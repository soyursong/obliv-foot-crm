-- ============================================================================
-- T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL · UP
--   foot timer_records cross-clinic tenant 격리 봉인 — text-side cast RESTRICTIVE.
--   leg2 잔여 ①(부모 T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL EXCLUDE 2건 중).
--
--   DA SSOT: agents/docs/da_replies/da_decision_foot_rls_newtables_residual_timer_waiting_20260820.md (①)
--   부모 SSOT: da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md (§A ADDITIVE RESTRICTIVE)
--   canonical 형제: 20260810200000_foot_rls_tenant_pkgpay_tighten.sql (RESTRICTIVE overlay).
--
-- ── ① timer_records anchor-축 anomaly = clinic_id 컬럼 타입 TEXT ──────────────────
--   DA verdict = (a) text-side cast-predicate = CANONICAL(no-schema-change·ADDITIVE RESTRICTIVE).
--     canonical 술어 = `clinic_id = current_user_clinic_id()::text OR is_admin_or_manager()`.
--   ⚠ H2: uuid-side cast `clinic_id::uuid` 금지 — malformed TEXT 면 query-time 22P02 raise
--     (RLS 평가 중 예외 → read 자체 실패). text-side(current_user_clinic_id()::text)만 canonical
--     → text↔text 비교로 예외 무발생. (b) TEXT→uuid ALTER TYPE = REJECT(691행 populated·비가역·DECOUPLE).
--   admin bypass = is_admin_or_manager()(foot 캐노니컬). crm get_user_role()='admin' 오용 금지.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ dispositive READ-ONLY census (dev-foot·apply 前·load-bearing·WRITE 0·DDL 0)
--   러너: scripts/T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL_census_readonly.mjs (prod, 2026-08-20)
--
--   [T1_count]     timer_records: total=691 · clinic_id NULL=0 · empty=0 · distinct=1.
--   [T1_distinct]  단일 distinct clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8' · is_valid_uuid_shape=TRUE.
--   [T1_clinics]   clinics: jongno-foot id = 74967aea-…-930bc8 (timer_rows=691) / songdo-foot (timer_rows=0·LATENT).
--   [T1_dispositive] 691/691 행이 clinic uuid(text)로 resolve · 691/691 이 jongno 로 resolve.
--       ⇒ ★(i) valid-uuid-string == jongno clinic_id(text) → text-side cast 가 jongno staff 691행
--         전건 TRUE → clean seal · lockout 0 = GO 경로. (H1 (ii)slug-lockout·(iii)NULL 배제됨.)
--   [T1_policies]  offending permissive 3종 실재(blind 금지 해소): SELECT USING(true)·INSERT WITH CHECK(true)·
--       UPDATE USING(true)+WITH CHECK(true). ⇒ write WIDE-OPEN → grain=FOR ALL(USING+WITH CHECK 둘 다·§A-2).
--   [T1_rls_enabled] timer_records RLS ENABLE=true(RESTRICTIVE 유효 전제 충족).
--   [T1_helpers]   current_user_clinic_id()→uuid · is_admin_or_manager()→boolean 실재(술어 해소 가능).
--
-- ── ② waiting_board (leg2 잔여 2번째) = 본 마이그 대상 아님 ────────────────────────
--   census(W2): 컬럼 8종 = id/clinic_id/queue_number/room/status/display_name/checked_in_at/updated_at.
--     PHI-named cols=0 · display_name 90/90 마스킹 실증(unmasked 0) · distinct_clinics=1(jongno-only).
--   ⇒ operational-display(zero-PII sanitized projection·by design) → DA (a) DEFER 수용(tracked-informational).
--     authenticated-seal-in-isolation = anon superset(공개 대기현황판) 하에서 confidentiality NO-OP.
--     현 단일-clinic public = legit. songdo 활성 시 cross-clinic anon leak = material trigger(planner tracked).
--   ⇒ waiting_board = seal 미대상 = 본 마이그 NO-OP(DDL 0). (§13.1.C premise-correction: (C)anon-leak
--     bucket 에서 carve-out → 'anon-intended-open'.)
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   DA verdict = (a) cast-predicate CANONICAL (change-class = exposure-REDUCING ADDITIVE).
--   DA GO = anchor/grain/change-class 판정만 · apply 허가 아님 (물리 GO-token = 배포 SSOT).
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님(AC-1) → supervisor DB-GATE(DDL-diff + 물리 GO-token)
--     선행 필수. 'cast=no-schema-change'/'read-seal'/'db_change' ≠ apply-gate 면제.
--     GO-token 前 prod DDL 선집행 금지(deploy-precheck C20 go_token_violation).
--
-- ── RESTRICTIVE tenant-isolation 의미(왜 안전·형제 pkgpay 동형) ──────────────────
--   PG RLS: RESTRICTIVE 는 TO authenticated 에만 적용 · permissive 3종과 AND.
--     · SELECT: permissive(true) AND restrictive(own-clinic OR admin) → 타 clinic 행 0-row.
--     · INSERT/UPDATE: permissive(true) AND restrictive(own-clinic OR admin, USING+WITH CHECK)
--       → 타 clinic 대상 write 차단 · own-clinic(jongno 691행) 지속.
--   anon = TO authenticated 미포함 → 무영향. service_role = BYPASSRLS → 무영향.
--   SECURITY DEFINER 함수(owner=postgres) = definer 컨텍스트 → 무영향.
--   permissive 3종 전량 존치(ADDITIVE) → rollback = DROP restrictive 1줄.
--
--   down    : 20260820120000_foot_timer_records_tenant_seal.rollback.sql
--   dryrun  : 20260820120000_foot_timer_records_tenant_seal.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-20
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + census drift 가드 + helper 실재 + 멱등 ──
DO $preflight$
DECLARE
  v_null_rows int;
  v_unresolved int;
BEGIN
  -- 대상 실재 (wrong-DB 오적용 방지)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='timer_records') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: timer_records 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF NOT (SELECT relrowsecurity FROM pg_class
            WHERE relname='timer_records' AND relnamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: timer_records RLS 미활성 — restrictive 무효';
  END IF;
  -- ★ census drift 가드(iii): apply 시점 NULL/empty clinic_id 잔존 0 이어야 함(no-silent-drop).
  SELECT count(*) INTO v_null_rows FROM timer_records
    WHERE clinic_id IS NULL OR btrim(clinic_id) = '';
  IF v_null_rows <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: timer_records.clinic_id NULL/empty = % (>0) — 백필 선행 필요(census (iii) HARD-BLOCK)', v_null_rows;
  END IF;
  -- ★ census drift 가드(ii): text-side cast 로 해소 안 되는 행(비-clinic-uuid) 잔존 0 이어야 함
  --   (slug/label 이 섞이면 jongno staff lockout = H3). apply 시점 재확인.
  SELECT count(*) INTO v_unresolved FROM timer_records t
    WHERE NOT EXISTS (SELECT 1 FROM clinics c WHERE c.id::text = t.clinic_id);
  IF v_unresolved <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: timer_records clinic_id 中 clinics 로 resolve 안 되는 행 = % (>0) — slug/label 혼입(census (ii)) → LOCKOUT 위험, seal 금지·escalate', v_unresolved;
  END IF;
  -- 술어 helper 실재 (text-side cast 대상)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — 술어 해소 불가';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — admin bypass 술어 해소 불가';
  END IF;
  -- 멱등/재실행 안전: 이미 restrictive 존재 시 abort (중복 CREATE 방지)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND tablename='timer_records'
               AND policyname='timer_records_tenant_isolation') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: timer_records_tenant_isolation 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- RESTRICTIVE tenant-isolation : cross-clinic 도달 AND-차단 (text-side cast)
--   canonical 술어(DA ①) = clinic_id = current_user_clinic_id()::text OR is_admin_or_manager()
--     · text-side cast (uuid→text) → clinic_id(text) 와 text↔text 비교 → 22P02 무발생(H2 회피).
--     · admin/manager 는 cross-clinic 보존(foot 캐노니컬 is_admin_or_manager()).
--   grain = FOR ALL(USING + WITH CHECK 둘 다) — write WIDE-OPEN census(§A-2·grain).
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "timer_records_tenant_isolation" ON public.timer_records
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (clinic_id = current_user_clinic_id()::text OR is_admin_or_manager())
  WITH CHECK (clinic_id = current_user_clinic_id()::text OR is_admin_or_manager());

COMMENT ON POLICY "timer_records_tenant_isolation" ON public.timer_records IS
  'T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL(①): cross-clinic tenant 격리(ADDITIVE RESTRICTIVE·text-side cast). '
  'clinic_id(TEXT) = current_user_clinic_id()::text OR is_admin_or_manager(). permissive 3종 존치·AND-차단. '
  'census: total 691 · NULL 0 · distinct 1(=jongno uuid text·전건 resolve) · write wide-open→FOR ALL. '
  'H2 회피: text-side cast(uuid-side ::uuid=22P02 raise 금지). anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_restrictive int;
  v_permissive  int;
  v_using       text;
  v_check       text;
BEGIN
  -- (1) restrictive 정책 실재 + RESTRICTIVE + TO authenticated + ALL 정확 매칭
  SELECT count(*) INTO v_restrictive FROM pg_policies
    WHERE schemaname='public' AND tablename='timer_records'
      AND policyname='timer_records_tenant_isolation'
      AND permissive='RESTRICTIVE'
      AND roles::text = '{authenticated}'
      AND cmd='ALL';
  IF v_restrictive <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: tenant-isolation restrictive/authenticated/ALL 매칭 실패 (count=%)', v_restrictive;
  END IF;

  -- (2) USING AND WITH CHECK 둘 다 canonical 술어(한쪽 누락=silent leak) + text-side cast 확인
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
    FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid
    WHERE c.relname='timer_records' AND po.polname='timer_records_tenant_isolation';
  IF v_using IS NULL OR v_check IS NULL THEN
    RAISE EXCEPTION 'VERIFY_FAIL: USING/WITH CHECK 한쪽 이상 NULL (using=%, check=%) — silent leak', v_using, v_check;
  END IF;
  IF v_using NOT LIKE '%current_user_clinic_id()%' OR v_check NOT LIKE '%current_user_clinic_id()%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: canonical 술어 미포함 (using=%, check=%)', v_using, v_check;
  END IF;
  -- text-side cast 확인(H2 회피 — uuid-side cast 금지): 술어에 ::text 존재, ::uuid 부재
  IF v_using NOT LIKE '%::text%' OR v_check NOT LIKE '%::text%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: text-side cast(::text) 미포함 (using=%, check=%)', v_using, v_check;
  END IF;
  IF v_using LIKE '%clinic_id)::uuid%' OR v_using LIKE '%clinic_id::uuid%' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: uuid-side cast(clinic_id::uuid) 검출 — H2 22P02 위험 (using=%)', v_using;
  END IF;

  -- (3) ADDITIVE 불변식: 기존 permissive 정책 존치(DROP 0) — 3종 이상
  SELECT count(*) INTO v_permissive FROM pg_policies
    WHERE schemaname='public' AND tablename='timer_records' AND permissive='PERMISSIVE';
  IF v_permissive < 3 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive 정책 DROP됨 (count=% , 기대 >=3)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: timer_records tenant-isolation RESTRICTIVE(authenticated,ALL,USING+CHECK text-side cast) 신설 + permissive % 종 존치(ADDITIVE).', v_permissive;
END $verify$;
