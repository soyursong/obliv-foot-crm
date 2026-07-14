-- T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT (step2, emit lane 3)
-- 풋 CRM → 도파민 라이프사이클 emit 확장: reschedule(예약일 변경) 이벤트 outbox 적재.
--
-- 근거 계약(SSOT):
--   memory/1_Projects/201_메디빌더_AI도입/da_replies/DA-20260714-FOOT-LIFECYCLE-CANCEL-RESCHEDULE-CANON.md
--   cross_crm_data_contract.md §6-6-8(reschedule canonical) / §6-6-1(payload) / §6-6-5(event_id)
--
-- ⚠ zero-DDL 정합 노트 (planner/supervisor 대상):
--   DA CONSULT-REPLY(GO/zero-DDL)의 "신규 DDL 0"은 **도파민 recv 측**(callback_audit_log/cue_cards)
--   기준이다. 풋 **발신부 outbox**의 event_type CHECK 에는 'reschedule'가 未등재
--   (기존 = visited|no_show|cancelled|rejected). 따라서 emit lane 3 에서 reschedule 발신은
--   **1건의 ADDITIVE CHECK 확장 + 1개 신규 트리거**가 불가피 = supervisor DDL-diff는 no-op 아님.
--   본 변경은 순수 ADDITIVE(기존 값·행·경로 무손상, 신규 값 추가만)이며 DA CONSULT(lane 3) 스코프 내.
--   → planner FOLLOWUP 로 discrepancy 통지함(deploy-order 게이트/DDL-diff 기대치 정정).
--
-- 착수 canon (dev-dopamine 확정):
--   - 단일 타깃 emit: crm-lifecycle-callback 로만. crm-cancel-callback fan-out 금지.
--     (reschedule 은 기존 dispatch EF 가 payload 를 그대로 forward → EF 변경 불요, 데이터 주도.)
--   - reschedule payload: source_system=foot / event_type=reschedule / event_id(=outbox row PK) /
--     cue_card_id(1급, 필수) / crm_reservation_id(grain, 필수=풋 reservation PK) /
--     old_date / new_date / changed_at.
--   - event_id 멱등키 = **풋 outbox 이벤트 row 의 안정 PK**(재시도 간 고정, 재생성 금지).
--     논리 reschedule 1건 = outbox row 1건 = event_id 1개. (reservation.id 를 event_id 로 쓰면
--     동일 예약 재-reschedule 시 오-dedup → 반드시 row PK 로 발급.)
--   - verify-precondition(DA Q2): reschedule 대상 풋예약의 도파민 cue_cards.crm_reservation_id 가
--     풋 PK 로 채워졌는지 = **도파민 측 상태** → step3 soak/일일감사(아키텍트)에서 대조.
--     발신부는 crm_reservation_id = 풋 reservation PK 를 payload 로 실어 보낼 뿐.
--   - foot-direct/walk-in(cue_card 부재, external_id NULL) = emit skip (기존 dopamine-연동 게이트 재사용).
--
-- 배포 시퀀스 게이트(planner 조율): 실 live emit 배포는 step1(도파민 recv canon, a503a95)
--   EF 가 supervisor QA통과+배포된 뒤. recv 미배포 중 emit → 도파민 4xx → outbox DLQ 적체.
--   ∴ 본 마이그 배포 = step1 배포 확인(planner 통지) 이후. shadow/live 는 dopamine_callback_config.mode.
--
-- 롤백: 20260715140000_foot_dopamine_reschedule_emit.rollback.sql
-- 작성: dev-foot / 2026-07-15 / ticket T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 1) event_type CHECK 확장 (ADDITIVE) — 'reschedule' 등재
--    기존 값(visited/no_show/cancelled/rejected) 전부 보존 + reschedule 추가.
--    기존 행은 신규 값을 쓰지 않으므로 검증 위반 0 (무손상).
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;

ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected','reschedule'));

-- ══════════════════════════════════════════════════════════════════
-- 2) reschedule enqueue 함수 (신규) — 예약일(reservation_date) 변경 → outbox 적재
--    ※ 기존 enqueue_dopamine_callback()(visited/no_show/cancelled)은 무접촉.
--       reschedule 은 status 가 아닌 date 축 변경이라 별도 트리거로 분리(관심사 격리).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enqueue_dopamine_reschedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT;
BEGIN
  -- 예약일이 실제로 바뀐 경우만 (동일 date 재기록/시간만 변경 = no-op, dopamine 무영향)
  IF NEW.reservation_date IS NOT DISTINCT FROM OLD.reservation_date THEN
    RETURN NEW;
  END IF;

  -- 취소/노쇼 예약의 날짜 변경은 reschedule 아님 → skip (cancel 경로가 별도 처리)
  IF NEW.status IN ('cancelled','no_show') THEN
    RETURN NEW;
  END IF;

  -- 도파민 연동(source_system=dopamine + external_id) 건만 발사.
  -- foot-direct/walk-in(external_id NULL) = cue_card 부재 → emit skip (계약 정합).
  IF NEW.source_system IS DISTINCT FROM 'dopamine'
     OR NEW.external_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- event_id = outbox row 의 안정 PK (논리 이벤트 1건당 1 event_id, 재시도 간 고정).
  v_id := gen_random_uuid()::TEXT;

  INSERT INTO public.dopamine_callback_outbox
    (id, event_type, event_id, reservation_id, cue_card_id, payload)
  VALUES (
    v_id::UUID,
    'reschedule',
    v_id,
    NEW.id,
    NEW.external_id,
    jsonb_build_object(
      'source_system',      'foot',
      'event_type',         'reschedule',
      'event_id',           v_id,
      'cue_card_id',        NEW.external_id,
      -- grain(필수): 수신 CRM 예약 식별자 = 풋 reservation PK. 도파민 grain 가드가 이 값으로 매칭.
      'crm_reservation_id', NEW.id,
      'reservation_id',     NEW.id,
      'old_date',           to_char(OLD.reservation_date, 'YYYY-MM-DD'),
      'new_date',           to_char(NEW.reservation_date, 'YYYY-MM-DD'),
      -- changed_at = reschedule 발생시각(단조 가드). occurred_at alias 수용(계약 §6-6-8).
      'changed_at',         to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'occurred_at',        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
  ON CONFLICT (event_type, event_id) DO NOTHING;  -- row PK 라 사실상 무충돌, 방어적 유지

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_dopamine_reschedule() IS
  'T-LIFECYCLE-OUTBOX-EMIT: 예약일(reservation_date) 변경 → reschedule outbox 적재. '
  '도파민 연동 건만(external_id). event_id=outbox row PK(재시도 고정). '
  'payload: crm_reservation_id(=풋 PK)/old_date/new_date/changed_at. 동기 발송 X(worker 소유).';

DROP TRIGGER IF EXISTS trg_dopamine_cb_resv_reschedule ON public.reservations;
CREATE TRIGGER trg_dopamine_cb_resv_reschedule
  AFTER UPDATE OF reservation_date ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_dopamine_reschedule();

COMMIT;
