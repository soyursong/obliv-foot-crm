-- T-20260602-foot-SLOT-DWELL-TIME (B안: 2번차트 슬롯별 체류시간 이력 조회)
--
-- 신규 함수: fn_check_in_slot_dwell(p_check_in_ids UUID[])
--   고객 차트(2번차트)에서 방문건(check_in)별로 각 슬롯(상태=상담실/치료실 등)에
--   머문 시간을 read-only 로 산출한다. 기존 status_transitions(전이 로그)만 사용 —
--   신규 쓰기/스키마 변경 없음(AC-5 충족). 기존 테이블 스키마 무변경.
--
-- 산출 모델:
--   - check_ins.checked_in_at 부터 첫 전이 시각까지 = 최초 슬롯('registered' 등) 체류
--   - 각 status_transitions(i)의 from_status = 그 전이 직전에 머문 슬롯,
--     체류구간 = [직전 전이 시각(없으면 checked_in_at), 현재 전이 시각]
--   - 마지막(현재) 슬롯 = 마지막 전이의 to_status(전이 없으면 현재 status),
--     체류구간 = [마지막 전이 시각(없으면 checked_in_at), now()]
--     단, 현재 status 가 done/cancelled 이면 "현재 슬롯"은 없음(완료/취소는 체류대상 아님) → 미산출.
--
-- 보안:
--   - SECURITY INVOKER(기본) — RLS 그대로 적용. status_transitions / check_ins 모두
--     approved authenticated 사용자에게 SELECT 허용(rls_role_separation E.19)이므로
--     별도 DEFINER 불필요. clinic 스코프는 호출측(차트 페이지)이 자기 clinic의
--     check_in_id 만 전달하는 것으로 보존(read-only, PII 미반환 — 상태/시각만).
--   - GRANT authenticated 만 (anon 미부여).
--
-- 롤백: 20260602230000_check_in_slot_dwell_fn.rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_check_in_slot_dwell(p_check_in_ids UUID[])
RETURNS TABLE(
  check_in_id      UUID,
  seq              INT,
  status           TEXT,
  entered_at       TIMESTAMPTZ,
  exited_at        TIMESTAMPTZ,
  duration_seconds BIGINT,
  is_current       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ci AS (
    SELECT id, checked_in_at, status AS current_status
    FROM check_ins
    WHERE id = ANY(p_check_in_ids)
  ),
  tr AS (
    SELECT
      st.check_in_id,
      st.from_status,
      st.to_status,
      st.transitioned_at,
      ROW_NUMBER() OVER (PARTITION BY st.check_in_id ORDER BY st.transitioned_at, st.id) AS rn,
      COUNT(*)     OVER (PARTITION BY st.check_in_id)                                    AS total
    FROM status_transitions st
    WHERE st.check_in_id = ANY(p_check_in_ids)
  ),
  -- 각 전이 직전에 머문 슬롯(from_status) 구간
  segs AS (
    SELECT
      t.check_in_id,
      t.rn::INT AS seq,
      t.from_status AS status,
      COALESCE(
        LAG(t.transitioned_at) OVER (PARTITION BY t.check_in_id ORDER BY t.rn),
        c.checked_in_at
      ) AS entered_at,
      t.transitioned_at AS exited_at,
      FALSE AS is_current
    FROM tr t
    JOIN ci c ON c.id = t.check_in_id
  ),
  -- 방문건별 마지막 전이 한 건
  last_tr AS (
    SELECT DISTINCT ON (check_in_id)
      check_in_id, to_status, transitioned_at, total
    FROM tr
    ORDER BY check_in_id, rn DESC
  ),
  -- 마지막(현재) 슬롯 구간 — done/cancelled 는 체류대상 아님 → 제외
  final_seg AS (
    SELECT
      c.id AS check_in_id,
      (COALESCE(lt.total, 0) + 1)::INT AS seq,
      COALESCE(lt.to_status, c.current_status) AS status,
      COALESCE(lt.transitioned_at, c.checked_in_at) AS entered_at,
      now() AS exited_at,
      TRUE AS is_current
    FROM ci c
    LEFT JOIN last_tr lt ON lt.check_in_id = c.id
    WHERE c.current_status NOT IN ('done', 'cancelled')
  )
  SELECT
    s.check_in_id,
    s.seq,
    s.status,
    s.entered_at,
    s.exited_at,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (s.exited_at - s.entered_at))))::BIGINT AS duration_seconds,
    s.is_current
  FROM (
    SELECT check_in_id, seq, status, entered_at, exited_at, is_current FROM segs
    UNION ALL
    SELECT check_in_id, seq, status, entered_at, exited_at, is_current FROM final_seg
  ) s
  ORDER BY s.check_in_id, s.seq;
$$;

GRANT EXECUTE ON FUNCTION public.fn_check_in_slot_dwell(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.fn_check_in_slot_dwell IS
  'T-20260602-foot-SLOT-DWELL-TIME (B안): 방문건별 슬롯(상태) 체류시간 read-only 산출.'
  ' status_transitions 전이 인터벌 기반. done/cancelled 는 현재 슬롯 미산출. SECURITY INVOKER(RLS 준수).';

COMMIT;
