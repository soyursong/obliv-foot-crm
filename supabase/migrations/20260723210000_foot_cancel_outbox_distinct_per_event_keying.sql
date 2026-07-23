-- 20260723210000_foot_cancel_outbox_distinct_per_event_keying
-- T-20260723-foot-CANCEL-OUTBOX-ENQUEUE-DISTINCT
--   (DA-20260723-XCRM-CANCEL-ENQUEUE-DISTINCT, verdict=GO_WARN / INV-CANCEL-ENQUEUE-DISTINCT 정본)
--   twin recipe = T-20260723-scalp2-CANCEL-OUTBOX-ENQUEUE-KEYING(commit 5340f027, deploy-ready) cross-CRM 확산.
--
-- 목적: cancel 이벤트 outbox enqueue 를 distinct-per-occurrence 키잉으로 전환.
--   재활성(restore)→재취소 시 2차 취소가 outbox 적재 단계 UNIQUE(event_type,event_id)
--   +ON CONFLICT DO NOTHING(mig 20260603010000 L82/188)에서 duplicate-drop → 도파민 미반영
--   silent 유실을 봉합. (dispatch EF payload event_id=row.id 발신계약(§14.2)은 이미 충족,
--   그러나 그 층은 outbox 행이 실제 INSERT 돼야 도달 → 조기 dedup 게이트가 더 이른 별개 층 =
--   본 마이그가 봉합하는 대상.)
--
-- ── live restore-UI 확인(무해조건 falsify) ──
--   Reservations.tsx handleEditorRestore(AC-7, L1983-): status='confirmed' + cancelled_at=NULL 리셋
--   → 재취소 동선 현실화 → "재취소 미발생(무해)" 조건 falsified → hardening MANDATORY.
--
-- 설계 = DA Approach A (트리거 v_event_id 파생, cancelled_at 앵커, cancel 분기 한정):
--   v_event_id := NEW.id::text || ':' || extract(epoch from NEW.cancelled_at)::text
--   · epoch = tz-independent 절대시각 + sub-second 유지. ::bigint(초 절삭) 금지 —
--     재활성→즉시재취소 동초 충돌 여지 차단.
--   · UNIQUE 제약 DDL 무변경(값만 granular) → ON CONFLICT(event_type,event_id) 그대로.
--   · payload event_id = row.id(dispatch EF 발신계약 §14.2) 유지 — 두 층 직교, 둘 다 distinct-per-occurrence.
--   · no_show 는 스코프 밖 → bare(NEW.id) 유지.
--
-- 불변식 보존:
--   (1) distinct-per-occurrence: restore(FE)가 cancelled_at NULL 리셋 + 재취소가 새 now()
--       → 재취소마다 키 distinct → 2차 outbox 행 INSERT 성립.
--   (2) within-occurrence 멱등: 동일 취소 tx 내 cancelled_at 고정(now()=tx-stable) → 동일 키
--       → ON CONFLICT DO NOTHING 흡수 유지. (emit 트리거에서 now()/clock_timestamp() 직접 앵커 안 함.)
--
-- ── prereq #1 (cancelled_at 원자성) 조치 — twin 동형 ──
--   진단: 풋 cancel 경로가 2개.
--     · FE(src/pages/Reservations.tsx handleEditorCancel L1894-1899): status='cancelled' + cancelled_at=now()
--       동일 UPDATE → 원자적. OK. restore(L2001)는 cancelled_at=NULL 리셋 → 재취소가 새 now() 획득. OK.
--     · RPC(cancel_reservation_from_source cancel, mig 20260723200000 L134-143):
--       status='cancelled' + updated_at=now() 만 SET, cancelled_at 부재 → 도파민 연동(source=dopamine
--       +external_id) 행 취소 시 NEW.cancelled_at NULL → composite 키 NULL 전파 →
--       event_id NOT NULL 위반 → 취소 회귀. ★ prereq #1 미충족 경로.
--   조치(twin 동형, DA GO): BEFORE UPDATE OF status 트리거로 DB 계층에서 보편 원자화.
--     BEFORE 는 AFTER emit 트리거(trg_dopamine_cb_resv)보다 항상 먼저 발화 → NEW.cancelled_at 가시성 보장.
--     RPC 본문 verbatim 재현(전사 리스크) 대신 모든 취소경로(FE/RPC/미래) 균일 커버.
--     FE 경로는 cancelled_at 이미 non-null → no-op(무영향).
--
-- ── prereq #2 (outbox.event_id 하류 소비자) 확인 ──
--   outbox 는 별도 reservation_id 컬럼(mig 20260603010000 L60) 보유. 본 변경은 event_id 만 composite.
--   dispatch EF(cancel)는 payload event_id=row.id 사용 + cue_card_id 로 대상 식별(event_id 를
--   reservation_id 로 join 안 함). alert_dopamine_callback_dlq 는 event_id 를 display(left 8)로만 사용.
--   reservation_id 참조 소비자는 outbox.reservation_id / payload.reservation_id(bare 유지) 로 읽음.
--   → event_id 를 bare reservation_id 로 기대하는 소비자 부재. OK.
--
-- change-class: ADDITIVE·가역·non-PHI. UNIQUE 제약 DDL 0(값 granularity만), 트리거함수 CREATE OR REPLACE +
--   신규 BEFORE 트리거 1. 게이트: autonomy §3.1 대표게이트 면제, supervisor DDL-diff(DB-gate).
--   baseline = 20260629150000_foot_resv_status_noshow_to_no_show(현행 enqueue 정의, source_system=foot,
--   status IN no_show/cancelled 직접). cancel 분기 v_event_id 만 composite 로 변경. 그 외 무변경.
-- 롤백: 20260723210000_foot_cancel_outbox_distinct_per_event_keying.rollback.sql
-- dryrun: 20260723210000_foot_cancel_outbox_distinct_per_event_keying.dryrun.sql (no-persistence)
-- 작성: dev-foot / ticket T-20260723-foot-CANCEL-OUTBOX-ENQUEUE-DISTINCT

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) prereq #1 원자화 — BEFORE UPDATE OF status: cancelled 전이 시 cancelled_at 보장
--    (RPC cancel_reservation_from_source 가 cancelled_at 미설정 → composite 키 NULL 방지)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ensure_reservation_cancelled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- status 가 cancelled 로 전이하는데 cancelled_at 이 비어 있으면 원자적으로 채운다.
  --   now() = transaction_timestamp (tx-stable) → within-occurrence 멱등 보존.
  --   FE 경로(이미 cancelled_at set)는 no-op. restore(status<>'cancelled')는 무접촉.
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_reservation_cancelled_at() IS
  'T-foot-CANCEL-OUTBOX-ENQUEUE-DISTINCT: cancelled 전이 시 cancelled_at 원자 보장(NULL이면 now()). '
  'outbox distinct-per-event 키(enqueue_dopamine_callback)의 cancelled_at 앵커 non-null 전제. '
  'RPC cancel_reservation_from_source(cancelled_at 미설정) 커버. FE 경로 no-op.';

DROP TRIGGER IF EXISTS trg_ensure_reservation_cancelled_at ON public.reservations;
CREATE TRIGGER trg_ensure_reservation_cancelled_at
  BEFORE UPDATE OF status ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_reservation_cancelled_at();

-- ══════════════════════════════════════════════════════════════════
-- 2) enqueue_dopamine_callback() — cancel 분기 distinct-per-occurrence 키잉
--    (20260629150000 정의에서 cancel 분기 v_event_id 만 composite 로 변경. 그 외 무변경.)
-- ══════════════════════════════════════════════════════════════════
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
    -- ★ DA-20260723-XCRM-CANCEL-ENQUEUE-DISTINCT (GO_WARN, Approach A): cancel 분기 한정
    --   distinct-per-occurrence 키잉. cancelled 는 restore→재취소 시 매 취소가 distinct
    --   event_id 를 얻어야 outbox UNIQUE(event_type,event_id)+ON CONFLICT DO NOTHING 조기
    --   dedup 게이트에서 2차 취소가 drop 되지 않음(silent 유실 봉합). 앵커=cancelled_at
    --   (BEFORE 트리거 trg_ensure_reservation_cancelled_at 로 원자 보장). epoch(::bigint 금지 —
    --   sub-second 유지, 재활성→동초 재취소 충돌 방지). no_show 는 스코프 밖 → bare 유지.
    --   payload event_id = row.id(§14.2 발신계약) 유지 — 수신부 dedup 층 무변경.
    IF NEW.status = 'cancelled' THEN
      v_event_id := NEW.id::TEXT || ':' || extract(epoch from NEW.cancelled_at)::TEXT;
    ELSE
      v_event_id := NEW.id::TEXT;     -- no_show: reservation.id = 멱등키(무변경)
    END IF;
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
  'T-CALLBACK-EF-4 + CANCEL-OUTBOX-ENQUEUE-DISTINCT: 라이프사이클(visited/no_show/cancelled) → outbox 적재. '
  '도파민 연동(source_system=dopamine + external_id) 건만. payload source_system=foot. '
  'cancel 분기 event_id = reservation_id:epoch(cancelled_at) — distinct-per-occurrence(재취소 봉합). '
  'no_show/visited = bare 멱등키. 동기 발송 안 함.';

COMMIT;
