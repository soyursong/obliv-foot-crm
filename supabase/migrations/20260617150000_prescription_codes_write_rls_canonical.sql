-- T-20260617-foot-RXSET-VIEWALL-TABLE-MIGCLEAR (§0.6 검증 flow 부수발견)
-- prescription_codes write(INSERT/UPDATE/DELETE) RLS GAP → canonical 정렬.
--
-- ── 확정 RC (라이브 pg_policies 덤프, READ-only 증거) ──
--   라이브 정책 단 1개:
--     prescription_codes_read_all [SELECT] roles={public} USING(true)
--   → write 정책 부재. RLS ENABLED(relrowsecurity=true) 상태에서 write 정책이 없으므로
--     authenticated 사용자의 INSERT/UPDATE/DELETE 는 전부 RLS DENY(0행, 에러 없음 = silent no-op).
--     service_role(마이그/시드)만 RLS 우회로 write 가능 → 그래서 seed/bundle 마이그는 됐고 FE write 는 막힘.
--
--   의도(canonical) 근거: 20260426000000_rls_role_separation.sql 이 prescription_codes 에
--     'prescription_codes_admin_all FOR ALL TO authenticated USING is_admin_or_manager()
--      WITH CHECK is_admin_or_manager()' 를 명시(=문서화된 의도). 그러나 해당 정책이 DO $$ ... $$
--     IF EXISTS(prescription_codes) 가드 안에서 EXECUTE 되도록 작성됨 → 본 DB 적용 시점에
--     테이블 부재/마이그 순서로 가드가 skip 되어 admin_all 이 실제로 생성되지 않음(prescription_codes_approved_read 도 동반 누락).
--     form_templates(T-20260611-...-WRITE-RLS-OUTLIER)와 동일 패밀리의 "DO-block 가드 admin_all 미생성" 결손.
--
-- ── 부수 영향(중요): 본 GAP 은 본 티켓 검증 flow 뿐 아니라 기배포된 InsuranceStatusTab
--   (prescription_codes.insurance_status 수동 갱신, admin/manager 동선)의 write 도 동일하게 silent 차단해 옴.
--   본 정책 생성으로 양쪽 동시 정상화. → FOLLOWUP 으로 planner/supervisor 인지 공유.
--
-- ── 회귀 영향 ──
--   READ 미접촉: prescription_codes_read_all [SELECT] USING(true) 그대로.
--     SELECT 는 read_all(true) OR admin_all → 전원 읽기 불변(회귀 0).
--   WRITE 신설: admin/manager/director(is_admin_or_manager()) 만 INSERT/UPDATE/DELETE.
--     기존엔 누구도 FE write 불가였으므로 권한 축소 회귀 없음(0 → admin 한정 = 순증 정상화).
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성. 데이터 무변경(정책 메타만).
-- Rollback: 20260617150000_prescription_codes_write_rls_canonical.rollback.sql
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor QA 게이트. 단일 테이블, blanket ALTER 금지.

BEGIN;

-- canonical write 정책 (20260426 가 의도했으나 DO-block 가드 skip 으로 미생성된 것 materialize)
DROP POLICY IF EXISTS prescription_codes_admin_all ON prescription_codes;
CREATE POLICY prescription_codes_admin_all ON prescription_codes
  FOR ALL
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

COMMENT ON POLICY prescription_codes_admin_all ON prescription_codes IS
  'T-20260617-foot-RXSET-VIEWALL-TABLE-MIGCLEAR(§0.6): 20260426 이 의도했으나 DO-block IF EXISTS 가드 skip 으로 미생성된 canonical write 정책 materialize. is_admin_or_manager()(admin/manager/director) 만 INSERT/UPDATE/DELETE. READ(prescription_codes_read_all SELECT true) 미접촉. 이관약 검증 + InsuranceStatusTab write 동시 정상화.';

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname;
--   → prescription_codes_admin_all [ALL] roles={authenticated}
--       USING: is_admin_or_manager()  WITH CHECK: is_admin_or_manager()
--   → prescription_codes_read_all [SELECT] USING true (그대로 존재)
