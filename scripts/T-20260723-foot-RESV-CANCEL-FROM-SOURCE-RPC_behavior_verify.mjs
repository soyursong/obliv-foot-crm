/**
 * T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC — 행동실증(AC-1/AC-2/AC-4/AC-5).
 *   prod 에 sentinel 테스트행을 잠시 심어 cancel_reservation_from_source 실동작을 검증 후 전량 삭제(무잔류).
 *   AC-6(도파민→풋 e2e)는 supervisor 소관 — 본 스크립트는 RPC 계약 실증 evidence 생성용.
 * 실행: node scripts/T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC_behavior_verify.mjs
 */
import { query } from './lib/foot_migration_ledger.mjs';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot
const TAG = '__accttest_cancel_20260723__';
const EXT1 = `${TAG}A`;
const EXT2 = `${TAG}B`;
const q1 = (o) => (Array.isArray(o) && o[0] ? o[0] : null);
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) ok = false; };

async function cleanup() {
  await query(`DELETE FROM public.check_ins WHERE reservation_id IN (SELECT id FROM public.reservations WHERE external_id LIKE '${TAG}%');`).catch(() => {});
  await query(`DELETE FROM public.reservations WHERE source_system='dopamine' AND external_id LIKE '${TAG}%';`).catch(() => {});
}

try {
  await cleanup(); // 이전 잔류 방지

  // ── AC-1: 활성 dopamine 예약 → cancel ──────────────────────────────────────
  const r1 = q1(await query(`
    INSERT INTO public.reservations (clinic_id, reservation_date, reservation_time, customer_name, status, source_system, external_id)
    VALUES ('${CLINIC}', CURRENT_DATE + 3, '10:00', '취소테스트A', 'confirmed', 'dopamine', '${EXT1}')
    RETURNING id;`));
  console.log(`seed R1 = ${r1.id}`);
  const c1 = q1(await query(`SELECT public.cancel_reservation_from_source('dopamine','${EXT1}','acct-test') AS o;`)).o;
  check(c1.action === 'cancelled' && c1.applied === true && c1.rows_affected === 1, `AC-1 cancel → ${JSON.stringify(c1)}`);
  const s1 = q1(await query(`SELECT status FROM public.reservations WHERE id='${r1.id}';`)).status;
  check(s1 === 'cancelled', `AC-1 status='cancelled' (실측=${s1})`);

  // ── AC-2: 재호출 멱등 → noop_already_cancelled ─────────────────────────────
  const c1b = q1(await query(`SELECT public.cancel_reservation_from_source('dopamine','${EXT1}') AS o;`)).o;
  check(c1b.action === 'noop_already_cancelled' && c1b.applied === false, `AC-2 재호출 멱등 → ${JSON.stringify(c1b)}`);

  // ── AC-4: 하류(check_in) 존재 → refused_downstream (순소실0) ────────────────
  const r2 = q1(await query(`
    INSERT INTO public.reservations (clinic_id, reservation_date, reservation_time, customer_name, status, source_system, external_id)
    VALUES ('${CLINIC}', CURRENT_DATE + 3, '11:00', '취소테스트B', 'confirmed', 'dopamine', '${EXT2}')
    RETURNING id;`));
  console.log(`seed R2 = ${r2.id}`);
  await query(`INSERT INTO public.check_ins (clinic_id, customer_name, reservation_id, status) VALUES ('${CLINIC}', '취소테스트B', '${r2.id}', 'registered');`);
  const statusBefore = q1(await query(`SELECT status FROM public.reservations WHERE id='${r2.id}';`)).status;
  const c2 = q1(await query(`SELECT public.cancel_reservation_from_source('dopamine','${EXT2}') AS o;`)).o;
  check(c2.action === 'refused_downstream' && c2.applied === false && (c2.downstream?.check_ins ?? 0) >= 1,
    `AC-4 하류 존재 → 취소거부 ${JSON.stringify(c2)}`);
  const statusAfter = q1(await query(`SELECT status FROM public.reservations WHERE id='${r2.id}';`)).status;
  check(statusAfter !== 'cancelled' && statusAfter === statusBefore, `AC-4 순소실0: status 불변 (${statusBefore}→${statusAfter})`);
} finally {
  await cleanup();
  const left = q1(await query(`SELECT count(*)::int AS n FROM public.reservations WHERE external_id LIKE '${TAG}%';`)).n;
  console.log(`\n[CLEANUP] 잔류 테스트행 = ${left} (기대 0)`);
  if (left !== 0) ok = false;
}
console.log(ok ? '\n✅ BEHAVIOR VERIFY PASS (AC-1/AC-2/AC-4/AC-5)' : '\n❌ BEHAVIOR VERIFY FAIL');
process.exit(ok ? 0 : 1);
