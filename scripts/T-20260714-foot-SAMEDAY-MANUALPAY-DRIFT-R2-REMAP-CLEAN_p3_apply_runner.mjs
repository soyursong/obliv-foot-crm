/**
 * T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — Phase 3 APPLY RUNNER
 * apply.sql(frozen 8건: A소액5 + B고액1 + C진찰료single2) 집행 + freeze re-check + before/after count + 7-invariant self-test.
 * 현장 confirm("반영", slack ts 1784073864.554299, 2026-07-15) + reconcile-with-evidence(B군 이중계상 0) 완료 후 실행.
 * usage: node scripts/..._p3_apply_runner.mjs           (freeze re-check + self-test only, write 0)
 *        node scripts/..._p3_apply_runner.mjs --apply    (apply.sql 집행)
 * SOP: Cross-CRM Data-Correction Backfill — 대상셋 freeze 재확인(변동 시 abort) · net-zero · 롤백SQL · 원장 파괴 0 · R1 12행 무접촉.
 */
import { readFileSync } from 'node:fs';
const APPLY = process.argv.includes('--apply');
const env = readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
// 영향 6개 패키지(A 5 + B 이재성 가열). C 진찰료는 single → 패키지 무접촉.
const PKG_IDS=['2b8a0c23-9fb0-46c0-ba05-707ac8ae84cf','a2869398-631a-4dd3-84a2-1dc43ffb082c','f7f02420-966b-4ace-b076-c7c2aa80d01c','730a1e69-d5dd-420e-b4ba-e4f26e52b61a','db0a17a6-7f41-48e6-b076-96b74d6e7197','8d42dbcb-a2f3-47c0-8819-a914544ac578'];
const HERYU_24='876e1a55-0545-4c5f-8591-75609be0bd06'; // 허유희 24회권 (R2 무접촉 확인용)
// frozen 대상 closing_manual_payments 8건 (Phase1 확정)
const TARGET_CMP=['54f54cc3-cc54-4c66-bbb9-e4132bc5de7f','580bda4d-d408-4090-b9a5-763de19e5a6b','7021a5ca-ecc7-451b-93ed-eb784e5dc701','bb0bd71c-8e03-4e4f-bc2f-c9075bef58b4','3a713bd7-a151-40ff-a743-f31fe5af1cfe','e0280dbb-02b4-43d4-bf31-5d0dd0284ea8','78c19a4f-ec9e-4d0e-b1e8-a7a45116ebbd','4ff33dc0-36da-40c4-8181-e87f0bc6ecf8'];
const TARGET_SUM=417800;

async function counts(label){
  const cmp=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM closing_manual_payments WHERE clinic_id='${CLINIC}' AND close_date='2026-07-14';`))[0];
  const mpp=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM package_payments WHERE memo LIKE '%DRIFT-R2%';`))[0];
  const mpay=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE memo LIKE '%DRIFT-R2%';`))[0];
  const r1pp=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM package_payments WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`))[0];
  const r1pay=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`))[0];
  const pk=await q(`SELECT id, total_amount, paid_amount, (total_amount-paid_amount) bal FROM packages WHERE id IN (${PKG_IDS.map(i=>`'${i}'`).join(',')}) ORDER BY id;`);
  const heryu=(await q(`SELECT total_amount, paid_amount, (total_amount-paid_amount) bal FROM packages WHERE id='${HERYU_24}';`))[0];
  const bal0=pk.filter(p=>Number(p.bal)===0).length;
  const r1n=Number(r1pp.c)+Number(r1pay.c), r1s=Number(r1pp.s)+Number(r1pay.s);
  console.log(`[${label}] cmp_today=${cmp.c}(${cmp.s}) | R2_pp=${mpp.c}(${mpp.s}) R2_pay=${mpay.c}(${mpay.s}) | pkg_bal0=${bal0}/6 | 허유희24 bal=${heryu.bal} | R1마커=${r1n}행(${r1s})`);
  return {cmp,mpp,mpay,r1n,r1s,bal0,heryu};
}

// ── freeze re-check (SOP: 대상셋 freeze 재확인 → 변동 시 abort) ──
console.log('=== FREEZE RE-CHECK (대상셋 8건 frozen 재확인) ===');
const live=await q(`SELECT id, chart_number, customer_name, amount FROM closing_manual_payments WHERE clinic_id='${CLINIC}' AND close_date='2026-07-14' ORDER BY created_at;`);
const liveIds=live.map(r=>r.id).sort();
const wantIds=[...TARGET_CMP].sort();
const liveSum=live.reduce((a,r)=>a+Number(r.amount),0);
const idsMatch=liveIds.length===wantIds.length && liveIds.every((v,i)=>v===wantIds[i]);
console.log(`잔존 당일 수기수납: ${live.length}건 / SUM ${liveSum} (기대 8건 / ${TARGET_SUM})`);
for(const r of live) console.log(`  ${r.customer_name} chart=${JSON.stringify(r.chart_number)} amount=${r.amount} id=${r.id.slice(0,8)}`);
if(!idsMatch || liveSum!==TARGET_SUM){
  console.error(`\n❌ ABORT: freeze셋 변동 감지 (drift). 기대 8건/${TARGET_SUM} ≠ 실측 ${live.length}건/${liveSum}. Phase1 재대사 필요.`);
  process.exit(4);
}
console.log('✅ freeze셋 8건 정확 일치 (drift 0) — apply 진행 가능.\n');

const before=await counts('BEFORE');
if(!APPLY){ console.log('\n(dry — --apply 없이 종료. write 0.)'); process.exit(0); }

// pre-guard: R2 canonical 마커 사전존재 0 (double-apply 방지)
if(Number(before.mpp.c)>0||Number(before.mpay.c)>0){ console.error('ABORT: R2 canonical 마커 사전존재 — 이미 apply됨(double-apply 방지).'); process.exit(2); }
// R1 12행 사전 스냅샷 (무접촉 확증용)
if(before.r1n!==12 || before.r1s!==4608900){ console.error(`ABORT: R1 canonical 마커 사전상태 이상 (${before.r1n}행/${before.r1s}, 기대 12/4608900).`); process.exit(5); }

console.log('\n>>> apply.sql 집행...');
const sql=readFileSync('scripts/T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN_apply.sql','utf8');
await q(sql);
console.log('    집행 완료.\n');

const after=await counts('AFTER');

// ── 7-invariant self-test (evidence §7) ──
const chk=[];
chk.push(['① canonical package_payments(DRIFT-R2) = 6건 / 400,000', Number(after.mpp.c)===6 && Number(after.mpp.s)===400000, `${after.mpp.c}건/${after.mpp.s}`]);
chk.push(['② canonical payments(DRIFT-R2) = 2건 / 17,800', Number(after.mpay.c)===2 && Number(after.mpay.s)===17800, `${after.mpay.c}건/${after.mpay.s}`]);
chk.push(['③ 대상 6개 package balance = 0 (미수 전건 해소)', after.bal0===6, `${after.bal0}/6`]);
chk.push(['④ 허유희 24회권 balance = 0 (R2 무접촉)', Number(after.heryu.bal)===0, `bal=${after.heryu.bal}`]);
chk.push(['⑤ closing_manual_payments(2026-07-14) = 0건 (8건 DELETE)', Number(after.cmp.c)===0, `${after.cmp.c}건`]);
chk.push(['⑥ net-zero: SUM(canonical)==SUM(deleted)==417,800', Number(after.mpp.s)+Number(after.mpay.s)===TARGET_SUM && (Number(before.cmp.s)-Number(after.cmp.s))===TARGET_SUM, `canon=${Number(after.mpp.s)+Number(after.mpay.s)} / deleted=${Number(before.cmp.s)-Number(after.cmp.s)}`]);
chk.push(['⑦ R1 canonical 마커 12행/4,608,900 무변경', after.r1n===12 && after.r1s===4608900, `${after.r1n}행/${after.r1s}`]);
console.log('\n=== 7-INVARIANT SELF-TEST ===');
let pass=true;
for(const [name,ok,val] of chk){ console.log(`${ok?'✅':'❌'} ${name} (${val})`); if(!ok)pass=false; }
console.log(pass?'\n=== ALL PASS (7/7) ===':'\n=== FAIL — rollback.sql 검토 필요 ===');
process.exit(pass?0:3);
