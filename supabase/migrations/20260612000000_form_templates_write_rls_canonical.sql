-- T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER  (WS-1, 부모 RLS-MENU-ROLE-PARITY-POLICY 부수발견)
-- form_templates write(INSERT/UPDATE/DELETE) RLS OUTLIER → canonical 정렬.
--
-- ── 확정 RC (Phase 1 전수감사 raw dump + 라이브 pg_policies 재확인, READ-only) ──
--   라이브 정책 2개:
--     form_templates_manage [ALL]  roles={public}
--       USING (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.user_id = auth.uid()))
--     form_templates_read   [SELECT] roles={public}  USING (true)
--   → write(INSERT/UPDATE/DELETE)가 form_templates_manage 단일 [ALL] 정책으로 통제됨.
--
--   OUTLIER 성격 (canonical 대비 차이, AC-1):
--     (1) 신원 소스 = staff.user_id (비정규/희소: 라이브 staff 48행 중 user_id 채워짐 20행).
--         로그인 신원은 user_profiles 기준 → admin/manager라도 staff.user_id 미보유 시 write deny.
--         health_q / clinic_events OUTLIER 와 동일 staff-신원 RC 패밀리.
--     (2) 역할 범위 = "해당 clinic 의 staff.user_id 보유자 전원"(역할 무필터) → 코디·테라피스트·
--         테크니션 누구든 템플릿 INSERT/UPDATE/DELETE 가능 = 의도(관리자/원장 write)보다 과대.
--     (3) roles={public} (canonical 은 TO authenticated), WITH CHECK 부재(USING 이 체크 대체).
--   → 결론: 역할상 과대(over-broad) + 신원상 깨짐(broken) 의 혼합 OUTLIER.
--
--   의도(canonical) 근거: 20260426000000_rls_role_separation.sql E.26 이 form_templates 에
--     'form_templates_admin_all FOR ALL TO authenticated USING is_admin_or_manager()
--      WITH CHECK is_admin_or_manager()' 를 명시(=문서화된 의도). 그러나 구 OUTLIER
--     form_templates_manage 가 drop 되지 않아 라이브에 잔존 → 본 마이그에서 정렬.
--
-- ── 회귀 영향 (AC-4) ──
--   FE 의 form_templates 접근은 전부 .select(...) (PenChartTab / DocumentPrintPanel / PaymentMiniWindow).
--   UI 상 INSERT/UPDATE/DELETE 경로 없음 → 일반 직원 write 회귀 0. 템플릿 관리는 admin 레벨(마이그/시드,
--   향후 관리자 UI)에서만 → is_admin_or_manager() 로 제한해도 정당 동선 영향 없음. 잠복 과대권한만 정리.
--
-- ── 범위 한정 (회귀가드) ──
--   READ 미접촉: form_templates_read [SELECT] USING(true) 그대로. (읽기 parity = 부모 티켓 도메인.)
--     SELECT 는 read(true) OR admin_all = true → 전원 읽기 불변(회귀 0).
--   WRITE 만 교체: form_templates_manage(OUTLIER) → form_templates_admin_all(canonical).
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260612000000_form_templates_write_rls_canonical.rollback.sql
-- 운영 적용: supervisor DB 게이트 (단일 테이블, blanket ALTER 금지).

BEGIN;

-- 1) OUTLIER write 정책 제거 (staff.user_id 비정규 신원 + 역할 무필터 과대권한)
DROP POLICY IF EXISTS form_templates_manage ON form_templates;

-- 2) 혹시 부분 적용/중복 잔재 방지 후 canonical write 재생성
DROP POLICY IF EXISTS form_templates_admin_all ON form_templates;
CREATE POLICY form_templates_admin_all ON form_templates
  FOR ALL
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

COMMENT ON POLICY form_templates_admin_all ON form_templates IS
  'T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER (WS-1): write canonical 정렬. 비정규 staff.user_id 신원 + 역할 무필터 과대 OUTLIER(form_templates_manage) → user_profiles 기반 is_admin_or_manager()(admin/manager/director) write 제한. READ(form_templates_read SELECT true) 미접촉.';

COMMIT;

-- 검증 쿼리 (apply 후 supervisor 수동 확인용):
-- 1) write canonical 확인:
--    SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--      WHERE schemaname='public' AND tablename='form_templates' ORDER BY cmd, policyname;
--    → form_templates_admin_all [ALL] roles={authenticated}
--        USING: is_admin_or_manager()   WITH CHECK: is_admin_or_manager()
--    → form_templates_manage 부재(제거됨)
-- 2) READ 불변 확인:
--    → form_templates_read [SELECT] USING true  (그대로 존재)
