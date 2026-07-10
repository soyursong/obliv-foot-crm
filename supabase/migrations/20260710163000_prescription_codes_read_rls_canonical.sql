-- T-20260617-foot-RXCODES-READ-TIGHTEN
-- prescription_codes READ RLS 조이기 → canonical(문서화된 approved_read) 복원.
--
-- ── 확정 RC (라이브 pg_policies 덤프, READ-only 증거 2026-07-10) ──
--   prescription_codes_read_all  [SELECT] roles={public}        USING(true)
--   prescription_codes_admin_all [ALL]    roles={authenticated} USING(is_admin_or_manager()) WITH CHECK(is_admin_or_manager())
--   → READ 가 roles={public} USING(true) = anon + 미승인 authenticated 까지 전원 약마스터(처방코드·insurance_status) 읽기 허용.
--     write 는 is_admin_or_manager() 로 좁혀졌는데(RXCODES-WRITE-RLS-CANONICAL, 9143ca7f IN-MAIN) READ 만 전원 개방 = 역할 비대칭 + 보안 느슨.
--
-- ── 의도(canonical) 근거 (DA CONSULT GO, MSG-20260619-203020-r026) ──
--   READ 대상 = is_approved_user() (TO authenticated). 근거 3중:
--   (a) 20260426000000_rls_role_separation.sql:585 가
--         'CREATE POLICY prescription_codes_approved_read ON prescription_codes FOR SELECT TO authenticated USING (is_approved_user())'
--       를 명시 의도했으나, DO $$ ... IF EXISTS(prescription_codes) $$ 가드가 당시 테이블 부재/마이그 순서로 skip 되어 미생성.
--       → 본 마이그 = 그 approved_read 의 잔여 materialize = 신정책 발명 아님, 문서화된 table-canonical 복원.
--   (b) 형제 reference master 전부 동일 표준 — prescriptions_approved_read(:567) / prescription_items_approved_read(:576)
--       / medications_approved_read(:591) = FOR SELECT TO authenticated USING(is_approved_user()). prescription_codes 만 outlier → 정렬.
--   (c) is_approved_user() = approved+active role-agnostic (user_profiles.approved=true AND active=true, SECURITY DEFINER).
--       → 의사 처방동선 5곳(MedicalChartPanel·DrugFolderTree·prescribableDrugs.ts·DrugInfoTooltip·PrescriptionSetsTab) 등
--         staff-authenticated READ 전원 보존. silent DENY 없음.
--
-- ── 회귀 영향 (2중 축소 = 비ADDITIVE 회귀면) ──
--   축소1) anon/PUBLIC READ 제거: read_all roles={public} → approved_read TO authenticated.
--          FE 전수감사(prescription_codes reader 12파일 = admin/doctor/lib staff 서피스, self-checkin/anon 컨텍스트 0건) → anon READ 의존 없음.
--   축소2) 미승인 authenticated READ 제거: USING(true) → USING(is_approved_user()). 미승인(approved=false)·비활성(active=false) 은 READ 차단.
--          정당 reader 는 전원 approved+active staff → silent DENY 0건 대상.
--   WRITE 미접촉: prescription_codes_admin_all [ALL] is_admin_or_manager() 그대로 유지.
--
-- ── 게이트 (READ 축소 = 회귀면, 3중) ──
--   ① DA CONSULT GO (완료, MSG-20260619-203020-r026)
--   ② supervisor DDL-diff + 8-role 전후검증 (anon 부재 · 미승인 부재 · approved+active 8역할 전원 SELECT PASS 매트릭스) — CEO 게이트 대체
--   ③ 실브라우저 READ 회귀 (정당 조회자 silent DENY 0건 + anon/미승인 차단)
--   ※ cross-product 충돌 없음(foot 로컬 테이블·헬퍼, cross_crm_data_contract 미참조) → CEO 게이트 면제(autonomy §3.1).
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성. 데이터 무변경(정책 메타만).
-- Rollback: 20260710163000_prescription_codes_read_rls_canonical.rollback.sql
-- 적용: ★supervisor DDL-diff + 8-role 전후검증 GO 후에만 (운영 DB 스키마 변경 = supervisor 사전 승인, standard §5). blind apply 금지.
--       scripts/T-20260617-foot-RXCODES-READ-TIGHTEN_apply.mjs (dry-run 기본 / APPLY=1 로 실적용).

BEGIN;

-- 과개방 read_all 제거 (anon+미승인 authenticated 포함 전원 개방)
DROP POLICY IF EXISTS prescription_codes_read_all ON prescription_codes;

-- canonical approved_read materialize (20260426:585 가 의도했으나 DO-block 가드 skip 으로 미생성된 것)
DROP POLICY IF EXISTS prescription_codes_approved_read ON prescription_codes;  -- 멱등 재적용 가드
CREATE POLICY prescription_codes_approved_read ON prescription_codes
  FOR SELECT
  TO authenticated
  USING (is_approved_user());

COMMENT ON POLICY prescription_codes_approved_read ON prescription_codes IS
  'T-20260617-foot-RXCODES-READ-TIGHTEN: 20260426:585 가 의도했으나 DO-block IF EXISTS 가드 skip 으로 미생성된 canonical read 정책 materialize. is_approved_user()(approved+active, role-agnostic) 만 SELECT. 과개방 read_all(roles=public USING true) 대체 — anon+미승인 authenticated READ 축소. WRITE(admin_all) 미접촉. 형제 reference master(prescriptions/prescription_items/medications) 표준 정렬. DA CONSULT GO MSG-20260619-203020-r026.';

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='prescription_codes' ORDER BY cmd, policyname;
--   → prescription_codes_approved_read [SELECT] roles={authenticated} USING: is_approved_user()
--   → prescription_codes_admin_all     [ALL]    roles={authenticated} USING/CHECK: is_admin_or_manager()  (불변)
--   → prescription_codes_read_all      부재 (제거됨)
