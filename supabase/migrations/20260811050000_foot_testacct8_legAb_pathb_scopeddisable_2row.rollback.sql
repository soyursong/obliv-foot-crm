-- ROLLBACK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(b) Path-B 물리삭제 2행 복원.
-- parents-first INSERT (삭제의 역연산). _arch_testacct8_ab_*_20260811 스냅샷 + off-git before-snapshot 이 복원 원천.
-- ★ form_submissions 복원은 retention-guard(published_immutable) 발화하지 않음: INSERT(재삽입)는 트리거 대상 아님
--   (트리거는 UPDATE/DELETE 차단). 원 상태(draft/voided)로 그대로 복귀. 안전.
-- 멱등: ON CONFLICT (id) DO NOTHING → 재실행 no-op. 복원 후 archive 테이블은 감사 위해 보존(수동 DROP 별도).
BEGIN;

INSERT INTO public.customers                SELECT * FROM public._arch_testacct8_ab_customers_20260811                ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservations             SELECT * FROM public._arch_testacct8_ab_reservations_20260811             ON CONFLICT (id) DO NOTHING;
INSERT INTO public.packages                 SELECT * FROM public._arch_testacct8_ab_packages_20260811                 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_ins                SELECT * FROM public._arch_testacct8_ab_check_ins_20260811                ON CONFLICT (id) DO NOTHING;
INSERT INTO public.notification_logs        SELECT * FROM public._arch_testacct8_ab_notification_logs_20260811        ON CONFLICT (id) DO NOTHING;
INSERT INTO public.phi_access_log           SELECT * FROM public._arch_testacct8_ab_phi_access_log_20260811           ON CONFLICT (id) DO NOTHING;
INSERT INTO public.status_transitions       SELECT * FROM public._arch_testacct8_ab_status_transitions_20260811       ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservation_memo_history SELECT * FROM public._arch_testacct8_ab_reservation_memo_history_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.reservation_logs         SELECT * FROM public._arch_testacct8_ab_reservation_logs_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_q_tokens          SELECT * FROM public._arch_testacct8_ab_health_q_tokens_20260811          ON CONFLICT (id) DO NOTHING;
INSERT INTO public.health_q_results         SELECT * FROM public._arch_testacct8_ab_health_q_results_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.form_submissions         SELECT * FROM public._arch_testacct8_ab_form_submissions_20260811         ON CONFLICT (id) DO NOTHING;
INSERT INTO public.customer_treatment_memos SELECT * FROM public._arch_testacct8_ab_customer_treatment_memos_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_in_services        SELECT * FROM public._arch_testacct8_ab_check_in_services_20260811        ON CONFLICT (id) DO NOTHING;
INSERT INTO public.check_in_room_logs       SELECT * FROM public._arch_testacct8_ab_check_in_room_logs_20260811       ON CONFLICT (id) DO NOTHING;
INSERT INTO public.chart_treatment_requests SELECT * FROM public._arch_testacct8_ab_chart_treatment_requests_20260811 ON CONFLICT (id) DO NOTHING;
INSERT INTO public.assignment_actions       SELECT * FROM public._arch_testacct8_ab_assignment_actions_20260811       ON CONFLICT (id) DO NOTHING;

COMMIT;
-- POSTCHECK: customers 2행 복귀 / 91행 전체 재삽입 / fs 2행(draft+voided) 복귀 / 트리거 tgenabled='O' 불변.
