-- T-20260713-foot-AUTH-ACTOR-AUDIT-APPLEVEL — INV-5 (B) STRUCTURAL, foot = canonical pilot
-- =============================================================================
-- 목적: destructive auth op(비번재설정·ban/unban·계정등록/초대·role변경)이 실행될 때
--       "어느 로그인 staff(actor)가 트리거했는지"를 append-only 감사테이블에 기록.
--       (FACEOFANGEL/김지윤 계정 복구 때 "누가 비번을 재설정했나 확인 불가" 근본 해결)
--
-- 정본: cross_crm_auth_identity_standard.md v0.3 §8-B(캐노니컬 DDL, byte-identical) + §3-B(TS 호출규약) + INV-5.
--       테이블 shape = §8-B 그대로. 5 CRM copy-now 재사용 기준.
--
-- ★ foot canonical pilot 아키텍처 정렬 (copy-now 팬아웃 시 필독):
--   §3-B 캐노니컬 스니펫은 **서버측 service_role 클라이언트**가 `admin.auth.admin.updateUserById()`
--   (GoTrue Admin HTTP) + `admin.from(...).insert()`(service_role 직삽입) 하는 패턴을 가정.
--   그러나 foot 은 **브라우저에 service_role 클라이언트를 두지 않는다**(service key 노출 금지).
--   foot 의 destructive auth op = 유저세션(anon+JWT)으로 호출하는 **SECURITY DEFINER RPC**
--   (admin_reset_user_password / admin_toggle_user_active / admin_register_user).
--   → 정본 §3-B 의 "service_role 직삽입"은 foot 에 그대로 매핑 불가. foot 변형 =
--     감사 insert/stamp 를 **SECURITY DEFINER RPC**(record_auth_action / stamp_auth_action_outcome)로 back,
--     actor 는 클라 인자가 아니라 **auth.uid() 서버확정**(위조 불가). TS 시그니처(§3-B)는 그대로 유지하되
--     내부 access mechanism 만 service_role 직삽입 → RPC 로 대체. (DA 피드백 대상 — planner FOLLOWUP)
--   → 이 변형은 §3-B 의 best-effort/2-phase(attempted→succeeded/failed) **의미를 그대로 보존**한다:
--     record 는 op 前 독립 txn 으로 커밋(attempted 내구), op 실패 시에도 'attempted' 행이 남아 stamp('failed') 가능.
--
-- 스키마 성격: ADDITIVE. 기존 컬럼·PHI 테이블·기존 RLS·기존 RPC 무변경. 신규 테이블 1 + 함수 2.
-- 롤백: 20260713170000_foot_staff_auth_action_audit.rollback.sql
-- MIG-GATE: db_change=true → dryrun(No-Persistence) + ledger 3자대조 + rollback 4필드 의무.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1) 감사 테이블 — §8-B 캐노니컬 DDL byte-identical (컬럼/타입/기본값 동일)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_auth_action_audit (
  id             bigint      generated always as identity primary key,
  actor_staff_id uuid        null,                            -- 로그인 staff canonical id(INV-4 통과값). null=사람-귀속 공백(fail-loud warn)
  target_user_id uuid        not null,                        -- destructive 대상 auth user id
  target_email   text        null,                            -- staff auth email(정규화 lower). staff PII, patient email과 직교·PHI 아님
  action         text        not null,                        -- password_reset|delete_user|ban|unban|role_change|email_change|invite_overwrite
  outcome        text        not null default 'attempted',    -- attempted → (성공)succeeded / (실패)failed
  request_meta   jsonb       null,                            -- {ip,userAgent,requestId} non-PHI 컨텍스트
  occurred_at    timestamptz not null default now()
);

COMMENT ON TABLE public.staff_auth_action_audit IS
  'INV-5(§8-B): app-level 파괴적 auth op 행위주체(actor) append-only 감사. RLS admin-read only + append-only(no DELETE, outcome stamp 1회 UPDATE만). RRN 無·PHI 아님·비번 평문 금지.';

CREATE INDEX IF NOT EXISTS idx_saaa_target_user ON public.staff_auth_action_audit (target_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_saaa_actor_staff ON public.staff_auth_action_audit (actor_staff_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_saaa_occurred    ON public.staff_auth_action_audit (occurred_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 2) RLS 계약: admin-read only + append-only
--    - SELECT: admin 만
--    - INSERT/UPDATE/DELETE: authenticated 직접경로 전면 회수(정책 부재 + REVOKE)
--      → 유일 write 경로 = 아래 SECURITY DEFINER 함수 2개.
--    - outcome stamp = stamp_auth_action_outcome 함수(1회, actor/target/action/occurred_at immutable).
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.staff_auth_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_auth_action_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saaa_admin_read ON public.staff_auth_action_audit;
CREATE POLICY saaa_admin_read ON public.staff_auth_action_audit
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_auth_action_audit FROM authenticated, anon, PUBLIC;
GRANT  SELECT ON public.staff_auth_action_audit TO authenticated;  -- 실노출은 RLS(admin) 재제한

-- ─────────────────────────────────────────────────────────────────
-- 3) record_auth_action — §3-B recordAuthAction 를 back 하는 SECURITY DEFINER RPC
--    - actor 를 클라 인자가 아니라 auth.uid() 서버확정(위조 불가) → staff.id 해소.
--    - outcome='attempted' insert. op 前 독립 호출(독립 txn 커밋 → attempted 내구).
--    - actor_staff_id NULL(로그인 staff 미해소) = 사람-귀속 공백. 행은 남기되 TS 에서 fail-loud warn.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_auth_action(
  p_target_user_id UUID,
  p_target_email   TEXT,
  p_action         TEXT,
  p_request_meta   JSONB DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_staff_id UUID;
  v_id       BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_auth_action: no authenticated actor (auth.uid() is NULL)' USING ERRCODE = '28000';
  END IF;

  -- actor staff canonical id 해소 (auth.uid() 기준 — 클라 신뢰 안 함)
  SELECT s.id INTO v_staff_id FROM public.staff s WHERE s.user_id = v_actor LIMIT 1;

  INSERT INTO public.staff_auth_action_audit
    (actor_staff_id, target_user_id, target_email, action, outcome, request_meta)
  VALUES
    (v_staff_id, p_target_user_id, NULLIF(lower(trim(p_target_email)), ''), p_action, 'attempted', p_request_meta)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.record_auth_action(UUID, TEXT, TEXT, JSONB) IS
  'INV-5 §3-B(foot RPC variant): destructive auth op 직전 actor stamp. actor=auth.uid() 서버확정.';
REVOKE ALL ON FUNCTION public.record_auth_action(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_auth_action(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4) stamp_auth_action_outcome — §3-B stampAuthActionOutcome 를 back 하는 SECURITY DEFINER RPC
--    - outcome 만 UPDATE. actor/target/action/occurred_at immutable(건드리지 않음).
--    - 1회만: 현재 outcome='attempted' 인 행만 전이 허용(idempotent-once).
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_auth_action_outcome(
  p_audit_id BIGINT,
  p_outcome  TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_audit_id IS NULL THEN RETURN; END IF;                 -- insert 실패 시 no-op(§3-B)
  IF p_outcome NOT IN ('succeeded','failed') THEN
    RAISE EXCEPTION 'stamp_auth_action_outcome: invalid outcome %', p_outcome USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_auth_action_audit
  SET outcome = p_outcome
  WHERE id = p_audit_id
    AND outcome = 'attempted';                                -- 1회 전이만 허용
END;
$$;
COMMENT ON FUNCTION public.stamp_auth_action_outcome(BIGINT, TEXT) IS
  'INV-5 §3-B(foot RPC variant): op 성공/실패 후 outcome 1회 확정(narrow update, outcome-only).';
REVOKE ALL ON FUNCTION public.stamp_auth_action_outcome(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_auth_action_outcome(BIGINT, TEXT) TO authenticated;

COMMIT;
