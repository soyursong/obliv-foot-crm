-- DRY-RUN (No-Persistence): T-20260718-foot-VDAILYREV-UNFILTERED-XCRM-APPLY
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · forward 본문에 txn-control 문(COMMIT/SAVEPOINT RELEASE 등) 없음 = sentinel-bypass hazard 부재
--     → runner 의 BEGIN..ROLLBACK 로 무영속. (forward 의 COMMIT/NOTIFY 는 runner 가 strip.)
--   · txn 내부 검증(runner invariants): (a) viewdef 에 status = 'active' 포함,
--       (b) reloptions 에 security_invoker=on, (c) anon grant 0건, (d) authenticated SELECT 유지,
--       (e) 부풀림 제거 delta = -44,800 (deleted n=4), (f) 최근 14일 net_revenue 불변(회귀 0).
--   · 사후 무영속(post-probe): 별 트랜잭션에서 viewdef/reloptions/anon-grant 원상 재확인.
-- 실측 prod 재확인(2026-07-18, rxlomoozakkjesdqjtvd, READ-ONLY probe):
--   · payments.status CHECK = {active,cancelled,deleted}; is_simulation/payment_scope/refund_date 부재
--     → 완전술어 적용불가 → 실효 §R1 = status='active' 단독(single CTE).
--   · package_payments status 컬럼 부재 → pkg CTE 필터 미적용(환불=payment_type='refund' 음수상계).
--   · reloptions=null(security_invoker 미설정=owner권한 RLS우회) → security_invoker=on 하드닝 필요.
--   · anon GRANT: SELECT 포함 → anon GET /rest/v1/v_daily_revenue = HTTP200 (매출유출 실증) → REVOKE 후 차단.
--   · status_dist: active n=118/12,700,250 · deleted n=4/44,800 → 부풀림 delta -44,800. 최근14일 net delta=0.
-- 아래는 무영속 검증용 forward 본문(참고). runner 가 BEGIN 후 실행, ROLLBACK.
BEGIN;

CREATE OR REPLACE VIEW public.v_daily_revenue
  WITH (security_invoker = on) AS
WITH single AS (
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt, clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM payments
  WHERE clinic_id IS NOT NULL AND status = 'active'
  GROUP BY 1, 2
),
pkg AS (
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt, clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM package_payments
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT COALESCE(s.dt, p.dt) AS dt, COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
  COALESCE(s.amt, 0) AS single_revenue, COALESCE(p.amt, 0) AS package_revenue,
  COALESCE(s.amt, 0) + COALESCE(p.amt, 0) AS net_revenue
FROM single s FULL OUTER JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

REVOKE ALL ON public.v_daily_revenue FROM anon;

ROLLBACK;
