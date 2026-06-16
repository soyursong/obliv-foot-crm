-- ============================================================
-- T-20260616-foot-OPINION-DOC-FEATURE (Phase 2): 소견서 템플릿 + 발행본
-- 김주연 총괄 (#foot, 채널 C0ATE5P6JTH, thread 1781491923.605529)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260616120000_opinion_documents.rollback.sql
-- 작성: dev-foot / 2026-06-16
-- ⚠ supervisor DDL-diff 게이트 경유(대표 게이트 면제, autonomy §3.1 ADDITIVE+DA GO).
--   GO 후 dev-foot 직접 prod apply. (dev_ops_policy — 대시보드 수동 실행 금지)
-- ============================================================
-- 설계 근거: data-architect CONSULT-REPLY GO (ADDITIVE) — MSG-20260616-142112-0i8a.
--   2 신규테이블 ADDITIVE 신설(기존 테이블·컬럼 파괴 0). 스키마 소유권=DA 확정안.
--
-- 핵심(의료법 제22조): opinion_documents 는 IMMUTABLE 의무기록.
--   ① RLS = INSERT + SELECT policy 만 부여(UPDATE/DELETE policy 미생성 → RLS on 시 차단)
--   ② 이중방어 BEFORE UPDATE OR DELETE 트리거 → RAISE EXCEPTION (service_role 등 RLS 우회 경로도 차단)
--   ③ 명시 REVOKE UPDATE,DELETE (authenticated/PUBLIC) — 삼중 방어
--   → 정정은 UPDATE 금지, 신규 INSERT(supersedes_id 채움)로만(append-only 정정 체인).
--   → 데스크 출력 = SELECT(스냅샷 body 그대로, 재조회 변조 불가).
--
-- 역할 헬퍼(canonical, 20260615160000 RLS isolation 표준 재사용):
--   · current_user_clinic_id() = 호출자 user_profiles.clinic_id (멀티테넌트 격리 키)
--   · is_approved_user()       = 승인된 전 직군(데스크 출력 포함 넓은 SELECT)
--   · is_admin_or_manager()    = admin/manager/director (= FE isDoctor 집합, 발행 권한=director|doctor)
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: opinion_doc_templates (소견서 템플릿 마스터 — mutable, 관리 UI CRUD)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.opinion_doc_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  option_name   TEXT        NOT NULL,
  body_template TEXT        NOT NULL,
  sort_order    INT         NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_opinion_tpl_clinic_active_sort
  ON public.opinion_doc_templates(clinic_id, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_opinion_tpl_updated_at ON public.opinion_doc_templates;
CREATE TRIGGER trg_opinion_tpl_updated_at
  BEFORE UPDATE ON public.opinion_doc_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.opinion_doc_templates IS
  'T-20260616-foot-OPINION-DOC-FEATURE: 소견서 팝업 옵션 템플릿(옵션명+자동삽입문구). clinic 격리, mutable. (DA CONSULT GO)';

ALTER TABLE public.opinion_doc_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: 동일 clinic 전 직군(승인 사용자)
DROP POLICY IF EXISTS opinion_tpl_select ON public.opinion_doc_templates;
CREATE POLICY opinion_tpl_select ON public.opinion_doc_templates
  FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

-- INSERT/UPDATE/DELETE: admin|manager|director (= is_admin_or_manager)
DROP POLICY IF EXISTS opinion_tpl_insert ON public.opinion_doc_templates;
CREATE POLICY opinion_tpl_insert ON public.opinion_doc_templates
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS opinion_tpl_update ON public.opinion_doc_templates;
CREATE POLICY opinion_tpl_update ON public.opinion_doc_templates
  FOR UPDATE TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

DROP POLICY IF EXISTS opinion_tpl_delete ON public.opinion_doc_templates;
CREATE POLICY opinion_tpl_delete ON public.opinion_doc_templates
  FOR DELETE TO authenticated
  USING (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: opinion_documents (발행 소견서 — IMMUTABLE 의무기록)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.opinion_documents (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID        NOT NULL REFERENCES public.clinics(id)               ON DELETE RESTRICT,
  customer_id          UUID        NOT NULL REFERENCES public.customers(id)             ON DELETE RESTRICT,
  chart_no             TEXT,                                       -- 발행시점 차트번호 스냅샷(출력 재현). SoT=customers, denorm
  template_id          UUID        REFERENCES public.opinion_doc_templates(id)          ON DELETE SET NULL,  -- provenance
  source_option_name   TEXT,                                       -- 발행시점 옵션명 스냅샷
  body                 TEXT        NOT NULL,                       -- 최종 발행 본문(수기수정 반영)
  issued_by            UUID        REFERENCES public.clinic_doctors(id)                 ON DELETE SET NULL,  -- 발행자=진료의(§2-5)
  issued_by_name       TEXT        NOT NULL,                       -- 발행자명 불변 스냅샷(의료법 audit)
  issued_by_license_no TEXT,                                       -- 면허번호 denorm 스냅샷
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_id        UUID        REFERENCES public.opinion_documents(id)              ON DELETE RESTRICT,  -- append-only 정정 체인
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opinion_doc_clinic_cust_issued
  ON public.opinion_documents(clinic_id, customer_id, issued_at DESC);

COMMENT ON TABLE public.opinion_documents IS
  'T-20260616-foot-OPINION-DOC-FEATURE: 발행 소견서(IMMUTABLE 의무기록, 의료법 제22조). UPDATE/DELETE 불가(RLS 미부여+트리거+REVOKE). 정정=신규 INSERT(supersedes_id). (DA CONSULT GO)';

-- ── IMMUTABILITY 이중방어 트리거 ──
CREATE OR REPLACE FUNCTION public.opinion_documents_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '의무기록(소견서)은 비가역입니다 — 정정은 신규 발행(supersedes_id)으로만 가능합니다'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.opinion_documents_immutable_guard() IS
  'T-20260616-foot-OPINION-DOC-FEATURE: 소견서 발행본 UPDATE/DELETE 차단(의료법 제22조 비가역). RLS 우회 경로(service_role 등) 포함 이중방어.';

DROP TRIGGER IF EXISTS trg_opinion_documents_immutable ON public.opinion_documents;
CREATE TRIGGER trg_opinion_documents_immutable
  BEFORE UPDATE OR DELETE ON public.opinion_documents
  FOR EACH ROW EXECUTE FUNCTION public.opinion_documents_immutable_guard();

-- ── RLS: INSERT + SELECT 만 부여(UPDATE/DELETE policy 미생성) ──
ALTER TABLE public.opinion_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: 동일 clinic 직군(데스크 출력 포함 넓게)
DROP POLICY IF EXISTS opinion_doc_select ON public.opinion_documents;
CREATE POLICY opinion_doc_select ON public.opinion_documents
  FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

-- INSERT(발행): director|doctor (= is_admin_or_manager: admin/manager/director)
DROP POLICY IF EXISTS opinion_doc_insert ON public.opinion_documents;
CREATE POLICY opinion_doc_insert ON public.opinion_documents
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());

-- ⚠ UPDATE/DELETE policy 의도적 미생성(RLS on → 정책 없는 명령 차단).
-- ── 삼중 방어: 테이블 레벨 UPDATE/DELETE 권한 명시 회수 ──
REVOKE UPDATE, DELETE ON public.opinion_documents FROM authenticated;
REVOKE UPDATE, DELETE ON public.opinion_documents FROM PUBLIC;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: 검증 (DDL-diff 4항 self-check)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_ud_policies INT;
BEGIN
  -- ① 테이블 생성
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='opinion_doc_templates') THEN
    RAISE EXCEPTION 'opinion_doc_templates 생성 실패'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='opinion_documents') THEN
    RAISE EXCEPTION 'opinion_documents 생성 실패'; END IF;

  -- ③ immutable 트리거 존재
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_opinion_documents_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'immutable 트리거 생성 실패'; END IF;

  -- ③ opinion_documents 에 UPDATE/DELETE policy 가 없어야 함
  SELECT count(*) INTO v_ud_policies
    FROM pg_policies
   WHERE schemaname='public' AND tablename='opinion_documents'
     AND cmd IN ('UPDATE','DELETE');
  IF v_ud_policies > 0 THEN
    RAISE EXCEPTION 'opinion_documents UPDATE/DELETE policy % 건 존재(immutability 위반)', v_ud_policies; END IF;

  -- ④ clinic isolation: 두 테이블 전 authenticated 정책에 clinic 술어 강제
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public'
       AND tablename IN ('opinion_doc_templates','opinion_documents')
       AND 'authenticated' = ANY(roles)
       AND COALESCE(qual,'')       NOT LIKE '%current_user_clinic_id()%'
       AND COALESCE(with_check,'') NOT LIKE '%current_user_clinic_id()%'
  ) THEN
    RAISE EXCEPTION 'clinic isolation 술어 부재 정책 잔존'; END IF;

  RAISE NOTICE 'T-20260616-foot-OPINION-DOC-FEATURE: 2 테이블 + immutability + clinic isolation 검증 통과';
END $$;

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor DDL-diff 4항)
-- ============================================================
-- [ ] ① 파괴 0      : 신규 CREATE TABLE 2종만, 기존 테이블/컬럼 ALTER·DROP 없음
-- [ ] ② FK 5종 정합 : clinic_id, customer_id(RESTRICT), template_id(SET NULL),
--                     issued_by→clinic_doctors(SET NULL), supersedes_id→self(RESTRICT)
-- [ ] ③ immutable   : SELECT count(*) FROM pg_policies WHERE tablename='opinion_documents' AND cmd IN ('UPDATE','DELETE');  -- 0
--                     + 트리거 trg_opinion_documents_immutable 존재(BEFORE UPDATE OR DELETE)
--                     + UPDATE 시도 → '의무기록(소견서)은 비가역입니다' 예외 확인
-- [ ] ④ clinic isol.: 전 authenticated 정책에 current_user_clinic_id() 술어 존재
-- ============================================================
