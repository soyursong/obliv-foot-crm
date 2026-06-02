-- ============================================================================
-- T-20260602-foot-SELFCHECKIN-DUP-GUARD · dedupe DRY-RUN (READ-ONLY)
-- ============================================================================
-- ⚠️ READ-ONLY — 본 스크립트는 SELECT 만. 어떤 row 도 변경/삭제하지 않는다.
--    idx_checkins_walkin_daily UNIQUE index 생성 전 게이트(GO_WARN) 필수 선행조사.
--
-- 목적: (clinic_id, customer_id, KST-day) status<>cancelled 활성 중복 그룹과
--       그 안의 모든 row 를 상세 나열 → 대표/총괄 행별 confirm 자료.
--
-- 정리 권고(확인 후 사람이 결정): 그룹별 "활성 1건 유지" 원칙.
--   - 유지 후보: 워크플로가 가장 진행된/가장 최근 row (예: status 진행도 우선, 동률 시 created_at 최신).
--   - 나머지: status='cancelled' 로 논리삭제(가드/인덱스 카운트 제외) 또는 물리삭제(테스트 데이터 한정).
--   - 결정은 반드시 사람 확인 후. 본 스크립트는 판단 자료만 제공.
-- ============================================================================

-- [1] 위반 그룹 요약 (몇 개 그룹이 인덱스 생성을 막는가)
SELECT
  clinic_id,
  customer_id,
  (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
  count(*)                                     AS active_checkins,
  array_agg(status ORDER BY created_at)        AS statuses,
  array_agg(id     ORDER BY created_at)        AS ids
FROM public.check_ins
WHERE status NOT IN ('cancelled')
  AND customer_id IS NOT NULL
GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
HAVING count(*) > 1
ORDER BY active_checkins DESC, kst_day DESC;

-- [2] 위반 그룹의 모든 row 상세 (행별 confirm 용)
--     test-pattern(가명/테스트 전화) 여부를 함께 표기해 QA 흔적 식별을 돕는다.
WITH dup_groups AS (
  SELECT clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day
  FROM public.check_ins
  WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
  GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
  HAVING count(*) > 1
)
SELECT
  ci.id,
  ci.clinic_id,
  ci.customer_id,
  ci.customer_name,
  ci.customer_phone,
  ci.status,
  ci.queue_number,
  ci.reservation_id,
  ci.created_at,
  (ci.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
  -- 유지 후보 힌트: 그룹 내 최신 created_at = TRUE (사람이 최종 판단)
  (ci.created_at = max(ci.created_at) OVER (
     PARTITION BY ci.clinic_id, ci.customer_id, (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
   )) AS is_latest_in_group,
  -- QA/테스트 흔적 추정: 반복 99/테스트 전화 패턴
  (regexp_replace(COALESCE(ci.customer_phone,''),'[^0-9]','','g') ~ '(9999|0000|1111|99990|99060)') AS looks_test_phone
FROM public.check_ins ci
JOIN dup_groups g
  ON  g.clinic_id   = ci.clinic_id
  AND g.customer_id = ci.customer_id
  AND g.kst_day     = (ci.created_at AT TIME ZONE 'Asia/Seoul')::date
WHERE ci.status NOT IN ('cancelled')
ORDER BY ci.clinic_id, ci.customer_id, kst_day, ci.created_at;

-- [3] 정리 후 재검증용 (정리 작업 후 0 이어야 index 생성 가능)
SELECT count(*) AS remaining_violation_groups
FROM (
  SELECT 1
  FROM public.check_ins
  WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
  GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
  HAVING count(*) > 1
) t;
