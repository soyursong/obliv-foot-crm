/**
 * T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 파트1 APPLY + postverify
 *   preflight_dryrun.mjs 가 ✅ 판정한 뒤에만 실행. apply.sql 을 트랜잭션 실행 후 postverify.
 * author: dev-foot / 2026-07-20
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
}
const PKG = '9455ca84-5798-413b-bd45-7457616d7f55';
const MANUAL = 'd38b38fb-a60d-41b1-91fa-05548c9f51bf';

// re-guard: dry-run 안전조건 재확인(apply 직전 지문 재검증 — freeze셋 변동 시 abort)
const guard = await q(`
  SELECT
    (SELECT count(*) FROM public.closing_manual_payments
       WHERE id='${MANUAL}' AND amount=1260000 AND method='transfer'
         AND chart_number='F-4717' AND close_date='2026-07-20' AND voided_at IS NULL) AS manual_fp,
    (SELECT count(*) FROM public.package_payments
       WHERE package_id='${PKG}' AND amount=1260000 AND method='transfer') AS canon_exist;`);
if (guard[0].manual_fp !== 1 || guard[0].canon_exist !== 0) {
  console.error('⛔ ABORT — apply 직전 지문 재검증 실패', guard[0]); process.exit(2);
}

const sql = readFileSync('scripts/T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC_apply.sql', 'utf8');
await q(sql);
console.log('✅ apply.sql 실행 완료');

// ── postverify ──
const pv = {};
pv.package = await q(`SELECT total_amount, paid_amount, (total_amount-paid_amount) AS due_after FROM public.packages WHERE id='${PKG}';`);
pv.package_payments = await q(`SELECT amount, method, payment_type, fee_kind, memo FROM public.package_payments WHERE package_id='${PKG}' ORDER BY created_at;`);
pv.manual = await q(`SELECT id, amount, method, voided_at, voided_reason FROM public.closing_manual_payments WHERE id='${MANUAL}';`);
console.log(JSON.stringify(pv, null, 2));

const due = Number(pv.package[0].due_after);
const voided = pv.manual[0].voided_at != null;
const canonTransfer = pv.package_payments.filter(r => r.method === 'transfer' && r.amount === 1260000).length;
console.log('\n─── POSTVERIFY ───');
console.log(`due_after=${due} (기대 0)`);
console.log(`manual soft-void=${voided} (기대 true)`);
console.log(`canonical transfer leg=${canonTransfer}건 (기대 1)`);
const ok = due === 0 && voided && canonTransfer === 1;
console.log(ok ? '✅ 정정 성공 (net-zero, 미수 0)' : '⛔ 정정 검증 실패 — 롤백 검토');
process.exit(ok ? 0 : 2);
