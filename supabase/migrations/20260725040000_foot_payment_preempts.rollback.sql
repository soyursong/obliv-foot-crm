-- ROLLBACK — T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX payment_preempts (DA §롤백 SQL 조건)
--   비파괴: 신규 테이블만 DROP. payments/reservations/reconcile 아티팩트 무접촉.
--   DROP TABLE 이 종속 인덱스(open_per_checkin_unique / clinic_status_idx / ttl_sweep_idx)와
--   RLS 정책을 함께 제거하므로 별도 DROP INDEX/POLICY 불요(명시성 위해 CASCADE).
DROP TABLE IF EXISTS public.payment_preempts CASCADE;
-- ⚠ payments/check_ins/customers/staff/clinics 등 참조 부모 테이블 DROP 금지.
-- ⚠ 롤백 시 이미 생성된 payments 행(preempt 매칭으로 INSERT 된 확정 수납)은 payments 원장에
--    그대로 보존됨 — preempt 테이블만 사라질 뿐 확정 수납 데이터는 순소실 0.
