-- T-20260625-foot-PHRASE-TEMPLATE-CRUD-FAIL — director write RLS UNBLOCK (ADDITIVE superset)
--
-- 현장(문지은 대표원장, U0ALGAAAJAV): 진료관리의 슈퍼상용구 / 상용구(진료차트) / 서류템플릿
--   3탭 전부 추가·수정·삭제가 안 됨.
--
-- AC-0 트리아지 ground-truth (read-only probe T-...-CRUD-FAIL_ac0_probe.mjs, PROD 실측 2026-06-25):
--   · 문지은 user_profiles.role = 'director' (active=true, director enum = 1행 = 문지은 단독).
--     (06-19 enumerate 당시 admin 이었으나 MUNJIEUN-ROLE-DIRECTOR 로 admin→director 재배정 완료.)
--   · super_phrases / phrase_templates / document_templates 의 write 정책(admin_write_*, FOR ALL)이
--     모두 USING role = ANY('{admin,manager}') — ★director 미포함★.
--     → director 가 RLS 0행 필터: INSERT = "violates RLS" 에러, UPDATE/DELETE = 0행 silent no-op({error:null}).
--   · super_phrases 에 clinic_id 컬럼 자체가 부재 → planner 후보(b) clinic_id NOT NULL 은 무관(기각).
--   ∴ 3테이블 동시 전CRUD 실패의 단일 공통 RC = write RLS role set 에 director 누락. (FE mutation 코드 정상.)
--
-- 동일 RC·동일 패턴 선례: 20260624180000_bundlerx_director_write_rls.sql (prescription_sets/document_templates/
--   phrase_templates 에 director 추가, BUNDLERX-ICON-NOAPPLY part1). 단 PROD 미적용 + super_phrases 미포함.
--   본 마이그는 본 티켓 scope 3테이블(super_phrases + 旣 2테이블)을 self-contained 로 동일 end-state 보장.
--   document_templates/phrase_templates 는 양 마이그 모두 DROP IF EXISTS+CREATE·동일 정의 → idempotent, 충돌 0.
--
-- 변경 성격: 순수 role superset — {admin,manager} → {admin,manager,director}.
--   기존 role(admin,manager) DROP/narrow 0. 신규 컬럼·테이블·enum 0. WITH CHECK 신설 0
--   (FOR ALL USING-only 패턴 보존 → USING 식이 INSERT WITH CHECK 로도 적용됨).
--   ∴ data-architect CONSULT 불요(스키마 무변경, RLS=supervisor DDL-diff 게이트). 대표 게이트 면제(autonomy §3.1 ADDITIVE).
--
-- ★ Convergence carry: director 하드코딩은 has_ops_authority(운영권한 플래그) 적재 전 stopgap.
--   has_ops_authority 수렴 시 본 RLS 의 'director' 도 동시 수렴 대상(고아화 방지). 20260624180000 과 동일 정책.
--
-- cross-CRM 영향 0: 세 테이블 모두 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (DROP/CREATE POLICY DDL 만, backfill 없음). 롤백 = .rollback.sql. 재실행 안전.

BEGIN;

-- 1. super_phrases ───────────────────────────────────────────
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

-- 2. phrase_templates ────────────────────────────────────────
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

-- 3. document_templates ──────────────────────────────────────
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

COMMENT ON POLICY "admin_write_super_phrases" ON public.super_phrases IS
  'T-20260625-PHRASE-TEMPLATE-CRUD-FAIL: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';
COMMENT ON POLICY "admin_write_phrase_templates" ON public.phrase_templates IS
  'T-20260625-PHRASE-TEMPLATE-CRUD-FAIL: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';
COMMENT ON POLICY "admin_write_document_templates" ON public.document_templates IS
  'T-20260625-PHRASE-TEMPLATE-CRUD-FAIL: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';

COMMIT;
