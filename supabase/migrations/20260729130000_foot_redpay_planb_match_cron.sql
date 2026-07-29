-- redpay-planb-match 1분 매칭/만료 워커 (pg_cron → redpay-planb-match EF)
-- T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어 · 만료/매칭 cron)
--
-- ── 순서 ──────────────────────────────────────────────────────────
--   선행: 20260723180000_..._pending_payment.sql(선점표) + 20260727100000_..._ttl.sql(TTL 컬럼)
--         + 20260729120000_..._expires_default_5min.sql(DEFAULT 정렬) apply 후 적용.
--         이 마이그는 EF 를 주기 호출하는 워커 잡(function + cron)만 등록한다(테이블 무접촉).
--
-- ── 역할 ──────────────────────────────────────────────────────────
--   redpay-planb-match EF 를 net.http_post 로 1분마다 호출 →
--   EF 가 ① now()>=expires_at open 선점 → expired(TTL 만료, 수기 폴백)
--          ② 유효창 open 선점을 웹훅 raw(received_at·승인)와 예상금액 매칭 → matched.
--   멱등: EF 내부 WHERE status='open' 재확인 가드 + 1 raw:1 선점 소비 추적 → 재실행 무해.
--   비대기형 결제 완료 뱃지가 최대 ~1분(TTL 5분 내) 자동 표시되는 근거 워커.
--
-- ── 인증 (redpay-reconcile cron 컨벤션 동형) ────────────────────────
--   URL 해석: app.supabase_url → vault supabase_project_url.
--   시크릿:   app.cron_secret  → vault internal_cron_secret. EF INTERNAL_CRON_SECRET 와 동일 값이어야 통과.
--   EF 인증 헤더: X-Internal-Cron (redpay-planb-match/index.ts).
--
-- ── ADDITIVE ──────────────────────────────────────────────────────
--   신규 함수 1 + cron job 1. 기존 테이블/스키마/함수/RLS/트리거 무접촉. 파괴적 변경 0.
--   신규 컬럼·테이블·enum 0 → §S2.4 데이터 정책 게이트 대상 아님(reconcile_cron 선례 동일). supervisor DDL-diff 만.
--   멱등: CREATE OR REPLACE FUNCTION + cron.unschedule(존재 시) → schedule. 재실행 무해.
-- Rollback: 20260729130000_foot_redpay_planb_match_cron.rollback.sql
-- Dry-run(무영속): 20260729130000_foot_redpay_planb_match_cron.dryrun.mjs

BEGIN;

CREATE OR REPLACE FUNCTION public.trigger_redpay_planb_match()
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
    RAISE LOG 'trigger_redpay_planb_match: supabase url 미설정 — skip';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_url');
  END IF;
  v_ef_url := v_ef_url || '/functions/v1/redpay-planb-match';

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
    body    := jsonb_build_object('mode', 'match_expire')  -- pg_net: body 는 jsonb
  );

  RETURN jsonb_build_object(
    'ok',     true,
    'run_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

COMMENT ON FUNCTION public.trigger_redpay_planb_match() IS
  'T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD: redpay-planb-match EF 호출 워커(1분 주기). '
  'pending_payment open 선점의 ① TTL 만료(expired) ② 웹훅 raw 예상금액 매칭(matched) 처리. '
  'payments 무접촉(선점=예정, §550 Model A). 멱등.';

-- pg_cron 등록 — 1분 주기(TTL 5분 내 완료뱃지 자동표시). 멱등 가드.
DO $$
BEGIN
  PERFORM cron.unschedule('foot-redpay-planb-match')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-redpay-planb-match');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'foot-redpay-planb-match',
  '* * * * *',   -- 매 1분
  $$ SELECT public.trigger_redpay_planb_match() $$
);

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor)
-- ============================================================
-- [ ] 0. EF 배포   : supabase functions deploy redpay-planb-match --project-ref rxlomoozakkjesdqjtvd
-- [ ] 1. secrets   : INTERNAL_CRON_SECRET (기존, reconcile 과 공유) — EF env == vault internal_cron_secret
-- [ ] 2. vault     : SELECT public.get_vault_secret('supabase_project_url'), get_vault_secret('internal_cron_secret'); → non-null
-- [ ] 3. 함수 생성 : SELECT proname FROM pg_proc WHERE proname='trigger_redpay_planb_match';
-- [ ] 4. cron 등록 : SELECT jobname,schedule,active FROM cron.job WHERE jobname='foot-redpay-planb-match';  -- * * * * * active
-- [ ] 5. 수동 1틱  : SELECT public.trigger_redpay_planb_match();  → EF 200 {ok:true, expired, matched}
-- ============================================================
