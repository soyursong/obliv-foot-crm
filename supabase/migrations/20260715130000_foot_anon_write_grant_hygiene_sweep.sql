-- ============================================================================
-- T-20260714-foot-ANON-WRITE-SWEEP-REVOKE · UP
--   slice3 형제 전수 승계 — 부모 우산 T-20260714-scalp-ANON-WRITE-GRANT-HYGIENE
--   의 per-CRM(foot) sweep. scalp slice1(deployed·VERIFIED PASS) 방법론 재적용.
--
-- 배경 (DA slice2 preflight = DA-20260714-slice2-ANON-WRITE-ALLOWLIST-5CRM):
--   foot(롱레 하드포크 계열) public base 테이블 상당수에 anon 이 Supabase 기본값
--   GRANT ALL(arwdDxtm) 을 그대로 상속 → anon INSERT/UPDATE/DELETE/TRUNCATE
--   table-grant fork-wide drift. RLS 가 INS/UPD/DEL 은 실효 차단하나 ★TRUNCATE 는
--   RLS 대상이 아님(Postgres RLS = SEL/INS/UPD/DEL 만) → anon TRUNCATE grant =
--   RLS 미커버 실 gap.
--
-- 실측 (introspect, 2026-07-15, prod rxlomoozakkjesdqjtvd):
--   public base 123개 중 anon write(INS/UPD/DEL) grant 115개, anon TRUNCATE 112개,
--   anon SELECT 116개. relowner = 전부 postgres (123/123).
--   anon-role write 정책 3건(check_ins/anon_insert_checkin_self,
--   checklists/anon_checklist_write, customers/anon_insert_customer_self_checkin)
--   존재하나 실쓰기 경로 아님(DA slice2 판정) → allowlist=∅.
--
-- ★ DA slice2 판정 (foot allowlist = ∅ · 전건 REVOKE-eligible):
--   - checklists(anon INS) = 실쓰기 = SECURITY DEFINER RPC fn_complete_prescreen_checklist
--     경유. anon 직접-INSERT 는 정상경로 아님.
--   - customers·check_ins 직접 write = authenticated 스태프 대시보드만
--     (Customers.tsx:1241 / ReservationDetailPopup.tsx:1113).
--   - payment_audit_logs(무조건 ALL) = PaymentEditDialog.tsx:109 authenticated only.
--   ⇒ anon 직접-write PostgREST 정상경로 부재 → 전건 REVOKE-eligible.
--   ⇒ anon INS 정책 3건은 grant REVOKE 로 도달불가화(PostgREST 는 table grant 필수)
--     → 정책 DROP 은 본 티켓 미포함(DA 미판정) = 미접촉. grant 회수만으로 봉합.
--
-- 조치 (AC-1 / AC-T / AC-2):
--   (1) [AC-T 최우선] TRUNCATE = 무조건 REVOKE (allowlist 예외 없음, RLS 미커버 gap).
--   (2) [AC-1] INSERT/UPDATE/DELETE = 전 base 테이블 REVOKE (allowlist=∅, 예외 없음).
--       SELECT 는 무접촉(공개 READ 폼 무훼손 — reservations/customers/services/clinics
--       등 anon read 정책 보존).
--   (3) [AC-1] 재-drift 근본교정 = write-only ALTER DEFAULT PRIVILEGES REVOKE
--       (미래 테이블 anon-write 기본값 차단). 앱 마이그는 postgres 역할로 테이블 생성
--       (prod 123/123 relowner=postgres 실측) → FOR ROLE postgres 대상이 실 re-drift
--       근원과 일치(cosmetic 아님). SELECT 미포함(공개 READ 보존). supabase_admin-owned
--       default_acl 은 앱 테이블 무관 = re-drift 벡터 아님.
--   (4) [AC-2, DA 권고] payment_audit_logs_open(permissive ALL·TO 부재=PUBLIC) →
--       TO authenticated 명시. grant 재유입 시 재개방 벡터 차단. FE 검증: 이 테이블은
--       PaymentEditDialog.tsx(authenticated 스태프)에서만 read/write(:109 insert, :451
--       select) → anon read/write 정상경로 부재 = 공개 READ 폼 아님 → SELECT 무접촉
--       원칙(AC-1) 위배 아님(공개 READ 는 booking 폼 대상).
--
-- 멱등: REVOKE 는 자연 멱등(미보유 권한 회수=no-op). 데이터 mutation 0(권한 메타 acl +
--       정책 메타). 동적 루프로 안전 적용. cross-CRM 영향 0(foot-local).
-- 게이트: REVOKE=가역 tightening(스키마 무변경 · 신규 컬럼/테이블/enum 0) → 대표 게이트
--         면제(autonomy §3.1). supervisor DDL-diff DB-GATE 의무.
-- 롤백: 20260715130000_foot_anon_write_grant_hygiene_sweep.rollback.sql
--       (anon write GRANT 복원 = fork 기본값 + payment_audit_logs_open TO public 복원).
-- 작성: dev-foot / 2026-07-15
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: foot public 스키마 실재 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
        AND table_name IN ('customers','check_ins','checklists','reservations','packages')) < 4 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: expected foot public base tables absent — wrong DB?';
  END IF;
END $preflight$;

-- ── (1)+(2) 동적 sweep: TRUNCATE 무조건 REVOKE + INS/UPD/DEL 전 테이블 REVOKE(allowlist=∅) ──
DO $sweep$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    -- [AC-T] TRUNCATE: 무조건 (RLS 미커버 gap)
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', r.relname);
    -- [AC-1] INS/UPD/DEL: 전 테이블 (allowlist=∅). SELECT 무접촉.
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', r.relname);
  END LOOP;
END $sweep$;

-- ── (3) write-only ALTER DEFAULT PRIVILEGES: 미래 테이블 anon-write 기본값 차단 ──
--   SELECT 미포함(공개 READ 폼 보존).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

-- ── (4) [AC-2] payment_audit_logs_open → TO authenticated (재개방 벡터 차단) ──
--   기존: permissive ALL, TO 부재(=PUBLIC), using=true / check=true.
--   신규: permissive ALL, TO authenticated, using=true / check=true.
--   anon 정상경로 부재 실증(FE PaymentEditDialog.tsx 만 authenticated read/write).
DROP POLICY IF EXISTS payment_audit_logs_open ON public.payment_audit_logs;
CREATE POLICY payment_audit_logs_open ON public.payment_audit_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── (5) VERIFY: 착지 확인(실패 시 abort) ──
DO $verify$
DECLARE
  bad_trunc   int;
  bad_write   int;
  bad_default int;
  bad_ac2     int;
BEGIN
  -- (a) [AC-T] anon TRUNCATE 잔존 0 (전 테이블)
  SELECT count(*) INTO bad_trunc
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND has_table_privilege('anon', c.oid, 'TRUNCATE');
  IF bad_trunc > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % public tables still grant anon TRUNCATE', bad_trunc;
  END IF;

  -- (b) [AC-1] anon INS/UPD/DEL 잔존 0 (전 테이블, allowlist=∅)
  SELECT count(*) INTO bad_write
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF bad_write > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: % public tables still grant anon INS/UPD/DEL', bad_write;
  END IF;

  -- (c) [AC-1] write-only ALTER DEFAULT 착지 — postgres-owned public default_acl 상
  --     anon write(a/w/d/D) 미보유. (SELECT=r 은 보존.)
  SELECT count(*) INTO bad_default
  FROM pg_default_acl d
  CROSS JOIN LATERAL unnest(d.defaclacl) AS acl(item)
  WHERE d.defaclnamespace = 'public'::regnamespace
    AND d.defaclobjtype = 'r'
    AND d.defaclrole = 'postgres'::regrole
    AND acl.item::text LIKE 'anon=%'
    AND (position('a' in split_part(acl.item::text,'=',2)) > 0   -- INSERT
      OR position('w' in split_part(acl.item::text,'=',2)) > 0   -- UPDATE
      OR position('d' in split_part(acl.item::text,'=',2)) > 0   -- DELETE
      OR position('D' in split_part(acl.item::text,'=',2)) > 0); -- TRUNCATE
  IF bad_default > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: pg_default_acl still grants anon write (% entries)', bad_default;
  END IF;

  -- (d) [AC-2] payment_audit_logs_open 이 PUBLIC(oid 0) 미포함 = authenticated-scoped
  SELECT count(*) INTO bad_ac2
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'payment_audit_logs'
    AND p.polname = 'payment_audit_logs_open'
    AND p.polroles @> ARRAY[0::oid];   -- 0 = PUBLIC
  IF bad_ac2 > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: payment_audit_logs_open still targets PUBLIC (AC-2 not applied)';
  END IF;
END $verify$;

COMMIT;
