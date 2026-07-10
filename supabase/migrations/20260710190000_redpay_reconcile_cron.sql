-- redpay-reconcile 5분 폴러 (pg_cron → redpay-reconcile EF)
-- T-20260708-foot-REDPAY-CLOSING-TAB (activation_gate task#3)
--
-- ── 순서 ──────────────────────────────────────────────────────────
--   선행: 20260607190000_pay_recon_port.sql (redpay_poller_state / redpay_raw_transactions
--         / payment_reconciliation_log / payments.external_* 신설) apply 후 적용.
--         이 마이그는 EF 를 주기 호출하는 폴러 잡(function + cron)만 등록한다(테이블 무접촉).
--
-- ── 역할 ──────────────────────────────────────────────────────────
--   redpay-reconcile EF 를 net.http_post 로 5분마다 호출(mode=incremental) →
--   EF 가 redpay_poller_state.last_incremental_to 기반 슬라이딩 윈도로 RedPay 파트너 API
--   를 pull, redpay_raw_transactions upsert + 4-tier 매처로 payments 대조.
--   윈도 오버랩 2분 + 멱등키 (clinic_id, external_trxid) → 재실행/중복 무해.
--
--   ⚠ 활성화 트리거 = EF secrets 3종(REDPAY_BUSINESS_NO / REDPAY_TID_WHITELIST /
--     REDPAY_DRY_RUN=false). 이 잡이 돌아도 DRY_RUN=true 면 EF 는 픽스처 시뮬레이션만
--     수행하고 실 API 호출 안 함(G5 hard-lock). 실적재 = secrets 등록 후.
--
--   URL/시크릿 해석은 풋 컨벤션(app.supabase_url→vault supabase_project_url,
--   app.cron_secret→vault internal_cron_secret) — attendance-sync / dopamine outbox 와 동일.
--   EF 인증: X-Internal-Cron 헤더 = INTERNAL_CRON_SECRET (index.ts:121-123).
--
-- ── ADDITIVE ──────────────────────────────────────────────────────
--   신규 함수 1 + cron job 1. 기존 테이블/스키마/함수 무접촉. 파괴적 변경 0.
--   신규 컬럼·테이블·enum 0 → §S2.4 데이터 정책 게이트 대상 아님(DA GO_WARN 봉투 내 활성화).
-- Rollback: 20260710190000_redpay_reconcile_cron.rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.trigger_redpay_reconcile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ef_url      TEXT;
  v_cron_secret TEXT;
BEGIN
  -- EF base URL (풋 컨벤션)
  v_ef_url := COALESCE(
    current_setting('app.supabase_url', TRUE),
    public.get_vault_secret('supabase_project_url')
  );
  IF v_ef_url IS NULL OR v_ef_url = '' THEN
    RAISE LOG 'trigger_redpay_reconcile: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/redpay-reconcile';

  -- 내부 호출 시크릿 (풋 컨벤션) — EF INTERNAL_CRON_SECRET 와 동일 값이어야 인증 통과
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
    body    := jsonb_build_object('mode', 'incremental')  -- pg_net http_post: body 는 jsonb (TEXT 캐스트 시 signature 불일치 42883)
  );

  RETURN jsonb_build_object(
    'ok',     true,
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.trigger_redpay_reconcile() IS
  'T-20260708-foot-REDPAY-CLOSING-TAB: redpay-reconcile EF 호출 폴러(5분 주기). '
  'RedPay 파트너 API pull → redpay_raw_transactions upsert + 4-tier 대조. 멱등. '
  'DRY_RUN=false + secrets 3종 등록 시에만 실적재.';

-- pg_cron 등록 — 5분 주기(롱레 crm-notif-delivery-reconcile / redpay 폴러 패턴 동일). 멱등 가드.
DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-reconcile')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-reconcile');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'foot-redpay-reconcile',
  '*/5 * * * *',   -- 매 5분 (롱레 5분 폴러 패턴)
  $$ SELECT public.trigger_redpay_reconcile() $$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor)
-- ============================================================
-- [ ] 0. EF 배포     : supabase functions deploy redpay-reconcile --project-ref rxlomoozakkjesdqjtvd
-- [ ] 1. secrets     : REDPAY_BUSINESS_NO=511-60-00988 / REDPAY_TID_WHITELIST=<foot 13 TID CSV>
--                       / REDPAY_DRY_RUN=false (기존 REDPAY_API_KEY / INTERNAL_CRON_SECRET 유지)
-- [ ] 2. vault       : SELECT public.get_vault_secret('supabase_project_url') , get_vault_secret('internal_cron_secret')  → non-null
--                       (INTERNAL_CRON_SECRET(EF env) == vault internal_cron_secret 값 일치 필수)
-- [ ] 3. clinic 행   : SELECT id,business_no FROM clinics WHERE business_no='511-60-00988';  -- 1행(EF clinic_id 조회 근거)
-- [ ] 4. 함수 생성   : SELECT proname FROM pg_proc WHERE proname='trigger_redpay_reconcile';
-- [ ] 5. cron 등록   : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-redpay-reconcile';  -- */5 active
-- [ ] 6. 수동 1틱    : SELECT public.trigger_redpay_reconcile();  → EF 200 (DRY_RUN=false 시 실 pull)
-- [ ] 7. 적재 검증   : SELECT count(*) FROM redpay_raw_transactions;  -- >0 (이광현 팀장 테스트 결제)
-- [ ] 8. 폴러 상태   : SELECT last_incremental_to FROM redpay_poller_state WHERE id=1;  -- now 근처 갱신
-- [ ] 9. TID 정합    : SELECT DISTINCT tid FROM redpay_raw_transactions;  -- foot 13 TID 만(롱레 8 TID 0건 혼입)
-- [ ] 10. freshness  : SELECT public.get_redpay_feed_freshness();  -- null/0 탈출
-- ============================================================
