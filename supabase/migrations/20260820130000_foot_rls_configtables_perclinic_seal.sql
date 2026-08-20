-- ============================================================================
-- T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE · UP
--   부모: T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (§C-4 governance leg 해소분)
--   config 3테이블 애매분(§C-4 governance) → 현장 결정으로 전부 (A) per-clinic 격리 확정
--     → RESTRICTIVE clinic-gate seal (§A-3 direct anchor·census-gated). 부모 seal-set 편입.
--
--   현장 결정: 김주연 총괄 "지점마다 다르지" (slack reply ts 1787181267.196129)
--     → form_templates · treatment_sets · code_availability 전부 (A) 지점별 격리.
--
--   DA SSOT: da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md §C-4 / Q2 3-way
--            (부모 da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md §A/§C)
--   census : _artifacts/T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE_census_evidence.md
--            (러너 scripts/T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE_census_readonly.mjs, 2026-08-20 prod)
--
--   change-class = exposure-REDUCING ADDITIVE(§A canonical):
--     permissive DROP 0 → RESTRICTIVE 신설으로 cross-clinic 도달 AND-차단.
--     데이터 mutation 0 · DDL=CREATE POLICY only · 완전가역(DROP 1줄/정책).
--     → CEO 파괴게이트 §3.1 면제(exposure 축소·mutation0·신규 컬럼/타입/enum/테이블 0).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   현장 결정(A 격리) ≠ apply 허가.
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + GO-token)
--     물리 선행 필수(AC-1 불변, apply-gate=supervisor NOT DA). GO-token 前 prod DDL
--     선집행 금지(apply_before_go, deploy-precheck C20). 부모 SEAL lane 과 동일 foot RLS
--     lane → supervisor 가 GO-token 발행 순서 조정(부모 seal-set 정합 유지).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ per-table READ-ONLY census 확정 (2026-08-20 prod, WRITE0/DDL0)
--   [clinics] jongno-foot=data-bearing(2520/70) · songdo-foot=LATENT(0/0)
--     → 실 cross-tenant read 대상 부재 = P0 미충족·forward-protective·회귀0(effective 단일 active).
--   [helper] current_user_clinic_id()=uuid SECDEF · is_admin_or_manager()=bool SECDEF (실재).
--
--   ── (A) config per-clinic seal (direct clinic_id anchor §A-3) ──
--     ① form_templates    · clinic_id uuid NOT NULL 0/35(distinct1) · offending `form_templates_read`(SELECT public true)
--          write=admin-gated(`form_templates_admin_all` is_admin_or_manager()), 非admin write permissive 0 → 노출축=read
--          → **SELECT read-seal**(§A-2 write 非universal-true·room_role_mapping 선례 동형).
--     ② treatment_sets    · clinic_id uuid **NULLABLE** 0NULL/2(distinct1) · offending `authenticated_all_treatment_sets`(ALL true)
--          write wide-open(ALL true) → **ALL**(USING+WITH CHECK). FE insert `clinic_id: clinicId` 항상 stamp(TreatmentSetsTab.tsx:211)
--          + 실 writer={admin,manager}(is_admin_or_manager bypass) → WITH CHECK 무lockout.
--          ⚠ nullable → PREFLIGHT NULL=0 재확인 가드(H3 silent lockout 금지).
--     ③ code_availability · clinic_id uuid NOT NULL 0/2(distinct2) · offending `code_availability_select`(SELECT {anon,auth} true)
--          write permissive 0(authenticated write RLS 차단) → 노출축=read → **SELECT read-seal**.
--          anon = `code_availability_anon_deny`(부모 leg2) 旣봉인.
--          ⚠ 실효성 낮음: 실 read=SECDEF RPC `get_inflow_channels`(useInflowChannels.ts:35)=RLS-immune
--            → seal 은 hypothetical 직접-client-read(소비자 0) 에만 작동 = **방어심층**(총괄 결정=격리 → 착지).
--
--   ── 범위 밖(census evidence 기록) ──
--     quick_rx_buttons(0행)=deferred 유지(rows>0 시 재census, 본 seal 대상 아님).
--     anon 축 = 부모 leg 旣봉쇄(form_templates_anon_deny·code_availability_anon_deny) — 본 leg=authenticated per-clinic 격리만.
--
-- ── clinic-anchor predicate (§A-3 캐노니컬 byte-identical) ──────────────────────
--   `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()`
--   ⚠️ admin bypass = is_admin_or_manager()(foot 캐노니컬) · crm get_user_role()='admin' 미사용.
--
-- ── RESTRICTIVE 의미(왜 안전) ─────────────────────────────────────────────────
--   PG RLS: RESTRICTIVE 는 TO 명시 롤에만 적용 · permissive 와 AND.
--     clinic-gate(TO authenticated): permissive(true) AND restrictive(own|admin) → 타clinic 0-row.
--       ALL(treatment_sets): write permissive(true) AND restrictive(own|admin, USING+CHECK) → 타clinic write 차단.
--       SELECT(form_templates·code_availability): read permissive(true) AND restrictive(own|admin) → 타clinic read 차단.
--   anon = TO 롤 미포함 → 무영향(각 테이블 anon_deny 별도 존치).
--   service_role=BYPASSRLS · SECURITY DEFINER RPC=definer 컨텍스트 → 무영향.
--   permissive 전량 존치(ADDITIVE) → rollback = DROP restrictive 1줄/정책.
--
--   down    : 20260820130000_foot_rls_configtables_perclinic_seal.rollback.sql
--   dryrun  : 20260820130000_foot_rls_configtables_perclinic_seal.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-20
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + helper 실재 + H3 NULL 0 + 멱등 ────────
DO $preflight$
DECLARE
  v_tbl       text;
  v_null_rows bigint;
  -- clinic-gate 대상 3테이블(NULL clinic_id 잔존 0 이어야 함)
  v_gate_tbls text[] := ARRAY['form_templates','treatment_sets','code_availability'];
BEGIN
  -- 대상 3테이블 실재 (wrong-DB 오적용 방지)
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY(v_gate_tbls)) <> 3 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 3테이블 중 일부 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF (SELECT count(*) FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname = ANY(v_gate_tbls) AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 중 RLS 미활성 테이블 존재 — restrictive 무효';
  END IF;
  -- canonical resolver 실재 (clinic-gate 술어 의존)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — 술어 해소 불가';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — admin bypass 해소 불가';
  END IF;
  -- ★ H3 재확인(apply 시점 drift 가드): 3테이블 각 clinic_id IS NULL 잔존 0.
  --   (silent lockout 금지 — NULL 발생 시 백필/재census 선행 후 재적용. 특히 treatment_sets=nullable)
  FOREACH v_tbl IN ARRAY v_gate_tbls LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE clinic_id IS NULL', v_tbl)
      INTO v_null_rows;
    IF v_null_rows <> 0 THEN
      RAISE EXCEPTION 'PREFLIGHT_FAIL: %.clinic_id IS NULL = % (>0) — 백필/재census 선행 필요, SEAL 금지(H3 게이트)', v_tbl, v_null_rows;
    END IF;
  END LOOP;
  -- 멱등/재실행 안전: 신설 정책 이미 존재 시 abort (중복 CREATE 방지)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND policyname IN ('form_templates_clinic_read_restrict',
                                  'treatment_sets_clinic_gate_restrict',
                                  'code_availability_clinic_read_restrict')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 신설 정책 이미 존재 — 재적용 abort';
  END IF;
  -- offending permissive 실재 재확인(blind seal 금지·ADDITIVE 전제)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='form_templates'    AND policyname='form_templates_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: form_templates_read(offending permissive) 부재 — census drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='treatment_sets'    AND policyname='authenticated_all_treatment_sets') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: authenticated_all_treatment_sets(offending permissive) 부재 — census drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='code_availability' AND policyname='code_availability_select') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: code_availability_select(offending permissive) 부재 — census drift';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- (A) config per-clinic seal (direct clinic_id anchor §A-3)
-- ══════════════════════════════════════════════════════════════════════════════

-- ① form_templates : RESTRICTIVE SELECT clinic-gate (read-seal · write=admin-gated → SELECT grain)
CREATE POLICY "form_templates_clinic_read_restrict" ON public.form_templates
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "form_templates_clinic_read_restrict" ON public.form_templates IS
  'T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE(§C-4 A·현장결정 per-clinic 격리): cross-clinic 서식템플릿 read 격리(ADDITIVE RESTRICTIVE SELECT §A-2). '
  'form_templates_read(public true) AND-차단(own-clinic|admin read). write=form_templates_admin_all(admin-gate) 무영향. clinic_id NOT NULL. anon=旣 form_templates_anon_deny. rollback=DROP 1줄.';

-- ② treatment_sets : RESTRICTIVE ALL clinic-gate (write wide-open → ALL USING+WITH CHECK)
CREATE POLICY "treatment_sets_clinic_gate_restrict" ON public.treatment_sets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "treatment_sets_clinic_gate_restrict" ON public.treatment_sets IS
  'T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE(§C-4 A·현장결정 per-clinic 격리): cross-clinic 진료세트 격리(ADDITIVE RESTRICTIVE ALL §A). '
  'authenticated_all_treatment_sets(ALL true) AND-차단(own-clinic|admin read+write). FE insert clinic_id stamp(TreatmentSetsTab.tsx:211)·writer={admin,manager} bypass. clinic_id nullable→PREFLIGHT NULL=0 가드. rollback=DROP 1줄.';

-- ③ code_availability : RESTRICTIVE SELECT clinic-gate (read-seal · write permissive 0 → SELECT · 방어심층)
CREATE POLICY "code_availability_clinic_read_restrict" ON public.code_availability
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "code_availability_clinic_read_restrict" ON public.code_availability IS
  'T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE(§C-4 A·현장결정 per-clinic 격리): cross-clinic code_availability read 격리(ADDITIVE RESTRICTIVE SELECT §A-2·방어심층). '
  'code_availability_select({anon,auth} true) 中 authenticated AND-차단. 실 read=SECDEF RPC get_inflow_channels=RLS-immune(실효성 낮음·방어심층). write permissive 0. clinic_id NOT NULL. anon=旣 code_availability_anon_deny. rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_all_cnt    int;  -- ALL-grain clinic-gate restrictive (treatment_sets)
  v_sel_cnt    int;  -- SELECT-grain clinic-gate restrictive (form_templates·code_availability)
  v_permissive int;  -- ADDITIVE 불변식(offending permissive 존치)
BEGIN
  -- (1) ALL-grain 1건(treatment_sets): RESTRICTIVE + authenticated + ALL + USING & WITH CHECK canonical
  SELECT count(*) INTO v_all_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('treatment_sets_clinic_gate_restrict')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='ALL'
     AND po.polqual IS NOT NULL AND po.polwithcheck IS NOT NULL
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%is_admin_or_manager()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_all_cnt <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ALL-grain restrictive 1건(treatment_sets) canonical 매칭 실패 (count=%)', v_all_cnt;
  END IF;

  -- (2) SELECT-grain 2건(form_templates·code_availability): RESTRICTIVE + authenticated + SELECT + USING canonical
  SELECT count(*) INTO v_sel_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('form_templates_clinic_read_restrict','code_availability_clinic_read_restrict')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='SELECT'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_sel_cnt <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: SELECT-grain restrictive 2건 canonical 매칭 실패 (count=%)', v_sel_cnt;
  END IF;

  -- (3) ADDITIVE 불변식: 봉쇄대상 offending permissive universal-true 정책 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
   WHERE schemaname='public'
     AND ( (tablename='form_templates'    AND policyname='form_templates_read')
        OR (tablename='treatment_sets'    AND policyname='authenticated_all_treatment_sets')
        OR (tablename='code_availability' AND policyname='code_availability_select') );
  IF v_permissive <> 3 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive 정책 DROP됨 (count=%, 기대 3)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: RESTRICTIVE ALL=1(treatment_sets) + SELECT=2(form_templates·code_availability) 신설(canonical) + offending permissive 3종 존치(ADDITIVE).';
END $verify$;
