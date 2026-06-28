-- ════════════════════════════════════════════════════════════════════════════
-- T-20260629-foot-NOSHOW-CANONICAL
-- 풋 reservations.status 값 통일: 'noshow' → 'no_show'  (canonical=no_show, 대표 결정)
--
-- 배경: reservations.status 는 'noshow'(언더스코어 없음)를 써왔고(initial_schema L118; 라이브
--   reservations_status_check 는 hfq 포크 상속으로 reserved/done 까지 포함한 슈퍼셋),
--   도파민 콜백 계약(outbox)·이벤트 도메인은 'no_show'를 써서 불일치.
--   foot 버그: DB noshow 다수행(CEO 849 / 2026-06-29 baseline 875행) vs outbox no_show → 데이터 정규화로 해소.
--   FE 표시라벨('노쇼')은 불변(대표 확인). 백엔드/시스템 값만 통일.
--
-- ⚠️ 스코프 가드: notification event_type 'noshow'(send-notification EF, messaging 템플릿 CHECK)는
--   예약상태와 별개 도메인 → 본 마이그는 절대 건드리지 않음. reservations.status 값만 통일.
--
-- 원자성: 단일 트랜잭션. CHECK 제약 교체 + 데이터 백필 + 의존 객체(RPC/트리거 함수) 전부
--   동기 갱신 후 잔존 검증. 어느 하나라도 실패하면 전체 롤백.
--   백필 중 trg_dopamine_cb_resv(AFTER UPDATE OF status) 일시 비활성 → 과거 노쇼 예약의
--   콜백 재적재(outbox) 부작용 차단. (notify_reservation_messaging 은 status='reserved'에만
--   반응하므로 no_show 백필에 무영향.)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) reservations.status CHECK 제약 교체 + 데이터 백필 (원자적) ────────────────
-- 구 제약(인라인 자동명 reservations_status_check)은 'no_show'를 거부하므로 먼저 제거.
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check;

-- 백필 중 도파민 콜백 트리거 비활성 (과거 노쇼 콜백 재적재 방지).
ALTER TABLE public.reservations DISABLE TRIGGER trg_dopamine_cb_resv;

UPDATE public.reservations
   SET status = 'no_show'
 WHERE status = 'noshow';

ALTER TABLE public.reservations ENABLE TRIGGER trg_dopamine_cb_resv;

-- 신규 제약: 라이브 제약(hfq 포크 상속: confirmed/reserved/checked_in/cancelled/done/noshow/no_show)에서
--   'noshow'만 제거. 나머지 허용값(reserved/done 등)은 보존 — 본 티켓 스코프는 noshow→no_show 단일.
--   (실데이터는 confirmed/checked_in/cancelled/no_show 4종만 사용. reserved/done은 미사용 레거시지만 제거 안 함.)
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('confirmed','reserved','checked_in','cancelled','done','no_show'));

-- ── 2) foot_stats_noshow_returning RPC 본문 비교값 noshow→no_show ────────────────
-- (함수명·시그니처·로직 동일, status 리터럴 비교값만 통일)
CREATE OR REPLACE FUNCTION foot_stats_noshow_returning(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  dt              DATE,
  noshow_rate     NUMERIC,   -- 0.0 ~ 100.0
  returning_rate  NUMERIC    -- 0.0 ~ 100.0
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT
      reservation_date AS dt,
      COUNT(*) FILTER (WHERE status = 'no_show')                             AS noshow_cnt,
      COUNT(*) FILTER (WHERE status IN ('checked_in','no_show'))             AS denom_cnt
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

-- ── 3) enqueue_dopamine_callback 트리거 함수 — status 비교 no_show + 매핑 단순화 ──
-- status 값이 이제 계약 event_type 과 동일(no_show/cancelled) → CASE 매핑 제거.
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
    -- visited: 신규 체크인 → 연결 예약이 도파민 연동(external_id) 건일 때만
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
    v_event_id       := NEW.id::TEXT;     -- check_in.id = 멱등키
    v_reservation_id := NEW.reservation_id;
    v_cue_card_id    := v_resv.external_id;
  ELSE
    -- reservations UPDATE — 풋 status('no_show'/'cancelled') 전이
    --   풋엔 'rejected' 예약상태 없음. status 값이 계약 event_type 와 동일(no_show/cancelled).
    IF NEW.status NOT IN ('no_show','cancelled') THEN
      RETURN NEW;
    END IF;
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;  -- 동일 상태 재기록 무시 (멱등)
    END IF;
    IF NEW.source_system IS DISTINCT FROM 'dopamine'
       OR NEW.external_id IS NULL THEN
      RETURN NEW;  -- 도파민 연동 건만 발사
    END IF;
    -- status 값이 곧 계약 event_type (no_show→no_show, cancelled→cancelled) → 직접 사용
    v_event_type     := NEW.status;
    v_event_id       := NEW.id::TEXT;     -- reservation.id = 멱등키
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
  ON CONFLICT (event_type, event_id) DO NOTHING;  -- 멱등 적재

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_dopamine_callback() IS
  'T-CALLBACK-EF-4: 라이프사이클(visited/no_show/cancelled/rejected) → outbox 적재. '
  '도파민 연동(source_system=dopamine + external_id) 건만. status=계약 event_type 동일(NOSHOW-CANONICAL). 동기 발송 안 함.';

-- ── 4) check_reservation_status (foot-022: 노쇼/취소 예약 체크인 차단) status 갱신 ──
-- 라이브 함수가 SET search_path TO 'public' 보유(드리프트) → 보존. status 비교값만 no_show 로.
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
        AND status IN ('no_show', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot create check-in for no_show/cancelled reservation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5) 잔존 검증 — noshow 0행이어야 함 (아니면 EXCEPTION → 전체 롤백) ─────────────
DO $$
DECLARE v_left INT;
BEGIN
  SELECT count(*) INTO v_left FROM public.reservations WHERE status = 'noshow';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'NOSHOW-CANONICAL 백필 실패: noshow 잔존 % 행 — 트랜잭션 롤백', v_left;
  END IF;
END $$;

COMMIT;
