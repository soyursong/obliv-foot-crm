-- T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS  (Option A — director 권한 1주 임시부여)
-- 대표원장(문지은) 컨펌 완료 / planner NEW-TASK MSG-20260724-185940-dpo3 / P1
--
-- ════════════════════════════════════════════════════════════════════════
-- 목적: 김주연 총괄 계정(user_profiles.id = ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12,
--       juyeon@medibuilder.com)에 소견서·진단서 서식 점검용 director 권한을
--       2026-07-25 00:00 KST ~ 2026-08-01 00:00 KST (1주) 한시 부여하고,
--       8/1 도래 시 자동으로 원래 role 로 원복한다. 계정 1행만 조작.
--
-- ★ 상태 실측(2026-07-24, prod rxlomoozakkjesdqjtvd) — 티켓 가정과 divergence ★
--   티켓 가정: 원래 role = "manager + has_ops_authority"
--   실측 정본: 원래 role = 'admin'  (has_ops_authority 컬럼은 prod 에 부재)
--   ⇒ 자동원복 대상(원래 role) = 'admin'.  manager 로 되돌리면 admin 권한 강등 사고.
--   ⇒ 본 마이그의 v_orig_role='admin' 은 실측 백업(evidence/..._backup.json)과 일치.
--
-- 권한 게이트 근거(코드 무변경으로 충족):
--   - FE: OpinionDocTab.canPublish = role∈{director,doctor}  (admin/manager dead-button)
--   - DB: publish_opinion_doc → is_doctor_role() = current_user_role()∈{director,doctor}
--         current_user_role() = user_profiles.role WHERE id=auth.uid()
--   ∴ user_profiles.role 를 'director' 로 바꾸면 FE+DB 양쪽 게이트가 인정. 서식/템플릿 코드 무변경.
--
-- 가드(대표원장 조건):
--   #1 서류 틀 무변경 — 본 마이그는 role UPDATE + 스케줄 함수/잡만. form_templates/htmlFormTemplates 무접촉.
--   #2 8/1 자동원복(핵심) — pg_cron lifecycle 잡이 8/1 도래 시 director→admin 원복 + 자기해지.
--   #3 원래 role 백업 + 원복 SQL — evidence 백업 + .rollback.sql (조기 원복 즉시 가능).
--   #4 실 환자 서류 작성 금지 — 코드 강제 불가(목적=서식 점검). 완료 안내에 명시(responder).
--
-- ADDITIVE / db_change=true:
--   신규 함수 1(foot_juyeon_tempgrant_tick) + cron job 1 + 계정 1행 role UPDATE(date-gated).
--   신규 컬럼·테이블·enum = 0  → §S2.4 데이터 정책 게이트 대상 아님
--   (redpay_reconcile_cron 20260710190000 선례: function+cron, no col/table/enum = DA GO 봉투 내).
--   supervisor DDL-diff 게이트 대상(함수/잡 = DDL 오브젝트).
--
-- 발효 방식(date-gated, 즉시부여 아님):
--   본 마이그 apply 시점엔 role='admin' 유지(assert). 부여/원복은 lifecycle 잡이 시각 도래 시 수행.
--   ⇒ 7/25 발효 정확 honoring + 조기 노출 최소화(guard #4). */15 분 폴 → 경계 15분 내 반영.
--
-- 상시 ROLE-MATRIX 정본(App.tsx/permissions.ts/CHECK 제약) 무접촉 — 이 계정 데이터 1행만.
-- Rollback: 20260724210000_foot_juyeon_director_1wk_tempgrant.rollback.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. 사전 가드(fail-closed): 대상 계정이 원래 role='admin' 인지 실측 확인 ──────────
--    divergence(이미 director 이거나 계정 부재) 시 abort → 백업/상태 재확인 유도.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12'
       AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ABORT: 김주연(ee67fc6b) 원래 role=admin 아님 — 상태 divergence. 백업(evidence)·원복 대상 재확인 후 재적용.';
  END IF;
END
$guard$;

-- ── 1. lifecycle tick 함수 ────────────────────────────────────────────────
--    p_now 파라미터(default now()) — cron 은 인자 없이 호출(now()), dry-run/QA 는
--    경계시각을 명시 주입해 grant/revert 분기를 무영속으로 검증(트랜잭션 롤백).
CREATE OR REPLACE FUNCTION public.foot_juyeon_tempgrant_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $fn$
DECLARE
  v_id        uuid        := 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';  -- 김주연(juyeon@medibuilder.com)
  v_grant_at  timestamptz := '2026-07-24 15:00:00+00';   -- 2026-07-25 00:00 KST 발효
  v_revert_at timestamptz := '2026-07-31 15:00:00+00';   -- 2026-08-01 00:00 KST 자동원복
  v_orig_role text        := 'admin';      -- 원복 대상(부여 전 원래 role) — evidence 백업과 일치
  v_temp_role text        := 'director';   -- 임시부여 role
  v_changed   int         := 0;
  v_action    text        := 'noop';
BEGIN
  IF p_now >= v_revert_at THEN
    -- 8/1 도래: director → admin 자동원복 (idempotent: 이미 admin이면 0행)
    UPDATE public.user_profiles
       SET role = v_orig_role, updated_at = now()
     WHERE id = v_id AND role = v_temp_role;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_action := 'revert';
    -- 원복 완료 → lifecycle 잡 자기해지 (존재할 때만; 미존재 시 no-op)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'foot-juyeon-tempgrant-lifecycle') THEN
      PERFORM cron.unschedule('foot-juyeon-tempgrant-lifecycle');
    END IF;
    RAISE LOG 'foot-juyeon-tempgrant: REVERT director->admin (rows=%) at %', v_changed, p_now;

  ELSIF p_now >= v_grant_at THEN
    -- 7/25 발효: admin → director 임시부여 (idempotent: 이미 director면 0행)
    UPDATE public.user_profiles
       SET role = v_temp_role, updated_at = now()
     WHERE id = v_id AND role = v_orig_role;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_action := 'grant';
    IF v_changed > 0 THEN
      RAISE LOG 'foot-juyeon-tempgrant: GRANT admin->director (rows=%) at %', v_changed, p_now;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action', v_action, 'rows', v_changed, 'p_now', p_now,
    'grant_at', v_grant_at, 'revert_at', v_revert_at, 'target', v_id
  );
END;
$fn$;

-- 노출 최소화: 임의 로그인 사용자 실행 차단(부여/원복은 cron=postgres 만).
REVOKE ALL ON FUNCTION public.foot_juyeon_tempgrant_tick(timestamptz) FROM PUBLIC;

-- ── 2. lifecycle cron 잡(15분 폴) ─────────────────────────────────────────
--    cron.schedule(name,...) = 동명 upsert(pg_cron 1.6.4) → 재적용 안전.
--    발효 전: no-op / 발효~원복: director 유지 / 원복 후: admin 복귀 + 자기해지.
SELECT cron.schedule(
  'foot-juyeon-tempgrant-lifecycle',
  '*/15 * * * *',
  $$SELECT public.foot_juyeon_tempgrant_tick();$$
);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 적용 후 검증(supervisor, 별도 실행):
--   -- (a) 함수/잡 설치 확인
--   SELECT proname FROM pg_proc WHERE proname='foot_juyeon_tempgrant_tick';
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';
--   -- (b) 발효 전 대상 role 불변(admin) 확인
--   SELECT id, role, updated_at FROM public.user_profiles WHERE id='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
-- ════════════════════════════════════════════════════════════════════════
