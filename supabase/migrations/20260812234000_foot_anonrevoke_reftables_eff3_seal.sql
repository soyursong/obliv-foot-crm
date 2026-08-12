-- ============================================================================
-- T-20260812-foot-ANONREVOKE-REFTABLES-EFF3 · UP  (anon EFFECTIVE 3종 SEAL)
--   부모: T-20260812-foot-ANON-REVOKE-REFTABLES (INERT 5/8 REVOKE) 의 EFFECTIVE carve-out.
--   DA SSOT: da_decision_xcrm_anon_defenseindepth_tierb_reference_consumer_census_20260812.md
--            §10 ADDENDUM #2 (CONSULT-REPLY MSG-20260812-233013-xqxb, SEAL disposition GO 조건부).
--
--   목적: behavioral-401 실측으로 EFFECTIVE(anon 실데이터 read) 확인된 3표의 anon 노출을 SEAL 봉인.
--     · form_templates            (anon 35행) — policy: form_templates_read
--     · redpay_terminal_registry  (anon 44행) — policy: redpay_terminal_registry_read_all  ★HIGH 우선
--     · room_role_mapping         (anon  4행) — policy: room_role_read
--   root-cause: 3표 각각 `TO public USING(true)` PERMISSIVE SELECT 정책 보유. public ⊇ anon →
--     RLS ON 이어도 anon 전행 read. census §5(RESTRICTIVE anon-deny 유무만 검사)가 public-permissive
--     정책 미검출 → INERT 오분류. behavioral AC3 = authoritative label source(§10 ADDENDUM #2).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ SEAL 충분성 doctrine 적용 (dev-foot grant provenance 실측, 2026-08-12) — false-GREEN 방지
--   prod relacl 실측(Management API, 2026-08-12):
--     3표 공통 anon ACL = anon=rxtm/postgres  (r=SELECT, x=REFERENCES, t=TRIGGER, m=MAINTAIN).
--     ⇒ SELECT 권한 provenance = ANON-DIRECT grant. relacl 에 PUBLIC 엔트리(`=r/postgres`) 부재
--        = PUBLIC-grant 경유 아님. (has_table_privilege('anon',...,'SELECT')=true 3표 확증.)
--   BUT: 3표 각각 PERMISSIVE `TO public USING(true)` SELECT 정책이 상존(RLS 레이어 개방).
--   ⇒ 기법 택: doctrine 의 "PERMISSIVE 정책 상존 → RESTRICTIVE anon-deny 정책 추가" arm 채택.
--     (a) REVOKE ALL FROM anon 도 anon-direct provenance 라 봉인은 되나:
--         · anon=r 는 Supabase fork 테이블-생성 기본 grant(AC3 self-scan: forward re-grant 벡터 0,
--           但 신규 테이블 재생성/플랫폼 default 재적용 시 재부여 durability 위험).
--         · REVOKE = 파괴적(privilege 제거) → §3.1 ADDITIVE 면제 상실 + rollback=재-GRANT.
--     (b) RESTRICTIVE anon-deny(본 채택):
--         · 재부여-immune — anon SELECT 가 미래 어떤 경로로 재부여돼도 restrictive(false) AND 로 차단.
--         · ADDITIVE(CREATE POLICY·DROP 0·데이터 0) → §3.1 CEO 파괴게이트 면제 유지.
--         · foot canonical 선례(20260810180000 services_anon_deny/package_tiers_anon_deny deployed) 일치.
--         · rollback = DROP 1줄/테이블. permissive `TO public` 정책은 무접촉 존치(ADDITIVE 불변식).
--   ★ fork-uniformity FALSIFIED: 본 판정은 foot 자체 static(relacl)+behavioral(anon REST) census.
--     타 fork(women 등) 획일 상속 아님(§10 ADDENDUM #2: per-CRM behavioral AC3 만 authoritative).
--
-- ── consumer 축② 재확인 (AC2·SEAL 안전 — 정당 anon 소비자 0 실측, dev-foot 2026-08-12) ──────────
--   anon-client 파일(createClient+ANON_KEY) 3개 = TabletChecklistPage / Waiting / HealthQMobilePage.
--     · TabletChecklistPage(셀프체크인/키오스크) = anonClient.rpc('fn_prescreen_start'…) [SECDEF] +
--       anonClient.storage 만 사용. form_templates 직접 read 0 (self-checkin/kiosk 템플릿 로드 경로 없음).
--     · Waiting(/waiting/:slug §16-3a) = anonClient.from('waiting_board')[sanitized projection]+realtime.
--       room_role_mapping 직접 read 0 (waiting_board room 의존 = DB projection 내부, anon 미접촉).
--     · HealthQMobilePage(/health-q/:token) = 3표 참조 0.
--   3표의 전 `.from()` 소비자(20건)는 authed `supabase`(@/lib/supabase, persistSession) 경유:
--     · redpay_terminal_registry → src/lib/cband/tidRegistryGate.ts (스태프 cband 결제, authed). anon 0.
--     · form_templates → 13 doctor/admin surface(OpinionDocTab·KohReportTab·DocumentPrintPanel·
--       PenChartTab·OpinionPhrasesTab·medDocPrintGate·printKohResult·referralAutoLoad 등, 전량 authed).
--     · room_role_mapping → src/pages/Staff.tsx (admin 직원관리, authed). anon 0.
--   ⇒ 3표 정당 anon 소비자 = 0 → SEAL 안전(스태프 authed read 무손·authenticated 정책 무접촉).
--
-- ── AC3 재부여-소스 self-scan (dev-foot 2026-08-12) — REVOKE-durability 참고(RESTRICTIVE=immune) ──
--   (1) `ALTER DEFAULT PRIVILEGES … GRANT … TO anon`(테이블) = NONE (repo ADP 는 function-EXEC 봉인 hardening).
--   (2) `GRANT … ON ALL TABLES IN SCHEMA … TO anon` = NONE.
--   (3) 3표 대상 명시 forward `GRANT … TO anon` = NONE (redpay=TO authenticated 뿐).
--   (4) post-deploy hook / seed.sql anon re-grant = NONE (seed.sql 부재).
--   ⇒ forward re-grant 벡터 부재. anon=r 은 fork 테이블-생성 default. RESTRICTIVE anon-deny 는 재부여 무관 봉인.
--
-- ── change-class / 게이트 (db_change=true) ─────────────────────────────────────
--   change-class = ADDITIVE(CREATE POLICY x3·permissive DROP 0·데이터 mutation 0).
--     ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + MIG-GATE 4필드 +
--       effective-authz + 물리 GO-token) 선행 필수(apply_before_go 금지·deploy-precheck C20).
--     GO-token 前 prod DDL/POLICY 선집행 금지. Gate-B(DA) GO ≠ apply 허가.
--   §3.1 CEO 파괴게이트 면제 YES(ADDITIVE·비-PHI·exposure-reducing·가역·부모 non-SEV·CEO NOTIFY 불요).
--   ★redpay HIGH 우선: 3 CREATE POLICY 는 상호독립. redpay_terminal_registry_anon_deny 를 정책#1 로 배치.
--
-- ── RESTRICTIVE anon-deny 의미(왜 안전) ───────────────────────────────────────────
--   PG RLS: RESTRICTIVE 는 TO 명시 롤에만 적용·permissive 와 AND. anon SELECT =
--   permissive(true) AND restrictive(false) = false → anon 차단. authenticated 는 TO anon 미포함 →
--   무영향(기존 authed read/write 정책 그대로). service_role=BYPASSRLS·SECDEF(definer=postgres)=무영향.
--
--   down     : 20260812234000_foot_anonrevoke_reftables_eff3_seal.rollback.sql
--   dryrun   : 20260812234000_foot_anonrevoke_reftables_eff3_seal.dryrun.mjs (무영속·post-probe)
--   postcheck: scripts/T-20260812-foot-ANONREVOKE-REFTABLES-EFF3_postcheck.mjs (apply 前/後 anon 실효 실측)
-- 작성: dev-foot / 2026-08-12 · ticket: T-20260812-foot-ANONREVOKE-REFTABLES-EFF3 (AC2·AC3)
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: 대상 3 실재 + RLS ON + before-image permissive 존재 + restrictive 미존재 ──
DO $preflight$
BEGIN
  -- 대상 3표 실재 (wrong-DB 오적용 방지)
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('form_templates','redpay_terminal_registry','room_role_mapping')) < 3 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 3표 중 하나 이상 부재 — wrong DB?';
  END IF;

  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF (SELECT count(*) FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname IN ('form_templates','redpay_terminal_registry','room_role_mapping')
          AND relrowsecurity) < 3 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 3표 중 RLS 미활성 존재 — restrictive 무효';
  END IF;

  -- before-image: 봉쇄 근거 permissive `TO public USING(true)` 정책 실재(census 정본 일치 확인)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='redpay_terminal_registry' AND policyname='redpay_terminal_registry_read_all') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: redpay_terminal_registry.redpay_terminal_registry_read_all 부재 — census drift, abort';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='form_templates' AND policyname='form_templates_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: form_templates.form_templates_read 부재 — census drift, abort';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename='room_role_mapping' AND policyname='room_role_read') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: room_role_mapping.room_role_read 부재 — census drift, abort';
  END IF;

  -- 멱등/재실행 안전: 이미 restrictive anon-deny 존재 시 abort (중복 CREATE 방지 — IF NOT EXISTS 미지원)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND policyname IN ('redpay_terminal_registry_anon_deny','form_templates_anon_deny','room_role_mapping_anon_deny')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: restrictive anon-deny 정책 이미 존재 — 재적용 abort(멱등)';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ① redpay_terminal_registry : RESTRICTIVE anon-deny  ★HIGH 우선 (POS/단말 config live-leak 최우선 봉인)
--    permissive redpay_terminal_registry_read_all(USING true) 존치 + AND-차단
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "redpay_terminal_registry_anon_deny" ON public.redpay_terminal_registry
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "redpay_terminal_registry_anon_deny" ON public.redpay_terminal_registry IS
  'T-20260812-foot-ANONREVOKE-REFTABLES-EFF3: anon EFFECTIVE(44행) live-leak SEAL(ADDITIVE RESTRICTIVE). '
  'permissive redpay_terminal_registry_read_all(TO public USING true) 존치·AND-차단. HIGH 우선(POS/단말 config). '
  '정당 anon 소비자 0(tidRegistryGate=authed). authenticated/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ② form_templates : RESTRICTIVE anon-deny
--    permissive form_templates_read(USING true) 존치 + AND-차단
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "form_templates_anon_deny" ON public.form_templates
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "form_templates_anon_deny" ON public.form_templates IS
  'T-20260812-foot-ANONREVOKE-REFTABLES-EFF3: anon EFFECTIVE(35행) live-leak SEAL(ADDITIVE RESTRICTIVE). '
  'permissive form_templates_read(TO public USING true) 존치·AND-차단. self-checkin/kiosk 직접 read 0'
  '(TabletChecklistPage=SECDEF RPC). 정당 anon 소비자 0(13 doctor/admin surface=authed). rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- ③ room_role_mapping : RESTRICTIVE anon-deny
--    permissive room_role_read(USING true) 존치 + AND-차단
-- ══════════════════════════════════════════════════════════════════════════════
CREATE POLICY "room_role_mapping_anon_deny" ON public.room_role_mapping
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "room_role_mapping_anon_deny" ON public.room_role_mapping IS
  'T-20260812-foot-ANONREVOKE-REFTABLES-EFF3: anon EFFECTIVE(4행) live-leak SEAL(ADDITIVE RESTRICTIVE). '
  'permissive room_role_read(TO public USING true) 존치·AND-차단. waiting_board(§16-3a) room 의존=DB '
  'projection 내부·anon 미접촉. 정당 anon 소비자 0(Staff.tsx=authed admin). rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_restrictive int;
  v_permissive  int;
BEGIN
  -- (1) restrictive anon-deny 3건 실재 + RESTRICTIVE + TO anon 정확 매칭
  SELECT count(*) INTO v_restrictive FROM pg_policies
    WHERE schemaname='public'
      AND ( (tablename='redpay_terminal_registry' AND policyname='redpay_terminal_registry_anon_deny')
         OR (tablename='form_templates'           AND policyname='form_templates_anon_deny')
         OR (tablename='room_role_mapping'        AND policyname='room_role_mapping_anon_deny') )
      AND permissive='RESTRICTIVE'
      AND roles::text = '{anon}';
  IF v_restrictive <> 3 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: restrictive anon-deny 불완전 (count=% , 기대 3)', v_restrictive;
  END IF;

  -- (2) ADDITIVE 불변식: before-image permissive `TO public` 정책 여전히 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
    WHERE schemaname='public'
      AND ( (tablename='redpay_terminal_registry' AND policyname='redpay_terminal_registry_read_all')
         OR (tablename='form_templates'           AND policyname='form_templates_read')
         OR (tablename='room_role_mapping'        AND policyname='room_role_read') );
  IF v_permissive <> 3 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive 정책이 DROP됨 (count=% , 기대 3)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: restrictive anon-deny 3(redpay,form_templates,room_role_mapping) 신설 + permissive 존치(ADDITIVE).';
END $verify$;

COMMIT;
