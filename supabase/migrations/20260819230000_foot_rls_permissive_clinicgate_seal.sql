-- ============================================================================
-- T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL · UP
--   foot authenticated-도달 permissive universal-true(READ+WRITE) cross-clinic 누수 봉인.
--   umbrella T-20260723-xcrm lane(c): 문지은 대표원장 현장결정 '지점 격리(clinic-scoped)' 확정
--   → foot(2 clinics provisioned·jongno active/songdo latent) authenticated OPEN 테이블에
--     캐노니컬 §A RESTRICTIVE clinic-gate SEAL (women/scalp2/body/derm 4-fork 실증 패턴 이식).
--
--   change-class = exposure-REDUCING ADDITIVE(§A canonical):
--     permissive DROP 0 → RESTRICTIVE 신설으로 cross-clinic 도달 AND-차단.
--     데이터 mutation 0 · DDL=CREATE POLICY only · 완전가역(DROP 1줄/테이블).
--     → CEO 파괴게이트 §3.1 면제(exposure 축소·mutation0·신규 컬럼/타입/enum/테이블 0).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   Gate-B(DA) GO(SSOT §A canonical) ≠ apply 허가.
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + GO-token)
--     물리 선행 필수. GO-token 前 prod DDL 선집행 금지(apply_before_go, deploy-precheck C20).
--   표준 이식(캐노니컬 §A predicate byte-identical, 신규 테이블 편입 0) = self-derive 허용
--     (DA 재관여 불요). §C-3 미명명 PHI-인접 5테이블(health_maintenance_balances/
--     payment_audit_logs/receipt_ocr_results/claim_diagnoses/handover_notes)은 본 티켓 밖
--     → planner FOLLOWUP(DA CONSULT: 신규 테이블 편입).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ AC1 prod 재-census 확정 (READ-ONLY, 2026-08-19, 27일 경과 재실측)
--   러너: scripts/T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL_census.mjs
--   evidence: _artifacts/T-20260819-foot-RLS-SEAL_census_evidence.md
--
--   [clinics] jongno-foot=data-bearing(cust 2517/staff 70) · songdo-foot=LATENT(0/0).
--     ⇒ clinics=2 provisioned이나 data-bearing=1. 실제 cross-tenant read 대상(songdo) 데이터 0
--        → §C-3 격상(clinics>1 LIVE + 실제 wide-open cross-tenant read 확증) 2번째 conjunct 미충족
--        → P0 격상 미충족(no ESCALATE). SEAL = forward-protective + 회귀0(effective 단일 active).
--
--   [봉쇄 6테이블 · availability 게이트] — 全 clinic_id = NOT NULL 컬럼:
--     ⇒ H3(NULL 잔존 0) 구조적 보장 · H5(write-path clinic_id stamp) 구조적 보장
--       (NOT NULL이 NULL insert 거부 = app-stamp 필수). populated 2건 distinct_clinics=1(jongno) → 회귀0.
--     ① clinical_images   PHI      · auth_all ALL true             · ALL  · rows=0
--     ② consent_forms     PHI      · auth_users_all ALL true       · ALL  · rows=0
--     ③ message_logs      PHI      · message_logs_authenticated ALL· ALL  · rows=0
--     ④ service_charges   금융명세  · auth_all ALL true             · ALL  · rows=782(jongno)
--     ⑤ checklists        PHI      · auth_users_all ALL true       · ALL  · rows=0 (anon축=lane b 旣봉인)
--     ⑥ packages          금융      · packages_read SELECT true     · SELECT(§A-2 write=role-gate 非universal) · rows=931(jongno)
--     · package_payments = 旣 SEAL(package_payments_tenant_isolation, 20260810200000) → 제외.
--
-- ── grain 규칙(§A-2) ──────────────────────────────────────────────────────────
--   write가 ALL universal-true(wide-open) → ALL(USING+WITH CHECK) : ①②③④⑤
--   write가 per-command 게이트·SELECT만 universal-true → SELECT(USING) : ⑥ packages
--
-- ── clinic-anchor predicate (§A-3 캐노니컬 byte-identical) ──────────────────────
--   `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()`
--   admin bypass 유지(AC2) · current_user_clinic_id/is_admin_or_manager = SECURITY DEFINER(재귀無).
--
-- ── RESTRICTIVE 의미(왜 안전) ─────────────────────────────────────────────────
--   PG RLS: RESTRICTIVE 는 TO 명시 롤(authenticated)에만 적용 · permissive 와 AND.
--     SELECT: permissive(true) AND restrictive(own-clinic|admin) → 타clinic 행 0-row.
--     write : permissive(role) AND restrictive(own-clinic|admin, USING+CHECK) → 타clinic write 차단.
--   anon = TO authenticated 미포함 → 무영향 (AC3 anon carve-out: 셀프접수/예약/카탈로그/대기판
--     anon 경로 무파손. anon 봉쇄는 lane b T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL 별 트랙).
--   service_role = BYPASSRLS · SECURITY DEFINER RPC = definer 컨텍스트 → 무영향.
--   permissive 정책 전량 존치(ADDITIVE) → rollback = DROP restrictive 1줄/테이블.
--
--   down    : 20260819230000_foot_rls_permissive_clinicgate_seal.rollback.sql
--   dryrun  : 20260819230000_foot_rls_permissive_clinicgate_seal.dryrun.mjs (무영속·post-probe)
--   probe   : scripts/T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL_behavioral.mjs (apply 후 실효)
-- 작성: dev-foot / 2026-08-19
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + helper 실재 + H3 NULL 0 + 멱등 ────────
DO $preflight$
DECLARE
  v_tbl       text;
  v_null_rows bigint;
  v_targets   text[] := ARRAY['clinical_images','consent_forms','message_logs',
                              'service_charges','packages','checklists'];
BEGIN
  -- 대상 6테이블 실재 (wrong-DB 오적용 방지)
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY(v_targets)) <> 6 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 6테이블 중 일부 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF (SELECT count(*) FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname = ANY(v_targets) AND relrowsecurity) <> 6 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 중 RLS 미활성 테이블 존재 — restrictive 무효';
  END IF;
  -- canonical resolver 실재 (술어 의존)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — 술어 해소 불가';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — admin bypass 해소 불가';
  END IF;
  -- ★ H3 재확인(apply 시점 drift 가드): 각 테이블 clinic_id IS NULL 잔존 0 이어야 함.
  FOREACH v_tbl IN ARRAY v_targets LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE clinic_id IS NULL', v_tbl)
      INTO v_null_rows;
    IF v_null_rows <> 0 THEN
      RAISE EXCEPTION 'PREFLIGHT_FAIL: %.clinic_id IS NULL = % (>0) — 백필 선행 필요, SEAL 금지(H3 게이트)', v_tbl, v_null_rows;
    END IF;
  END LOOP;
  -- 멱등/재실행 안전: 신설 restrictive 이미 존재 시 abort (중복 CREATE 방지)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND policyname IN ('clinical_images_clinic_gate_restrict',
                                  'consent_forms_clinic_gate_restrict',
                                  'message_logs_clinic_gate_restrict',
                                  'service_charges_clinic_gate_restrict',
                                  'checklists_clinic_gate_restrict',
                                  'packages_clinic_read_restrict')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 신설 restrictive 정책 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ① clinical_images (PHI) : RESTRICTIVE ALL clinic-gate (wide-open write auth_all 존치)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "clinical_images_clinic_gate_restrict" ON public.clinical_images
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "clinical_images_clinic_gate_restrict" ON public.clinical_images IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic 격리(ADDITIVE RESTRICTIVE §A). '
  'permissive 존치·AND-차단(own-clinic|admin read+write). anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ② consent_forms (PHI)
CREATE POLICY "consent_forms_clinic_gate_restrict" ON public.consent_forms
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "consent_forms_clinic_gate_restrict" ON public.consent_forms IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic 격리(ADDITIVE RESTRICTIVE §A). '
  'permissive 존치·AND-차단. anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ③ message_logs (PHI)
CREATE POLICY "message_logs_clinic_gate_restrict" ON public.message_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "message_logs_clinic_gate_restrict" ON public.message_logs IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic 격리(ADDITIVE RESTRICTIVE §A). '
  'permissive 존치·AND-차단. anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ④ service_charges (금융/매출명세) — rows=782(jongno) 회귀0
CREATE POLICY "service_charges_clinic_gate_restrict" ON public.service_charges
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "service_charges_clinic_gate_restrict" ON public.service_charges IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic 매출명세 격리(ADDITIVE RESTRICTIVE §A). '
  'permissive 존치·AND-차단. clinic_id NOT NULL(H3/H5 보장)·distinct=1(jongno). rollback=DROP 1줄.';

-- ⑤ checklists (PHI 사전체크리스트) — authenticated 축(anon 축은 lane b 旣봉인)
CREATE POLICY "checklists_clinic_gate_restrict" ON public.checklists
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "checklists_clinic_gate_restrict" ON public.checklists IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic 격리(ADDITIVE RESTRICTIVE §A, authenticated 축). '
  'anon 축=T-20260810 anon-deny 旣봉인. permissive 존치·AND-차단. SECDEF 셀프체크인 RPC 무영향. rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ⑥ packages (금융) : RESTRICTIVE SELECT clinic-gate (§A-2 write=role-gate 非universal → SELECT)
--    read 누수만 봉쇄. write(role-gate)는 universal-true 아님 → 본 SEAL fingerprint 밖.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "packages_clinic_read_restrict" ON public.packages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "packages_clinic_read_restrict" ON public.packages IS
  'T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL: cross-clinic read 격리(ADDITIVE RESTRICTIVE SELECT §A-2). '
  'packages_read(true) AND-차단. write=role-gate(非universal)→SELECT-only grain. clinic_id NOT NULL·distinct=1(jongno). rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_all_cnt    int;
  v_sel_cnt    int;
  v_bad_pred   int;
  v_permissive int;
BEGIN
  -- (1) ALL-grain 5건: RESTRICTIVE + authenticated + ALL + USING & WITH CHECK 둘 다 canonical
  SELECT count(*) INTO v_all_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('clinical_images_clinic_gate_restrict','consent_forms_clinic_gate_restrict',
                           'message_logs_clinic_gate_restrict','service_charges_clinic_gate_restrict',
                           'checklists_clinic_gate_restrict')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='ALL'
     AND po.polqual IS NOT NULL AND po.polwithcheck IS NOT NULL
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%is_admin_or_manager()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_all_cnt <> 5 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ALL-grain restrictive 5건 canonical 매칭 실패 (count=%)', v_all_cnt;
  END IF;

  -- (2) SELECT-grain 1건(packages): RESTRICTIVE + authenticated + SELECT + USING canonical
  SELECT count(*) INTO v_sel_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public' AND pp.policyname='packages_clinic_read_restrict'
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='SELECT'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_sel_cnt <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: packages SELECT-grain restrictive canonical 매칭 실패 (count=%)', v_sel_cnt;
  END IF;

  -- (3) ADDITIVE 불변식: 봉쇄대상 permissive universal-true 정책 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
   WHERE schemaname='public'
     AND ( (tablename='clinical_images' AND policyname='auth_all')
        OR (tablename='consent_forms'   AND policyname='auth_users_all')
        OR (tablename='message_logs'    AND policyname='message_logs_authenticated')
        OR (tablename='service_charges' AND policyname='auth_all')
        OR (tablename='checklists'      AND policyname='auth_users_all')
        OR (tablename='packages'        AND policyname='packages_read') );
  IF v_permissive <> 6 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive universal-true 정책 DROP됨 (count=%, 기대 6)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: RESTRICTIVE clinic-gate ALL=5 + SELECT=1 신설(canonical §A predicate) + permissive 6종 존치(ADDITIVE).';
END $verify$;
