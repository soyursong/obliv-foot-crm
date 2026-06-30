-- T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND · sub-gate ④ (PII-egress audit)
--   DA CONSULT-REPLY DA-20260701 (CR-20260701-foot-PERM-UNLOCK-EXPORT-AUTOSEND) GO 조건부.
--   고객목록 내보내기(엑셀·CSV, 전화번호·생년월일 bulk PII egress) 권한을 직원 3역할로 확대(permissions.ts
--   customer_export += coordinator/consultant/therapist)하면서 honest-actor accountability 를 위한
--   export audit trail 을 net-new 로 켠다.
--
-- ── 채택 결정(DA 8문항) ──────────────────────────────────────────────────────
--   Q1 audit 의무화 GO — net-new `customer_export_audit`(assignment_actions 패턴: per-CRM-local,
--       append-only, contract_required:false). RRN-class PHI 아님(birth_date=일반PII) → 6MENU RRN
--       대표 게이트 bar 전이 안 됨. 변경=ADDITIVE.
--   Q2 DEFINER RPC 채택(client INSERT-only 반려) — fn_log_customer_export(...) SECURITY DEFINER 가
--       actor=auth.uid() / role=get_user_role() / clinic=get_user_clinic_id() 서버파생(위조 불가).
--       테이블 RLS = client write 전면차단(DEFINER 만 write), SELECT = admin/manager/director 한정.
--
-- ── GO 조건 C1 (필수) ─────────────────────────────────────────────────────────
--   ① actor_user_id = FK·cascade 금지 — actor(user_profiles) 삭제 후에도 trail 생존 → 평 uuid 컬럼(無 FK).
--   ② filter_context PII 평문 금지 — 구조메타만 {selection_mode, selected_count, filter_field}.
--       phone/name 원문 검색어 적재 금지(위반 시 GO 무효). RPC 가 화이트리스트 key 만 추출해 강제.
--   C4: ADDITIVE·롤백SQL 동반·기존3역할 회귀0·send/Solapi 키 신설0.
--
-- rollback: see 20260701030000_customer_export_audit.rollback.sql
-- ============================================================================

BEGIN;

-- ── 1. net-new 테이블 (append-only audit trail) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_export_audit (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL,        -- 서버파생(get_user_clinic_id()). FK 미설정(append-only trail 보존, clinic 삭제와 무관 생존).
  actor_user_id   UUID        NOT NULL,        -- ★C1①: FK·cascade 금지 — actor 삭제 후 trail 생존. 평 uuid(auth.uid()).
  actor_role      TEXT        NOT NULL,        -- 서버파생(get_user_role()).
  selection_mode  TEXT        NOT NULL,        -- 'selected' | 'filter_all' (구조메타).
  selected_count  INTEGER     NOT NULL DEFAULT 0,
  filter_context  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- ★C1②: 구조메타만(필터 활성 여부 bool). 검색어 원문(phone/name) 적재 금지.
  exported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custexport_audit_clinic_id
  ON public.customer_export_audit(clinic_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_custexport_audit_actor
  ON public.customer_export_audit(actor_user_id);

COMMENT ON TABLE public.customer_export_audit IS
  'T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND ④: 고객목록 export(PII egress) 감사 추적. append-only, per-CRM-local, contract_required:false. actor_user_id=FK없음(trail 생존). filter_context=구조메타만(PII 평문 금지).';
COMMENT ON COLUMN public.customer_export_audit.actor_user_id IS
  '★C1①: FK·cascade 금지 — actor(user_profiles) 삭제 후에도 감사 trail 생존하도록 평 uuid 저장(auth.uid() 서버파생).';
COMMENT ON COLUMN public.customer_export_audit.filter_context IS
  '★C1②: 구조메타만 {filter_field bool 등}. phone/name 원문 검색어 평문 적재 절대 금지(GO 무효 조건).';

-- ── 2. RLS: client write 전면차단(DEFINER RPC 만 write), SELECT=admin/manager/director ──
ALTER TABLE public.customer_export_audit ENABLE ROW LEVEL SECURITY;

-- SELECT: 운영 감사 목적 — admin/manager/director(원장) 한정 + clinic isolation INVARIANT.
DROP POLICY IF EXISTS custexport_audit_select ON public.customer_export_audit;
CREATE POLICY custexport_audit_select ON public.customer_export_audit
  FOR SELECT
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN ('admin', 'manager', 'director')
  );

-- INSERT/UPDATE/DELETE: client 정책 미생성 = RLS 거부(DEFINER RPC 만 write). 위조/탬퍼 차단.

-- ── 3. fn_log_customer_export — SECURITY DEFINER. actor/role/clinic 서버파생(위조 불가) ──
--   클라이언트는 selection_mode/selected_count/filter_context(구조메타)만 전달.
--   filter_context 는 화이트리스트 key 만 추출 적재 → PII 평문 유입 봉쇄(C1②).
CREATE OR REPLACE FUNCTION public.fn_log_customer_export(
  p_selection_mode TEXT,
  p_selected_count INTEGER,
  p_filter_context JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_role    TEXT := public.get_user_role();
  v_clinic  UUID := public.get_user_clinic_id();
  v_id      UUID;
  v_ctx     JSONB;
BEGIN
  -- 호출자 검증: 인증 + export 권한 역할(permissions.ts customer_export = 6역할)만 기록 허용.
  IF v_actor IS NULL OR v_clinic IS NULL THEN
    RAISE EXCEPTION 'fn_log_customer_export: unauthenticated';
  END IF;
  IF v_role NOT IN ('admin', 'manager', 'director', 'coordinator', 'consultant', 'therapist') THEN
    RAISE EXCEPTION 'fn_log_customer_export: role % not permitted', v_role;
  END IF;

  -- selection_mode 정규화(화이트리스트). 미지정/이상값은 'unknown'.
  IF p_selection_mode NOT IN ('selected', 'filter_all') THEN
    p_selection_mode := 'unknown';
  END IF;

  -- ★C1②: filter_context 는 화이트리스트 구조 key(bool/숫자)만 추출. 검색어 원문 유입 봉쇄.
  v_ctx := jsonb_strip_nulls(jsonb_build_object(
    'has_query',        (p_filter_context->>'has_query')::boolean,
    'has_staff_filter', (p_filter_context->>'has_staff_filter')::boolean
  ));

  INSERT INTO public.customer_export_audit (
    clinic_id, actor_user_id, actor_role, selection_mode, selected_count, filter_context
  ) VALUES (
    v_clinic, v_actor, v_role, p_selection_mode, GREATEST(COALESCE(p_selected_count, 0), 0), COALESCE(v_ctx, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_log_customer_export(TEXT, INTEGER, JSONB) IS
  'T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND ④: 고객 export 감사기록. actor/role/clinic 서버파생(위조불가). filter_context 화이트리스트 추출(PII 평문 봉쇄).';

REVOKE ALL ON FUNCTION public.fn_log_customer_export(TEXT, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_log_customer_export(TEXT, INTEGER, JSONB) TO authenticated;

COMMIT;
