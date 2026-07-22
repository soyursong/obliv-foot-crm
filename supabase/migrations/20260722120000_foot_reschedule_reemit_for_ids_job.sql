-- T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE — 풋 reschedule re-emit executable (foot-side)
-- 계약 SSOT = planner NEW-TASK(MSG-20260722-125737-5wfq). parent = crm executable
--   T-20260722-crm-CANCELCALL-REEMIT-EXECUTABLE (deployed) 의 foot 동형 하드포크.
--
-- ── 문제(ball) ────────────────────────────────────────────────────────────────
--   A1-R frozen 687 재발화 실행(DA)에서 emitted 528 / skip 159. skip 159 中
--   **foot·crm_ahead 22건이 reservation_not_found** — crm executable(longre)은 자기테이블만
--   read 하므로(설계상 정상, hot-path cross-CRM read 0) foot 예약 id 를 못 찾음.
--   → 동형 RPC 를 foot(rxlomooz)에 배포해야 그 22건 재발화 가능. 발화 주체는 DA(a1r_snapshots 보유).
--
-- ── 설계(멱등 re-emit = foot canonical 권위 재동기, clobber 무위험) ─────────────
--   • 재사용 경로: 기존 dopamine_callback_outbox(20260603010000) + worker(분당 pg_cron
--     foot-dopamine-callback-worker) + dopamine-callback-dispatch EF → 도파민 crm-lifecycle-callback.
--     신규 outbox/드레인/EF/트리거 0.
--   • payload = enqueue_dopamine_reschedule() 트리거(20260716140000)와 **동일 shape**
--     (source_system='foot'/event_type='reschedule'/event_id/cue_card_id/crm_reservation_id/
--      reservation_id/new_date/changed_at/occurred_at) → 수신부가 live reschedule 과 동일 취급.
--     값은 canonical 현재값(reservations.reservation_date)에서 산출 = foot(source of authority) native.
--     old_date 는 re-emit 시점에 OLD 부재 → 생략(parent crm executable 선례 정합, 수신부 무영향).
--   • 불변식 정합(parent crm executable 동일):
--       - NO-BULK 무위배: 정본/미러에 raw UPDATE 0. outbox(큐) INSERT 만 → 실제 수렴은 멱등 콜백 재발화.
--       - 단조가드: changed_at = now() > 미러 crm_synced_at(stale=과거) → 항상 통과(신규결과 미소멸).
--       - grain: crm_reservation_id = reservations.id(canonical 예약 grain=풋 PK) emit.
--         수신부가 미러 crm_reservation_id 일치로 적용. grain 불일치 건은 수신부 no-apply(범위 밖).
--         hot-path cross-CRM read 없이 foot canonical 만으로 emit(DA read-반려 설계 정합).
--   • enqueue 게이트 미러: 트리거와 동일하게 source_system='dopamine' AND external_id NOT NULL 건만 emit.
--   • event_id 네임스페이스: id || ':reemit:' || p_batch_tag → 트리거 이벤트(랜덤 uuid PK)와 충돌 0.
--     동일 batch_tag 재실행 = outbox UNIQUE(event_type,event_id) ON CONFLICT DO NOTHING → 0 신규(멱등).
--     새 발화가 필요하면 DA 가 새 batch_tag 지정.
--
-- ── ★foot 실 스키마 실측 대조 (crm 가정 복붙 아님) ──────────────────────────────
--   [outbox 테이블명]  public.dopamine_callback_outbox            (20260603010000) — crm 동명, 확인
--   [ON CONFLICT arb]  UNIQUE(event_type, event_id) = uq_dopamine_outbox_event — crm 동형, 확인
--   [event_type CHECK] 'reschedule' 등재됨 (20260716140000 ADDITIVE) — re-emit 적재 통과, 확인
--   [reschedule 트리거] enqueue_dopamine_reschedule() / trg_dopamine_cb_resv_reschedule
--                       (20260716140000) = payload shape SSOT — 실측, 확인
--   [enqueue 게이트]    reservations.source_system='dopamine' AND external_id NOT NULL — 실측, 확인
--   [canonical 컬럼]    reservations.(id, external_id, source_system, reservation_date, status) — 실측, 확인
--   [outbox INSERT 컬럼] (event_type, event_id, reservation_id, cue_card_id, payload)
--                        id 는 DEFAULT gen_random_uuid() → 미지정(event_id 는 uuid 아님, id 로 못 씀) — 확인
--   ▷ crm 대비 delta = payload.source_system 'crm'→'foot', payload 에 reservation_id 키 추가
--     (foot live 트리거 shape 정합). 그 외 불변식·게이트·arbiter·grain 전부 동일.
--
-- ── 인터페이스(DA handoff) ──────────────────────────────────────────────────────
--   잡 트리거 방식 = 단일 RPC 호출:
--     SELECT * FROM public.reemit_reschedule_for_ids(
--       p_reservation_ids => ARRAY[...]::uuid[],   -- 프리즈된 22 foot·crm_ahead id셋(스냅샷) 주입
--       p_batch_tag       => 'cancelcall-readside-canon-harden-foot-20260722',
--       p_dry_run         => true                   -- 기본 true(안전). emit/skip breakdown 프리뷰 후 false.
--     );
--   반환(행별 감사): (reservation_id, action, reason, event_id, new_date, cue_card_id)
--     action ∈ would_emit(dry) | emitted | noop_conflict(이미 적재) | skip
--     skip reason ∈ reservation_not_found | not_dopamine_linked | no_external_id | no_reservation_date
--
-- ── 배포 ────────────────────────────────────────────────────────────────────────
--   ADDITIVE(신규 함수 1개 · DROP/ALTER/backfill 0 · 신규 컬럼/테이블/enum 0 → 데이터정책 CONSULT 게이트 불요).
--   DA GO(요청자) + parent crm DA GO 선례 → autonomy §3.1 대표게이트 불요.
--   supervisor DDL-diff(非PHI) + 롤백 SQL 동봉 = prod apply 게이트.
--   prod(rxlomooz) apply 후 DA 가 프리즈 22 로 RPC 발화(dry_run=false) → close-the-loop.
--   field close 는 parent crm executable close-loop 와 합류(박민지/최원용 재확인 前 금지).
-- 롤백: 20260722120000_foot_reschedule_reemit_for_ids_job.rollback.sql (DROP FUNCTION — 데이터 무접점).
-- dry-run: 20260722120000_foot_reschedule_reemit_for_ids_job.dryrun.sql (No-Persistence).
-- 작성: dev-foot / 2026-07-22 · ticket: T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE

BEGIN;

CREATE OR REPLACE FUNCTION public.reemit_reschedule_for_ids(
  p_reservation_ids UUID[],
  p_batch_tag       TEXT,
  p_dry_run         BOOLEAN DEFAULT true
)
RETURNS TABLE (
  reservation_id UUID,
  action         TEXT,
  reason         TEXT,
  event_id       TEXT,
  new_date       DATE,
  cue_card_id    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
-- OUT 컬럼(event_id/reservation_id/cue_card_id)이 dopamine_callback_outbox 동명 컬럼과 겹침 →
-- SQL 문(ON CONFLICT 등) 내 모호참조는 컬럼으로 해소(할당 LHS·RETURN NEXT 는 변수로 동작, 무영향).
#variable_conflict use_column
DECLARE
  v_changed_at TIMESTAMPTZ := now();  -- 배치 전체 공유 스탬프(단조가드: > 미러 crm_synced_at)
  v_id         UUID;
  v_rec        RECORD;
  v_event_id   TEXT;
  v_rowcount   INT;
  v_iso        TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  -- batch_tag 필수 — event_id 네임스페이스 격리(트리거 랜덤 uuid 와 충돌 방지 + 재실행 멱등 앵커).
  IF p_batch_tag IS NULL OR btrim(p_batch_tag) = '' THEN
    RAISE EXCEPTION 'p_batch_tag required (event_id namespace / idempotency anchor)';
  END IF;
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN;  -- 빈 id셋 = no-op
  END IF;

  FOREACH v_id IN ARRAY p_reservation_ids LOOP
    -- canonical 현재값 로드 (hot-path cross-CRM read 없음 — foot 자기 테이블만)
    SELECT r.id, r.external_id, r.source_system, r.reservation_date, r.status
      INTO v_rec
      FROM public.reservations r
     WHERE r.id = v_id;

    IF NOT FOUND THEN
      reservation_id := v_id; action := 'skip'; reason := 'reservation_not_found';
      event_id := NULL; new_date := NULL; cue_card_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    -- enqueue 게이트 미러(트리거와 동일): 도파민 연동 건만.
    IF v_rec.source_system IS DISTINCT FROM 'dopamine' THEN
      reservation_id := v_id; action := 'skip'; reason := 'not_dopamine_linked';
      event_id := NULL; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_rec.external_id IS NULL THEN
      reservation_id := v_id; action := 'skip'; reason := 'no_external_id';
      event_id := NULL; new_date := v_rec.reservation_date; cue_card_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_rec.reservation_date IS NULL THEN
      reservation_id := v_id; action := 'skip'; reason := 'no_reservation_date';
      event_id := NULL; new_date := NULL; cue_card_id := v_rec.external_id;
      RETURN NEXT; CONTINUE;
    END IF;

    -- event_id: 트리거(랜덤 uuid PK)와 별개 네임스페이스 → 라이브 이벤트 무충돌 + batch 멱등.
    v_event_id := v_rec.id::TEXT || ':reemit:' || p_batch_tag;

    IF p_dry_run THEN
      reservation_id := v_id; action := 'would_emit'; reason := NULL;
      event_id := v_event_id; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
      RETURN NEXT; CONTINUE;
    END IF;

    -- 멱등 적재 — payload shape = enqueue_dopamine_reschedule() 트리거와 동일(source_system='foot').
    -- id 미지정(DEFAULT gen_random_uuid()): event_id 가 uuid 아니라 id 컬럼으로 못 씀 = parent crm 선례 정합.
    INSERT INTO public.dopamine_callback_outbox
      (event_type, event_id, reservation_id, cue_card_id, payload)
    VALUES (
      'reschedule',
      v_event_id,
      v_rec.id,
      v_rec.external_id,
      jsonb_build_object(
        'source_system',      'foot',
        'event_type',         'reschedule',
        'event_id',           v_event_id,
        'cue_card_id',        v_rec.external_id,
        'crm_reservation_id', v_rec.id,
        'reservation_id',     v_rec.id,
        'changed_at',         v_iso,
        'new_date',           to_char(v_rec.reservation_date, 'YYYY-MM-DD'),
        'occurred_at',        v_iso,
        -- re-emit 출처 표식(수신부 로직 무영향 · 감사/추적용).
        'reemit_batch',       p_batch_tag
      )
    )
    ON CONFLICT (event_type, event_id) DO NOTHING;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;

    reservation_id := v_id;
    action   := CASE WHEN v_rowcount > 0 THEN 'emitted' ELSE 'noop_conflict' END;
    reason   := NULL;
    event_id := v_event_id; new_date := v_rec.reservation_date; cue_card_id := v_rec.external_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END $$;

COMMENT ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) IS
  'foot crm_ahead re-emit executable — 프리즈된 예약 id셋에 대해 foot canonical(reservation_date) 현재값으로 '
  'event_type=reschedule 콜백을 dopamine_callback_outbox 에 멱등 재발화(정본/미러 raw UPDATE 0 = NO-BULK 무위배). '
  'changed_at=now()>미러 crm_synced_at 단조가드 통과. payload shape = enqueue_dopamine_reschedule() 트리거 동일(source_system=foot). '
  'grain=crm_reservation_id(=풋 PK) 불일치 건은 수신부 no-apply(범위 밖). '
  'p_dry_run 기본 true. parent=T-20260722-crm-CANCELCALL-REEMIT-EXECUTABLE. T-20260722-foot-CANCELCALL-REEMIT-FOOT-SIDE (planner 5wfq / DA).';

-- 접근통제: default-deny 정합. anon/authenticated/PUBLIC 회수, 운영 발화자(DA)=service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reemit_reschedule_for_ids(UUID[], TEXT, BOOLEAN) TO service_role;

COMMIT;
