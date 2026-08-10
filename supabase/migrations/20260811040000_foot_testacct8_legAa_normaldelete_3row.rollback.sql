-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(a) 정상삭제 3행 복원.
-- parents-first INSERT (삭제의 역연산). _arch_testacct8_aa_*_20260811 스냅샷 + off-git before-snapshot 이 복원 원천.
-- 멱등: ON CONFLICT (id) DO NOTHING → 재실행 no-op. 복원 후 archive 테이블은 감사 위해 보존(수동 DROP 별도).
BEGIN;

-- parents 먼저 (FK 성립 순서)
INSERT INTO public.customers                SELECT * FROM public._arch_testacct8_aa_customers_20260811                ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservations             SELECT * FROM public._arch_testacct8_aa_reservations_20260811             ON CONFLICT (id) DO NOTHING;
INSERT INTO public.packages                 SELECT * FROM public._arch_testacct8_aa_packages_20260811                 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_ins                SELECT * FROM public._arch_testacct8_aa_check_ins_20260811                ON CONFLICT (id) DO NOTHING;
INSERT INTO public.notification_logs        SELECT * FROM public._arch_testacct8_aa_notification_logs_20260811        ON CONFLICT (id) DO NOTHING;
INSERT INTO public.phi_access_log           SELECT * FROM public._arch_testacct8_aa_phi_access_log_20260811           ON CONFLICT (id) DO NOTHING;
INSERT INTO public.package_sessions         SELECT * FROM public._arch_testacct8_aa_package_sessions_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.status_transitions       SELECT * FROM public._arch_testacct8_aa_status_transitions_20260811       ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservation_memo_history SELECT * FROM public._arch_testacct8_aa_reservation_memo_history_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservation_logs         SELECT * FROM public._arch_testacct8_aa_reservation_logs_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_q_tokens          SELECT * FROM public._arch_testacct8_aa_health_q_tokens_20260811          ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_q_results         SELECT * FROM public._arch_testacct8_aa_health_q_results_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.customer_treatment_memos SELECT * FROM public._arch_testacct8_aa_customer_treatment_memos_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_in_services        SELECT * FROM public._arch_testacct8_aa_check_in_services_20260811        ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_in_room_logs       SELECT * FROM public._arch_testacct8_aa_check_in_room_logs_20260811       ON CONFLICT (id) DO NOTHING;
INSERT INTO public.chart_treatment_requests SELECT * FROM public._arch_testacct8_aa_chart_treatment_requests_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.assignment_actions       SELECT * FROM public._arch_testacct8_aa_assignment_actions_20260811       ON CONFLICT (id) DO NOTHING;

COMMIT;
-- POSTCHECK: customers 3행 복귀 / 80행 전체 재삽입 / 무결성(FK) 성립.
-- 참고: notification_logs.customer_id 는 삭제 시 명시삭제(SET NULL 아님) → 복원으로 원 customer_id 그대로 회복.
