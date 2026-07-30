-- T-20260730-foot-CLOSING-READER-DB-PROVISION — 매출전령 수신측 foot DB 리더 프로비저닝
-- SSOT 계약: memory/_handoff/da_replies/DA-REPLY-T-20260718-meta-CLOSING-HERALD-XCRM-PROGRAM-reader-registry.md (§3·§4)
-- 부모: T-20260718-meta-CLOSING-HERALD-XCRM-PROGRAM / program: closing-herald-cross-crm-port (foot=Wave1 레퍼런스 선행)
-- 정본 idiom: 롱레(happy-flow-queue) 골든 —
--   • 20260711150000_closing_outbox_readfn_role.sql (parent role + USAGE + EXECUTE + REVOKE)
--   • 20260711160000_readfn_execute_denyall.sql      (anon EXECUTE 노출 P0 봉합 codify)
--   • 20260715170000_outbox_reader_login_role.sql    (LOGIN role + read-only/timeout 하드닝 + ASSERT)
--   da_decision_longre_outbox_reader_credential_20260715 (transport = 직접 PG LOGIN role) 동형 복제.
-- body 골든(T-20260730-body-CLOSING-READER-DB-PROVISION, deploy-ready 07-30)과 동형 템플릿 —
--   센터별 DB(별도 Supabase project rxlomoozakkjesdqjtvd)라 롤 이름 충돌 무관. body 실측 2개 보정 반영(하단 ★).
--
-- 무엇: foot Supabase(obliv-foot-crm) prod 에 매출전령 리더가 소비할 최소권한 read surface 신설.
--   (A) SECDEF read fn read_closing_confirmed_events  (B) 롤 2종  (C) grants/REVOKE(default-deny)  (D) ASSERT 자가검증
--   전건 ADDITIVE(CREATE FUNCTION / CREATE ROLE / GRANT+REVOKE). 데이터 파괴 0·컬럼 drop 0.
--   → autonomy §3.1 대표 게이트 면제, supervisor DDL-diff + 42501 적대실증 게이트.
--
-- ★ posture (DA §4, 롱레 승계):
--   • transport = 직접 PG LOGIN role (durable·플랫폼 독립). sb_secret(≡service_role BYPASSRLS) 금지·role-claim JWT 비권장.
--     ★ 그러므로 authenticator 멤버십(PostgREST JWT role-switch) 부여 안 함 — 롱레 parent(20260711150000)와의
--       의도적 divergence(롱레 LOGIN 결정 20260715 이전 잔재). 본 계약 transport = 직접 PG LOGIN 전용.
--       (body 실측 보정 #2 = "authenticator JWT 멤버십 미부여" 동형.)
--   • fn EXECUTE-only. closing_confirmed_outbox 직접 grant 없음 → 직접 SELECT 시 42501(SECDEF fn 이 sole read surface).
--   • INSERT/UPDATE/DELETE 0, 타 테이블(PHI) 0. anon/authenticated/PUBLIC REVOKE(default-deny).
--   • ★비밀번호는 본 마이그에 미포함. mgosu_outbox_reader_login 은 NOLOGIN 로 생성 → 별도 git-미커밋
--     ALTER ROLE ... LOGIN PASSWORD 주입 스크립트(supervisor prod exec 전용, ~/.config/medibuilder-secrets/)로 LIVE.
--     (롱레 20260715170000 + ALTER ROLE PASSWORD 2단 절차 동형.)
--
-- ★ REVOKE 를 CREATE OR REPLACE FUNCTION 바로 뒤에 결착하는 이유(롱레 160000 P0 lesson):
--   Supabase public default privileges 는 함수 CREATE(OR REPLACE) 시마다 PUBLIC(→anon/authenticated) EXECUTE 를
--   자동 부여한다. SECDEF(RLS 우회) 함수에 anon EXECUTE 가 붙으면 무인증(publishable 키)으로 매출·PHI 라이브 노출.
--   → 함수 정의와 REVOKE 를 반드시 같은 마이그에 묶어 재적용 시에도 default-deny 재보장.
--
-- ★ keyset 복합커서 (DA §3): (created_at, event_id) — event_id=gen_random_uuid(비단조)라 uuid 단독커서 금지,
--   created_at 단독커서도 동시각 경계행 silent skip hazard. 복합키셋만 correct-by-construction(skip0·dup0·LIMIT안전).
--   ★ 롱레 현행 fn(after_created_at TEXT 단일커서)은 일마감 그레인이라 라이브 유지 — 신규 센터(foot)는 처음부터 keyset.
--
-- ★ body 실측 보정 #1 (schema USAGE) — foot prod 실측 결과 반영:
--   body prod 는 public 스키마 USAGE 를 PUBLIC 에 미부여(anon/authenticated/service_role 명시부여만)라 reader 가
--   별도 USAGE 필요했다. ★foot prod 실측(2026-07-30): public nspacl 에 PUBLIC(=U/pg_database_owner) USAGE 존재 →
--   reader 는 PUBLIC 경유로 이미 USAGE 상속(fn 이름해석 성립). 그럼에도 아래 GRANT USAGE 를 명시 유지하는 이유 =
--   (a) 롱레/​body 골든 idiom 정합(템플릿 1개 통일), (b) 방어심층(향후 PUBLIC USAGE 회수돼도 reader 무영향),
--   (c) 멱등·additive(재부여 안전). USAGE 만으론 테이블 접근 불가(테이블별 SELECT 무grant 유지 → 직접 SELECT 42501 불변).
--
-- clinic_slugs=[jongno-foot, songdo-foot] (레지스트리 foot 행 — 1 DB 가 2 slug 서빙, payload.clinic_slug 로 구분).
--   ★slug 화이트리스트는 수신측 레지스트리(dev-sales) 검증 키이지 본 DB read surface 의 필터 아님(fn 은 전 slug 반환).
--
-- 대상 테이블 = public.closing_confirmed_outbox (foot emit-side, prod 실재 확인 2026-07-30:
--   컬럼 event_id/clinic_slug/payload/revision/created_at/dlq/superseded 전건 present).
-- 멱등: CREATE OR REPLACE FUNCTION / 롤 존재체크 DO 블록 / GRANT·REVOKE 재실행 안전.
-- rollback: 20260730160000_foot_closing_reader_provision.rollback.sql
-- dryrun : scripts/dryrun_foot_closing_reader_provision_T-20260730.mjs (dryrun_lib runDryrun, post-probe absent)
-- 작성: dev-foot / 2026-07-30

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- A) SECDEF read fn (계약 §3) — allowlist 5컬럼 최소 read surface, keyset 복합커서
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.read_closing_confirmed_events(
    p_after_created_at timestamptz DEFAULT NULL,   -- watermark.last_created_at (NULL=cold-start)
    p_after_event_id   uuid        DEFAULT NULL,    -- watermark.last_event_id (keyset tiebreaker)
    p_limit            int         DEFAULT 200
)
RETURNS TABLE (
    event_id    uuid,        -- dedup 키(리더 SQLite UNIQUE)
    clinic_slug text,        -- 라우팅 키(payload 승격, HARD-DROP 게이트)
    payload     jsonb,       -- schema_version 2 전체(split/month/kpi) — 렌더 소스
    revision    int,         -- 재확정/supersession 처리
    created_at  timestamptz  -- watermark 전진값
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT event_id, clinic_slug, payload, revision, created_at
    FROM public.closing_confirmed_outbox
    WHERE dlq = false
      AND COALESCE(superseded, false) = false
      AND (
            p_after_created_at IS NULL
         OR (created_at, event_id) > (p_after_created_at, p_after_event_id)
          )
    ORDER BY created_at, event_id
    LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

COMMENT ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) IS
  'T-20260730-foot-CLOSING-READER: 매출전령 리더 sole read surface(SECDEF). keyset 복합커서 (created_at,event_id). '
  'dlq=false AND superseded=false. EXECUTE=mgosu_outbox_reader 만. 롱레 07-15 posture 동형.';

-- ── A1) EXECUTE default-deny 강제 (fn CREATE 바로 뒤 결착 — 롱레 160000 P0 lesson) ──
--   재적용(CREATE OR REPLACE) 시 Supabase 가 재부여하는 PUBLIC/anon/authenticated EXECUTE 를 매번 회수.
REVOKE EXECUTE ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) FROM authenticated;

-- ══════════════════════════════════════════════════════════════════
-- B) 롤 2종 (계약 §4) — 멱등 DO 블록(CREATE ROLE 는 IF NOT EXISTS 미지원)
--    mgosu_outbox_reader        : NOLOGIN 권한 컨테이너(schema USAGE + fn EXECUTE 만 보유)
--    mgosu_outbox_reader_login  : LOGIN principal(비번은 별도 주입 전까지 NOLOGIN 유지 → 접속 불가)
--                                 IN ROLE mgosu_outbox_reader INHERIT → 멤버십으로 USAGE+EXECUTE 상속
-- ══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mgosu_outbox_reader') THEN
    CREATE ROLE mgosu_outbox_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mgosu_outbox_reader_login') THEN
    -- ★비번 미설정 + NOLOGIN 로 생성 → 별도 ALTER ROLE ... LOGIN PASSWORD(git-미커밋, supervisor) 로 LIVE.
    CREATE ROLE mgosu_outbox_reader_login NOLOGIN INHERIT IN ROLE mgosu_outbox_reader;
  END IF;
END
$$;

COMMENT ON ROLE mgosu_outbox_reader IS
  'T-20260730-foot-CLOSING-READER: 매출전령 리더 최소권한 role(NOLOGIN). schema public USAGE + read fn EXECUTE 전용. '
  'closing_confirmed_outbox 직접 SELECT 없음(무grant → 42501). 타 테이블(PHI) 0. service_role 전권 분리.';
COMMENT ON ROLE mgosu_outbox_reader_login IS
  'T-20260730-foot-CLOSING-READER: 리더 LOGIN principal. IN ROLE mgosu_outbox_reader(INHERIT) → USAGE+EXECUTE 상속. '
  '자체 직접권한 0. 비번/LOGIN 은 별도 git-미커밋 ALTER ROLE 주입(supervisor) 후 LIVE.';

-- ══════════════════════════════════════════════════════════════════
-- C) grants (계약 §4) — schema USAGE + fn EXECUTE 만. 테이블 SELECT 부여 안 함.
--    ★ schema USAGE = 함수 해석(name resolution) 근거(롱레 golden idiom). foot prod 는 PUBLIC USAGE 존재(실측)로
--      reader 가 이미 상속하나, 방어심층·템플릿 정합·멱등 위해 명시 부여 유지(상단 ★ body 보정 #1 참조).
--      USAGE 만으로는 테이블 접근 불가(테이블별 SELECT 무grant 유지 → 직접 SELECT 42501 불변).
-- ══════════════════════════════════════════════════════════════════
GRANT USAGE   ON SCHEMA public TO mgosu_outbox_reader;
GRANT EXECUTE ON FUNCTION public.read_closing_confirmed_events(timestamptz, uuid, int) TO mgosu_outbox_reader;

-- ── C1) LOGIN role 하드닝 (롱레 20260715170000 승계) — 읽기전용·타임아웃 방어심층 ──
ALTER ROLE mgosu_outbox_reader_login SET default_transaction_read_only = on;
ALTER ROLE mgosu_outbox_reader_login SET statement_timeout = '30s';
ALTER ROLE mgosu_outbox_reader_login SET idle_in_transaction_session_timeout = '60s';

-- ══════════════════════════════════════════════════════════════════
-- D) ASSERT 자가검증 (posture 회귀 방지) — 위반 시 RAISE 로 마이그 abort.
--    ★ 이 블록이 dry-run(무영속) 트랜잭션 내에서도 실행 → grant matrix 정합의 dev 자가확인(AC #6 의 in-txn 실증).
--      live psql 42501 실증은 supervisor 비번 주입 후 게이트(apply 러너 POSTCHECK 참조).
-- ══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- (a) 롤 2종 존재
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader') THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader 부재'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader_login') THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader_login 부재'; END IF;
  -- (b) login 은 아직 NOLOGIN(비번 주입 전) — LOGIN 이면 위험(비번 없이 LOGIN 속성 노출)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader_login' AND rolcanlogin) THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader_login 이 LOGIN(비번 주입 전 NOLOGIN 이어야)'; END IF;
  -- (c) login 은 위험 속성(superuser/createrole/createdb/bypassrls) 0
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader_login'
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)) THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader_login 위험 role 속성 보유'; END IF;
  -- (d) 부모 멤버십(권한 상속 근거)
  IF NOT pg_has_role('mgosu_outbox_reader_login','mgosu_outbox_reader','MEMBER') THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader 멤버십 부재'; END IF;
  -- (e) reader schema USAGE 보유(함수 해석 근거)
  IF NOT has_schema_privilege('mgosu_outbox_reader','public','USAGE') THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader schema public USAGE 없음'; END IF;
  -- (f) reader fn EXECUTE 보유
  IF NOT has_function_privilege('mgosu_outbox_reader',
        'public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERT FAIL: read_closing_confirmed_events EXECUTE 없음'; END IF;
  -- (g) anon/authenticated fn EXECUTE 0 (default-deny)
  IF has_function_privilege('anon','public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE')
   OR has_function_privilege('authenticated','public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERT FAIL: anon/authenticated 가 read fn EXECUTE 보유(default-deny 위반)'; END IF;
  -- (h) reader 는 outbox 직접 SELECT 0 (42501 근거)
  IF has_table_privilege('mgosu_outbox_reader','public.closing_confirmed_outbox','SELECT') THEN
    RAISE EXCEPTION 'ASSERT FAIL: mgosu_outbox_reader 가 closing_confirmed_outbox 직접 SELECT 보유'; END IF;
END
$$;

COMMIT;
