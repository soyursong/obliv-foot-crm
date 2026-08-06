/**
 * T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase B-RECHECK READ-ONLY 재진단
 *
 * ⛔ READ-ONLY. prod WRITE/DELETE/DDL 0. 전부 SELECT. 재-apply 금지.
 * 인증컨텍스트: Supabase Management API /database/query = service_role 권한(RLS 우회) SELECT.
 *
 * 08-05 19:48 Phase B apply(UPDATE payments SET package_id WHERE id=8bf6ac26, rows-affected==1)
 * + 트리거 refunded→active 복원 이후, 총괄 재제보에 대한 현재 prod 원장 실측.
 *
 *   RC-1: 현재 prod F-4717 packages.status = active / refunded?
 *   RC-2: repay payment(8bf6ac26) package_id 링크 현재도 실재? (revert 여부)
 *   RC-3: 08-05 19:48 apply 이후 신규 재결제/환불 이벤트 추가 발생?
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const j = (x) => JSON.stringify(x, null, 2);

const PKG = '9455ca84-5798-413b-bd45-7457616d7f55';   // F-4717 현은호 패키지
const REPAY = '8bf6ac26-dd20-4cfc-af38-7113868c9882'; // 08-05 링크한 재결제 payment
const APPLY_AT = '2026-08-05 19:48:00';               // Phase B apply 시각(KST 표기, UTC 대조)

console.log('════════ F-4717 Phase B-RECHECK 재진단 (READ-ONLY, service_role) ════════');
console.log(`실행시각(server now): 아래 now 참조 / PKG=${PKG} / REPAY=${REPAY}\n`);

const now = await q(`SELECT now() AT TIME ZONE 'Asia/Seoul' AS kst_now, now() AS utc_now`);
console.log('── server now ──'); console.log(j(now));

// ── 대상 고객 재확인 (chart F-4717) ──
const cust = await q(`
  SELECT id, name, chart_number FROM customers WHERE chart_number ILIKE '%4717%'`);
console.log('\n── 고객 식별 (chart 4717) ──'); console.log(j(cust));
const CID = (cust.find((c) => /(^|\D)4717(\D|$)/.test(String(c.chart_number))) || cust[0] || {}).id;

// ════════ RC-1: 현재 packages.status ════════
console.log('\n════════ RC-1: 현재 prod F-4717 packages.status ════════');
const rc1 = await q(`
  SELECT id, package_name, status, total_amount, paid_amount, total_sessions,
         superseded_by, transferred_to, updated_at
  FROM packages WHERE id = '${PKG}'`);
console.log(j(rc1));

// ════════ RC-2: repay payment package_id 링크 실재 ════════
console.log('\n════════ RC-2: repay payment(8bf6ac26) package_id 링크 실재 여부 ════════');
const rc2 = await q(`
  SELECT id, package_id, customer_id, amount, method, payment_type, status,
         external_trxid, external_approval_no, reconciled_at, accounting_date,
         cancelled_at, deleted_at, created_at
  FROM payments WHERE id = '${REPAY}'`);
console.log(j(rc2));

// ════════ RC-3: 08-05 apply 이후 신규 재결제/환불 이벤트 ════════
console.log('\n════════ RC-3: 08-05 19:48 apply 이후 신규 payments 이벤트 (KST) ════════');
const rc3pay = await q(`
  SELECT id, package_id, amount, method, payment_type, status,
         (created_at AT TIME ZONE 'Asia/Seoul') AS created_kst,
         external_approval_no, cancelled_at, deleted_at
  FROM payments
  WHERE customer_id = '${CID}'
    AND created_at > (TIMESTAMP '${APPLY_AT}' AT TIME ZONE 'Asia/Seoul')
  ORDER BY created_at`);
console.log('── payments (원장② after apply) ──'); console.log(j(rc3pay));

const rc3pp = await q(`
  SELECT id, package_id, amount, method, payment_type,
         (created_at AT TIME ZONE 'Asia/Seoul') AS created_kst, memo
  FROM package_payments
  WHERE customer_id = '${CID}'
    AND created_at > (TIMESTAMP '${APPLY_AT}' AT TIME ZONE 'Asia/Seoul')
  ORDER BY created_at`);
console.log('── package_payments (원장① after apply) ──'); console.log(j(rc3pp));

// ── 보강: F-4717 전 payments 원장(맥락 완전성) ──
console.log('\n── (보강) F-4717 전체 payments 원장 스냅샷 ──');
const allpay = await q(`
  SELECT id, package_id, amount, method, payment_type, status,
         (created_at AT TIME ZONE 'Asia/Seoul') AS created_kst,
         reconciled_at, cancelled_at, deleted_at
  FROM payments WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log(j(allpay));

// ── 판정 요약 ──
const pkg = rc1[0] || {};
const rep = rc2[0] || {};
console.log('\n════════ 판정 요약 ════════');
console.log(`RC-1 packages.status       = ${pkg.status}  (기대: active)`);
console.log(`RC-2 repay.package_id      = ${rep.package_id}  (기대: ${PKG})`);
console.log(`RC-2 repay linked?         = ${rep.package_id === PKG}`);
console.log(`RC-3 apply 이후 신규 pay    = ${rc3pay.length}건 / 신규 pp = ${rc3pp.length}건`);
const newUnlinked = rc3pay.filter((r) => !r.package_id && (r.payment_type === 'payment' || Number(r.amount) > 0));
console.log(`RC-3 신규 미링크 재결제 후보 = ${newUnlinked.length}건`);
console.log('\n분기:');
if (pkg.status === 'active' && rep.package_id === PKG && rc3pay.length === 0) {
  console.log('  → (a) active·링크정상·신규0 = apply 영속 확인. 현장 stale 캐시/세션 가설 → responder relay(새로고침·재로그인).');
} else if (pkg.status !== 'active' || rep.package_id !== PKG) {
  console.log('  → (b) refunded/미링크 = apply 미영속 or revert → 기계레일(archive-first·DA·supervisor dry-run) 재정정.');
}
if (newUnlinked.length > 0) {
  console.log('  → (c) 신규 미링크 재결제 발견 = FWDFIX 회귀 P0 별 조사.');
}
