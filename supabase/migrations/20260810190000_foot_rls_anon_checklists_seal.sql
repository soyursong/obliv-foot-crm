-- ============================================================================
-- T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT · UP  (checklists anon 직접정책 봉쇄)
--   foot checklists 테이블의 직접 anon read+write 미인증 PHI 누수 봉쇄.
--   ★2건 CONSULT 中 checklists 만 착수 (waiting_board = anon-read CANONICAL, 봉쇄 NO-GO).
--
--   change-class = ADDITIVE(§A canonical / DA §4): permissive DROP 0 → RESTRICTIVE 신설으로
--                  anon 롤 도달 AND-차단. 데이터 mutation 0. rollback = DROP restrictive x2.
--   자매 SEAL mig 20260810180000(services·package_tiers) 및 umbrella §A SSOT 와 batch-uniform.
--
-- ── DA 근거 (SSOT: da_decision_foot_rls_anon_legitpath_wb_checklists_20260810.md) ──
--   Q2 checklists 봉쇄 = GO(조건부). SECDEF fn_complete_prescreen_checklist
--   (owner=postgres·prosecdef=true·relforcerowsecurity=false)는 RLS 를 전면 우회 →
--   직접 anon read/write 정책 제거는 셀프체크인 RPC write 경로에 영향 0(수학적 독립·CONFIRMED).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   Gate-B(DA) GO ≠ apply 허가. ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 →
--   supervisor DB-GATE(DDL-diff + effective-authz + GO-token) 물리 선행 필수
--   (apply_before_go 금지, deploy-precheck C20/C24). GO-token 前 prod DDL 선집행 금지.
--   ADDITIVE(신규 컬럼/타입/enum/테이블 0·기존 정책 무DROP·데이터 0) → CEO 파괴게이트 §3.1 면제.
--
-- ── ★재-census (PRE-SEAL FE 증거 · DA C3 · 하드규율) ──────────────────────────────
--   census 정본(prod, Management API, DA §1-B, 2026-08-10):
--     · anon 직접정책 2 = anon_checklist_read(SELECT,{anon},qual=true)
--                        + anon_checklist_write(INSERT,{anon},with_check=true) — 미인증 PHI 누수.
--     · authenticated 정책 6(무접촉): auth_users_all·checklists_admin_all·checklists_approved_read
--                        ·checklists_consult_update·checklists_coord_insert·checklists_coord_update.
--     · SECDEF fn_complete_prescreen_checklist owner=postgres·prosecdef=true·EXECUTE anon 보존.
--   FE census(dev-foot 재확인, grep + built bundle, 2026-08-10):
--     · anon-client(anonClient, anon-key) 참조처 = TabletChecklistPage(셀프체크인)/HealthQMobilePage.
--       두 파일 공히 anonClient.rpc(...)만 호출 — anonClient.from('checklists') read/write **0건**.
--     · .from('checklists') 실참조 3건 전부 authed client(supabase) — Dashboard:4301(select),
--       CustomerChartPage:3326/10453(select). 스태프 세션 = authenticated 정책 6종 소관(무접촉).
--   ⇒ 직접 anon .from('checklists') read+write 소비자 = 0(read-back 부재 → SECDEF read RPC 전환 불요).
--     셀프체크인 write = 전량 fn_complete_prescreen_checklist(SECDEF·RLS-immune) 경유. C3 충족.
--
-- ── RESTRICTIVE anon-deny 의미(왜 안전) ───────────────────────────────────────────
--   PG RLS: RESTRICTIVE 정책은 TO 명시 롤에만 적용되며 permissive 와 AND. anon SELECT =
--   permissive(true) AND restrictive(false) = false → anon read 차단. anon INSERT 동일 → write 차단.
--   authenticated 는 TO anon 미포함 → 무영향(기존 스태프 read/write 정책 6종 그대로).
--   service_role = BYPASSRLS → 무영향. SECURITY DEFINER 함수(owner=postgres)는 definer 컨텍스트
--   실행 = 호출자 RLS 미적용 → 무영향(셀프체크인 write 무회귀). permissive 는 존치(ADDITIVE).
--
--   down    : 20260810190000_foot_rls_anon_checklists_seal.rollback.sql (DROP restrictive x2)
--   dryrun  : 20260810190000_foot_rls_anon_checklists_seal.dryrun.mjs (무영속·post-probe)
--   postcheck: scripts/T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT_postcheck.mjs (anon 세션 실효 실측)
-- 작성: dev-foot / 2026-08-10
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + before-image(anon 직접정책 존치) + restrictive 미존재 + SECDEF 독립 전제 ──
DO $preflight$
DECLARE
  v_secdef record;
BEGIN
  -- 대상 테이블 실재 (wrong-DB 오적용 방지)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='checklists') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: public.checklists 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF NOT EXISTS (SELECT 1 FROM pg_class
                   WHERE relnamespace='public'::regnamespace
                     AND relname='checklists' AND relrowsecurity) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: checklists RLS 미활성 — restrictive 무효';
  END IF;
  -- before-image: 봉쇄 대상 anon 직접정책 2 실재(census 정본과 일치 확인)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='checklists' AND policyname='anon_checklist_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: checklists.anon_checklist_read 부재 — census drift, abort';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='checklists' AND policyname='anon_checklist_write') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: checklists.anon_checklist_write 부재 — census drift, abort';
  END IF;
  -- C2 before-image: authenticated 정책 6종 실재(봉쇄가 이들을 건드리지 않음을 착지 전 고정)
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='checklists'
        AND policyname IN ('auth_users_all','checklists_admin_all','checklists_approved_read',
                           'checklists_consult_update','checklists_coord_insert','checklists_coord_update')) <> 6 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: authenticated 정책 6종 census drift(<>6) — abort';
  END IF;
  -- C1 SECDEF 독립 전제: fn_complete_prescreen_checklist prosecdef=true (무접촉·read-only 확인)
  SELECT p.proname, p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist' LIMIT 1;
  IF v_secdef IS NULL OR NOT v_secdef.prosecdef THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: fn_complete_prescreen_checklist SECDEF(prosecdef=true) 전제 붕괴 — 독립 재확인 필요';
  END IF;
  -- 멱등/재실행 안전: 이미 restrictive 존재 시 abort (중복 CREATE 방지 — IF NOT EXISTS 없음)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='checklists'
               AND policyname IN ('checklists_anon_read_deny','checklists_anon_write_deny')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: restrictive anon-deny 정책 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ① checklists : RESTRICTIVE anon READ-deny (permissive anon_checklist_read 존치 + AND-차단)
--    → anon SELECT = true AND false = false → 미인증 PHI read 봉쇄. (mirror of anon_checklist_read)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "checklists_anon_read_deny" ON public.checklists
  AS RESTRICTIVE FOR SELECT TO anon
  USING (false);

COMMENT ON POLICY "checklists_anon_read_deny" ON public.checklists IS
  'T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT: 미인증 PHI read 누수 봉쇄(ADDITIVE RESTRICTIVE). '
  'permissive anon_checklist_read(SELECT,USING true) 존치·AND-차단. authenticated 6종/service_role/SECDEF 무영향. '
  'DA §3: 직접 anon read 소비자 0(셀프체크인=SECDEF RPC 경유). rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ② checklists : RESTRICTIVE anon WRITE-deny (permissive anon_checklist_write 존치 + AND-차단)
--    → anon INSERT = true AND false = false → 미인증 PHI write 봉쇄. (mirror of anon_checklist_write)
--    셀프체크인 INSERT 은 fn_complete_prescreen_checklist(SECDEF·RLS-bypass) 경유 → 무영향.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "checklists_anon_write_deny" ON public.checklists
  AS RESTRICTIVE FOR INSERT TO anon
  WITH CHECK (false);

COMMENT ON POLICY "checklists_anon_write_deny" ON public.checklists IS
  'T-20260810-foot-RLS-ANON-LEGITPATH-DACONSULT: 미인증 PHI write 누수 봉쇄(ADDITIVE RESTRICTIVE). '
  'permissive anon_checklist_write(INSERT,WITH CHECK true) 존치·AND-차단. 셀프체크인 write=SECDEF RPC 경유 무영향. '
  'DA §3-A: SECDEF↔직접정책 수학적 독립. rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_restrictive int;
  v_permissive  int;
  v_authed      int;
  v_secdef      boolean;
BEGIN
  -- (1) restrictive anon-deny 2건 실재 + PERMISSIVE 아님 + TO anon 정확 매칭 (C2: roles={anon} 전용)
  SELECT count(*) INTO v_restrictive FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists'
      AND policyname IN ('checklists_anon_read_deny','checklists_anon_write_deny')
      AND permissive='RESTRICTIVE'
      AND roles::text = '{anon}';
  IF v_restrictive <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: restrictive anon-deny 불완전/롤 이탈 (count=% , 기대 2·roles={anon})', v_restrictive;
  END IF;

  -- (2) ADDITIVE 불변식: before-image anon 직접정책(read+write) 여전히 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists'
      AND policyname IN ('anon_checklist_read','anon_checklist_write');
  IF v_permissive <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — anon permissive 직접정책이 DROP됨 (count=% , 기대 2)', v_permissive;
  END IF;

  -- (3) C2 불변식: authenticated 정책 6종 무접촉(스태프 read/write 파괴 0)
  SELECT count(*) INTO v_authed FROM pg_policies
    WHERE schemaname='public' AND tablename='checklists'
      AND policyname IN ('auth_users_all','checklists_admin_all','checklists_approved_read',
                         'checklists_consult_update','checklists_coord_insert','checklists_coord_update');
  IF v_authed <> 6 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: C2 위반 — authenticated 정책 6종 변형됨 (count=% , 기대 6)', v_authed;
  END IF;

  -- (4) C1 불변식: SECDEF fn_complete_prescreen_checklist prosecdef=true 무접촉
  SELECT p.prosecdef INTO v_secdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_complete_prescreen_checklist' LIMIT 1;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY_FAIL: C1 위반 — SECDEF fn_complete_prescreen_checklist prosecdef 변형/부재';
  END IF;

  RAISE NOTICE 'VERIFY OK: restrictive anon-deny(read+write)=2 신설 + anon permissive 존치(ADDITIVE) + authed 6종 무접촉(C2) + SECDEF 독립(C1) 확인.';
END $verify$;
