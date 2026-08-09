-- ============================================================================
-- T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE · UP  (STRAGGLER_OPEN 폐쇄)
--   foot master-config write RLS 중 ungated write(USING(true)/WITH CHECK(true)) 2건 폐쇄.
--   change-class = RESTRICTIVE access-tightening DDL on policies (데이터 write 0, 가역).
--   게이트: DA CONSULT-REPLY GO(MSG-20260810-022318-hzv9, 조건부 per-fork/class-scoped) +
--          CEO 파괴게이트 면제(§3.1, Q4 RESTRICTIVE) · ⚠DROP/CREATE POLICY=DDL → DDL-0 carve 아님 →
--          supervisor DB-GATE(DDL-diff + effective-authz superset + GO-token) 물리 선행 필수(apply_before_go 금지, C20).
--   SSOT: agents/docs/da_replies/da_decision_meta_rls_adminfunc_ungated_2_3_a_conformance_sweep_20260810.md
--   census 정본: _handoff/_evidence/T-20260810-meta-RLS-ADMINFUNC-UNGATED-2-3-A-CONFORMANCE-SWEEP_{raw_policies,findings,census}_2026-08-10.*
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 대상 (census AC-3 정본 = 2 policies, before-image verbatim = raw_policies_2026-08-10.json)
-- ══════════════════════════════════════════════════════════════════════════════
--   ① fee_set_templates.auth_all  : FOR ALL TO authenticated USING(true) WITH CHECK(true)
--   ② package_templates.auth_all  : FOR ALL TO authenticated USING(true) WITH CHECK(true)
--   → 임의 authenticated(미승인·tm·타clinic 포함)가 요금/패키지 config mutate 가능(ungated write).
--   ★foot packages(TARGET8_REGRESSION)는 본건 무접촉 — DA Q1 명시 제외(packages_consult_*=상담 워크플로) → Q5 REVIEW 별 트랙.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- canonical predicate (DA Q2 · §12-8② HARD 계승 / class-invariant ≠ verbatim clone)
-- ══════════════════════════════════════════════════════════════════════════════
--   arg-form invariant(WHICH tenant): 두 테이블 clinic_id UUID NOT NULL 실재 → per-row tenant binding
--     `clinic_id = current_user_clinic_id()`. ★argless/own-only 금지(2호점 misscope) — row.clinic_id 를
--     참조하는 per-row 바인딩(caller clinic == row clinic). foot 은 is_clinic_admin(uuid)/is_clinic_owner(uuid)
--     함수 부재 → derm 8타깃 술어 문자열 복제 금지(HARD) → foot 계보로 렌더(같은 불변식, 다른 문자열):
--     `clinic_id = current_user_clinic_id()`(row-tenant) + is_approved_user()(승인직원) + current_user_role() 역할셋.
--     (단일-clinic 멤버십 모델: current_user_clinic_id() = caller 단일 clinic → is_clinic_admin(row.clinic_id) 와 등가 불변식.)
--
--   role-set(WHO, per-fork adjudicable — anti-false-lockout 실 census 근거):
--   ── [BLOCKING] per-table write-path READ-ONLY census (dev-foot, commit 이 마이그와 동봉) ──
--     ① fee_set_templates : FE writer 게이트 = canEditStaffArea = STAFF_AREA_EDIT_ROLES = ALL_STAFF_ROLES
--          = {admin,manager,director,consultant,coordinator,therapist,part_lead,staff} (8역할, tm/technician 제외).
--          현장 확정(김주연 총괄) "직원들이 메인으로 쓰는 곳"(T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED).
--          reader(PaymentMiniWindow) ⊆ 동일 8역할. → read=write=8역할(단일 FOR ALL). blanket admin-only 강제 시
--          consultant/coordinator/therapist/part_lead/staff false-lockout(현장 정당 writer) → 8역할 편입 필수.
--     ② package_templates : write(INSERT/UPDATE/DELETE) 게이트 = canWritePackage = isStaffUnlockRole =
--          STAFF_UNLOCK_ROLES = {admin,manager,director,consultant,coordinator,therapist} (6역할) — Packages.tsx /
--          CustomerChartPage submitWithTemplate(상담 워크플로). ★read(SELECT)는 part_lead/staff 도 정당 소비:
--          Closing.tsx(PERM closing=8역할)→PaymentDialog 가 package_templates 를 로드(결제창 패키지 선택).
--          → read=8역할 / write=6역할 SPLIT. part_lead/staff write 임의편입 금지(DA "임의 편입 금지") = read-only 편입.
--     ※ EF/서버 writer 0(functions/ · supabase/functions/ grep 무매치) — 전 write=클라 JWT(authenticated) → RLS 적용.
--
-- ── 성격 / 게이트 ──────────────────────────────────────────────────────────────
--   비파괴(DROP POLICY + CREATE POLICY). 신규 컬럼/타입/enum/테이블 0. 데이터 mutation 0.
--   멱등(DROP ... IF EXISTS + CREATE). RLS 이미 ENABLE(무변경).
--   down: 20260810170000_foot_mastercfg_openwrite_rls_close.rollback.sql (auth_all USING(true) verbatim 복원 = 취약 재개통)
--   dryrun: 20260810170000_foot_mastercfg_openwrite_rls_close.dryrun.mjs (무영속·post-probe 원상태 복원 실측)
-- 작성: dev-foot / 2026-08-10
-- ============================================================================

-- ── (0) PREFLIGHT: foot DB 실재 + 대상 오브젝트/컬럼/함수 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
BEGIN
  -- 대상 테이블 2건 실재
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='fee_set_templates') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: fee_set_templates 부재 — wrong DB?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='package_templates') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_templates 부재 — wrong DB?';
  END IF;
  -- arg-form invariant 전제: clinic_id 컬럼 실재(참조 컬럼 prod-ABSENT fail-closed, deploy-precheck C12)
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND column_name='clinic_id'
          AND table_name IN ('fee_set_templates','package_templates')) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: clinic_id 컬럼 부재(한쪽 이상) — per-row tenant binding 술어 의존 미충족';
  END IF;
  -- canonical 술어 helper 함수 실재(foot 계보)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — tenant-binding 술어 의존 미충족';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='is_approved_user') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_approved_user() 부재 — 승인직원 게이트 술어 의존 미충족';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='current_user_role') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_role() 부재 — 역할셋 술어 의존 미충족';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ① fee_set_templates : ungated auth_all DROP → canonical staff+clinic FOR ALL (read=write=8역할)
-- ══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "auth_all" ON public.fee_set_templates;

CREATE POLICY "fee_set_templates_staff_clinic_all" ON public.fee_set_templates
  FOR ALL TO authenticated
  USING (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist','part_lead','staff']::text[])
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist','part_lead','staff']::text[])
  );

COMMENT ON POLICY "fee_set_templates_staff_clinic_all" ON public.fee_set_templates IS
  'T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE: ungated auth_all(true) 폐쇄. '
  'per-row tenant binding(clinic_id=current_user_clinic_id()) + 승인직원 + 8직원역할(canEditStaffArea SSOT). '
  'read=write=8역할(reader⊆writer). tm/technician/미승인/타clinic 차단.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ② package_templates : ungated auth_all DROP → SPLIT(read=8역할 / write=6역할, anti-false-lockout)
--    part_lead/staff 는 결제창(Closing→PaymentDialog) read 정당 소비 → SELECT 편입 / write 미편입(임의편입 금지).
-- ══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "auth_all" ON public.package_templates;

-- (2a) READ(SELECT) = 8직원역할, clinic-scoped — part_lead/staff 결제창 read 보존(anti-false-lockout)
CREATE POLICY "package_templates_staff_read" ON public.package_templates
  FOR SELECT TO authenticated
  USING (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist','part_lead','staff']::text[])
  );

-- (2b) INSERT = 6역할(STAFF_UNLOCK / canWritePackage parity), clinic-scoped
CREATE POLICY "package_templates_staff_insert" ON public.package_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist']::text[])
  );

-- (2c) UPDATE = 6역할, clinic-scoped(USING+WITH CHECK)
CREATE POLICY "package_templates_staff_update" ON public.package_templates
  FOR UPDATE TO authenticated
  USING (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist']::text[])
  )
  WITH CHECK (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist']::text[])
  );

-- (2d) DELETE = 6역할, clinic-scoped
CREATE POLICY "package_templates_staff_delete" ON public.package_templates
  FOR DELETE TO authenticated
  USING (
    clinic_id = current_user_clinic_id()
    AND is_approved_user()
    AND current_user_role() = ANY (ARRAY['admin','manager','director','consultant','coordinator','therapist']::text[])
  );

COMMENT ON POLICY "package_templates_staff_read" ON public.package_templates IS
  'T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE: ungated auth_all(true) 폐쇄(read leg). '
  'per-row tenant binding + 승인직원 + 8직원역할(read). Closing→PaymentDialog 결제창 read = part_lead/staff 정당 소비 → SELECT 편입.';
COMMENT ON POLICY "package_templates_staff_insert" ON public.package_templates IS
  'T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE: write(insert) = 6역할(STAFF_UNLOCK/canWritePackage) + clinic bind. part_lead/staff/tm/미승인 차단.';
COMMENT ON POLICY "package_templates_staff_update" ON public.package_templates IS
  'T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE: write(update) = 6역할 + clinic bind.';
COMMENT ON POLICY "package_templates_staff_delete" ON public.package_templates IS
  'T-20260810-foot-RLS-MASTERCFG-OPENWRITE-CLOSE: write(delete) = 6역할 + clinic bind.';

-- ── (VERIFY) POSTCHECK 착지 상태 확인(실패 시 abort — 무영속) ─────────────────────
--   forbidden-predicate(true) 잔존 0 + auth_all DROP + canonical 정책 실재 + tenant-binding assertion.
--   (behavioral probe: admin CAN·비권한 CANNOT = apply-후 runtime probe → evidence 문서. 여기선 구조 assertion.)
DO $verify$
DECLARE
  v_authall     int;
  v_forbidden   int;
  v_fee_cnt     int;
  v_pkg_read    int;
  v_pkg_write   int;
  v_no_tenant   int;
BEGIN
  -- (1) auth_all 2건 제거 실증
  SELECT count(*) INTO v_authall FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('fee_set_templates','package_templates')
      AND policyname='auth_all';
  IF v_authall <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: auth_all 미제거 (count=%)', v_authall;
  END IF;

  -- (2) forbidden-predicate(true) 잔존 0 — 대상 2테이블 전 정책 qual/with_check 에 벌거벗은 true 부재
  SELECT count(*) INTO v_forbidden FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('fee_set_templates','package_templates')
      AND (lower(btrim(COALESCE(qual,''))) = 'true' OR lower(btrim(COALESCE(with_check,''))) = 'true');
  IF v_forbidden <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: forbidden-predicate(true) 잔존 (count=%)', v_forbidden;
  END IF;

  -- (3) canonical 정책 실재
  SELECT count(*) INTO v_fee_cnt FROM pg_policies
    WHERE schemaname='public' AND tablename='fee_set_templates' AND policyname='fee_set_templates_staff_clinic_all';
  IF v_fee_cnt <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: fee_set_templates canonical 정책 부재';
  END IF;
  SELECT count(*) INTO v_pkg_read FROM pg_policies
    WHERE schemaname='public' AND tablename='package_templates' AND policyname='package_templates_staff_read';
  SELECT count(*) INTO v_pkg_write FROM pg_policies
    WHERE schemaname='public' AND tablename='package_templates'
      AND policyname IN ('package_templates_staff_insert','package_templates_staff_update','package_templates_staff_delete');
  IF v_pkg_read <> 1 OR v_pkg_write <> 3 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: package_templates canonical split 정책 불완전 (read=%, write=%)', v_pkg_read, v_pkg_write;
  END IF;

  -- (4) tenant-binding assertion — 대상 2테이블 전 정책이 current_user_clinic_id() row-bind 참조(argless/own-only 회귀 방지)
  SELECT count(*) INTO v_no_tenant FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('fee_set_templates','package_templates')
      AND position('current_user_clinic_id' IN (COALESCE(qual,'') || ' ' || COALESCE(with_check,''))) = 0;
  IF v_no_tenant <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: tenant-binding(current_user_clinic_id) 미참조 정책 잔존 (count=%)', v_no_tenant;
  END IF;

  RAISE NOTICE 'VERIFY OK: auth_all DROP(2) + forbidden-predicate(true)=0 + canonical(fee 1 / pkg read1 write3) + tenant-binding 전정책 착지.';
END $verify$;
