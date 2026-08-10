-- T-20260810-foot-TESTACCT-CLEANUP-8ACCT  Leg A-(b) — Path-B 물리삭제 2행 (scoped DISABLE trigger)
-- planner NEW-TASK MSG-20260811-082849-425f · DA z676 조건부 GO (Path-B scoped-DISABLE · §ADDENDUM#1).
--   SSOT da_decision_foot_testacct_cleanup_formsubmissions_retention_purge_20260810.md
--
-- 대상 2 customers (Leg A-(b)): 풋테스트3 F-4425(draft·doc_serial_seq NULL) · 송지현2 F-4692(voided·serial NULL)
--   ★★ 이 2계정은 form_submissions 보유(draft/voided·둘 다 serial NULL·never-issued) →
--      retention-guard trigger trg_form_submissions_published_immutable(의료법 §22/§40)가 hard-DELETE 차단.
--      z676 조건부 GO = same-txn scoped DISABLE→DELETE(FK closure)→커밋前 ENABLE→tgenabled 사후재확인(H3).
--   ★★★ {F-4425,F-4692} 2행 한정 scoped(blanket DISABLE 금지). ★F-4427(printed·serial74) fs=b4a36c4e 절대 미포함.
--       F-4427 은 Leg B(is_test 원장보존·HARD REJECT) — 본 마이그 어떤 셋에도 부재.
-- 안전근거(census 3leg, dev-foot 2026-08-11 · scripts/T-…_3leg-census.mjs):
--   - retention firewall CLEAR: 대상 2 fs = serial-NULL·never-issued·재무⊥(payments/sc/closing/fct 무접점) → 보존의무 threshold 밖.
--   - LEDGER/MEDICAL GUARD PASS: payments/service_charges/package_payments/package_credit_ledger/
--     medical_charts/prescriptions/consent_forms/insurance_claims = 전건 0.
--   - form_submissions_audit_log child(RESTRICT) = 0 · self source_submission_id ref = 0 (추가 blocker 없음).
--   - FK closure: 15 closure tables 51 rows(fs 2 포함) + notification_logs 5(SET NULL→명시삭제) + phi_access_log 35(loose) = 총 91행.
-- 성격: 파괴 DELETE + retention-control bypass(ALTER..TRIGGER=DDL) + archive-first(무손실). 신규 business 스키마 0.
-- 멱등: 아카이브 IF NOT EXISTS · DELETE WHERE id IN(archive) 재실행 시 0-row · DISABLE/ENABLE 항상 원상.
-- rollback: 20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row.rollback.sql (parents-first INSERT 복원).
-- ★apply = CEO 경량 sign-off(H6·§3.1) + supervisor DDL-diff(up/down) + Migration Dry-Run No-Persistence
--   + DB-GATE rows-affected(freeze-set 2행 exact) + tgenabled 사후재확인 + 물리 GO-token 後 db_apply_guard.sh 만.
--   ★★ CEO sign-off 前·GO-token 前 prod DELETE/DISABLE TRIGGER/DDL 선집행 금지(apply_before_go 클래스).

BEGIN;

-- ═══ 1) ARCHIVE-FIRST (무손실 스냅샷; parents 먼저) ═══
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_customers_20260811 AS
  SELECT * FROM public.customers WHERE id IN ('21a82994-b231-4bcc-94ff-dd9e6c3a4951'::uuid, 'd7faae9b-8e0b-421a-b68b-483ede6834a3'::uuid);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_reservations_20260811 AS
  SELECT * FROM public.reservations WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 3
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_packages_20260811 AS
  SELECT * FROM public.packages WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_check_ins_20260811 AS
  SELECT * FROM public.check_ins WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811)
     OR reservation_id IN (SELECT id FROM public._arch_testacct8_ab_reservations_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_assignment_actions_20260811 AS
  SELECT * FROM public.assignment_actions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_chart_treatment_requests_20260811 AS
  SELECT * FROM public.chart_treatment_requests WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811)
     OR check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_check_in_room_logs_20260811 AS
  SELECT * FROM public.check_in_room_logs WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 4
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_check_in_services_20260811 AS
  SELECT * FROM public.check_in_services WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 16
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_customer_treatment_memos_20260811 AS
  SELECT * FROM public.customer_treatment_memos WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_form_submissions_20260811 AS
  SELECT * FROM public.form_submissions WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811)
     OR check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 2 (755ac489 voided · b0edd82a draft)
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_health_q_results_20260811 AS
  SELECT * FROM public.health_q_results WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_health_q_tokens_20260811 AS
  SELECT * FROM public.health_q_tokens WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_reservation_logs_20260811 AS
  SELECT * FROM public.reservation_logs WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_ab_reservations_20260811);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_reservation_memo_history_20260811 AS
  SELECT * FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_ab_reservations_20260811)
     OR check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_status_transitions_20260811 AS
  SELECT * FROM public.status_transitions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 10
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_notification_logs_20260811 AS
  SELECT * FROM public.notification_logs WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811)
     OR reservation_id IN (SELECT id FROM public._arch_testacct8_ab_reservations_20260811);  -- expect 5
CREATE TABLE IF NOT EXISTS public._arch_testacct8_ab_phi_access_log_20260811 AS
  SELECT * FROM public.phi_access_log WHERE customer_id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 35

-- ═══ 1.5) IN-TXN SCOPE GUARD (z676 조건: 2행 exact · serial-NULL·never-issued · F-4427 leak 차단 · 실고객 미혼입) ═══
DO $$
DECLARE nc int; nfs int; bad int;
BEGIN
  SELECT count(*) INTO nc FROM public._arch_testacct8_ab_customers_20260811;
  IF nc <> 2 THEN RAISE EXCEPTION 'legAb customers archive expected 2, got %', nc; END IF;
  SELECT count(*) INTO nfs FROM public._arch_testacct8_ab_form_submissions_20260811;
  IF nfs <> 2 THEN RAISE EXCEPTION 'legAb form_submissions archive expected 2, got %', nfs; END IF;
  -- ★ F-4427 leak guard: 발번(serial NOT NULL)/printed row 가 스코프에 들어오면 즉시 ABORT (retention 보존건 오삭제 방지).
  SELECT count(*) INTO bad FROM public._arch_testacct8_ab_form_submissions_20260811
    WHERE doc_serial_seq IS NOT NULL OR status = 'printed';
  IF bad > 0 THEN RAISE EXCEPTION 'legAb form_submissions includes serial-bearing/printed row (F-4427 leak guard) count=%', bad; END IF;
  -- F-4427 fs id 명시 배제 확증
  IF EXISTS (SELECT 1 FROM public._arch_testacct8_ab_form_submissions_20260811 WHERE id = 'b4a36c4e-f5a8-4afb-8f87-b581f152050e'::uuid)
  THEN RAISE EXCEPTION 'legAb archive contains F-4427 fs b4a36c4e — abort'; END IF;
  -- 실고객/KEEP 오삭제 가드
  IF EXISTS (SELECT 1 FROM public._arch_testacct8_ab_customers_20260811
             WHERE id IN ('1c61bad2-ad49-4e7d-92ae-2d132aae95cb'::uuid, 'fcd8cd52-b383-4994-83af-387c4f7d9f7a'::uuid, '7ad9e9a4-5e52-418c-acdb-300ee7d30e0b'::uuid, 'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid))
  THEN RAISE EXCEPTION 'legAb archive contains a KEEP/real/F-4427 customer id — abort'; END IF;
END $$;

-- ═══ 2) FK-safe DELETE (children first; freeze-set = _arch_* 로 고정) ═══
DELETE FROM public.assignment_actions          WHERE id IN (SELECT id FROM public._arch_testacct8_ab_assignment_actions_20260811);  -- expect 2
DELETE FROM public.chart_treatment_requests    WHERE id IN (SELECT id FROM public._arch_testacct8_ab_chart_treatment_requests_20260811);  -- expect 2
DELETE FROM public.check_in_room_logs          WHERE id IN (SELECT id FROM public._arch_testacct8_ab_check_in_room_logs_20260811);  -- expect 4
DELETE FROM public.check_in_services           WHERE id IN (SELECT id FROM public._arch_testacct8_ab_check_in_services_20260811);  -- expect 16
DELETE FROM public.customer_treatment_memos    WHERE id IN (SELECT id FROM public._arch_testacct8_ab_customer_treatment_memos_20260811);  -- expect 1
-- ★★ scoped DISABLE → DELETE(2행 한정) → ENABLE (same-txn 원자 복구; blanket 금지)
ALTER TABLE public.form_submissions DISABLE TRIGGER trg_form_submissions_published_immutable;  -- z676 DA-sanctioned scoped purge
DELETE FROM public.form_submissions            WHERE id IN (SELECT id FROM public._arch_testacct8_ab_form_submissions_20260811);  -- expect 2 (draft+voided, serial NULL)
ALTER TABLE public.form_submissions ENABLE TRIGGER trg_form_submissions_published_immutable;   -- retention guard 즉시 복구(커밋 前)
DELETE FROM public.health_q_results            WHERE id IN (SELECT id FROM public._arch_testacct8_ab_health_q_results_20260811);  -- expect 1
DELETE FROM public.health_q_tokens             WHERE id IN (SELECT id FROM public._arch_testacct8_ab_health_q_tokens_20260811);  -- expect 1
DELETE FROM public.reservation_logs            WHERE id IN (SELECT id FROM public._arch_testacct8_ab_reservation_logs_20260811);  -- expect 2
DELETE FROM public.reservation_memo_history    WHERE id IN (SELECT id FROM public._arch_testacct8_ab_reservation_memo_history_20260811);  -- expect 1
DELETE FROM public.status_transitions          WHERE id IN (SELECT id FROM public._arch_testacct8_ab_status_transitions_20260811);  -- expect 10
DELETE FROM public.notification_logs           WHERE id IN (SELECT id FROM public._arch_testacct8_ab_notification_logs_20260811);  -- expect 5
DELETE FROM public.phi_access_log              WHERE id IN (SELECT id FROM public._arch_testacct8_ab_phi_access_log_20260811);  -- expect 35
DELETE FROM public.check_ins                   WHERE id IN (SELECT id FROM public._arch_testacct8_ab_check_ins_20260811);  -- expect 2
DELETE FROM public.packages                    WHERE id IN (SELECT id FROM public._arch_testacct8_ab_packages_20260811);  -- expect 2
DELETE FROM public.reservations                WHERE id IN (SELECT id FROM public._arch_testacct8_ab_reservations_20260811);  -- expect 3
DELETE FROM public.customers                   WHERE id IN (SELECT id FROM public._arch_testacct8_ab_customers_20260811);  -- expect 2

-- ═══ 2.5) IN-TXN tgenabled 사후재확인 (H3: 커밋 前 트리거 재활성 확증) ═══
DO $$
DECLARE en char;
BEGIN
  SELECT t.tgenabled INTO en FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'form_submissions' AND t.tgname = 'trg_form_submissions_published_immutable';
  IF en IS NULL THEN RAISE EXCEPTION 'legAb: trigger trg_form_submissions_published_immutable NOT FOUND post-delete'; END IF;
  IF en <> 'O' THEN RAISE EXCEPTION 'legAb: retention trigger NOT re-enabled before commit (tgenabled=%)', en; END IF;
END $$;

COMMIT;
-- exact-N POSTCHECK (apply 후): 삭제 총 91행(closure 51 + notif 5 + phi 35) / customers 2행 소멸 / fs 2행(draft+voided) 소멸.
-- ★ tgenabled 사후재확인(H3, prod live) = 'O'(enabled) 여야 함 — supervisor POSTCHECK 필수.
