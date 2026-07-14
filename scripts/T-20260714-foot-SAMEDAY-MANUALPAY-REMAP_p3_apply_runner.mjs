/**
 * T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 3 APPLY RUNNER
 * apply.sql(v2, re-frozen 12건) 집행 + before/after count + net-zero/invariant self-test.
 * 현장 confirm("반영해주세요") + reconcile-with-evidence 완료 후 실행.
 * usage: node scripts/..._p3_apply_runner.mjs           (self-test only, no write)
 *        node scripts/..._p3_apply_runner.mjs --apply    (apply.sql 집행)
 */
import { readFileSync } from 'node:fs';
const APPLY = process.argv.includes('--apply');
const env = readFileSync('.env.local','utf8');
const tok=(env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PKG_IDS=['f84a95cd-ab07-4f83-8760-d941c46ed079','04feb879-afbf-4158-ba29-3dfaa39c0c3c','3ba632cd-82ec-4abc-89ca-7ac2ca710286','1f7a61f1-f7d0-438b-adb6-620d203969db','84808f19-c6c4-45d6-bf85-8e242b01bee4','a8d402ba-7763-4dd8-8f63-5fca23dc484c','387c8f6a-f151-426d-ac56-96366188a2f4','24e02b64-84b0-4e44-82cd-670768340927','692fb8d5-ce16-48c0-a25b-19c885757483','1637a08f-5d5a-4eab-bcb8-aea9b84253e1','876e1a55-0545-4c5f-8591-75609be0bd06'];
const HERYU='876e1a55-0545-4c5f-8591-75609be0bd06';

async function counts(label){
  const cmp=(await q(`SELECT COUNT(*) c FROM closing_manual_payments WHERE clinic_id='${CLINIC}' AND close_date='2026-07-14';`))[0].c;
  const mpp=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM package_payments WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`))[0];
  const mpay=(await q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE memo LIKE '%T-20260714-SAMEDAY-REMAP%';`))[0];
  const pk=await q(`SELECT id, paid_amount, (total_amount-paid_amount) bal FROM packages WHERE id IN (${PKG_IDS.map(i=>`'${i}'`).join(',')}) ORDER BY id;`);
  const heryu=(await q(`SELECT total_amount, paid_amount, (total_amount-paid_amount) bal FROM packages WHERE id='${HERYU}';`))[0];
  const bal0=pk.filter(p=>Number(p.bal)===0).length;
  console.log(`[${label}] cmp_today=${cmp} | marker_pp=${mpp.c}(${mpp.s}) marker_pay=${mpay.c}(${mpay.s}) | pkg_bal0=${bal0}/11 | heryu total=${heryu.total_amount} paid=${heryu.paid_amount} bal=${heryu.bal}`);
  return {cmp:Number(cmp),mpp,mpay,bal0,heryu};
}

const before=await counts('BEFORE');
if(!APPLY){ console.log('\n(dry — --apply 없이 종료. write 0.)'); process.exit(0); }

// pre-guard: canonical 마커 사전존재 0 확인 (double-apply 방지)
if(Number(before.mpp.c)>0||Number(before.mpay.c)>0){ console.error('ABORT: canonical 마커 사전존재 — 이미 apply됨(double-apply 방지).'); process.exit(2); }

console.log('\n>>> apply.sql 집행...');
const sql=readFileSync('scripts/T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN_apply.sql','utf8');
await q(sql);
console.log('    집행 완료.\n');

const after=await counts('AFTER');

// ── invariant self-test ──
const chk=[];
chk.push(['cmp_today 12건 감소', before.cmp-after.cmp===12, `${before.cmp}→${after.cmp}`]);
chk.push(['canonical package_payments 11건', Number(after.mpp.c)===11, `${after.mpp.c}`]);
chk.push(['canonical package_payments 합계 4,600,000(=10*10k+4.5M)', Number(after.mpp.s)===4600000, `${after.mpp.s}`]);
chk.push(['canonical payments 1건(이미현 8,900)', Number(after.mpay.c)===1 && Number(after.mpay.s)===8900, `${after.mpay.c}/${after.mpay.s}`]);
chk.push(['net-zero(canonical합=삭제합 4,608,900)', Number(after.mpp.s)+Number(after.mpay.s)===4608900, `${Number(after.mpp.s)+Number(after.mpay.s)}`]);
chk.push(['11개 패키지 balance 0(미수해소)', after.bal0===11, `${after.bal0}/11`]);
chk.push(['허유희 paid=4,880,000 balance 0(이중계상 0)', Number(after.heryu.paid_amount)===4880000 && Number(after.heryu.bal)===0, `paid=${after.heryu.paid_amount} bal=${after.heryu.bal}`]);
console.log('\n=== SELF-TEST ===');
let pass=true;
for(const [name,ok,val] of chk){ console.log(`${ok?'✅':'❌'} ${name} (${val})`); if(!ok)pass=false; }
console.log(pass?'\n=== ALL PASS ===':'\n=== FAIL — rollback 검토 필요 ===');
process.exit(pass?0:3);
