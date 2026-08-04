-- Rollback: T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
-- 신규 테이블 monthly_sales_targets 전체 제거(ADDITIVE 역연산). 트리거/정책은 테이블 DROP CASCADE로 함께 소멸.
-- ⚠️ 목표금액 데이터 유실 주의 — 롤백 전 백업 권장(운영 목표값 보존 필요 시).

drop table if exists public.monthly_sales_targets cascade;
