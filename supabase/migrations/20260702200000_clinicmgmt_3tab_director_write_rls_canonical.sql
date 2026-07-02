-- T-20260702-foot-CLINICMGMT-DIRECTOR-EDIT-FIX (Phase B 집행) — 진료관리 3탭 write RLS director ADDITIVE 정본화
--
-- ★정본 = DA CONSULT-REPLY MSG-20260702-185958-9i2o (option-A GO). planner INFO MSG-20260702-190400-3era.
--   3 테이블(super_phrases · document_templates · phrase_templates[medical_chart=admin_write]) write policy
--   role set = {admin, manager} → {admin, manager, director} (ADDITIVE / broadening).
--   director 는 표준 role enum(cross_crm_data_contract §2-3) → CHECK/컬럼/타입 무변경. 스키마 0.
--
-- ★option-B(has_ops_authority) 채택 금지 — 그건 RESTRICTIVE(일반 manager write 회수) → 별도 락아웃 역전.
--   ROLE-MATRIX(T-20260619) converge 로 이관됨. 본 파일은 순수 broadening 스톱갭.
--
-- ★C1 불변식: manager 를 세트에 유지(director-only 로 조이지 말 것). admin↔manager 어떤 재배치에도
--   김주연 총괄 write 보존.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠ PROD 실측 (2026-07-02, dev-foot Management API 라이브 스냅샷):
--   super_phrases.admin_write_super_phrases        = {admin,manager,director}  ← 이미 director 포함
--   document_templates.admin_write_document_templates = {admin,manager,director}  ← 이미 director 포함
--   phrase_templates.admin_write_phrase_templates  = {admin,manager,director}  ← 이미 director 포함
--   ⇒ PROD RLS 는 이미 option-A(=본 파일 target state)와 정합. 본 apply = 멱등 no-op (동일 정책 재생성).
--   ⇒ 티켓 CODY-PARITY-SWEEP baseline({admin,manager}, director 미포함)은 STALE. 실제 락아웃 원인은
--     FE 하위 3탭의 `profile?.role==='admin'` 하드코딩(Phase A 잔여) 단독 → 본 배포의 FE 3파일이 그 fix.
--
-- 근거(PROD 가 이미 director 인 이유):
--   · document_templates / phrase_templates director = 20260624180000_bundlerx_director_write_rls (repo 반영·apply 완료).
--   · super_phrases director = T-20260625-CLINICMGMT-3TAB-DIRECTOR-RBAC_rls_apply.mjs (branch 9329f522,
--     PROD apply 됐으나 migration 파일 main 미머지) → super_phrases 만 repo/PROD 드리프트.
--   ⇒ 본 파일 = 3 정책을 repo 에 canonical 로 재확정 + super_phrases 드리프트 closure. 멱등 DROP+CREATE.
-- ────────────────────────────────────────────────────────────────────────────
--
-- G1: 3 테이블 = 1 migration txn (BEGIN/COMMIT). 롤백 = ..._canonical.rollback.sql (정확히 {admin,manager} 복원).
-- G2: apply 후 각 admin_write 정책 = {admin,manager,director}, 그 외 정책(staffarea_write_phrases / read) 미접촉.
-- G3: supervisor DDL-diff 게이트 유지. FE(3파일 canEditClinicMgmt)+RLS 동반 배포. FE-only 금지.
--     (단 PROD RLS 가 이미 director 이므로 FE-only 여도 write-deny 사고는 발생하지 않음 — 안전 마진.)
--
-- 데이터 mutation 0 (DDL only). 재실행 안전 (DROP POLICY IF EXISTS + CREATE).
-- cross-CRM 영향 0: 세 테이블 모두 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- ★staffarea_write_phrases (phrase_templates 7역할, pen/customer_chart) = ★무접촉★ (본 파일에 DROP/CREATE 없음).

BEGIN;

-- 1) super_phrases (슈퍼상용구)
DROP POLICY IF EXISTS "admin_write_super_phrases" ON public.super_phrases;
CREATE POLICY "admin_write_super_phrases"
  ON public.super_phrases FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

-- 2) document_templates (서류 템플릿)
DROP POLICY IF EXISTS "admin_write_document_templates" ON public.document_templates;
CREATE POLICY "admin_write_document_templates"
  ON public.document_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

-- 3) phrase_templates (상용구 — admin_write 는 all-type; medical_chart(진료차트) director write 커버)
--    ★staffarea_write_phrases(pen/customer_chart 7역할)와 OR·무접촉. medical_chart 는 admin_write 단독 게이트.
DROP POLICY IF EXISTS "admin_write_phrase_templates" ON public.phrase_templates;
CREATE POLICY "admin_write_phrase_templates"
  ON public.phrase_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

COMMENT ON POLICY "admin_write_super_phrases" ON public.super_phrases IS
  'T-20260702-CLINICMGMT-DIRECTOR-EDIT-FIX option-A: write role {admin,manager,director} ADDITIVE. has_ops_authority 적재 전 stopgap(ROLE-MATRIX converge 대상). manager 유지(C1 불변식).';
COMMENT ON POLICY "admin_write_document_templates" ON public.document_templates IS
  'T-20260702-CLINICMGMT-DIRECTOR-EDIT-FIX option-A: write role {admin,manager,director} ADDITIVE. has_ops_authority 적재 전 stopgap. manager 유지(C1).';
COMMENT ON POLICY "admin_write_phrase_templates" ON public.phrase_templates IS
  'T-20260702-CLINICMGMT-DIRECTOR-EDIT-FIX option-A: write role {admin,manager,director} ADDITIVE(all-type; medical_chart director write 커버). staffarea_write_phrases(pen/customer 7역할)와 OR·무접촉. manager 유지(C1).';

COMMIT;

-- 검증 쿼리(참고, 수동):
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname='public'
--      AND policyname IN ('admin_write_super_phrases','admin_write_document_templates','admin_write_phrase_templates');
--   → 3 정책 모두 qual 에 'admin','manager','director' 포함, 그 외 정책 미변경.
