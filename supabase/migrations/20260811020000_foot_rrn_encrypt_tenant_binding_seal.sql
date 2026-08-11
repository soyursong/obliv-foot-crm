-- ============================================================================
-- T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL · UP
--   foot(root) public.rrn_encrypt(uuid,text) — customer-scoped in-body UPDATE 에
--   tenant/role assert 부재(GRANT authenticated) → 임의 인증 사용자가 他 clinic
--   고객의 rrn_enc 를 덮어쓸 수 있는 systemic 취약(women 과 동일 shape).
--   ADDITIVE seal: in-body role assert(is_approved_user) + tenant assert
--   (customers.clinic_id = current_user_clinic_id()) 통과 시에만 UPDATE.
--
--   change-class = exposure-REDUCING ADDITIVE(byte-preserve):
--     · SECDEF byte-preserve: LANGUAGE plpgsql · SECURITY DEFINER ·
--       SET search_path=public,extensions · owner(CREATE OR REPLACE 보존) 불변.
--     · GRANT 불변: TO authenticated 만 (anon 재개방 0 · service_role 무접촉).
--     · decrypt READ 무접촉(rrn_decrypt 미변경).
--     · 데이터 mutation 0 · DROP 0 · 신규 컬럼/테이블/enum 0.
--     → CEO 파괴게이트 §3.1 면제(exposure 축소·mutation0). db_change=true(함수 재정의).
--
-- ── ★ foot own-helper census (blind-copy 금지, DA CONSULT-REPLY MSG-20260811-134705-kmfa) ──
--   women 의 current_user_clinic_id()/is_approved_user() 리터럴 복사 금지 요구 →
--   foot 자체 네이티브 헬퍼를 census 로 실측 확인(20260426000000_rls_role_separation.sql):
--     · public.current_user_clinic_id() : SELECT clinic_id FROM user_profiles
--         WHERE id=auth.uid() LIMIT 1. (SECDEF·STABLE·search_path=public·GRANT authenticated)
--     · public.is_approved_user()       : approved=true AND active=true (동 파일 네이티브 정의)
--   ⇒ 두 헬퍼는 foot 네이티브(women 복사 아님). is_staff_clinic()=foot 부재(DA 명시) → 미사용.
--   tenant 술어 형태 = health_q_create_token_canonical_identity(DA CONSULT MSG-20260630-192615
--     -6mts) 준용: `is_approved_user() AND (current_user_clinic_id() IS NULL OR
--     <target>.clinic_id = current_user_clinic_id())`.
--     · current_user_clinic_id() IS NULL = 다지점 admin/manager(user_profiles.clinic_id NULL)
--       = any-clinic 허용(foot 단일clinic 현재 동작 무변·미래 다지점 forward 격리).
--     · customer.clinic_id IS NULL(레거시 clinic 미스탬프 고객) = 단일clinic 무-cross-tenant →
--       무회귀 위해 허용(현 동작 유지). cross-tenant 차단 = 양측 clinic 알려짐 AND 상이 시만.
--
-- ── 단일-clinic 회귀0 근거 ────────────────────────────────────────────────────
--   caller = 데스크 스태프 JWT(CustomerChartPage.tsx supabase.rpc('rrn_encrypt')). 정당
--   스태프 = approved+active AND own-clinic = customer.clinic_id → seal 통과(무변).
--   다지점 admin(clinic NULL) = any-clinic 통과. 차단되는 유일 경로 = 他 clinic 인증
--   사용자의 cross-tenant 덮어쓰기(현 취약) — 정당 단일clinic 동선엔 부재.
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   DA CONSULT-REPLY = ADDITIVE seal doctrine(cross-fork settled·신규 DA게이트 불요).
--   ⚠ CREATE OR REPLACE FUNCTION = DDL → DDL-0 carve 아님 → supervisor DB-GATE
--     (DDL-diff + GO-token) 물리 선행 필수. GO-token 前 prod DDL/GRANT 선집행 금지
--     (deploy-precheck C20 · apply_before_go 금지).
--
--   down    : 20260811020000_foot_rrn_encrypt_tenant_binding_seal.rollback.sql
--   dryrun  : 20260811020000_foot_rrn_encrypt_tenant_binding_seal.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-11
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + 헬퍼 실재 + before-image(seal 미적용) + 멱등 ──────────
DO $preflight$
DECLARE
  v_before_def text;
BEGIN
  -- 대상 함수 실재 (wrong-DB 오적용 방지)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rrn_encrypt'
      AND pg_get_function_identity_arguments(p.oid)='customer_uuid uuid, plain_rrn text'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: public.rrn_encrypt(uuid,text) 부재 — wrong DB?';
  END IF;
  -- tenant/role 술어 헬퍼 실재 (술어 해소 불가 시 abort)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — tenant 술어 해소 불가';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_approved_user') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_approved_user() 부재 — role 술어 해소 불가';
  END IF;
  -- customers.clinic_id 컬럼 실재 (tenant 술어 대상 컬럼)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='clinic_id'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.clinic_id 부재 — tenant 술어 무효';
  END IF;
  -- 멱등/재실행 안전: 이미 seal 적용됨(재적용 무해하나 drift 감지용 NOTICE)
  v_before_def := pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure);
  IF position('RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL' in v_before_def) > 0 THEN
    RAISE NOTICE 'PREFLIGHT: rrn_encrypt seal 이미 적용됨 — 멱등 재적용(무해).';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- rrn_encrypt : ADDITIVE tenant/role seal (byte-preserve 재정의)
--   키-게이트/암호화식/GRANT 는 20260520000030_rrn_key_harden.sql 와 byte-identical.
--   추가분 = 선언 2변수 + role/tenant assert 블록 + UPDATE WHERE tenant 술어.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rrn_encrypt(
  customer_uuid UUID,
  plain_rrn     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key           TEXT;
  v_caller_clinic UUID;
  v_cust_clinic   UUID;
BEGIN
  -- ── 키 게이트 (byte-preserve: rrn_key_harden AC-1 원형) ──────────────────────
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'app.rrn_key not configured — RRN encryption unavailable'
      USING ERRCODE = 'P0002',
            HINT    = 'Run: ALTER DATABASE postgres SET app.rrn_key = ''<your-secret-key-min-32-chars>'';';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL (ADDITIVE seal)
  --   role assert  : approved+active 사용자만 (unapproved authenticated 차단)
  --   tenant assert: caller clinic == customer clinic (cross-tenant write 차단)
  --                  NULL=any-clinic(다지점 admin) · 술어 = foot 네이티브 헬퍼.
  -- ══════════════════════════════════════════════════════════════════════════
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'rrn_encrypt: unauthorized — approved user required'
      USING ERRCODE = '42501';
  END IF;

  v_caller_clinic := public.current_user_clinic_id();
  SELECT clinic_id INTO v_cust_clinic
    FROM public.customers
   WHERE id = customer_uuid;

  -- cross-tenant 차단: 양측 clinic 이 모두 알려졌고 상이할 때만 거부(무회귀).
  IF v_caller_clinic IS NOT NULL
     AND v_cust_clinic IS NOT NULL
     AND v_cust_clinic <> v_caller_clinic THEN
    RAISE EXCEPTION 'rrn_encrypt: cross-tenant write denied'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE WHERE 에도 tenant 술어 belt-and-suspenders(TOCTOU 방어·NULL=any-clinic).
  UPDATE public.customers
    SET rrn_enc = extensions.pgp_sym_encrypt(plain_rrn, v_key)
  WHERE id = customer_uuid
    AND (v_caller_clinic IS NULL OR clinic_id IS NULL OR clinic_id = v_caller_clinic);
END;
$$;

-- GRANT byte-preserve: authenticated 만 (anon 재개방 0). rrn_key_harden 와 동일.
GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.rrn_encrypt(UUID, TEXT) IS
  'T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL: ADDITIVE tenant/role seal. '
  'is_approved_user() role assert + customers.clinic_id=current_user_clinic_id() tenant assert '
  '(NULL=any-clinic 다지점 admin·foot 단일clinic 무회귀). byte-preserve: SECDEF/search_path/GRANT '
  'authenticated 불변·decrypt READ 무접촉·anon 재개방 0. census=foot 네이티브 헬퍼(women blind-copy 아님).';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_def       text;
  v_secdef    boolean;
  v_proconfig text[];
  v_sp_ok     boolean;
  v_grant_ok  boolean;
  v_anon_ok   boolean;
BEGIN
  v_def := pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure);

  -- (1) seal 착지: role + tenant assert 술어 실존
  IF position('is_approved_user' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: role assert(is_approved_user) 미착지';
  END IF;
  IF position('current_user_clinic_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: tenant assert(current_user_clinic_id) 미착지';
  END IF;
  IF position('cross-tenant write denied' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: cross-tenant 차단 분기 미착지';
  END IF;

  -- (2) byte-preserve: SECURITY DEFINER 유지 + (3) search_path 유지 (proconfig 로 정밀 판정)
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rrn_encrypt'
      AND pg_get_function_identity_arguments(p.oid)='customer_uuid uuid, plain_rrn text';
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'VERIFY_FAIL: SECURITY DEFINER 소실(byte-preserve 위반)';
  END IF;

  -- (3) byte-preserve: search_path 에 public + extensions 둘 다 고정 (proconfig element 검사)
  SELECT EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_proconfig, ARRAY[]::text[])) AS cfg
    WHERE cfg LIKE 'search_path=%' AND cfg LIKE '%public%' AND cfg LIKE '%extensions%'
  ) INTO v_sp_ok;
  IF NOT v_sp_ok THEN
    RAISE EXCEPTION 'VERIFY_FAIL: search_path(public,extensions) 소실(byte-preserve 위반) — proconfig=%', v_proconfig;
  END IF;

  -- (4) GRANT byte-preserve: authenticated EXECUTE 존치 AND anon 재개방 0
  SELECT has_function_privilege('authenticated', 'public.rrn_encrypt(uuid, text)', 'EXECUTE')
    INTO v_grant_ok;
  IF NOT v_grant_ok THEN
    RAISE EXCEPTION 'VERIFY_FAIL: authenticated EXECUTE 소실(GRANT byte-preserve 위반)';
  END IF;
  SELECT has_function_privilege('anon', 'public.rrn_encrypt(uuid, text)', 'EXECUTE')
    INTO v_anon_ok;
  IF v_anon_ok THEN
    RAISE EXCEPTION 'VERIFY_FAIL: anon EXECUTE 재개방 감지(anon 재개방 금지 위반)';
  END IF;

  RAISE NOTICE 'VERIFY OK: rrn_encrypt tenant/role seal 착지 + SECDEF/search_path/GRANT(authenticated only, anon 0) byte-preserve.';
END $verify$;
