-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260629-foot-NOSHOW-CANONICAL
-- reservations.status 값 되돌림: 'no_show' → 'noshow' + 의존 객체 원복.
-- ⚠️ 비상 롤백 전용. FE/EF 도 함께 revert(이전 커밋) 해야 정합. 단독 실행 금지.
-- 원자성: 단일 트랜잭션. 백필 중 trg_dopamine_cb_resv 비활성.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) CHECK 제약 원복 + 데이터 백필
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check;

ALTER TABLE public.reservations DISABLE TRIGGER trg_dopamine_cb_resv;

UPDATE public.reservations
   SET status = 'noshow'
 WHERE status = 'no_show';

ALTER TABLE public.reservations ENABLE TRIGGER trg_dopamine_cb_resv;

-- 롤백: 마이그 직전 라이브 제약 def 정확 복원 (noshow + no_show 양립 슈퍼셋).
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('confirmed','reserved','checked_in','cancelled','done','noshow','no_show'));

-- 2) foot_stats_noshow_returning RPC 비교값 원복
CREATE OR REPLACE FUNCTION foot_stats_noshow_returning(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  noshow_rate     NUMERIC,
  returning_rate  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT
      reservation_date AS dt,
      COUNT(*) FILTER (WHERE status = 'noshow')                              AS noshow_cnt,
      COUNT(*) FILTER (WHERE status IN ('checked_in','noshow'))              AS denom_cnt
    FROM reservations
    WHERE clinic_id = p_clinic_id
      AND reservation_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  ck AS (
    SELECT
      (checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS dt,
      COUNT(*) FILTER (WHERE visit_type = 'returning')  AS returning_cnt,
      COUNT(*)                                          AS total_cnt
    FROM check_ins
    WHERE clinic_id = p_clinic_id
      AND checked_in_at IS NOT NULL
      AND status NOT IN ('cancelled')
      AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  )
  SELECT
    COALESCE(r.dt, c.dt) AS dt,
    CASE
      WHEN COALESCE(r.denom_cnt, 0) > 0
      THEN ROUND((r.noshow_cnt::numeric / r.denom_cnt) * 100, 1)
      ELSE 0
    END AS noshow_rate,
    CASE
      WHEN COALESCE(c.total_cnt, 0) > 0
      THEN ROUND((c.returning_cnt::numeric / c.total_cnt) * 100, 1)
      ELSE 0
    END AS returning_rate
  FROM res r
  FULL OUTER JOIN ck c ON c.dt = r.dt
  ORDER BY 1;
$$;

-- 3) enqueue_dopamine_callback 트리거 함수 원복 (CASE 매핑 복원)
CREATE OR REPLACE FUNCTION public.enqueue_dopamine_callback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type     TEXT;
  v_event_id       TEXT;
  v_reservation_id UUID;
  v_cue_card_id    TEXT;
  v_resv           RECORD;
BEGIN
  IF TG_TABLE_NAME = 'check_ins' THEN
    IF NEW.reservation_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT r.id, r.source_system, r.external_id
      INTO v_resv
      FROM public.reservations r
      WHERE r.id = NEW.reservation_id;
    IF NOT FOUND
       OR v_resv.source_system IS DISTINCT FROM 'dopamine'
       OR v_resv.external_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_type     := 'visited';
    v_event_id       := NEW.id::TEXT;
    v_reservation_id := NEW.reservation_id;
    v_cue_card_id    := v_resv.external_id;
  ELSE
    IF NEW.status NOT IN ('noshow','cancelled') THEN
      RETURN NEW;
    END IF;
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.source_system IS DISTINCT FROM 'dopamine'
       OR NEW.external_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_type     := CASE NEW.status
                          WHEN 'noshow' THEN 'no_show'
                          ELSE NEW.status
                        END;
    v_event_id       := NEW.id::TEXT;
    v_reservation_id := NEW.id;
    v_cue_card_id    := NEW.external_id;
  END IF;

  INSERT INTO public.dopamine_callback_outbox
    (event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    v_event_type,
    v_event_id,
    v_reservation_id,
    v_cue_card_id,
    jsonb_build_object(
      'source_system',  'foot',
      'event_type',     v_event_type,
      'event_id',       v_event_id,
      'cue_card_id',    v_cue_card_id,
      'reservation_id', v_reservation_id,
      'occurred_at',    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 4) check_reservation_status 원복 (SET search_path TO 'public' 보존)
CREATE OR REPLACE FUNCTION public.check_reservation_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE id = NEW.reservation_id
        AND status IN ('noshow', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot create check-in for noshow/cancelled reservation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
