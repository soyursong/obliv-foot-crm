-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A
-- _arch_* 스냅샷에서 원본 복원(parents-first INSERT). up.sql 의 정확한 역연산.
-- 주의: 복원 후 _arch_* 테이블은 감사용으로 보존(별도 DROP 마이그로 정리 가능).
BEGIN;
INSERT INTO public.customers SELECT * FROM public._arch_testacct8_customers_20260810 ON CONFLICT DO NOTHING;  -- restore 6
INSERT INTO public.reservations SELECT * FROM public._arch_testacct8_reservations_20260810 ON CONFLICT DO NOTHING;  -- restore 7
INSERT INTO public.packages SELECT * FROM public._arch_testacct8_packages_20260810 ON CONFLICT DO NOTHING;  -- restore 5
INSERT INTO public.check_ins SELECT * FROM public._arch_testacct8_check_ins_20260810 ON CONFLICT DO NOTHING;  -- restore 5
INSERT INTO public.phi_access_log SELECT * FROM public._arch_testacct8_phi_access_log_20260810 ON CONFLICT DO NOTHING;  -- restore 78
INSERT INTO public.notification_logs SELECT * FROM public._arch_testacct8_notification_logs_20260810 ON CONFLICT DO NOTHING;  -- restore 11
INSERT INTO public.package_sessions SELECT * FROM public._arch_testacct8_package_sessions_20260810 ON CONFLICT DO NOTHING;  -- restore 1
INSERT INTO public.status_transitions SELECT * FROM public._arch_testacct8_status_transitions_20260810 ON CONFLICT DO NOTHING;  -- restore 20
INSERT INTO public.reservation_memo_history SELECT * FROM public._arch_testacct8_reservation_memo_history_20260810 ON CONFLICT DO NOTHING;  -- restore 2
INSERT INTO public.reservation_logs SELECT * FROM public._arch_testacct8_reservation_logs_20260810 ON CONFLICT DO NOTHING;  -- restore 4
INSERT INTO public.health_q_tokens SELECT * FROM public._arch_testacct8_health_q_tokens_20260810 ON CONFLICT DO NOTHING;  -- restore 3
INSERT INTO public.health_q_results SELECT * FROM public._arch_testacct8_health_q_results_20260810 ON CONFLICT DO NOTHING;  -- restore 2
INSERT INTO public.form_submissions SELECT * FROM public._arch_testacct8_form_submissions_20260810 ON CONFLICT DO NOTHING;  -- restore 3
INSERT INTO public.customer_treatment_memos SELECT * FROM public._arch_testacct8_customer_treatment_memos_20260810 ON CONFLICT DO NOTHING;  -- restore 2
INSERT INTO public.customer_reservation_memos SELECT * FROM public._arch_testacct8_customer_reservation_memos_20260810 ON CONFLICT DO NOTHING;  -- restore 1
INSERT INTO public.check_in_services SELECT * FROM public._arch_testacct8_check_in_services_20260810 ON CONFLICT DO NOTHING;  -- restore 49
INSERT INTO public.check_in_room_logs SELECT * FROM public._arch_testacct8_check_in_room_logs_20260810 ON CONFLICT DO NOTHING;  -- restore 6
INSERT INTO public.chart_treatment_requests SELECT * FROM public._arch_testacct8_chart_treatment_requests_20260810 ON CONFLICT DO NOTHING;  -- restore 3
INSERT INTO public.assignment_actions SELECT * FROM public._arch_testacct8_assignment_actions_20260810 ON CONFLICT DO NOTHING;  -- restore 4
COMMIT;
