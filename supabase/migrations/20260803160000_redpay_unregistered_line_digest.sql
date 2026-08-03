-- ══════════════════════════════════════════════════════════════════
-- T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST
--   레드페이 미등록 회선(merchant_id/tid) 등록 알람 스팸 억제 — 실시간/반복 → 하루 1회 digest.
-- ══════════════════════════════════════════════════════════════════
-- 배경(티켓 §현장요지): redpay-webhook 미등록 merchant 경로가 push 당 즉시 Slack 발송(쿨다운 0) →
--   레드페이 재시도(1/5/30분)마다 동일내용 반복(15:52~16:32 5회). 등록담당 즉시처리 불가 시
--   하루 수십회 쌓여 타 알람이 묻힘. 거래는 폴러 백스톱으로 재수집되므로 실시간 반복 불필요.
--
--   ★ 발원지 특정(dev-foot 진단): redpay-reconcile 폴러는 filterToFootScope 로 미등록 merchant 를
--     upsert 前 drop(raw 미적재) → v_redpay_unclassified_merchants 뷰는 미등록 회선을 담지 못함
--     (무DDL 재집계 불가). 유일하게 미등록 회선을 관측하는 곳 = webhook unknown 경로.
--     AC5(알림 유실 0) 보장하려면 webhook 관측시점에 상태를 영속해야 함 → 본 ADDITIVE 테이블.
--
-- ── ADDITIVE 계약 (data-architect CONSULT 게이트 대상) ─────────────────────────────
--   신규: TABLE redpay_unregistered_line_seen (dedup 상태: 첫감지·누적건·last_seen·resolved)
--        + FUNC redpay_note_unregistered_line() (webhook accumulate, 멱등 증분)
--        + FUNC trigger_redpay_unreg_digest() (cron → redpay-unreg-digest EF)
--        + cron job 'foot-redpay-unreg-digest' (0 0 * * * UTC = 09:00 KST 하루 1회).
--   무접촉: payments / redpay_raw_transactions / payment_reconciliation_log / redpay_poller_state /
--          redpay_terminal_registry / 기존 뷰·함수·트리거·RLS·원장. 파괴적 변경 0.
--   신규 컬럼·테이블·enum 추가 O(신규 테이블 1) → §S2.4 데이터 정책 게이트 = data-architect CONSULT 선행.
--     파괴 변경 아님 → 대표 게이트 불요(autonomy §3.1). CONSULT GO 후 prod apply + deploy-ready.
--   Rollback: 20260803160000_redpay_unregistered_line_digest.rollback.sql
--     (cron unschedule + DROP FUNC 2 + DROP TABLE. 데이터손실 0 — 운영 알람 상태만 소실).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ============================================================
-- 1. TABLE redpay_unregistered_line_seen — 미등록 회선 dedup 상태 SSOT (ADDITIVE 신설)
--    grain = 미등록 (merchant_id, tid) 조합 1개 = 1행. dedup_key 로 멱등 증분.
--    resolved_at = 미등록→등록 전이 시각(digest 재확인 때 stamp) → 이후 digest 자동 제외.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.redpay_unregistered_line_seen (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid,                                  -- 테넌트 스코프(RLS 앵커). 미등록 회선은 clinic 미상일 수 있음(nullable).
  merchant_id    text,                                  -- 가맹점(미상 시 NULL → dedup_key 에서 '∅' 정규화)
  merchant_name  text,                                  -- 최근 관측 가맹점명(사람용 표시 보조)
  tid            text,                                  -- 회선(단말 TID). merchant 부재 시 회선만 있을 수 있음.
  dedup_key      text        NOT NULL,                  -- 정규화 키 = coalesce(merchant_id,'∅') || '::' || coalesce(tid,'∅')
  first_seen_at  timestamptz NOT NULL DEFAULT now(),    -- 최초 감지(= digest '첫 감지 M/D' 원천)
  last_seen_at   timestamptz NOT NULL DEFAULT now(),    -- 최근 감지
  hit_count      integer     NOT NULL DEFAULT 0,        -- 누적 감지 건수(= digest '누적 N건')
  resolved_at    timestamptz,                           -- 등록 전이 시각(NULL=아직 미등록 → digest 대상)
  last_digest_at timestamptz,                           -- 마지막 digest 포함 시각(관측용)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redpay_unregistered_line_seen_dedup_uk UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_redpay_unreg_line_unresolved
  ON public.redpay_unregistered_line_seen (resolved_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.redpay_unregistered_line_seen IS
  'T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST: 레드페이 미등록 회선(merchant/tid) dedup 상태 SSOT. '
  'redpay-webhook unknown 경로가 push 당 accumulate(realtime Slack 억제) → redpay-unreg-digest 가 하루 1회 요약. '
  'resolved_at 세팅 = 등록 전이(digest 재확인 시 registry 대조) → 이후 digest 자동 제외. 비-PII 운영 상태.';

-- RLS: 미등록 회선 = 비민감 운영 알람 상태. authenticated read-all. write=service_role(RPC/EF) 전용.
ALTER TABLE public.redpay_unregistered_line_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS redpay_unregistered_line_seen_read_all ON public.redpay_unregistered_line_seen;
CREATE POLICY redpay_unregistered_line_seen_read_all
  ON public.redpay_unregistered_line_seen FOR SELECT USING (true);
GRANT SELECT ON public.redpay_unregistered_line_seen TO authenticated;

-- ============================================================
-- 2. FUNC redpay_note_unregistered_line — webhook accumulate (멱등 증분, INSERT..ON CONFLICT)
--    최초 = hit_count 1 / first_seen_at now. 재감지 = hit_count+1 / last_seen_at now / resolved_at 재개(NULL).
--    (한번 등록됐다 다시 미등록 신호가 오면 재-open — 실제 재발을 놓치지 않음.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.redpay_note_unregistered_line(
  p_merchant_id   text,
  p_merchant_name text,
  p_tid           text,
  p_clinic_id     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.redpay_unregistered_line_seen
    (clinic_id, merchant_id, merchant_name, tid, dedup_key, hit_count, first_seen_at, last_seen_at)
  VALUES (
    p_clinic_id,
    NULLIF(btrim(p_merchant_id), ''),
    NULLIF(btrim(p_merchant_name), ''),
    NULLIF(btrim(p_tid), ''),
    COALESCE(NULLIF(btrim(p_merchant_id), ''), '∅') || '::' || COALESCE(NULLIF(btrim(p_tid), ''), '∅'),
    1, now(), now()
  )
  ON CONFLICT (dedup_key) DO UPDATE SET
    hit_count     = public.redpay_unregistered_line_seen.hit_count + 1,
    last_seen_at  = now(),
    updated_at    = now(),
    merchant_name = COALESCE(EXCLUDED.merchant_name, public.redpay_unregistered_line_seen.merchant_name),
    clinic_id     = COALESCE(public.redpay_unregistered_line_seen.clinic_id, EXCLUDED.clinic_id),
    resolved_at   = NULL;   -- 재감지 = 다시 미등록 상태 → 재-open(digest 재포함).
$$;

COMMENT ON FUNCTION public.redpay_note_unregistered_line(text, text, text, uuid) IS
  'T-20260803: redpay-webhook unknown 경로 accumulate. 멱등 증분(dedup_key). realtime Slack 대체(스팸 억제). '
  'SECURITY DEFINER(service_role EF 호출). 재감지 시 hit_count+1 + resolved_at 재-open.';

GRANT EXECUTE ON FUNCTION public.redpay_note_unregistered_line(text, text, text, uuid) TO service_role;

-- ============================================================
-- 3. FUNC trigger_redpay_unreg_digest — cron → redpay-unreg-digest EF (풋 net.http_post 컨벤션)
--    redpay-reconcile 폴러 트리거와 동일 URL/시크릿 해석 규약.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trigger_redpay_unreg_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
BEGIN
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'trigger_redpay_unreg_digest: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/redpay-unreg-digest';

  v_cron_secret := COALESCE(
    current_setting('app.cron_secret', TRUE),
    public.get_vault_secret('internal_cron_secret'),
    ''
  );

  PERFORM net.http_post(
    url     := v_ef_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'X-Internal-Cron', v_cron_secret
    ),
    body    := jsonb_build_object('mode', 'daily_digest')
  );

  RETURN jsonb_build_object('ok', true, 'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ'));
END;
$$;

COMMENT ON FUNCTION public.trigger_redpay_unreg_digest() IS
  'T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST: redpay-unreg-digest EF 호출(하루 1회). '
  '미등록 회선 요약 Slack 1건. EF 가 registry 재확인 → 등록 전이 resolved 처리 + 미등록만 발송.';

-- ============================================================
-- 4. pg_cron — 하루 1회 09:00 KST (= 00:00 UTC). 멱등 가드.
--    ※ 발송 시각 기본 09:00 KST(업무시작) — 현장 확정 시 schedule 만 교체(코드 무영향, 롤백레일).
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-unreg-digest')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-unreg-digest');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'foot-redpay-unreg-digest',
  '0 0 * * *',   -- 00:00 UTC = 09:00 Asia/Seoul (하루 1회, 업무시작). 현장 확정 시 교체.
  $$ SELECT public.trigger_redpay_unreg_digest() $$
);

COMMIT;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260803160000', 'redpay_unregistered_line_digest')
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor — CONSULT GO 후)
-- ============================================================
-- [ ] 0. DA CONSULT GO 확인(ADDITIVE 테이블) → db_change=true 전환 근거.
-- [ ] 1. EF 배포     : supabase functions deploy redpay-unreg-digest --project-ref rxlomoozakkjesdqjtvd
-- [ ] 2. 테이블 생성 : SELECT to_regclass('public.redpay_unregistered_line_seen');  -- non-null
-- [ ] 3. 함수 생성   : SELECT proname FROM pg_proc WHERE proname IN ('redpay_note_unregistered_line','trigger_redpay_unreg_digest');  -- 2행
-- [ ] 4. cron 등록   : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-redpay-unreg-digest';  -- 0 0 * * * active
-- [ ] 5. env 세팅    : redpay-webhook REDPAY_UNREG_ALARM_MODE=digest (기본) / rollback=realtime
-- [ ] 6. 수동 1틱    : SELECT public.trigger_redpay_unreg_digest();  → EF 200 (미등록 0건이면 no-send)
-- [ ] 7. 발송주기    : 현장 확정 시각으로 cron.schedule 교체(기본 09:00 KST=0 0 * * *).
-- ============================================================
