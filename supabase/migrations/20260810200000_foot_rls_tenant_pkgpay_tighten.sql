-- ============================================================================
-- DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN · UP
--   foot package_payments cross-clinic tenant 격리 봉인 — RESTRICTIVE overlay.
--   B4 arm(부모 triage §64): 'ADDITIVE clinic_id RESTRICTIVE tighten'.
--   v4.27 anon-deny(TO anon) 과 대칭인 authenticated cross-clinic 축(TO authenticated).
--
--   change-class = exposure-REDUCING ADDITIVE(§72): permissive DROP 0 → RESTRICTIVE
--     신설으로 cross-clinic 도달 AND-차단. 데이터 mutation 0 · DROP 0. 완전가역(DROP 1줄).
--     → CEO 파괴게이트 §3.1 면제(exposure 축소·mutation0).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   DA verdict = 조건부 GO (SSOT: agents/docs/da_replies/da_decision_foot_rls_tenant_pkgpay_tighten_20260810.md).
--   DA GO = change-class/술어 판정만 · apply 허가 아님 (물리 GO-token = 배포 SSOT).
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + GO-token)
--     물리 선행 필수(AC-1). GO-token 前 prod DDL 선집행 금지(deploy-precheck C20).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ availability 선결 census HARD 3항 (H3/H4/H5) — 착수 前 실측 완료 (prod, 2026-08-10)
--   러너: scripts/DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN_census.mjs (READ-ONLY)
--
--   [H3 행측 NULL census] package_payments: total=169, clinic_id IS NULL = 0, distinct_clinics=1.
--       ⇒ NULL 잔존 0 → 백필 leg 불요(H3 PASS). RESTRICTIVE apply 게이트 통과.
--   [H4a active staff clinic_id non-NULL] user_profiles: total=67, clinic_id IS NULL = 1.
--       NULL staff = 이승준(coordinator, active=false·approved=false) → active+approved NULL-clinic = 0.
--       ⇒ 정당(활성·승인) staff 全 own-clinic non-NULL → own-clinic 0-row 잠금 위험 0. (비활성 1건=별건 roster, 비차단)
--   [H4b cross-clinic principal] is_clinic_owner()/is_clinic_admin() 함수 부재 · owner/hq role 부재 ·
--       clinics 2행(jongno-foot 활성 / songdo-foot 空=LATENT) 이나 전 staff·전 payment = 단일 clinic.
--       ⇒ 정당 cross-clinic principal 없음 → 술어 = bare `clinic_id = current_user_clinic_id()`
--          (is_clinic_owner OR … 확장 불요). songdo 활성화 시 본 정책이 곧 forward 격리 봉인.
--   [H5 write-path stamp] package_payments.clinic_id: column_default=NULL · clinic_id-stamp 트리거 부재
--       (BEFORE INSERT 트리거 2종=sim_stamp/accounting_date, clinic_id 미접촉) BUT app-stamp 보편:
--       FE 전 INSERT 경로(PaymentDialog / manualPaymentWritePath / RPC)가 clinic_id 명시 stamp
--       (`checkIn.clinic_id`/`clinicId`) + 169행/NULL 0 = app-stamp 보편성 실증.
--       ⇒ H5 satisfied(app stamp) → 기본권장 FOR ALL(read+write 원자봉인) 채택. (FOR SELECT 폴백 불요)
--
-- ── RESTRICTIVE tenant-isolation 의미(왜 안전) ────────────────────────────────────
--   PG RLS: RESTRICTIVE 정책은 TO 명시 롤(authenticated)에만 적용 · permissive 와 AND.
--     · SELECT: permissive(approved/true) AND restrictive(own-clinic) → 타 clinic 행 0-row.
--     · INSERT/UPDATE/DELETE: permissive write AND restrictive(own-clinic, USING+WITH CHECK)
--       → 타 clinic 대상 write 차단 · own-clinic 지속.
--   anon = TO authenticated 미포함 → 무영향. service_role = BYPASSRLS → 무영향.
--   SECURITY DEFINER 함수(refund/record RPC, owner=postgres) = definer 컨텍스트 → 무영향.
--   permissive 정책 6종 전량 존치(ADDITIVE) → rollback = DROP restrictive 1줄.
--
--   down    : 20260810200000_foot_rls_tenant_pkgpay_tighten.rollback.sql
--   dryrun  : 20260810200000_foot_rls_tenant_pkgpay_tighten.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-10
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + H3 NULL 0 재확인 + before-image + 멱등 ──
DO $preflight$
DECLARE
  v_null_rows int;
BEGIN
  -- 대상 실재 (wrong-DB 오적용 방지)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='package_payments') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF NOT (SELECT relrowsecurity FROM pg_class
            WHERE relname='package_payments' AND relnamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments RLS 미활성 — restrictive 무효';
  END IF;
  -- ★ H3 재확인(apply 시점 drift 가드): clinic_id IS NULL 잔존 0 이어야 함.
  SELECT count(*) INTO v_null_rows FROM package_payments WHERE clinic_id IS NULL;
  IF v_null_rows <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments.clinic_id IS NULL = % (>0) — 백필 선행 leg 필요, RESTRICTIVE apply 금지(H3 게이트)', v_null_rows;
  END IF;
  -- before-image: canonical resolver 실재 (술어 의존)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — 술어 해소 불가';
  END IF;
  -- 멱등/재실행 안전: 이미 restrictive 존재 시 abort (중복 CREATE 방지)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND tablename='package_payments'
               AND policyname='package_payments_tenant_isolation') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments_tenant_isolation 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- RESTRICTIVE tenant-isolation : cross-clinic 도달 AND-차단
--   H1 canonical 술어 byte-identical (sibling 200-use `clinic_id = current_user_clinic_id()`)
--   H2 AS RESTRICTIVE FOR ALL TO authenticated + USING AND WITH CHECK 둘 다
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "package_payments_tenant_isolation" ON public.package_payments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (clinic_id = current_user_clinic_id())
  WITH CHECK (clinic_id = current_user_clinic_id());

COMMENT ON POLICY "package_payments_tenant_isolation" ON public.package_payments IS
  'DA-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN: cross-clinic tenant 격리(ADDITIVE RESTRICTIVE). '
  'permissive 6종 존치·AND-차단(own-clinic read+write only). anon/service_role/SECDEF 무영향. '
  'census: H3 NULL 0 · H4b bare(cross-clinic principal 부재) · H5 app-stamp(FOR ALL). rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_restrictive int;
  v_permissive  int;
  v_using       text;
  v_check       text;
BEGIN
  -- (1) restrictive 정책 실재 + RESTRICTIVE + TO authenticated 정확 매칭
  SELECT count(*) INTO v_restrictive FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_tenant_isolation'
      AND permissive='RESTRICTIVE'
      AND roles::text = '{authenticated}'
      AND cmd='ALL';
  IF v_restrictive <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: tenant-isolation restrictive/authenticated/ALL 매칭 실패 (count=%)', v_restrictive;
  END IF;

  -- (2) USING AND WITH CHECK 둘 다 canonical 술어(H2 — 한쪽 누락=silent leak)
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polname='package_payments_tenant_isolation';
  IF v_using IS NULL OR v_check IS NULL THEN
    RAISE EXCEPTION 'VERIFY_FAIL: USING/WITH CHECK 한쪽 이상 NULL (using=%, check=%) — silent leak', v_using, v_check;
  END IF;
  IF v_using NOT LIKE '%current_user_clinic_id()%' OR v_check NOT LIKE '%current_user_clinic_id()%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: canonical 술어 미포함 (using=%, check=%)', v_using, v_check;
  END IF;

  -- (3) ADDITIVE 불변식: 기존 permissive 정책 존치(DROP 0) — 6종 이상
  SELECT count(*) INTO v_permissive FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments' AND permissive='PERMISSIVE';
  IF v_permissive < 6 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive 정책 DROP됨 (count=% , 기대 >=6)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: tenant-isolation RESTRICTIVE(authenticated,ALL,USING+CHECK canonical) 신설 + permissive % 종 존치(ADDITIVE).', v_permissive;
END $verify$;
