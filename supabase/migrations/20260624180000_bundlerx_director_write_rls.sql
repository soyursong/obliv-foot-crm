-- T-20260624-foot-BUNDLERX-ICON-NOAPPLY part1 — director write RLS UNBLOCK (ADDITIVE superset)
--
-- 현장(문지은 대표원장, U0ALGAAAJAV): 묶음처방 아이콘/태그 저장이 silent no-op.
--   RC: director(대표원장) 역할이 묶음처방/문서템플릿/상용구 write RLS({admin,manager}) 미포함 →
--       supabase .update()/.insert() 가 RLS 0행 필터에도 {error:null} 반환 → 거짓 성공.
--   part2(FE .select() 0-row throw)로 거짓 토스트는 旣 차단(f55038a1). 본 part1 은 director 가
--   실제로 write 할 수 있도록 RLS write 정책 role set 을 admin,manager → admin,manager,director 로 확대.
--
-- DA CONSULT-REPLY (MSG-20260624-223215-az67, GO · ADDITIVE):
--   대표 게이트 면제(autonomy §3.1) · supervisor DDL-diff only.
--   순수 role superset 추가만 — 기존 role(admin,manager) DROP/narrow 0. WITH CHECK 신설 0.
--   세 정책 모두 FOR ALL + USING-only 패턴 → USING 에 'director' 추가 1곳으로 read+write 모두 커버
--   (FOR ALL 에서 WITH CHECK 생략 시 USING 식이 write check 로도 적용됨).
--
-- 대상 3정책 (모두 동일 RC · 동일 패턴):
--   1. admin_write_prescription_sets  (20260504_doctor_treatment_flow_up.sql:117) — 원 대상(아이콘/태그)
--   2. admin_write_document_templates (동 :140) — 동일 RC 동봉
--   3. admin_write_phrase_templates   (동 :94)  — 동일 RC 동봉
--   ※ staff_write_staffarea_phrases(20260620, 직원 pen/customer write)는 별개 permissive 정책 → 무변경.
--
-- 제외 (AC-6 / 본 버그 아님):
--   - diagnosis_names: ★table 미존재★. '상병명 관리' 탭 backing = services 테이블(category_label='상병').
--     services RLS = is_admin_or_manager() 함수 + services_staff_unlock_6menu(직원 unlock) 으로
--     본 3정책의 inline {admin,manager}-only EXISTS 패턴과 ★상이★ → 본 마이그 제외, planner 1줄 보고(AC-6).
--   - drug_folders: table 미존재(이미 폐기).
--   - diagnosis_sets / prescription_folders: authenticated USING(true) 과개방 = 본 버그 아님 → 별도 P3.
--
-- ★ Convergence carry: 본 RLS director 추가는 has_ops_authority(운영권한 플래그) 적재 전 stopgap.
--   has_ops_authority 수렴 시 본 RLS 의 'director' 하드코딩도 ★동시 수렴★ 대상(고아화 방지).
--
-- cross-CRM 영향 0: 세 테이블 모두 cross_crm_data_contract·schema_registry 미등재 foot-로컬.
-- 데이터 mutation 0 (DROP/CREATE POLICY DDL 만, backfill 없음). 롤백 = .rollback.sql.
-- 재실행 안전: DROP POLICY IF EXISTS + CREATE.

BEGIN;

-- 1. prescription_sets ───────────────────────────────────────
DROP POLICY IF EXISTS "admin_write_prescription_sets" ON public.prescription_sets;
CREATE POLICY "admin_write_prescription_sets"
  ON public.prescription_sets FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

-- 2. document_templates ──────────────────────────────────────
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

-- 3. phrase_templates ────────────────────────────────────────
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

COMMENT ON POLICY "admin_write_prescription_sets" ON public.prescription_sets IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';
COMMENT ON POLICY "admin_write_document_templates" ON public.document_templates IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';
COMMENT ON POLICY "admin_write_phrase_templates" ON public.phrase_templates IS
  'T-20260624-BUNDLERX-ICON-NOAPPLY part1: write role admin,manager,director. director 추가는 has_ops_authority 적재 전 stopgap → 수렴 시 동시 정리.';

COMMIT;
