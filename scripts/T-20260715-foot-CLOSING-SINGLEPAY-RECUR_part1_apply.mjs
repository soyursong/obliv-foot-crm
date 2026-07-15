/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — Part1/Part0 정정 APPLY
 * ★★ 김주연 총괄 현장 확인 게이트 통과 후에만 실행. (금융성·prod 데이터 정정)
 *    실행: node scripts/..._part1_apply.mjs --confirm
 *    --confirm 없으면 abort. apply 직전 freeze 재검증(drift 시 abort).
 * data_correction_backfill_sop 준수. author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

if (!process.argv.includes('--confirm')) {
  console.error('ABORT: --confirm 없음. 김주연 총괄 현장 확인 게이트 통과 후 --confirm 으로만 실행.');
  process.exit(1);
}

// freeze셋 (dry-run 확정). apply 직전 재검증 abort-guard.
const FREEZE = [
  { pkg: '5ed60da7-990c-4407-9d63-cf61e1714789', chart: 'F-4666', name: '김지민', amount: 10000 },
  { pkg: '3f4d3ec6-30e1-47a1-873d-3e798043f240', chart: 'F-4716', name: '김희정', amount: 59000 },
];

for (const t of FREEZE) {
  const [row] = await q(`SELECT id, package_name, total_amount, paid_amount, status FROM public.packages WHERE id='${t.pkg}';`);
  if (!row) { console.error(`ABORT ${t.chart}: pkg ${t.pkg} 부재`); process.exit(1); }
  if (row.status !== 'active') { console.error(`ABORT ${t.chart}: status=${row.status}(active 아님, drift)`); process.exit(1); }
  if (Number(row.paid_amount) !== 0) { console.error(`ABORT ${t.chart}: paid_amount=${row.paid_amount}(0 아님, 이미 정정/drift)`); process.exit(1); }
  if (Number(row.total_amount) !== t.amount) { console.error(`ABORT ${t.chart}: total_amount=${row.total_amount}!=${t.amount}(drift)`); process.exit(1); }
}
console.log('✅ freeze 재검증 통과 — apply 진행');

for (const t of FREEZE) {
  await q(`UPDATE public.packages SET paid_amount=${t.amount} WHERE id='${t.pkg}' AND paid_amount=0;`);
  console.log(`APPLIED: ${t.chart} ${t.name} paid_amount 0→${t.amount}`);
}

// postverify 불변식
console.log('\n======== postverify ========');
for (const t of FREEZE) {
  const [row] = await q(`SELECT total_amount, paid_amount FROM public.packages WHERE id='${t.pkg}';`);
  const due = Number(row.total_amount) - Number(row.paid_amount);
  console.log(`V1 ${t.chart}: due=${due} ${due===0?'PASS':'FAIL'}`);
}
const [payCnt] = await q(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net FROM public.payments WHERE created_at>='2026-07-15T00:00:00+09:00' AND created_at<'2026-07-16T00:00:00+09:00';`);
console.log(`V2 payments 07-15: ${payCnt.n}행 net=${payCnt.net} (신규 결제 write 0 — 값 불변이어야 함)`);
const [cmpCnt] = await q(`SELECT COUNT(*) n FROM public.closing_manual_payments WHERE close_date='2026-07-15';`);
console.log(`V3 closing_manual_payments 07-15: ${cmpCnt.n}행 (무접점 — 0 유지)`);
console.log('\n※ Rollback: UPDATE packages SET paid_amount=0 WHERE id IN (...freeze pkgs...);');
