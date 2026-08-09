-- ============================================================================
-- T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL · UP  (anon-도달 permissive READ 봉쇄)
--   foot anon-도달 미인증 READ 누수 봉쇄 — ★재-census 로 확정된 SUBSET(2/4)만.
--   change-class = ADDITIVE(§A canonical): permissive DROP 0 → RESTRICTIVE 신설으로
--                  anon 롤 도달 AND-차단. 데이터 mutation 0. 롤백 = DROP 1줄/테이블.
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   Gate-B(DA INFO tkv8: anon-도달 4 = 미인증 누수 → 즉시 봉쇄) GO ≠ apply 허가.
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + effective-authz
--     + GO-token) 물리 선행 필수(apply_before_go 금지, deploy-precheck C20). GO-token 前 prod DDL 선집행 금지.
--   ADDITIVE(신규 컬럼/타입/enum/테이블 0·기존 정책 무DROP·데이터 0) → CEO 파괴게이트 §3.1 면제.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★재-census + 정당 anon 경로 검증 (하드규율 — 파괴위험 높음, 본 티켓 make-or-break)
--   census 정본(prod, Management API, 2026-08-10):
--     anon-도달 READ 정책 4테이블 —
--       ① services       : anon_service_read           SELECT anon USING(true)
--       ② package_tiers  : anon_read_package_tiers      SELECT anon USING(true)
--       ③ waiting_board  : waiting_board_select         SELECT {anon,authenticated} USING(true)
--       ④ checklists     : anon_checklist_read          SELECT anon USING(true)  (+anon_checklist_write INSERT)
--   FE/prod 정당 anon 소비자 실측(Explore 전수 census — 전 anon-client + 전 public route):
--     · anon-client 파일 = src/lib/supabase.ts(authed·persistSession), TabletChecklistPage,
--       Waiting, HealthQMobilePage. public route = /checklist/:id, /waiting/:slug,
--       /health-q/:token, /attendance/{punch,kiosk}.
--     · ① services      → 정당 anon 소비자 0 (public route 어디서도 미read; /admin authed only). = 미인증 누수 확정.
--     · ② package_tiers → src/ 전체 참조 0 (dead grant). = 미인증 누수 확정.
--     · ③ waiting_board → ★정당 anon READ 경로 존재 (Waiting.tsx:120 anonClient.from('waiting_board').select
--                          + :152 realtime — 공개 대기현황판 /waiting/:slug, PII는 DB projection 선-마스킹). → 봉쇄 보류.
--     · ④ checklists    → 정당 anon feature 존재(TabletChecklistPage 셀프체크인)나 전량 SECURITY DEFINER RPC
--                          (fn_prescreen_start / fn_complete_prescreen_checklist, prosecdef=true) 경유 = RLS-immune.
--                          직접 anon .from('checklists') read/write 소비자 0. 직접정책=PHI 누수지만 live anon-feature
--                          테이블 → 보류 + DA CONSULT(SECDEF↔직접정책 상호작용 판정 위임).
--   ⇒ 봉쇄 SUBSET(본 티켓) = services + package_tiers (정당 anon 소비자 0 = 미인증 누수 확정분).
--     waiting_board + checklists = HOLD → FOLLOWUP planner/DA CONSULT (파괴위험 회피).
--
-- ── RESTRICTIVE anon-deny 의미(왜 안전) ───────────────────────────────────────────
--   PG RLS: RESTRICTIVE 정책은 TO 명시 롤에만 적용되며 permissive 와 AND. anon SELECT =
--   permissive(true) AND restrictive(false) = false → anon 차단. authenticated 는 TO anon 에
--   미포함 → 무영향(기존 authed read 정책 그대로). service_role = BYPASSRLS → 무영향.
--   SECURITY DEFINER 함수는 definer(postgres) 컨텍스트 실행 = 호출자 RLS 미적용 → 무영향.
--   permissive 는 존치(ADDITIVE) → rollback = DROP restrictive 1줄/테이블(취약 재개통).
--
--   down    : 20260810180000_foot_rls_anon_permissive_seal.rollback.sql
--   dryrun  : 20260810180000_foot_rls_anon_permissive_seal.dryrun.mjs (무영속·post-probe 부재 실측)
--   postcheck: scripts/T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL_postcheck.mjs (apply 후 anon 세션 실효 실측)
-- 작성: dev-foot / 2026-08-10
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + before-image(permissive anon-read 존치) + restrictive 미존재 ──
DO $preflight$
BEGIN
  -- 대상 2테이블 실재 (wrong-DB 오적용 방지)
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('services','package_tiers')) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: services/package_tiers 부재(한쪽 이상) — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF (SELECT count(*) FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname IN ('services','package_tiers') AND relrowsecurity) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: services/package_tiers RLS 미활성 — restrictive 무효';
  END IF;
  -- before-image: 봉쇄 대상 permissive anon-read 정책 실재(census 정본과 일치 확인)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='services' AND policyname='anon_service_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: services.anon_service_read 부재 — census drift, abort';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='package_tiers' AND policyname='anon_read_package_tiers') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: package_tiers.anon_read_package_tiers 부재 — census drift, abort';
  END IF;
  -- 멱등/재실행 안전: 이미 restrictive 존재 시 abort (중복 CREATE 방지 — IF NOT EXISTS 없음)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND tablename IN ('services','package_tiers')
               AND policyname IN ('services_anon_deny','package_tiers_anon_deny')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: restrictive anon-deny 정책 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ① services : RESTRICTIVE anon-deny (permissive anon_service_read 존치 + AND-차단)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "services_anon_deny" ON public.services
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "services_anon_deny" ON public.services IS
  'T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL: anon-도달 미인증 READ 누수 봉쇄(ADDITIVE RESTRICTIVE). '
  'permissive anon_service_read(USING true) 존치·AND-차단. authenticated/service_role/SECDEF 무영향. '
  '재-census: 정당 anon 소비자 0(전 public route 미read). rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ② package_tiers : RESTRICTIVE anon-deny (permissive anon_read_package_tiers 존치 + AND-차단)
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "package_tiers_anon_deny" ON public.package_tiers
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "package_tiers_anon_deny" ON public.package_tiers IS
  'T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL: anon-도달 미인증 READ 누수 봉쇄(ADDITIVE RESTRICTIVE). '
  'permissive anon_read_package_tiers(USING true) 존치·AND-차단. src/ 참조 0(dead grant). rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_restrictive int;
  v_permissive  int;
BEGIN
  -- (1) restrictive anon-deny 2건 실재 + PERMISSIVE 아님 + TO anon 정확 매칭
  SELECT count(*) INTO v_restrictive FROM pg_policies
    WHERE schemaname='public'
      AND ( (tablename='services'      AND policyname='services_anon_deny')
         OR (tablename='package_tiers' AND policyname='package_tiers_anon_deny') )
      AND permissive='RESTRICTIVE'
      AND roles::text = '{anon}';
  IF v_restrictive <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: restrictive anon-deny 불완전 (count=% , 기대 2)', v_restrictive;
  END IF;

  -- (2) ADDITIVE 불변식: before-image permissive anon-read 정책 여전히 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
    WHERE schemaname='public'
      AND ( (tablename='services'      AND policyname='anon_service_read')
         OR (tablename='package_tiers' AND policyname='anon_read_package_tiers') );
  IF v_permissive <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive anon-read 정책이 DROP됨 (count=% , 기대 2)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: restrictive anon-deny(services,package_tiers)=2 신설 + permissive 존치(ADDITIVE) 확인.';
END $verify$;
