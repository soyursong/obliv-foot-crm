#!/usr/bin/env node
/**
 * DRY-RUN — T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT (allowlist 재작성본)
 *
 * 대상 마이그: supabase/migrations/20260716120000_foot_checkin_sync_reservation_broaden.sql
 *   body-only CREATE OR REPLACE fn_checkin_sync_reservation()
 *   sync WHERE = status IN ('reserved','confirmed')  ← DA CONSULT-REPLY 정정 채택(allowlist)
 *   (denylist `NOT IN ('checked_in','done','cancelled')` 는 DA 반려 — STALE)
 *
 * 표준: agents/docs/migration_dryrun_no_persistence_standard.md (dryrun_lib 3요소)
 *   ① stripTxnControl(top-level BEGIN;/COMMIT; 제거, plpgsql 본문 BEGIN/END 보존)
 *   ② plpgsql exception-handler(DO … EXECUTE … EXCEPTION) 경유 실행 → sentinel RAISE 로
 *      implicit-savepoint 롤백 = 진짜 무영속. 비-sentinel 에러는 re-raise → FAIL.
 *   ③ post-probe: 롤백 후 prod fn body 에 신규 술어(`IN ('reserved'`)가 **부재**함을 실측
 *      (= body 변경 무영속). 발견 시 dryrun_persistence_leak → FAIL.
 *
 * 기능 검증(롤백 봉투 내, self-assert — 실패 시 RAISE → harness re-raise → FAIL):
 *   A. status='reserved' 예약에 체크인 생성 → reservations.status='checked_in' 착지 (버그 fix 핵심)
 *   B. status='confirmed' 예약에 체크인 생성 → checked_in (회귀 방지)
 *   C. status='done' 예약에 체크인 생성 → 'done' 보존 (allowlist fail-safe, 자동전이 안 됨)
 *
 * usage: node scripts/T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT_dryrun.mjs
 */
import { readFileSync } from 'node:fs';
import { runDryrun } from './dryrun_lib.mjs';

const MIG = 'supabase/migrations/20260716120000_foot_checkin_sync_reservation_broaden.sql';
const migSql = readFileSync(MIG, 'utf8');

// 롤백-봉투 내 기능 검증 DO 블록. 마이그 body 적용 직후, harness 가 붙일 sentinel RAISE 이전에 실행.
// 실패 시 RAISE EXCEPTION(비-sentinel) → harness handler 가 re-raise → q() throw → FAIL.
const functionalTest = `
DO $fntest$
DECLARE
  v_clinic uuid;
  v_rid    uuid;
  v_st     text;
  v_body   text;
BEGIN
  -- 적용된 body 가 allowlist 술어를 포함하는지 in-txn 확인(belt-and-suspenders)
  v_body := pg_get_functiondef('public.fn_checkin_sync_reservation()'::regprocedure);
  IF position('reserved' IN v_body) = 0 THEN
    RAISE EXCEPTION 'DRYRUN_ASSERT_FAIL: in-txn fn body 에 allowlist(reserved) 술어 없음';
  END IF;

  SELECT clinic_id INTO v_clinic FROM public.reservations WHERE clinic_id IS NOT NULL LIMIT 1;
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'DRYRUN_SETUP_FAIL: clinic_id 확보 실패'; END IF;

  -- A) reserved → checked_in (노쇼↔복원 race 로 reserved 인 예약도 sync 되어야 함)
  INSERT INTO public.reservations (clinic_id, customer_name, customer_phone, reservation_date, reservation_time, status, visit_type)
    VALUES (v_clinic, 'dryrun-A-reserved', '01099990001', CURRENT_DATE, '10:00:00', 'reserved', 'new')
    RETURNING id INTO v_rid;
  INSERT INTO public.check_ins (clinic_id, reservation_id, customer_name, visit_type, status, queue_number)
    VALUES (v_clinic, v_rid, 'dryrun-A', 'new', 'receiving', 990001);
  SELECT status INTO v_st FROM public.reservations WHERE id = v_rid;
  IF v_st IS DISTINCT FROM 'checked_in' THEN
    RAISE EXCEPTION 'DRYRUN_ASSERT_FAIL A(reserved): expected checked_in, got %', v_st;
  END IF;
  RAISE NOTICE 'DRYRUN A(reserved→checked_in) PASS';

  -- B) confirmed → checked_in (기존 정상 동선 회귀 방지)
  INSERT INTO public.reservations (clinic_id, customer_name, customer_phone, reservation_date, reservation_time, status, visit_type)
    VALUES (v_clinic, 'dryrun-B-confirmed', '01099990002', CURRENT_DATE, '10:10:00', 'confirmed', 'new')
    RETURNING id INTO v_rid;
  INSERT INTO public.check_ins (clinic_id, reservation_id, customer_name, visit_type, status, queue_number)
    VALUES (v_clinic, v_rid, 'dryrun-B', 'new', 'receiving', 990002);
  SELECT status INTO v_st FROM public.reservations WHERE id = v_rid;
  IF v_st IS DISTINCT FROM 'checked_in' THEN
    RAISE EXCEPTION 'DRYRUN_ASSERT_FAIL B(confirmed): expected checked_in, got %', v_st;
  END IF;
  RAISE NOTICE 'DRYRUN B(confirmed→checked_in) PASS';

  -- C) done → done 보존 (allowlist fail-safe: 자동전이 대상 아님)
  INSERT INTO public.reservations (clinic_id, customer_name, customer_phone, reservation_date, reservation_time, status, visit_type)
    VALUES (v_clinic, 'dryrun-C-done', '01099990003', CURRENT_DATE, '10:20:00', 'done', 'new')
    RETURNING id INTO v_rid;
  INSERT INTO public.check_ins (clinic_id, reservation_id, customer_name, visit_type, status, queue_number)
    VALUES (v_clinic, v_rid, 'dryrun-C', 'new', 'receiving', 990003);
  SELECT status INTO v_st FROM public.reservations WHERE id = v_rid;
  IF v_st IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'DRYRUN_ASSERT_FAIL C(done): expected done preserved, got %', v_st;
  END IF;
  RAISE NOTICE 'DRYRUN C(done preserved) PASS';
END
$fntest$;
`;

const upSql = migSql + '\n' + functionalTest;

// post-probe: 롤백 후 prod fn body 에 allowlist 신규 술어(`IN ('reserved'`)가 부재 = 무영속.
// 현재 prod body 는 구 `status = 'confirmed'` 정확일치(2026-07-16 introspect 확인) → 'reserved' 미포함.
const absentNewPredicate = {
  label: "fn_checkin_sync_reservation body: allowlist(reserved) 술어 (무영속 확인)",
  sql: `SELECT pg_get_functiondef('public.fn_checkin_sync_reservation()'::regprocedure) NOT ILIKE '%in (''reserved''%' AS absent;`,
};

runDryrun({
  upSql,
  assertAbsent: [absentNewPredicate],
  passNote: '[allowlist IN (reserved,confirmed) · A/B/C 기능검증 · body 변경 무영속]',
}).catch((e) => { console.error(e); process.exit(1); });
