-- ============================================================================
-- T-20260812-foot-ANON-REVOKE-REFTABLES · UP  (anon REVOKE on NON-PHI reference — INERT subset 5/8)
--   부모: T-20260720-xcrm-ANON-DEFENSEINDEPTH-P2P3-REVOKE (Tier-B leg)
--   DA SSOT: da_decision_xcrm_anon_defenseindepth_tierb_reference_consumer_census_20260812.md §6 (foot 행)
--
--   목적: 비-PHI 참조표에 잔존하는 anon(익명키) 테이블 grant 를 완전 회수한다(defense-in-depth).
--
-- ★★★ SCOPE 축소 (8→5): behavioral-401 self-front 로 census 불일치 발견 (dev-foot, 2026-08-12) ★★★
--   DA census §2/§6 은 8표 전부 INERT(grant+RLS-deny·anon 0-row) 로 분류했으나,
--   dev-foot 가 anon 실키 REST 로 apply-前 behavioral-401 선행(§5⚠⚠⚠d) 을 실측한 결과:
--     · 진성 INERT (anon 200+0row 확증) = 5표 → 본 마이그 대상:
--         call_type_codes · check_in_services · clinic_holidays · clinic_schedules · prescription_codes
--     · EFFECTIVE (anon 이 실행 READ — census 오분류) = 3표 → 본 마이그 DEFERRED (DA 재-CONSULT):
--         form_templates(anon 35행) · redpay_terminal_registry(anon 44행) · room_role_mapping(anon 4행)
--       root-cause: 3표 각각 `TO public USING(true)` PERMISSIVE SELECT 정책 존재
--         (form_templates_read / redpay_terminal_registry_read_all / room_role_read).
--         `public` 롤 = anon 포함 → RLS ON 이어도 anon 전행 read. census §5(RESTRICTIVE anon-deny
--         유무만 검사) 가 public-permissive 정책을 놓쳐 INERT 오분류.
--   ⇒ 3표는 EFFECTIVE-path 처리(consumer staff-only 재확인 → RESTRICTIVE anon-deny SEAL 또는 REVOKE)
--      가 필요하며, 이는 DA 소관(census 정정). DA HARD REJECT #5(behavioral 확증 없이 INERT REVOKE 금지)
--      에 정확히 해당 → 본 마이그에서 REVOKE 금지. FOLLOWUP → planner/DA 발행됨.
--
--   제외(KEEP·DA §3): clinics(EFFECTIVE·anonClient slug→clinic 해소·load-bearing) / waiting_board(§16-3a zero-PII)
--   제외(moot): check_ins(anon no-grant·이미 봉인)
--
-- ── change-class / 게이트 (db_change=true) ─────────────────────────────────────
--   change-class = exposure-reducing·가역 REVOKE(grant-axis DESTRUCTIVE) → DDL 실재 →
--     DDL-0 carve 아님 → supervisor DDL-diff DB-GATE + MIG-GATE 4필드 + 물리 GO-token 선행 필수
--     (apply_before_go 금지·deploy-precheck C20). GO-token 前 prod REVOKE 선집행 금지.
--   §3.1 CEO 파괴게이트 면제 YES(exposure-reducing·가역·비-PHI reference·부모 non-SEV·CEO NOTIFY 불요).
--   Gate-B(DA census GO) ≠ apply 허가 — supervisor GO-token 이 apply chokepoint(AC-1).
--   ⚠ scope 축소(5/8): planner/DA 가 5-subset deploy 를 승인해야 최종 deployed (3표 재-CONSULT 별도).
--
-- ── behavioral-401 선행 (INERT REVOKE 하드규율·§5⚠⚠⚠d) ─────────────────────────
--   본 5 target = anon 200+0row(grant≠realized·RLS-deny) INERT 실측 완료(dev-foot 2026-08-12).
--   supervisor 는 apply 前 재확인 + apply 後 401 전이 실측:
--     scripts/T-20260812-foot-ANON-REVOKE-REFTABLES_postcheck.mjs --phase before|after
--
-- ── AC6 재부여-소스 self-scan 결과 (dev, 2026-08-12) ──────────────────────────
--   REVOKE false-GREEN 방지 재부여 경로 부재 확인 — 전 항목 NONE:
--     (1) `ALTER DEFAULT PRIVILEGES … GRANT … TO anon` = NONE (repo ADP 전량 REVOKE anon·방어).
--     (2) `GRANT … ON ALL TABLES IN SCHEMA … TO anon` = NONE.
--     (3) 5 target 대상 명시 `GRANT … TO anon` = NONE.
--     (4) post-deploy hook / seed.sql anon re-grant = NONE (seed.sql 부재).
--   ⇒ 재부여 벡터 부재. 본 REVOKE 는 forward-stable.
--
--   before-image relacl (anon, 5 target 공통·2026-08-12 실측): {SELECT, REFERENCES, TRIGGER, MAINTAIN}
--     (write 4종 INSERT/UPDATE/DELETE/TRUNCATE 는 anon-write hygiene 스윕에서 旣회수).
--
--   down    : 20260812230000_foot_anon_revoke_reftables.rollback.sql (재-GRANT relacl parity)
--   dryrun  : 20260812230000_foot_anon_revoke_reftables.dryrun.mjs (무영속·PASS 2026-08-12)
--   postcheck: scripts/T-20260812-foot-ANON-REVOKE-REFTABLES_postcheck.mjs
-- 작성: dev-foot / 2026-08-12 · ticket: T-20260812-foot-ANON-REVOKE-REFTABLES (AC1·AC2·AC3-before)
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: 대상 5 실재(wrong-DB 오적용 방지) + before-image 로깅 ──────────
DO $preflight$
DECLARE
  v_present int;
  v_anon_acl int;
BEGIN
  SELECT count(*) INTO v_present
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('call_type_codes','check_in_services','clinic_holidays','clinic_schedules','prescription_codes');
  IF v_present <> 5 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 5 참조표 중 %개만 실재 — wrong DB / census drift, abort', v_present;
  END IF;

  SELECT count(*) INTO v_anon_acl
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('call_type_codes','check_in_services','clinic_holidays','clinic_schedules','prescription_codes')
      AND r.rolname = 'anon';
  RAISE NOTICE 'PREFLIGHT OK: 대상 5 실재. before anon relacl 엔트리(5표 합산)=% (INERT grant, REVOKE 대상).', v_anon_acl;
END $preflight$;

-- ── (1) REVOKE ALL FROM anon (5표·멱등: 미보유 권한 회수=no-op) ──────────────────
REVOKE ALL ON public.call_type_codes    FROM anon;
REVOKE ALL ON public.check_in_services  FROM anon;
REVOKE ALL ON public.clinic_holidays    FROM anon;
REVOKE ALL ON public.clinic_schedules   FROM anon;
REVOKE ALL ON public.prescription_codes FROM anon;

-- ── (VERIFY) 착지 실증: anon relacl 엔트리 0 (§5 relacl 정본·실패 시 abort·무영속) ──
DO $verify$
DECLARE
  v_remaining int;
  v_detail text;
BEGIN
  SELECT count(*), coalesce(string_agg(c.relname || ':' || a.privilege_type, ', '), '(none)')
    INTO v_remaining, v_detail
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('call_type_codes','check_in_services','clinic_holidays','clinic_schedules','prescription_codes')
      AND r.rolname = 'anon';
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: REVOKE 후에도 anon relacl 엔트리 % 잔존 (%)', v_remaining, v_detail;
  END IF;
  RAISE NOTICE 'VERIFY OK: 5 참조표 anon relacl 엔트리 0 (defense-in-depth grant 완전 회수).';
END $verify$;

COMMIT;
