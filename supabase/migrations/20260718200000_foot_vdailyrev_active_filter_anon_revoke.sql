-- T-20260718-foot-VDAILYREV-UNFILTERED-XCRM-APPLY — scalp2 canonical fan-out (foot apply)
-- v_daily_revenue 이중결함 FIX (부모 T-20260718-scalp2-VDAILYREV-UNFILTERED-XCRM-FIX, commit e1a02506 상속):
--   (AC-B 매출정합) status='active' 필터 → 취소/삭제 결제 매출부풀림 제거
--   (AC-A 보안하드닝) anon REVOKE + security_invoker=on → 공개키 REST 매출유출(HTTP200 실증) 차단
--
-- 근거: data-architect §R1 SSOT (da_reply_scalp2_vdailyrev_unfiltered_simstatus_20260718.md) 구현정합.
--       change-class = autonomy §3.1 CEO 게이트 면제(신규 정책 아님, §R1 SSOT + scalp2 canonical 상속).
--       배포게이트 = supervisor DDL-diff.
--
-- ★ foot 실컬럼 재확인 (AC4 문언편차 대응 — 2026-07-18 prod rxlomoozakkjesdqjtvd 실측):
--     payments 컬럼: status 존재(CHECK status IN ('active','cancelled','deleted')).
--       is_simulation / payment_scope / refund_date 는 부재 → DA canonical 완전술어 적용 불가.
--       → scalp2 실효 §R1 매핑 = status = 'active' (cancelled/deleted 배제). 환불은 view가
--         payment_type='refund' → 음수상계로 이미 처리 → refund_date 술어 불요.
--     package_payments 컬럼: status 컬럼 자체가 부재(실측) → status 필터는 payments(single) CTE 에만 적용.
--       티켓 §2 AC4 "양 CTE" 문언은 foot 스키마상 pkg CTE 에 적용 불가 → single CTE 단독 적용이 실효.
--       package_payments 환불도 payment_type='refund' 음수상계로 처리됨(추가필터 불요).
--     → foot 프로파일 = scalp2 프로파일과 동일(payments.status만 존재). canonical 그대로 적용.
-- ★ security_invoker=on: 원 stats_views.sql 헤더주석("views default to SECURITY INVOKER")은
--     실측 reloptions=null 로 미설정 → owner(postgres) 권한 실행 = 하부 payments/package_payments
--     RLS 우회였음. security_invoker=on 으로 하부 RLS 상속을 강제(주석과 실제 거동 정합화).
--
-- ★ AC-B 부풀림 실측(prod, 2026-07-18): status 분포 active n=117/12,690,250 · deleted n=4/44,800.
--     status='active' 필터 → 부풀림 제거 delta = -44,800 (2026-05-21 -4,690 + 2026-05-30 -40,110).
--     최근 14일 활성일 매출은 불변(회귀 0).

BEGIN;

CREATE OR REPLACE VIEW public.v_daily_revenue
  WITH (security_invoker = on) AS
WITH single AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM payments
  WHERE clinic_id IS NOT NULL
    AND status = 'active'            -- ★AC-B: 취소/삭제 결제 배제 (foot 실측 §R1)
  GROUP BY 1, 2
),
pkg AS (
  SELECT
    (created_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
    clinic_id,
    SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)::bigint AS amt
  FROM package_payments             -- ★ status 컬럼 부재(foot 실측) → 필터 불가/불요 (환불=음수상계)
  WHERE clinic_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  COALESCE(s.dt, p.dt) AS dt,
  COALESCE(s.clinic_id, p.clinic_id) AS clinic_id,
  COALESCE(s.amt, 0) AS single_revenue,
  COALESCE(p.amt, 0) AS package_revenue,
  COALESCE(s.amt, 0) + COALESCE(p.amt, 0) AS net_revenue
FROM single s
FULL OUTER JOIN pkg p ON p.dt = s.dt AND p.clinic_id = s.clinic_id;

-- AC-A: anon 은 매출 조회 정당사유 없음 → REVOKE (tightening-safe). authenticated GRANT 는 유지.
REVOKE ALL ON public.v_daily_revenue FROM anon;

COMMENT ON VIEW public.v_daily_revenue IS
  'foot-047 + T-20260718-foot-VDAILYREV-APPLY: 일 매출(payments status=active + package_payments, 환불차감). security_invoker=on, anon REVOKE.';

COMMIT;

NOTIFY pgrst, 'reload schema';
