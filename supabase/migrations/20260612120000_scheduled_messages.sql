-- ============================================================
-- T-20260612-foot-SMS-SCHEDULE-SEND-OPTION: 문자 예약 발송 (즉시/예약 옵션)
-- 김주연 총괄 (#project-doai-crm-풋확장, 채널 C0ATE5P6JTH)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260612120000_scheduled_messages.rollback.sql
-- 작성: dev-foot / 2026-06-12
-- ⚠ supervisor 게이트: 이 마이그레이션은 dev-foot 가 prod 직접 적용하지 않는다.
--   supervisor 가 db-gate 검토(GO_WARN) 후 적용 → 그 다음 FE 배포. (배포-마이그 순서)
-- ============================================================
-- 설계 근거: db-gate/T-20260612-foot-SMS-SCHEDULE-SEND-OPTION_design1pager.md
--   2안 비교 결과 = 신규 테이블(scheduled_messages) 채택.
--   사유: notification_logs(append-only 감사로그) 에 미래-의도 행을 섞으면
--         재시도 윈도우(48h)·발송이력 필터·status 머신이 오염되어 회귀 위험.
--         (§13.1.A: 기존 notifications 동선 코드 겹침 경고와도 정합 — 분리가 안전)
-- 핵심: "지정 시각 발송 누락 금지" → claim/processing 상태 + stuck-reaper 로 무손실 보장.
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: scheduled_messages 테이블 (예약 발송 큐)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID        NOT NULL REFERENCES public.clinics(id)   ON DELETE CASCADE,
  customer_id         UUID        REFERENCES public.customers(id)          ON DELETE SET NULL,
  recipient_phone     TEXT        NOT NULL,
  body                TEXT        NOT NULL,
  image_path          TEXT,                       -- MMS 첨부(있으면 MMS), 없으면 SMS/LMS
  channel             TEXT        NOT NULL DEFAULT 'sms',  -- 참고용(EF 가 발송 시 재판정)
  scheduled_at        TIMESTAMPTZ NOT NULL,       -- 발송 예정 시각(UTC 저장, FE 가 KST→UTC 변환)
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  source              TEXT        NOT NULL DEFAULT 'manual_scheduled',  -- manual_scheduled | settings_scheduled
  created_by          UUID,                       -- auth.uid() (등록한 직원)
  claimed_at          TIMESTAMPTZ,                -- dispatcher 가 processing 으로 점유한 시각(reaper 기준)
  attempts            SMALLINT    NOT NULL DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  notification_log_id UUID,                       -- 발송 후 notification_logs 연결
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- due-scan 전용 부분 인덱스(가장 빈번한 dispatcher 쿼리): pending 중 예정시각 도래분
CREATE INDEX IF NOT EXISTS idx_sched_msg_due
  ON public.scheduled_messages(scheduled_at)
  WHERE status = 'pending';
-- stuck-reaper 전용: processing 중 오래 점유된 행
CREATE INDEX IF NOT EXISTS idx_sched_msg_processing
  ON public.scheduled_messages(claimed_at)
  WHERE status = 'processing';
-- 지점별 목록/조회
CREATE INDEX IF NOT EXISTS idx_sched_msg_clinic_status
  ON public.scheduled_messages(clinic_id, status, scheduled_at);

DROP TRIGGER IF EXISTS trg_sched_msg_updated_at ON public.scheduled_messages;
CREATE TRIGGER trg_sched_msg_updated_at
  BEFORE UPDATE ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime_updated_at();

COMMENT ON TABLE  public.scheduled_messages IS
  'T-20260612-foot-SMS-SCHEDULE-SEND-OPTION: 예약(지정시각) 문자 발송 큐. pending→processing→sent/failed, cancelled.';
COMMENT ON COLUMN public.scheduled_messages.scheduled_at IS
  '발송 예정 시각(UTC). FE 가 현장 KST 입력을 +09:00 으로 UTC 변환해 저장.';
COMMENT ON COLUMN public.scheduled_messages.status IS
  'pending=대기 | processing=발송중(점유) | sent=발송완료 | failed=실패 | cancelled=취소';
COMMENT ON COLUMN public.scheduled_messages.claimed_at IS
  'dispatcher 가 processing 으로 점유한 시각. reaper 가 정체 행(>10분) 을 pending 으로 회수하는 기준(무손실 보장).';

-- ============================================================
-- SECTION 2: RLS
-- ============================================================
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: 같은 지점 전직원(예약 목록·취소 조회)
DROP POLICY IF EXISTS sched_msg_select ON public.scheduled_messages;
CREATE POLICY sched_msg_select ON public.scheduled_messages
  FOR SELECT TO authenticated
  USING (clinic_id = public.get_user_clinic_id());

-- INSERT: 같은 지점 전직원(8역할), 본인 명의(created_by=auth.uid())
DROP POLICY IF EXISTS sched_msg_insert ON public.scheduled_messages;
CREATE POLICY sched_msg_insert ON public.scheduled_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN
      ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff')
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- UPDATE: 같은 지점 전직원(예약 취소 — status='cancelled' 전이). 발송 처리(processing/sent)는
--         dispatcher/EF 가 service_role 로 수행(RLS 우회) → 사용자 UPDATE 는 취소 용도.
DROP POLICY IF EXISTS sched_msg_update ON public.scheduled_messages;
CREATE POLICY sched_msg_update ON public.scheduled_messages
  FOR UPDATE TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN
      ('admin','manager','director','consultant','coordinator','therapist','part_lead','staff')
  )
  WITH CHECK (clinic_id = public.get_user_clinic_id());

-- DELETE 불허(이력 보존) — 취소는 status='cancelled' soft.

-- ============================================================
-- SECTION 3: dispatch_scheduled_messages() — 예약 발송 디스패처(+ stuck-reaper)
-- ============================================================
-- 1분 주기 pg_cron 호출. 무손실 보장 설계:
--   (a) reaper: status='processing' 인데 claimed_at < now()-10min 인 행은 EF 호출 유실로 간주
--               → attempts<5 면 pending 회수, attempts>=5 면 failed 확정(영구 정체 방지).
--   (b) claim: status='pending' AND scheduled_at<=now() 인 행을 FOR UPDATE SKIP LOCKED 로 점유,
--               status='processing', claimed_at=now(), attempts+1 로 전이(중복발송 차단).
--   (c) dispatch: 각 점유 행을 send-notification EF(_action='scheduled_send') 로 비동기 POST.
--               EF 가 발송 결과를 scheduled_messages 에 sent/failed 로 기록.
CREATE OR REPLACE FUNCTION public.dispatch_scheduled_messages(
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_row         RECORD;
  v_ef_url      TEXT;
  v_cron_secret TEXT;
  v_anon_jwt    TEXT;
  v_requeued    INT := 0;
  v_failed_perm INT := 0;
  v_dispatched  INT := 0;
  v_claimed     INT := 0;
BEGIN
  -- (a) stuck-reaper: 점유 후 10분 넘게 결과 미기록 → 유실 간주
  WITH reclaimed AS (
    UPDATE public.scheduled_messages
       SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
           claimed_at = NULL,
           error_message = CASE WHEN attempts >= 5
             THEN 'dispatch 5회 초과 — 발송 실패 확정(점검 필요)'
             ELSE error_message END,
           updated_at = now()
     WHERE status = 'processing'
       AND claimed_at < now() - INTERVAL '10 minutes'
    RETURNING attempts
  )
  SELECT
    COUNT(*) FILTER (WHERE attempts < 5),
    COUNT(*) FILTER (WHERE attempts >= 5)
    INTO v_requeued, v_failed_perm
  FROM reclaimed;

  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  ) || '/functions/v1/send-notification';
  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret')
  );
  v_anon_jwt := public.get_vault_secret('supabase_anon_key');

  -- (b) claim due rows (SKIP LOCKED → 동시 실행 안전, 중복 점유 차단)
  FOR v_row IN
    UPDATE public.scheduled_messages sm
       SET status = 'processing',
           claimed_at = now(),
           attempts = attempts + 1,
           updated_at = now()
     WHERE sm.id IN (
       SELECT id FROM public.scheduled_messages
        WHERE status = 'pending'
          AND scheduled_at <= now()
        ORDER BY scheduled_at
        LIMIT 100
        FOR UPDATE SKIP LOCKED
     )
    RETURNING sm.id, sm.clinic_id
  LOOP
    v_claimed := v_claimed + 1;
    IF p_dry_run THEN CONTINUE; END IF;

    -- (c) dispatch → send-notification EF
    PERFORM net.http_post(
      url     := v_ef_url,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'Authorization',   'Bearer ' || v_anon_jwt,
        'X-Internal-Cron', v_cron_secret
      ),
      body    := jsonb_build_object(
        '_action',               'scheduled_send',
        'scheduled_message_id',  v_row.id,
        'clinic_id',             v_row.clinic_id
      )
    );
    v_dispatched := v_dispatched + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run',          p_dry_run,
    'reaper_requeued',  v_requeued,
    'reaper_failed',    v_failed_perm,
    'claimed',          v_claimed,
    'dispatched',       v_dispatched,
    'run_at',           to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.dispatch_scheduled_messages(BOOLEAN) IS
  'T-20260612-foot-SMS-SCHEDULE-SEND-OPTION: 예약 발송 디스패처 — reaper(정체 회수) + claim(SKIP LOCKED) + EF POST. 무손실 보장.';

-- ============================================================
-- SECTION 4: pg_cron 등록 — 1분 주기 디스패치
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('foot-scheduled-msg-dispatch');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'foot-scheduled-msg-dispatch',
  '* * * * *',   -- 매 1분 (지정 시각 ±1분 내 발송 — 누락 금지)
  $$SELECT public.dispatch_scheduled_messages(FALSE)$$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor)
-- ============================================================
-- [ ] 1. 테이블 생성   : SELECT COUNT(*) FROM public.scheduled_messages;  -- 0
-- [ ] 2. RLS 활성      : SELECT relrowsecurity FROM pg_class WHERE relname='scheduled_messages';  -- t
-- [ ] 3. cron 등록     : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-scheduled-msg-dispatch';  -- '* * * * *', active=t
-- [ ] 4. dry-run       : SELECT public.dispatch_scheduled_messages(TRUE);  -- {claimed:0,...} 에러 없음
-- [ ] 5. EF 배포 동기  : send-notification EF 에 _action='scheduled_send' 핸들러 배포 확인
-- ============================================================
