/**
 * T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED — 전수 시뮬레이션 census (READ-ONLY, AC-4 재현)
 *
 * 고시 제19조(끝수계산) 단일 SSOT(applyArticle19Rounding, src/lib/footBilling.ts)의 알고리즘을 **정확 미러**해
 * prod status='printed' 전 서류의 급여/총액 토큰에 적용 → 수정 후 정합/위반/⑥가드 무접촉을 실측 재현한다.
 *
 * ⚠ 인증컨텍스트 = Management API /database/query (postgres role, RLS 우회). **READ-ONLY SELECT only. DB write 0.**
 * ⚠ prod(rxlomoozakkjesdqjtvd) 데이터는 a1973d0c 스냅샷(핸드오프 측정=342건) 이후 전진했다(08-05 하루 180건).
 *    본 census 는 현시점 live 전수(N)를 정직 보고 — 핵심 AC(수정 후 정합=N/N·위반0·비급여/detail 무접촉·⑥가드
 *    결제액 보존)는 데이터셋 크기와 무관하게 성립함을 실증한다(342 → live N 로 확대 재검증).
 *
 * 실행: node scripts/T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED_sim_census.mjs
 */
import fs from 'fs';
function loadEnv(p){const o={};if(!fs.existsSync(p))return o;for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}return o;}
const env={...loadEnv('.env.local'),...process.env};
const TOKEN=env.SUPABASE_ACCESS_TOKEN;const REF='rxlomoozakkjesdqjtvd';
if(!TOKEN){console.error('❌ SUPABASE_ACCESS_TOKEN 필요 (.env.local)');process.exit(1);}
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// ── SSOT 미러 (footBilling.ts applyArticle19Rounding / computeBillDetailRounding / floorOutpatientCopayment) ──
const parseAmount=(v)=> Number(String(v ?? '').replace(/[^\d-]/g,''))||0;
const floor10=(n)=> (Number.isFinite(n)&&n>0? Math.floor(n/10)*10 : 0);   // computeBillDetailRounding
const floor100=(n)=> (Number.isFinite(n)&&n>0? Math.floor(n/100)*100 : 0); // floorOutpatientCopayment
const COPAY_KEYS=['copayment','subtotal_copayment','total_copayment'];
const FUND_KEYS=['insurance_covered','subtotal_fund','total_fund'];
const NONCOV_KEYS=['non_covered','subtotal_noncovered','total_noncovered'];
const TOTAL_KEYS=['total_amount','subtotal_amount'];
const firstPresent=(fd,keys)=>{for(const k of keys)if(k in fd)return parseAmount(fd[k]);return null;};

function applyArticle19(fd){ // 제자리 변경 (SSOT 라인바이라인 미러)
  const copayRaw=firstPresent(fd,COPAY_KEYS), fundRaw=firstPresent(fd,FUND_KEYS);
  if(copayRaw==null&&fundRaw==null) return;
  const copay=copayRaw!=null&&copayRaw>0?copayRaw:0;
  const fund=fundRaw!=null&&fundRaw>0?fundRaw:0;
  const gupyeoRaw=copay+fund; if(gupyeoRaw<=0) return;
  const copayNew=floor100(copay), gupyeoNew=floor10(gupyeoRaw);
  const fundNew=Math.max(0,gupyeoNew-copayNew), delta=gupyeoNew-gupyeoRaw;
  for(const k of COPAY_KEYS) if(k in fd) fd[k]=copayNew;
  for(const k of FUND_KEYS) if(k in fd) fd[k]=fundNew;
  const nonCovRaw=firstPresent(fd,NONCOV_KEYS), nonCov=nonCovRaw!=null&&nonCovRaw>0?nonCovRaw:0;
  const treatTotalRaw=gupyeoRaw+nonCov;
  for(const k of TOTAL_KEYS){ if(!(k in fd)) continue; const cur=parseAmount(fd[k]); if(cur===treatTotalRaw) fd[k]=cur+delta; }
}

// ── 정합 판정 (핸드오프 DoD #1/#2/#3): 급여총액 floor10 · 본인 floor100 · treatment-total 10원배수+보존식 ──
function isCompliant(fd){
  const copay=firstPresent(fd,COPAY_KEYS), fund=firstPresent(fd,FUND_KEYS);
  if(copay==null&&fund==null) return null; // 비적용(급여 토큰 전무)
  const c=copay!=null&&copay>0?copay:0, f=fund!=null&&fund>0?fund:0;
  const gupyeo=c+f; if(gupyeo<=0) return null;
  const noncov=(()=>{const n=firstPresent(fd,NONCOV_KEYS);return n!=null&&n>0?n:0;})();
  if(c%100!==0) return false;            // ① 본인 floor100
  if(gupyeo%10!==0) return false;        // ② 급여총액 floor10
  for(const k of TOTAL_KEYS){ if(!(k in fd)) continue; const t=parseAmount(fd[k]);
    if(t===gupyeo+noncov){ if(t%10!==0) return false; } } // treatment-total 만 10원배수 요구(결제액 exempt)
  return true;
}
const isPaymentTotalRow=(fd)=>{ // ⑥가드: total_amount 가 진료비총액(급여+비급여)이 아님 = 결제액 등
  const copay=firstPresent(fd,COPAY_KEYS), fund=firstPresent(fd,FUND_KEYS);
  const c=copay!=null&&copay>0?copay:0, f=fund!=null&&fund>0?fund:0;
  const noncov=(()=>{const n=firstPresent(fd,NONCOV_KEYS);return n!=null&&n>0?n:0;})();
  const treat=c+f+noncov;
  for(const k of TOTAL_KEYS){ if(k in fd && parseAmount(fd[k])!==treat) return true; }
  return false;
};

// ── 전수 조회 ──
const rows=await sql(`
  select fs.id, coalesce(ft.form_key,'(none)') form_key, fs.field_data
  from form_submissions fs
  left join form_templates ft on ft.id=fs.template_id
  where fs.status='printed'`);
console.log(`✅ target=prod ${REF} · status='printed' 전수 N=${rows.length} (a1973d0c 스냅샷=342, 이후 전진)`);

let applicable=0, baseCompliant=0, postCompliant=0, postViolations=0;
let guardRows=0, guardValueChanged=0, noncovChanged=0, detailChanged=0;
const byForm={};
const violationSamples=[], changeSamples=[];

for(const r of rows){
  const fd=r.field_data||{};
  const comp0=isCompliant(fd);
  byForm[r.form_key]=byForm[r.form_key]||{n:0,base:0,post:0,viol:0,na:0};
  byForm[r.form_key].n++;
  if(comp0===null){ byForm[r.form_key].na++; continue; }
  applicable++;
  if(comp0) baseCompliant++;

  // 무접촉 기준 스냅샷
  const noncovBefore=NONCOV_KEYS.filter(k=>k in fd).map(k=>parseAmount(fd[k]));
  const detailBefore=['detail_total','detail_subtotal'].filter(k=>k in fd).map(k=>parseAmount(fd[k]));
  // ⑥가드는 total key **개별** 판정(진료비총액 key 만 조정·결제액 key 는 무접촉). 그래서 payment key 는 key 단위로 스냅샷.
  const cG=(()=>{const v=firstPresent(fd,COPAY_KEYS);return v!=null&&v>0?v:0;})();
  const fG=(()=>{const v=firstPresent(fd,FUND_KEYS);return v!=null&&v>0?v:0;})();
  const ncG=(()=>{const v=firstPresent(fd,NONCOV_KEYS);return v!=null&&v>0?v:0;})();
  const treatTotalG=cG+fG+ncG;
  const paymentKeyBefore={}; for(const k of TOTAL_KEYS) if(k in fd && parseAmount(fd[k])!==treatTotalG) paymentKeyBefore[k]=parseAmount(fd[k]);

  const after=JSON.parse(JSON.stringify(fd));
  applyArticle19(after);

  // ④ 비급여 무절사 · detail 불변 검증
  const noncovAfter=NONCOV_KEYS.filter(k=>k in after).map(k=>parseAmount(after[k]));
  const detailAfter=['detail_total','detail_subtotal'].filter(k=>k in after).map(k=>parseAmount(after[k]));
  if(JSON.stringify(noncovBefore)!==JSON.stringify(noncovAfter)){ noncovChanged++; }
  if(JSON.stringify(detailBefore)!==JSON.stringify(detailAfter)){ detailChanged++; }
  // ⑥가드: 결제액(진료비총액≠) total key 는 key 단위로 무접촉이어야 함(진료비총액 key 조정과 독립).
  if(Object.keys(paymentKeyBefore).length){ guardRows++;
    for(const k of Object.keys(paymentKeyBefore)) if(parseAmount(after[k])!==paymentKeyBefore[k]) guardValueChanged++; }

  const comp1=isCompliant(after);
  if(comp1){ postCompliant++; byForm[r.form_key].post++; }
  else { postViolations++; byForm[r.form_key].viol++;
    if(violationSamples.length<10) violationSamples.push({id:r.id.slice(0,8),form:r.form_key,
      copay:firstPresent(after,COPAY_KEYS),fund:firstPresent(after,FUND_KEYS),
      total:TOTAL_KEYS.filter(k=>k in after).map(k=>parseAmount(after[k]))}); }
  if(comp0) byForm[r.form_key].base++;
  if(!comp0 && comp1 && changeSamples.length<8)
    changeSamples.push({id:r.id.slice(0,8),form:r.form_key,
      before:{copay:firstPresent(fd,COPAY_KEYS),fund:firstPresent(fd,FUND_KEYS),total:TOTAL_KEYS.filter(k=>k in fd).map(k=>parseAmount(fd[k]))},
      after:{copay:firstPresent(after,COPAY_KEYS),fund:firstPresent(after,FUND_KEYS),total:TOTAL_KEYS.filter(k=>k in after).map(k=>parseAmount(after[k]))}});
}

const pct=(a,b)=> b? (100*a/b).toFixed(1)+'%':'-';
console.log('\n════════ 전수 시뮬레이션 결과 (AC-4) ════════');
console.log(`적용대상(급여 토큰 보유) applicable   : ${applicable}`);
console.log(`수정 전 정합 baseline compliant       : ${baseCompliant} (${pct(baseCompliant,applicable)})  ← 결함 재현(핸드오프 68/342≈23%)`);
console.log(`수정 후 정합 post-fix compliant       : ${postCompliant} / ${applicable}  (${pct(postCompliant,applicable)})`);
console.log(`수정 후 위반 post-fix violations      : ${postViolations}`);
console.log(`④ 비급여 값 변경 (must 0)             : ${noncovChanged}`);
console.log(`detail_total/subtotal 변경 (must 0)   : ${detailChanged}`);
console.log(`⑥가드 결제액-total row 수             : ${guardRows}`);
console.log(`⑥가드 결제액-total 값 변경 (must 0)   : ${guardValueChanged}  ← 결제액 진료비총액으로 안 날아감`);

console.log('\n════════ 양식별 (수정 전→후 정합) ════════');
for(const [k,v] of Object.entries(byForm).sort((a,b)=>b[1].n-a[1].n)){
  const app=v.n-v.na;
  console.log(`  ${k.padEnd(28)} N=${String(v.n).padStart(3)} 비적용=${String(v.na).padStart(3)} 수정전정합=${String(v.base).padStart(3)} 수정후정합=${String(v.post).padStart(3)}/${app} 위반=${v.viol}`);
}
if(violationSamples.length){ console.log('\n⚠ 위반 샘플:'); for(const s of violationSamples) console.log('   ',JSON.stringify(s)); }
console.log('\n════════ 수정 전→후 변경 샘플 (결함→정합) ════════');
for(const s of changeSamples) console.log('   ',JSON.stringify(s));

const verdict = (postCompliant===applicable && postViolations===0 && noncovChanged===0 && detailChanged===0 && guardValueChanged===0);
console.log(`\n${verdict?'✅ PASS':'❌ FAIL'} — 수정 후 정합 ${postCompliant}/${applicable}·위반 ${postViolations}·비급여변경 ${noncovChanged}·detail변경 ${detailChanged}·결제액total변경 ${guardValueChanged}`);

const out={ target:REF, snapshot_note:'a1973d0c=342, live moved forward', printed_total:rows.length,
  applicable, baseline_compliant:baseCompliant, post_compliant:postCompliant, post_violations:postViolations,
  noncov_changed:noncovChanged, detail_changed:detailChanged, guard_payment_rows:guardRows, guard_value_changed:guardValueChanged,
  by_form:byForm, verdict:verdict?'PASS':'FAIL', violation_samples:violationSamples, change_samples:changeSamples };
fs.writeFileSync('scripts/evidence/T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED_sim_census.json', JSON.stringify(out,null,2));
console.log('\n📄 evidence → scripts/evidence/T-20260806-foot-GUPYEO-TOTAL-FLOOR10-NOTAPPLIED_sim_census.json');
if(!verdict) process.exit(1);
