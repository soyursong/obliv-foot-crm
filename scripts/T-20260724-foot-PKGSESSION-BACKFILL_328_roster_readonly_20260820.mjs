/**
 * T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY
 * ── 328 backfill 대상자 명단 read-only 추출 (FM3 총괄 재확인 sub-gate) ──
 * planner NEW-TASK MSG-20260820-082125-zju8.
 *
 * READ-ONLY: prod write 0 / DDL 0 / mutation 0 (Management API service_role SELECT only).
 * 328 = 프리즈316(remeasure316.json snapshot.rows) + delta12(delta12.json gb_preimage).
 * 금액/날짜 = 프리즈 canonical(드리프트 무관). 환자명/시술명 = prod enrich(join).
 * PHI: 환자명 마스킹(홍*동) · 전화/주민번호/연락처 컬럼 일절 미포함.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = '/Users/domas/GitHub/obliv-foot-crm';
const env = readFileSync(`${REPO}/.env.local`, 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// ── 1. 328 대상 로드 (프리즈316 + delta12) ──
const frozen = JSON.parse(readFileSync('/tmp/pkg328/remeasure316.json','utf8'));
const delta  = JSON.parse(readFileSync('/tmp/pkg328/delta12.json','utf8'));

const rows316 = frozen.snapshot.rows.map(r => ({
  cis_id: r.cis_id, price: r.price, visit_date: r.kst_date, session_type: r.session_type, set: 'freeze316',
}));
const rows12 = delta.gb_preimage.map(r => ({
  cis_id: r.cis_id, price: r.price, visit_date: (r.created_kst||'').slice(0,10), session_type: r.session_type, set: 'delta12',
}));
const all = [...rows316, ...rows12];
if (all.length !== 328) throw new Error(`대상 수 불일치: ${all.length} != 328`);
const sumTotal = all.reduce((a,r)=>a+r.price,0);
const sum316 = rows316.reduce((a,r)=>a+r.price,0);
const sum12  = rows12.reduce((a,r)=>a+r.price,0);
console.log(`대상 ${all.length}건 | 316분 ₩${sum316.toLocaleString()} + delta12 ₩${sum12.toLocaleString()} = ₩${sumTotal.toLocaleString()}`);
if (sumTotal !== 77450000) throw new Error(`합계 불일치: ${sumTotal} != 77,450,000`);

// ── 2. prod enrich (READ-ONLY SELECT · 환자명/시술명/실 방문일) ──
const idList = all.map(r=>`'${r.cis_id}'`).join(',');
const enrichRows = await q(`
  SELECT c.id AS cis_id,
         ci.customer_id,
         COALESCE(NULLIF(TRIM(cust.name),''), ci.customer_name) AS customer_name,
         s.name AS service_name,
         s.service_code,
         (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date::text AS checkin_date,
         ci.created_date::text AS created_date
  FROM public.check_in_services c
  JOIN public.check_ins ci ON ci.id = c.check_in_id
  LEFT JOIN public.customers cust ON cust.id = ci.customer_id
  JOIN public.services s ON s.id = c.service_id
  WHERE c.id IN (${idList})
`);
const emap = new Map(enrichRows.map(r=>[r.cis_id, r]));
console.log(`enrich 매칭: ${enrichRows.length}/328`);

// ── 3. 마스킹 ──
function maskName(n){
  if(!n) return '(무명)';
  n = String(n).trim();
  const ch=[...n];
  if(ch.length<=1) return n+'*';
  if(ch.length===2) return ch[0]+'*';
  // 3+ : 첫·끝 유지, 가운데 마스킹
  return ch[0] + '*'.repeat(ch.length-2) + ch[ch.length-1];
}

// ── 4. 병합 + 정렬(방문일 asc, 이름) ──
const merged = all.map(r=>{
  const e = emap.get(r.cis_id) || {};
  const rawName = e.customer_name || null;
  return {
    cis_id: r.cis_id,
    customer_id: e.customer_id || null,
    name_masked: maskName(rawName),
    visit_date: r.visit_date,                       // canonical 프리즈 KST 방문일
    checkin_date: e.checkin_date || null,           // 참고: 실 체크인일
    service_name: e.service_name || `(${r.session_type})`,
    service_code: e.service_code || null,
    price: r.price,
    set: r.set,
  };
});
merged.sort((a,b)=> (a.visit_date<b.visit_date?-1:a.visit_date>b.visit_date?1: (a.name_masked<b.name_masked?-1:1)));

const enrichMiss = merged.filter(m=>!emap.has(m.cis_id));
const listSum = merged.reduce((a,r)=>a+r.price,0);
console.log(`명단 소계 재검증: ₩${listSum.toLocaleString()} (== 77,450,000: ${listSum===77450000})`);
console.log(`enrich 미매칭: ${enrichMiss.length}건`);

writeFileSync('/tmp/pkg328/merged328.json', JSON.stringify({
  generated_kst: null, total: merged.length, sum: listSum, sum316, sum12,
  enrich_matched: enrichRows.length, enrich_missing: enrichMiss.length, rows: merged,
}, null, 2));
console.log('WROTE /tmp/pkg328/merged328.json');
