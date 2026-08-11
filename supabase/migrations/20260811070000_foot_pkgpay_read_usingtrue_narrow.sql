-- ============================================================================
-- T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW · UP
--   foot package_payments_read RLS `USING (true)` → `USING (is_approved_user())` narrow.
--   cross_crm_data_contract §38 census-first disposition hygiene D1.
--   부모 T-20260716-cross-crm-FINANCE-READ-ROLEGATE-STD(done).
--
--   문제: package_payments_read permissive SELECT = USING(true) → 任 authenticated(비-승인
--     스태프 포함)이 package_payments(재무-PII) read. foot 자기 payments floor
--     (is_approved_user() AND clinic_id=current_user_clinic_id()) 및 sibling(body/scalp2/
--     women) 대비 over-open OUTLIER.
--     ※ package_payments 에는 이미 canonical `package_payments_approved_read`
--        (USING is_approved_user()) 가 병존하나, permissive 정책은 OR 결합이라
--        `USING(true)` 가 그 위를 덮어 narrow 를 moot 화한다(effective read = true).
--
--   해법: outlier `package_payments_read` 술어를 is_approved_user() 로 narrow(in-place
--     DROP+CREATE). RESTRICTIVE tenant-isolation(clinic_id, 20260810200000) 은 UNCHANGED
--     → effective read floor = is_approved_user() AND clinic_id=current_user_clinic_id()
--     = payments sibling(payments_read) 및 body/scalp2/women 과 byte-parity.
--     = outlier→canonical 정렬(role-floor narrowing 아님·availability 회귀 0).
--     narrow 후 package_payments_read ≡ package_payments_approved_read(중복 무해·OR 등가·
--     sibling payments 의 payments_read≡payments_approved_read 중복 shape 과 동형).
--
--   change-class = exposure-REDUCING(§72): permissive 술어 true→is_approved_user()
--     (신규 컬럼/테이블/enum 0 · 데이터 mutation 0 · DROP=자기 정책 in-place 재정의).
--     완전가역(rollback = USING true 로 복원). → CEO/legal 인간게이트 불요
--     (DA §38-4 명시: exposure-REDUCING outlier 정렬 · 승인 스태프=현 프로비저닝 데스크 전원).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   census-gate(착수 前 READ-ONLY, prod 2026-08-11): PASS.
--     러너: scripts/T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW_census.mjs
--     [C1 before-image] package_payments 정책 = {tenant_isolation RESTRICTIVE(clinic_id),
--        approved_read is_approved_user(), read USING(true)←OUTLIER, admin_all, write, ...}.
--     [C2/C3 delta] narrow 후 read 상실 principal = is_approved_user()=false 집합 = 12행,
--        전건 active=false(비활성/오프보딩 계정). approved=false AND active=true(활성-미승인
--        현업 스태프) = 0 건 → **legit 비-승인 consumer 부재**(availability 회귀 0).
--     [C4 secdef bypass] package_payments read 하는 refund/record/recompute/delete RPC =
--        전건 SECURITY DEFINER owner=postgres → RLS bypass → narrow 무영향.
--     [C5 anon] TO anon 정책 0 → narrow 직교(무관).
--     [C6 sibling] payments_read = is_approved_user() AND clinic_id → canonical target 확증.
--   ⚠ DROP/CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + 물리
--     GO-token) 선행 필수(AC-1). GO-token 前 prod DDL 선집행 금지(deploy-precheck C20/apply_before_go).
--     DA §38 GO = change-class/술어 승인일 뿐 ≠ apply 허가.
--
--   down   : 20260811070000_foot_pkgpay_read_usingtrue_narrow.rollback.sql
--   dryrun : 20260811070000_foot_pkgpay_read_usingtrue_narrow.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-11
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + 술어함수 실재 + 현행 USING(true) drift + tenant 존치 ──
DO $preflight$
DECLARE
  v_using text;
  v_tenant int;
BEGIN
  -- 대상 실재 (wrong-DB 오적용 방지)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='package_payments') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제
  IF NOT (SELECT relrowsecurity FROM pg_class
            WHERE relname='package_payments' AND relnamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments RLS 미활성';
  END IF;
  -- 술어 함수 실재 (narrow 술어 해소 불가 방지)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_approved_user') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_approved_user() 부재 — narrow 술어 해소 불가';
  END IF;
  -- current_user_clinic_id (RESTRICTIVE tenant 술어 의존) 실재
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재';
  END IF;
  -- 대상 정책 실재
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='package_payments' AND policyname='package_payments_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments_read 정책 부재';
  END IF;
  -- ★ drift/멱등 가드: 현행 술어가 반드시 'true' 여야 함. 이미 is_approved_user() 면 재적용 abort.
  SELECT pg_get_expr(polqual, polrelid) INTO v_using
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polname='package_payments_read';
  IF v_using IS NULL OR btrim(v_using) <> 'true' THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_payments_read 현행 USING <> true (=%): 이미 narrow 됐거나 예상 밖 술어 — 재적용 abort', v_using;
  END IF;
  -- RESTRICTIVE tenant-isolation 존치 확인(clinic 격리 축 보존 전제 — 이 축은 UNCHANGED)
  SELECT count(*) INTO v_tenant FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_tenant_isolation' AND permissive='RESTRICTIVE';
  IF v_tenant <> 1 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: RESTRICTIVE tenant_isolation 부재/중복(count=%) — clinic 격리 전제 붕괴, narrow 보류', v_tenant;
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- narrow : package_payments_read `USING (true)` → `USING (is_approved_user())`
--   in-place 재정의(DROP self + CREATE). clinic 격리 = RESTRICTIVE tenant_isolation(무접촉).
-- ══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "package_payments_read" ON public.package_payments;

CREATE POLICY "package_payments_read" ON public.package_payments
  FOR SELECT TO authenticated
  USING (is_approved_user());

COMMENT ON POLICY "package_payments_read" ON public.package_payments IS
  'T-20260811-foot-PKGPAY-READ-USINGTRUE-NARROW: over-open USING(true) → is_approved_user() narrow '
  '(census-first §38 D1 · exposure-REDUCING outlier→canonical 정렬). clinic 격리=RESTRICTIVE '
  'tenant_isolation(UNCHANGED). effective read floor = is_approved_user() AND own-clinic '
  '= payments sibling parity. census: 비-승인 read-loser 전건 active=false(legit consumer 0).';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_using       text;
  v_trueperm    int;
  v_tenant      int;
  v_approved    int;
BEGIN
  -- (1) package_payments_read 가 is_approved_user() SELECT/authenticated 로 재정의됨
  SELECT pg_get_expr(polqual, polrelid) INTO v_using
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polname='package_payments_read';
  IF v_using IS NULL OR v_using NOT LIKE '%is_approved_user()%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: package_payments_read 술어 is_approved_user() 미포함 (=%)', v_using;
  END IF;
  IF v_using LIKE '%true%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: package_payments_read 술어에 잔여 true (=%)', v_using;
  END IF;

  -- (2) ★핵심: package_payments 에 USING(true) permissive SELECT 정책 잔존 0 (outlier 봉인)
  SELECT count(*) INTO v_trueperm FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='package_payments' AND po.polpermissive
      AND po.polcmd IN ('r','*')            -- SELECT or ALL
      AND btrim(coalesce(pg_get_expr(po.polqual, po.polrelid),'')) = 'true';
  IF v_trueperm <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: USING(true) permissive read 잔존 (count=%) — narrow 무의미', v_trueperm;
  END IF;

  -- (3) 불변식: RESTRICTIVE tenant_isolation 존치(clinic 격리 축 무접촉)
  SELECT count(*) INTO v_tenant FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_tenant_isolation' AND permissive='RESTRICTIVE';
  IF v_tenant <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: RESTRICTIVE tenant_isolation 훼손 (count=%)', v_tenant;
  END IF;

  -- (4) canonical approved_read 존치(중복 무해·OR 등가) — 삭제 안 됨 실증
  SELECT count(*) INTO v_approved FROM pg_policies
    WHERE schemaname='public' AND tablename='package_payments'
      AND policyname='package_payments_approved_read';
  IF v_approved <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: package_payments_approved_read 훼손 (count=%)', v_approved;
  END IF;

  RAISE NOTICE 'VERIFY OK: package_payments_read = is_approved_user() · USING(true) permissive 0 · RESTRICTIVE tenant 존치 · approved_read 존치.';
END $verify$;
