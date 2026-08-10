-- T-20260810-foot-TESTACCT-CLEANUP-8ACCT  Leg A — 테스트계정 5이름/6행 archive-first 물리삭제
-- planner NEW-TASK MSG-20260810-164607(승인, 총괄 confirm MSG-20260810-164012-o67t "웅 테스트표시ㄱㄱ")
-- census commit f68b9613 · closure 재검증 + off-git snapshot(sha256 71c1a6b9fd42f33e79c2eacb60b93831d6f2fc7e5eb78d4214e616df089a4e88) 완료.
--
-- 대상 6 customers (Leg A): 풋테스트3 F-4425 · 풋테스트1 F-4427 · 풋서류테스트입니다 F-4468 · 송지현2 F-4692 · 엄경은2 F-4691 · 엄경은2 F-4703(DUMMY)
--   ★ 서류테스트 F-4990 · 총괄테스트중 F-4574 · 서류테스트2 F-5113 = Leg B(is_test), 본 마이그 제외(삭제 금지).
-- 안전근거: 6대상 전건 payments/service_charges/medical_charts/insurance_*/prescriptions/consent_forms 접점 0
--   (LEDGER/MEDICAL GUARD PASS) → 의료법 보존의무 무저촉 → 물리삭제 eligible.
-- FK closure(재귀 resolver): 19 tables / 212 rows. children-first topological delete order.
--   ledger/의료 테이블은 closure 전체 깊이에서도 0건(check_in_services/status_transitions 등은 운영·감사 자식이며 매출/의료 아님).
-- 성격: 파괴 DELETE + archive-first(무손실). 신규 스키마(business table) 0. _arch_* 는 복구용 스냅샷 테이블.
-- 멱등: 아카이브 IF NOT EXISTS · DELETE 재실행 시 0-row no-op.
-- 원장 무접점: payments/service_charges/package_payments/package_credit_ledger 미접촉(대상에 부재).
-- dry-run: 무영속(dryrun_lib) — _arch_* prod 부재 + customers 6행 잔존(롤백) post-probe.
-- rollback: 20260810220000_foot_testacct8_legA_cleanup.rollback.sql (parents-first INSERT 복원).
-- ★apply = supervisor DB-GATE GO-token 후 db_apply_guard.sh 만(apply_before_go 금지).

BEGIN;

-- ═══ 1) ARCHIVE-FIRST (무손실 스냅샷; parents 먼저 생성해 predicate 의존 성립) ═══
CREATE TABLE IF NOT EXISTS public._arch_testacct8_customers_20260810 AS SELECT * FROM public.customers WHERE id IN ('21a82994-b231-4bcc-94ff-dd9e6c3a4951'::uuid, 'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid, 'c074025b-cd27-443c-93a9-151d6d4214d4'::uuid, 'd7faae9b-8e0b-421a-b68b-483ede6834a3'::uuid, 'a0f8c846-9f93-47bf-a79e-57d265d989b6'::uuid, '02594dfa-9428-4405-b640-95ab50ad5e5d'::uuid);  -- expect 6
CREATE TABLE IF NOT EXISTS public._arch_testacct8_reservations_20260810 AS SELECT * FROM public.reservations WHERE customer_id IN ('21a82994-b231-4bcc-94ff-dd9e6c3a4951'::uuid, 'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid, 'c074025b-cd27-443c-93a9-151d6d4214d4'::uuid, 'd7faae9b-8e0b-421a-b68b-483ede6834a3'::uuid, 'a0f8c846-9f93-47bf-a79e-57d265d989b6'::uuid, '02594dfa-9428-4405-b640-95ab50ad5e5d'::uuid);  -- expect 7
CREATE TABLE IF NOT EXISTS public._arch_testacct8_packages_20260810 AS SELECT * FROM public.packages WHERE customer_id IN ('21a82994-b231-4bcc-94ff-dd9e6c3a4951'::uuid, 'e72022d0-7cf5-4f42-b5e3-b5162005b454'::uuid, 'c074025b-cd27-443c-93a9-151d6d4214d4'::uuid, 'd7faae9b-8e0b-421a-b68b-483ede6834a3'::uuid, 'a0f8c846-9f93-47bf-a79e-57d265d989b6'::uuid, '02594dfa-9428-4405-b640-95ab50ad5e5d'::uuid);  -- expect 5
CREATE TABLE IF NOT EXISTS public._arch_testacct8_check_ins_20260810 AS SELECT * FROM public.check_ins WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810) OR reservation_id IN (SELECT id FROM public._arch_testacct8_reservations_20260810);  -- expect 5
CREATE TABLE IF NOT EXISTS public._arch_testacct8_assignment_actions_20260810 AS SELECT * FROM public.assignment_actions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 4
CREATE TABLE IF NOT EXISTS public._arch_testacct8_chart_treatment_requests_20260810 AS SELECT * FROM public.chart_treatment_requests WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810) OR check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 3
CREATE TABLE IF NOT EXISTS public._arch_testacct8_check_in_room_logs_20260810 AS SELECT * FROM public.check_in_room_logs WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 6
CREATE TABLE IF NOT EXISTS public._arch_testacct8_check_in_services_20260810 AS SELECT * FROM public.check_in_services WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 49
CREATE TABLE IF NOT EXISTS public._arch_testacct8_customer_reservation_memos_20260810 AS SELECT * FROM public.customer_reservation_memos WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_customer_treatment_memos_20260810 AS SELECT * FROM public.customer_treatment_memos WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_form_submissions_20260810 AS SELECT * FROM public.form_submissions WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810) OR check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 3
CREATE TABLE IF NOT EXISTS public._arch_testacct8_health_q_results_20260810 AS SELECT * FROM public.health_q_results WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_health_q_tokens_20260810 AS SELECT * FROM public.health_q_tokens WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 3
CREATE TABLE IF NOT EXISTS public._arch_testacct8_reservation_logs_20260810 AS SELECT * FROM public.reservation_logs WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_reservations_20260810);  -- expect 4
CREATE TABLE IF NOT EXISTS public._arch_testacct8_reservation_memo_history_20260810 AS SELECT * FROM public.reservation_memo_history WHERE reservation_id IN (SELECT id FROM public._arch_testacct8_reservations_20260810) OR check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 2
CREATE TABLE IF NOT EXISTS public._arch_testacct8_status_transitions_20260810 AS SELECT * FROM public.status_transitions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 20
CREATE TABLE IF NOT EXISTS public._arch_testacct8_package_sessions_20260810 AS SELECT * FROM public.package_sessions WHERE check_in_id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810) OR package_id IN (SELECT id FROM public._arch_testacct8_packages_20260810);  -- expect 1
CREATE TABLE IF NOT EXISTS public._arch_testacct8_notification_logs_20260810 AS SELECT * FROM public.notification_logs WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 11
CREATE TABLE IF NOT EXISTS public._arch_testacct8_phi_access_log_20260810 AS SELECT * FROM public.phi_access_log WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 78

-- ═══ 2) FK-safe DELETE (children first; freeze-set = _arch_* 로 고정) ═══
-- ★★ GATED LEG — form_submissions 는 발행 의무기록 retention guard(trg_form_submissions_published_immutable,
--    의료법 §22/§40 10년보존)로 hard-DELETE 전면차단. 정당 purge = service_role 의 의도적 DISABLE TRIGGER
--    경유(트리거 본문 'DA 명시'). 본 3행(F-4427 printed·doc_serial_seq=74 / F-4692 voided / F-4425 draft)은
--    테스트계정 서류이나 이는 census '발행서류 0건→DA CONSULT N/A' 전제를 뒤집음.
--    ⇒ 이 DISABLE TRIGGER purge 블록의 실행은 DA CONSULT sign-off + planner/총괄 확인 후에만(FOLLOWUP 발행).
--    guard 는 트랜잭션 내에서만 disable→enable(원자 복구). form_submissions_audit_log=0·self-ref=0 확인.
DELETE FROM public.assignment_actions WHERE id IN (SELECT id FROM public._arch_testacct8_assignment_actions_20260810);  -- expect 4
DELETE FROM public.chart_treatment_requests WHERE id IN (SELECT id FROM public._arch_testacct8_chart_treatment_requests_20260810);  -- expect 3
DELETE FROM public.check_in_room_logs WHERE id IN (SELECT id FROM public._arch_testacct8_check_in_room_logs_20260810);  -- expect 6
DELETE FROM public.check_in_services WHERE id IN (SELECT id FROM public._arch_testacct8_check_in_services_20260810);  -- expect 49
DELETE FROM public.customer_reservation_memos WHERE id IN (SELECT id FROM public._arch_testacct8_customer_reservation_memos_20260810);  -- expect 1
DELETE FROM public.customer_treatment_memos WHERE id IN (SELECT id FROM public._arch_testacct8_customer_treatment_memos_20260810);  -- expect 2
ALTER TABLE public.form_submissions DISABLE TRIGGER trg_form_submissions_published_immutable;  -- DA-sanctioned purge path (GATED)
DELETE FROM public.form_submissions WHERE id IN (SELECT id FROM public._arch_testacct8_form_submissions_20260810);  -- expect 3
ALTER TABLE public.form_submissions ENABLE TRIGGER trg_form_submissions_published_immutable;   -- retention guard 즉시 복구
DELETE FROM public.health_q_results WHERE id IN (SELECT id FROM public._arch_testacct8_health_q_results_20260810);  -- expect 2
DELETE FROM public.health_q_tokens WHERE id IN (SELECT id FROM public._arch_testacct8_health_q_tokens_20260810);  -- expect 3
DELETE FROM public.reservation_logs WHERE id IN (SELECT id FROM public._arch_testacct8_reservation_logs_20260810);  -- expect 4
DELETE FROM public.reservation_memo_history WHERE id IN (SELECT id FROM public._arch_testacct8_reservation_memo_history_20260810);  -- expect 2
DELETE FROM public.status_transitions WHERE id IN (SELECT id FROM public._arch_testacct8_status_transitions_20260810);  -- expect 20
DELETE FROM public.package_sessions WHERE id IN (SELECT id FROM public._arch_testacct8_package_sessions_20260810);  -- expect 1
DELETE FROM public.notification_logs WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 11
DELETE FROM public.phi_access_log WHERE customer_id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 78
DELETE FROM public.check_ins WHERE id IN (SELECT id FROM public._arch_testacct8_check_ins_20260810);  -- expect 5
DELETE FROM public.packages WHERE id IN (SELECT id FROM public._arch_testacct8_packages_20260810);  -- expect 5
DELETE FROM public.reservations WHERE id IN (SELECT id FROM public._arch_testacct8_reservations_20260810);  -- expect 7
DELETE FROM public.customers WHERE id IN (SELECT id FROM public._arch_testacct8_customers_20260810);  -- expect 6

COMMIT;
-- exact-N POSTCHECK (apply 후): 삭제 총 212행 / customers 6행 소멸 / _arch_* 212행 보존.
