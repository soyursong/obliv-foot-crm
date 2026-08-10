-- T-20260810-foot-TESTACCT-CLEANUP-8ACCT  Leg A-(a) — 정상삭제 3행 archive-first 물리삭제
-- planner NEW-TASK MSG-20260811-082849-425f (총괄 김주연 '완전정리' erase-의도 게이트 RESOLVED, ts 1786403792.800929).
-- DA GO: z676 (SSOT da_decision_foot_testacct_cleanup_formsubmissions_retention_purge_20260810.md §ADDENDUM#1).
--
-- 대상 3 customers (Leg A-(a)): 엄경은2 F-4691 · 엄경은2(DUMMY) F-4703 · 풋서류테스트입니다 F-4468
--   ★ 이 3계정은 form_submissions 0행 → 발행 의무기록 retention-guard 미관여(trigger 무접점).
--   ★ Leg A-(b) Path-B(F-4425/F-4692) · Leg B is_test(F-4427/F-4445) 는 본 마이그 제외.
-- 안전근거(census 3leg, dev-foot 2026-08-11 · scripts/T-…_3leg-census.mjs):
--   - LEDGER/MEDICAL GUARD PASS: payments/service_charges/package_payments/package_credit_ledger/
--     medical_charts/prescriptions/consent_forms/insurance_claims = 전건 0 → 의료법 보존의무 무저촉.
--   - form_submissions = 0행(3계정 전부) → trigger DISABLE 불요(정상삭제 경로).
--   - serial-NULL · 재무⊥ · is_simulation=false · created_by=NULL · is_test=false.
-- FK closure(재귀 resolver): 15 closure tables 50 rows + notification_logs 2(SET NULL→명시삭제) + phi_access_log 28(loose)
--   = 총 80행. children-first topological delete order.
-- 성격: 파괴 DELETE + archive-first(무손실). 신규 business 스키마 0. _arch_* = 복구용 스냅샷.
-- 멱등: 아카이브 IF NOT EXISTS · DELETE WHERE id IN(archive) 재실행 시 0-row no-op.
-- rollback: 20260811040000_foot_testacct8_legAa_normaldelete_3row.rollback.sql (parents-first INSERT 복원).
-- ★apply = supervisor DDL-diff + Migration Dry-Run No-Persistence + DB-GATE rows-affected(freeze-set 3행 exact)
--   + 물리 GO-token 後 db_apply_guard.sh 만(apply_before_go 금지·GO-token 前 prod DELETE/DDL 선집행 금지).

BEGIN;

-- ═══ 1) ARCHIVE-FIRST (무손실 스냅샷; parents 먼저 생성해 predicate 의존 성립) ═══
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_customers_20260811 AS
  SELECT * FROM public.customers WHERE id IN ('a0f8c846-9f93-47bf-a79e-57d265d989b6'::uuid, '02594dfa-9428-4405-b640-95ab50ad5e5d'::uuid, 'c074025b-cd27-443c-93a9-151d6d4214d4'::uuid);  -- expect 3
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_reservations_20260811 AS
  SELECT * FROM public.reservations WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_packages_20260811 AS
  SELECT * FROM public.packages WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_check_ins_20260811 AS
  SELECT * FROM public.check_ins WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811)
     OR reservation_id IN (SELECT id FROM public._arch_testacct8_aa_reservations_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_assignment_actions_20260811 AS
  SELECT * FROM public.assignment_actions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_chart_treatment_requests_20260811 AS
  SELECT * FROM public.chart_treatment_requests WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811)
     OR check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_check_in_room_logs_20260811 AS
  SELECT * FROM public.check_in_room_logs WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_check_in_services_20260811 AS
  SELECT * FROM public.check_in_services WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 20
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_customer_treatment_memos_20260811 AS
  SELECT * FROM public.customer_treatment_memos WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_health_q_results_20260811 AS
  SELECT * FROM public.health_q_results WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_health_q_tokens_20260811 AS
  SELECT * FROM public.health_q_tokens WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_reservation_logs_20260811 AS
  SELECT * FROM public.reservation_logs WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_aa_reservations_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_reservation_memo_history_20260811 AS
  SELECT * FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_aa_reservations_20260811)
     OR check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_status_transitions_20260811 AS
  SELECT * FROM public.status_transitions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 9
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_package_sessions_20260811 AS
  SELECT * FROM public.package_sessions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811)
     OR package_id IN (SELECT id FROM public._arch_testacct8_aa_packages_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_notification_logs_20260811 AS
  SELECT * FROM public.notification_logs WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811)
     OR reservation_id IN (SELECT id FROM public._arch_testacct8_aa_reservations_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_aa_phi_access_log_20260811 AS
  SELECT * FROM public.phi_access_log WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 28

-- ═══ 1.5) IN-TXN FREEZE-SET GUARD (오삭제 방지: 대상 3행 exact · form_submissions 0 · 실고객 미혼입) ═══
DO $$
DECLARE nc int; nfs int;
BEGIN
  SELECT count(*) INTO nc FROM public._arch_testacct8_aa_customers_20260811;
  IF nc <> 3 THEN RAISE EXCEPTION 'legAa customers archive expected 3, got %', nc; END IF;
  -- form_submissions 0 확증(정상삭제 경로 = trigger 무관). >0 이면 Path-B 경로여야 하므로 ABORT.
  SELECT count(*) INTO nfs FROM public.form_submissions
    WHERE customer_id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811)
       OR check_in_id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);
  IF nfs <> 0 THEN RAISE EXCEPTION 'legAa expected 0 form_submissions (normal-delete lane), got % → Path-B required', nfs; END IF;
  -- 실고객 오삭제 가드: 아카이브에 KEEP id(박민석 본계정/실고객) 미혼입
  IF EXISTS (SELECT 1 FROM public._arch_testacct8_aa_customers_20260811
             WHERE id IN ('1c61bad2-ad49-4e7d-92ae-2d132aae95cb'::uuid, 'fcd8cd52-b383-4994-83af-387c4f7d9f7a'::uuid, '7ad9e9a4-5e52-418c-acdb-300ee7d30e0b'::uuid))
  THEN RAISE EXCEPTION 'legAa archive contains a KEEP/real-customer id — abort'; END IF;
END $$;

-- ═══ 2) FK-safe DELETE (children first; freeze-set = _arch_* 로 고정) ═══
DELETE FROM public.assignment_actions          WHERE id IN (SELECT id FROM public._arch_testacct8_aa_assignment_actions_20260811);  -- expect 2
DELETE FROM public.chart_treatment_requests    WHERE id IN (SELECT id FROM public._arch_testacct8_aa_chart_treatment_requests_20260811);  -- expect 1
DELETE FROM public.check_in_room_logs          WHERE id IN (SELECT id FROM public._arch_testacct8_aa_check_in_room_logs_20260811);  -- expect 2
DELETE FROM public.check_in_services           WHERE id IN (SELECT id FROM public._arch_testacct8_aa_check_in_services_20260811);  -- expect 20
DELETE FROM public.customer_treatment_memos    WHERE id IN (SELECT id FROM public._arch_testacct8_aa_customer_treatment_memos_20260811);  -- expect 1
DELETE FROM public.health_q_results            WHERE id IN (SELECT id FROM public._arch_testacct8_aa_health_q_results_20260811);  -- expect 1
DELETE FROM public.health_q_tokens             WHERE id IN (SELECT id FROM public._arch_testacct8_aa_health_q_tokens_20260811);  -- expect 2
DELETE FROM public.reservation_logs            WHERE id IN (SELECT id FROM public._arch_testacct8_aa_reservation_logs_20260811);  -- expect 1
DELETE FROM public.reservation_memo_history    WHERE id IN (SELECT id FROM public._arch_testacct8_aa_reservation_memo_history_20260811);  -- expect 1
DELETE FROM public.status_transitions          WHERE id IN (SELECT id FROM public._arch_testacct8_aa_status_transitions_20260811);  -- expect 9
DELETE FROM public.package_sessions            WHERE id IN (SELECT id FROM public._arch_testacct8_aa_package_sessions_20260811);  -- expect 1
DELETE FROM public.notification_logs           WHERE id IN (SELECT id FROM public._arch_testacct8_aa_notification_logs_20260811);  -- expect 2
DELETE FROM public.phi_access_log              WHERE id IN (SELECT id FROM public._arch_testacct8_aa_phi_access_log_20260811);  -- expect 28
DELETE FROM public.check_ins                   WHERE id IN (SELECT id FROM public._arch_testacct8_aa_check_ins_20260811);  -- expect 2
DELETE FROM public.packages                    WHERE id IN (SELECT id FROM public._arch_testacct8_aa_packages_20260811);  -- expect 2
DELETE FROM public.reservations                WHERE id IN (SELECT id FROM public._arch_testacct8_aa_reservations_20260811);  -- expect 2
DELETE FROM public.customers                   WHERE id IN (SELECT id FROM public._arch_testacct8_aa_customers_20260811);  -- expect 3

COMMIT;
-- exact-N POSTCHECK (apply 후): 삭제 총 80행(closure 50 + notif 2 + phi 28) / customers 3행 소멸 / _arch_* 80행 보존.
