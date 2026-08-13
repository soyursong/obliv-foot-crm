// READ-ONLY supervisor POST-APPLY re-probe — T-20260811-foot-FIX2B-SOFTVOID
// 사후검증(§8): dev APPLY-RESULT 신뢰 아닌 판정시각 prod 실측. 종단상태 = applied.
import { q } from './dryrun_lib.mjs';

const IDS = "'2dedc31e-109d-46c6-b592-afe25b8d46b0','1799c939-a810-481d-ae41-1d50937e180b','ea1f5000-b48c-4ddd-9faa-23925a27d40f'";
const PHANTOMS = "'d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','9d8c6f77-dbe0-40c1-a024-5b33b23fb035'";
const TICKET = 'dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID';

const fails = [];
const chk = (cond, label) => { console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`); if (!cond) fails.push(label); };
const p = (label, rows) => { console.log(`\n### ${label}`); console.log(JSON.stringify(rows, null, 2)); return rows; };

// 1) 3 TARGET rows — must be cancelled BY THIS TICKET, service_charge_id NULL, identity intact
const t = await q(
  `SELECT id, status, amount, payment_type, memo, customer_id, check_in_id,
          linked_payment_id, service_charge_id, cancelled_by, cancelled_at
     FROM public.payments WHERE id IN (${IDS}) ORDER BY amount;`);
p('1) 3 TARGET rows current state', t);
chk(t.length === 3, '대상 3행 존재');
chk(t.every(r => r.status === 'cancelled'), '3행 전부 status=cancelled');
chk(t.every(r => r.cancelled_by === TICKET), '3행 전부 cancelled_by=이 티켓');
chk(t.every(r => r.service_charge_id === null), '3행 service_charge_id=NULL (insurance-split 무접촉)');
chk(t.every(r => r.payment_type === 'refund' && r.memo === 'crm오류'), '3행 identity(refund/crm오류) 불변');
chk(t.map(r => Number(r.amount)).sort((a,b)=>a-b).join(',') === '3100,5600,261700', '금액 3100/5600/261700 불변');

// 2) OVER-VOID GUARD — cancelled_by=this ticket 인 행은 정확히 이 3행뿐(stray write 0)
const stray = await q(
  `SELECT count(*) AS n, coalesce(sum(amount),0) AS total
     FROM public.payments WHERE cancelled_by='${TICKET}';`);
p('2) OVER-VOID GUARD: rows cancelled_by this ticket (must be exactly 3, sum 270400)', stray);
chk(Number(stray[0].n) === 3, '이 티켓이 취소한 행 = 정확히 3 (초과 취소 0)');
chk(Number(stray[0].total) === 270400, '이 티켓 취소 총액 = 270,400');

// 3) IDEMPOTENT: active fingerprint match 는 이제 0 (남은 active 없음)
const act = await q(
  `SELECT count(*) AS n FROM public.payments
    WHERE customer_id='c18b7fd4-1183-4fa1-8aa3-442a65ee24d2'
      AND payment_type='refund' AND memo='crm오류' AND status='active'
      AND check_in_id='3c69ac66-63e3-451d-ae42-33a8ef88a1b3'
      AND linked_payment_id IN (${PHANTOMS});`);
p('3) IDEMPOTENT: active fingerprint remaining (must be 0)', act);
chk(Number(act[0].n) === 0, 'active 잔여 0 (멱등 종단)');

// 4) PHANTOM parents — MATAEMIN 소유, 이 티켓 무접촉
const ph = await q(
  `SELECT id, status, amount, cancelled_by FROM public.payments WHERE id IN (${PHANTOMS}) ORDER BY amount;`);
p('4) PHANTOM parents untouched (cancelled by MATAEMIN, NOT this ticket)', ph);
chk(ph.every(r => r.status === 'cancelled'), 'phantom 3행 cancelled 유지');
chk(ph.every(r => r.cancelled_by === 'dev-foot:T-20260804-MATAEMIN-ROLLBACK'), 'phantom cancelled_by=MATAEMIN (본 티켓 무접촉)');

// 5) LEDGER — schema_migrations 20260812150000 PRESENT
const led = await q(
  `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='20260812150000';`);
p('5) LEDGER: schema_migrations 20260812150000 (must be present)', led);
chk(led.length === 1, 'schema_migrations 20260812150000 등재됨');

// 6) REVENUE authority — v_daily_revenue 08-04 single=3,851,000, 08-03 불변
const rev = await q(
  `SELECT dt, single_revenue, package_revenue, net_revenue
     FROM public.v_daily_revenue
    WHERE dt IN ('2026-08-03','2026-08-04') ORDER BY dt;`);
p('6) REVENUE: v_daily_revenue 08-03 & 08-04', rev);
const d04 = rev.find(r => String(r.dt).startsWith('2026-08-04'));
chk(!!d04 && Number(d04.single_revenue) === 3851000, '08-04 single_revenue = 3,851,000 (Δ+270,400 반영)');

console.log(`\n=== POST-APPLY VERDICT: ${fails.length === 0 ? 'ALL PASS' : 'FAIL(' + fails.length + ')'} ===`);
if (fails.length) { console.log(JSON.stringify(fails, null, 2)); process.exit(1); }
