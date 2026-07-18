-- ============================================================================
-- T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX · UP  (women 동형 승계, adopted=B)
--   풋센터CRM 자가회원가입 최초 user_profiles 생성 정당경로 = auth.users 표준 트리거.
--   벤더잔차(Dashboard Auth Hook) handle_new_user 를 in-repo 표준 트리거로 **canon 재정의**.
--   parent: T-20260718-women-SELFREG-PROFILE-CREATE-PATH-FIX (deployed, DA GO primary=B).
--   DA verdict: GO (DA=제안자/IMPROVE-PROPOSAL 발원 → §S2.4 CONSULT 게이트 선충족).
--
-- ══════════════════════════════════════════════════════════════════════════════
-- foot 현 상태 (BEFORE prod introspection 실측, 2026-07-18)
-- ══════════════════════════════════════════════════════════════════════════════
--   women 과 달리 foot 은 **이미** on_auth_user_created → public.handle_new_user() 가
--   prod 에 존재(벤더잔차). 실측:
--     · owner=postgres, SECURITY DEFINER=true, anon EXECUTE=false  (여기까진 OK)
--     · SET search_path TO 'public'  ← **미검증 잔차**(canon 은 search_path='' 요구)
--     · authenticated EXECUTE=true   ← PUBLIC grant 잔재(RPC surface — 회수 필요)
--     · 본문 로직 잔차(canon 위배):
--         - 최초 유저(count=0) → role='admin', approved=TRUE 자동승격  ← **권한 자기부트스트랩 백도어**
--         - approved 를 서버강제하지 않음(count 분기)
--         - raw_user_meta_data.role(자기신고) 미반영 + 화이트리스트 검증 없음
--   ∴ 본 마이그 = 벤더잔차 함수를 canon 규약으로 **CREATE OR REPLACE 재정의**(비파괴).
--     신규 컬럼/타입/enum/테이블 0. 데이터 mutation 없음(정의만 교체). 트리거 배선 재확인.
--
-- ── canon 규약 이행 매핑 (women HC1~4 parity) ─────────────────────────────────
--   [HC1] role authz-trust 금지 → approved := FALSE **서버강제**(count 분기·client 값 무시).
--         role = raw_user_meta_data.role(자기신고)를 화이트리스트로 검증 후 저장. 밖/누락 → 'staff'.
--         admin/director 자기선언 차단(화이트리스트 배제) → 비특권 강등. 실 권한=스태프 승인(트리거 밖).
--         ⇒ 최초유저 admin+approved 자동승격 백도어 제거(보안 하드닝).
--   [HC2] failure-safe → EXCEPTION WHEN OTHERS → RAISE WARNING + RETURN NEW.
--         함수 결함이 signup 트랜잭션을 막지 않는다(최악=orphan → 별건 백필). anti-signup-block.
--   [HC3] FE 직접 INSERT 제거는 ③단계(②검증 GREEN 후). RLS authenticated-only(0515) 무변경
--         (SECDEF/owner=postgres 로 RLS 우회 INSERT → 정책 접촉 0).
--   [HC4] Dashboard 'Auth Hook'(코드밖) 아님 → 마이그로 관리되는 on_auth_user_created →
--         public.handle_new_user() 표준 트리거로 canon. owner=postgres 명시(supabase_admin 잔차 제거).
--         SET search_path='' 명시(스키마 오염 차단). anon-EXEC surface 증가 0(PUBLIC/anon REVOKE).
--
-- ── 성격 / 게이트 ──────────────────────────────────────────────────────────────
--   비파괴(CREATE OR REPLACE, 데이터 무영향). anon table-write 재노출 0, anon EXECUTE 증가 0.
--   멱등: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + ON CONFLICT(id) DO NOTHING.
--   CEO 게이트 면제(autonomy §3.1, 비파괴+DA GO) + supervisor DDL-diff DB-GATE 의무 + applied_at evidence.
--   dryrun: dryrun_lib.mjs 무영속 harness(canon-marker absence probe — 함수 pre-exist 이므로 procAbsent 부적).
--   롤백:   20260718220000_foot_selfreg_handle_new_user_canon.rollback.sql
--           (⚠ DROP 아님 — foot 은 함수가 pre-exist 하므로 BEFORE 벤더잔차 정의로 CREATE OR REPLACE 복원.)
-- 작성: dev-foot / 2026-07-18
-- ============================================================================

-- ── (0) PREFLIGHT: foot DB 실재 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('user_profiles','clinics')) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: user_profiles/clinics 부재 — wrong DB?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='auth' AND table_name='users') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: auth.users 부재 — wrong DB?';
  END IF;
END $preflight$;

-- ── (1) 트리거 함수 canon 재정의: signUp(auth.users INSERT) → user_profiles 최초생성 ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_role       text;
  v_name       text;
  v_clinic_id  uuid;
  -- [HC1] 자기등록 허용 직책 화이트리스트(Register.tsx ROLES 와 동일, women parity).
  --       admin/director/part_lead 등 특권 role 은 배제 → 자기선언 승격 차단.
  v_allowed    text[] := ARRAY['consultant','coordinator','therapist','technician','tm','manager'];
BEGIN
  -- [HC1] role = 자기신고 요청값(raw_user_meta_data.role). 화이트리스트 밖/누락 → 'staff' 안전기본.
  v_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  IF v_role IS NULL OR NOT (v_role = ANY(v_allowed)) THEN
    v_role := 'staff';
  END IF;

  v_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), NEW.email);

  -- clinic_id: 서버측 파생(단일지점 foot = slug 'jongno-foot'). 부재/모호 시 NULL(승인 시 배정).
  SELECT c.id INTO v_clinic_id
    FROM public.clinics c
   WHERE c.slug = 'jongno-foot'
   LIMIT 1;

  -- [HC1] approved := FALSE **서버강제**(count 분기·client 값 무시 — 최초유저 admin 백도어 제거).
  --       active=true(기본). 멱등(ON CONFLICT).
  INSERT INTO public.user_profiles (id, email, name, role, clinic_id, approved, active)
  VALUES (NEW.id, NEW.email, v_name, v_role, v_clinic_id, false, true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  -- [HC2] failure-safe: 어떤 결함도 signup 트랜잭션을 막지 않는다(RETURN NEW). 최악=orphan(별건 백필).
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile 생성 실패(무시, signup 계속) uid=% sqlstate=% msg=%',
      NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$fn$;

-- [HC4] owner=postgres 명시(supabase_admin 잔차 금지 — 벤더잔차化 방지, DA §15-5-8).
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- anon-EXEC surface 증가 0 + authenticated RPC 잔재 회수: PUBLIC/anon EXECUTE 회수
-- (트리거는 grant 무관 발화 — 함수를 RPC 로 호출 가능한 표면만 제거).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;

COMMENT ON FUNCTION public.handle_new_user() IS
  'T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX (women 동형 승계, adopted=B): auth.users INSERT 시 '
  'user_profiles 최초생성(approved=false 서버강제, role=자기신고 화이트리스트/그외 staff, clinic_id=jongno-foot 파생). '
  'failure-safe(EXCEPTION→RETURN NEW). SECURITY DEFINER/owner=postgres/search_path=''. 벤더잔차 canon 재정의.';

-- ── (2) 표준 트리거 배선 canon 재확인: on_auth_user_created (postgres-owned, in-lane) ──
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── (3) VERIFY: canon 착지 상태 확인(실패 시 abort — 무영속) ──
DO $verify$
DECLARE
  v_secdef    boolean;
  v_owner     text;
  v_anon_exec boolean;
  v_config    text[];
  v_trig      int;
BEGIN
  SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner), p.proconfig
    INTO v_secdef, v_owner, v_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='handle_new_user';

  IF v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'VERIFY_FAIL: handle_new_user 가 SECURITY DEFINER 아님';
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'VERIFY_FAIL: handle_new_user owner=% (postgres 기대 — HC4/§15-5-8)', v_owner;
  END IF;

  -- [foot 변형] search_path='' canon 확인(벤더잔차 search_path=public 제거 실증).
  --   SET search_path='' 는 proconfig 에 'search_path=' (빈값)으로 저장. 'search_path=public' 이면 잔차.
  IF (v_config @> ARRAY['search_path=public']) OR (v_config @> ARRAY['search_path="public"']) THEN
    RAISE EXCEPTION 'VERIFY_FAIL: handle_new_user search_path 잔차(public) 미제거 — config=%', v_config;
  END IF;
  IF NOT (v_config @> ARRAY['search_path='] OR v_config @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'VERIFY_FAIL: handle_new_user search_path='''' 미설정 — config=%', v_config;
  END IF;

  -- anon EXECUTE 부재(surface 증가 0)
  SELECT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') INTO v_anon_exec;
  IF v_anon_exec THEN
    RAISE EXCEPTION 'VERIFY_FAIL: handle_new_user 가 anon EXECUTE 보유(surface 증가) — 봉합 실패';
  END IF;

  -- 트리거 실재(auth.users, non-internal)
  SELECT count(*) INTO v_trig
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='auth' AND c.relname='users' AND t.tgname='on_auth_user_created' AND NOT t.tgisinternal;
  IF v_trig <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: on_auth_user_created 트리거 auth.users 에 부재(count=%)', v_trig;
  END IF;

  RAISE NOTICE 'VERIFY OK: handle_new_user SECDEF/owner=postgres/search_path=''''/anon-exec=false + on_auth_user_created 실재.';
END $verify$;
