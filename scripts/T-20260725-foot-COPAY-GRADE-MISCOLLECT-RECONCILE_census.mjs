import { readFileSync } from 'fs';
const env = {}; for (const line of readFileSync('.env.local','utf8').split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,''); }
const BASE = env.VITE_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (p) => { const r = await fetch(`${BASE}/rest/v1/${p}`, { headers: H }); if(!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`); return r.json(); };
console.log('TARGET DB:', BASE, '(role=service_role, RLS bypassed)\n');

// 1. customers by insurance_grade — the affected population source of truth
const custs = await get('customers?select=id,insurance_grade,clinic_id');
const cg = {}; for (const c of custs) cg[c.insurance_grade ?? 'NULL'] = (cg[c.insurance_grade??'NULL']||0)+1;
console.log(`=== customers total: ${custs.length} — by insurance_grade ===`);
for (const [k,v] of Object.entries(cg).sort((a,b)=>b[1]-a[1])) console.log(`  ${v}\t${k}`);
const AFF = ['low_income_1','low_income_2','medical_aid_2'];
const affCust = custs.filter(c=>AFF.includes(c.insurance_grade));
console.log(`  → AFFECTED-grade customers (low_income_1/2, medical_aid_2): ${affCust.length}`);
// also medical_aid_1 (flat, unchanged) for completeness
console.log(`  → (ref) medical_aid_1 customers: ${custs.filter(c=>c.insurance_grade==='medical_aid_1').length}, elderly_flat: ${custs.filter(c=>c.insurance_grade==='elderly_flat').length}, foreigner: ${custs.filter(c=>c.insurance_grade==='foreigner').length}`);

// 2. payments — resettle_confirmed_grade + total collected
const pays = await get('payments?select=id,amount,payment_type,status,resettle_confirmed_grade,created_at,check_in_id&order=created_at.asc');
console.log(`\n=== payments total: ${pays.length} ===`);
const rg = {}; for (const p of pays) rg[p.resettle_confirmed_grade ?? 'NULL']=(rg[p.resettle_confirmed_grade??'NULL']||0)+1;
console.log('  resettle_confirmed_grade distribution:'); for (const [k,v] of Object.entries(rg)) console.log(`    ${v}\t${k}`);
const affPay = pays.filter(p=>AFF.includes(p.resettle_confirmed_grade));
console.log(`  → payments with AFFECTED resettle grade: ${affPay.length}`);

// 3. service_charges full recompute (validate logic on general + scan any affected)
function copayFromBase(grade, base, rate, hasOverride){
  if(base<=0) return 0;
  if(grade==='low_income_1') return 0;
  if(grade==='medical_aid_1'||grade==='low_income_2'||grade==='medical_aid_2') return Math.min(1000,base);
  if(grade==='elderly_flat' && !hasOverride){ let c; if(base<=15000)c=Math.min(1500,base); else if(base<=20000)c=Math.floor(base*0.10/100)*100; else if(base<=25000)c=Math.floor(base*0.20/100)*100; else c=Math.floor(base*0.30/100)*100; return Math.min(c,base);}
  return Math.min(Math.floor(base*rate/100)*100, base);
}
function baseRate(g){return ({general:.3,low_income_1:0,low_income_2:0,medical_aid_1:0,medical_aid_2:0,infant:.21,elderly_flat:.3,foreigner:1}[g])??.3;}
const charges = await get('service_charges?select=*&order=calculated_at.asc');
console.log(`\n=== service_charges: ${charges.length} — recompute (correct v1.6) vs stored ===`);
let mismatch=0, affCharge=0;
for(const c of charges){
  const g=c.customer_grade_at_charge;
  if(AFF.includes(g)) affCharge++;
  if(!c.is_insurance_covered) continue;
  const rate = c.copayment_rate_at_charge!=null?Number(c.copayment_rate_at_charge):baseRate(g);
  const correct = (g==='foreigner')? c.base_amount : copayFromBase(g, c.base_amount, rate, c.copayment_rate_at_charge!=null);
  const diff = c.copayment_amount - correct;
  if(diff!==0){ mismatch++; console.log(`  ⚠ diff=${diff} grade=${g} base=${c.base_amount} stored=${c.copayment_amount} correct=${correct} at=${c.calculated_at?.slice(0,10)}`);}
}
console.log(`  covered recompute mismatches: ${mismatch} | affected-grade charges: ${affCharge}`);
console.log('\n=== VERDICT ===');
console.log(`affected-grade customers=${affCust.length}, affected charges=${affCharge}, affected payments(resettle)=${affPay.length}`);
