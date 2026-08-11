-- ============================================================================
-- T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL · UP  (REWRITTEN 2026-08-11)
--   foot(root) public.rrn_encrypt(uuid,text) — customer-scoped in-body UPDATE 에
--   tenant/role assert 부재(GRANT authenticated) → 임의 인증 사용자가 他 clinic
--   고객의 rrn_enc 를 덮어쓸 수 있는 systemic 취약(women 과 동일 shape).
--   ADDITIVE seal: in-body role assert(is_approved_user) + tenant assert
--   (customers.clinic_id = current_user_clinic_id()) 통과 시에만 UPDATE.
--
-- ── ★ REWRITTEN: apply-base = prod 실재 Vault-V2 (STAGE2 dual-key), NOT GUC ──────
--   ⚠ 초판(v1)은 20260520000030_rrn_key_harden(GUC `app.rrn_key`) body 를 byte-preserve
--     base 로 전제 → supervisor MIG-GATE NO-GO(FIX-REQUEST MSG-20260811-151014-419f).
--   prod(rxlomoozakkjesdqjtvd) 실재 rrn_encrypt = **Vault-V2 body**(out-of-band 적용·
--     repo 미추적, provenance = scripts/T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS_apply.mjs
--     (근거 SQL: agents/docs/_draft/sql/rrn_stage2_foot_dual_key_functions.sql · commit 4f502d6)):
--       · key gate  = Vault `vault.decrypted_secrets` WHERE name='foot_rrn_key_v2'
--                     (GUC `app.rrn_key` 완전 제거).
--       · UPDATE    = rrn_enc 암호화 + resident_id=NULL(평문 잔존 scrub)
--                     + rrn_re_encrypted_at=NOW() + rrn_encryption_version=2.
--       · prod def md5(pg_get_functiondef) = 0385d316f5c8d336824ce211ce35281b (pre-seal).
--   → 본 seal 은 이 **Vault-V2 base 위에** role/tenant assert 를 재접붙인다.
--     GUC base 로 회귀 시 (1)prod app.rrn_key 미설정→P0002 전면 RAISE=write-path 파손
--     (2)V2 하드닝(resident_id scrub·version 스탬프) 소실 → 절대 금지.
--
--   change-class = exposure-REDUCING ADDITIVE(Vault-V2 base-preserve):
--     · SECDEF base-preserve: LANGUAGE plpgsql · SECURITY DEFINER ·
--       SET search_path=public,extensions · owner(CREATE OR REPLACE 보존) 불변.
--     · key gate(Vault foot_rrn_key_v2)/암호화식/V2 하드닝 write 3종(resident_id NULL·
--       rrn_re_encrypted_at·version=2)/GRANT(authenticated only, anon 0) = prod Vault-V2 와 동일.
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
--   ⚠ CREATE OR REPLACE FUNCTION = DDL → DDL-0 carve 아님 → supervisor MIG-GATE
--     (DDL-diff + GO-token) 물리 선행 필수. GO-token 前 prod DDL/GRANT 선집행 금지
--     (deploy-precheck C20 · apply_before_go 금지).
--   Ledger Reconciliation: OOB Vault-V2 rrn_encrypt def 를 repo 정본화(forward-doc)로 수렴 →
--     차기 마이그 stale-base 재발 차단. 동명 .ledger_reconcile.md 참조.
--
--   down    : 20260811020000_foot_rrn_encrypt_tenant_binding_seal.rollback.sql
--             (= Vault-V2 pre-seal body 원복, prod def md5 0385d316 재현. GUC 아님.)
--   dryrun  : 20260811020000_foot_rrn_encrypt_tenant_binding_seal.dryrun.mjs
--             (base-body 대조 pre-check[Vault-V2 실재·GUC 부재 fail-closed] + 무영속 post-probe)
-- 작성: dev-foot / 2026-08-11 (REWRITTEN — base 교체)
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + 헬퍼 실재 + Vault-V2 base 컬럼/키 실재 + before-image + 멱등 ──
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
  -- ★ Vault-V2 base 전제: customers.clinic_id + rrn_enc + V2 하드닝 write 3컬럼 실재
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.clinic_id 부재 — tenant 술어 무효';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='rrn_enc') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.rrn_enc 부재 — encrypt write 대상컬럼 무효';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='resident_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.resident_id 부재 — V2 평문 scrub write 무효(Vault-V2 base 아님)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='rrn_re_encrypted_at') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.rrn_re_encrypted_at 부재 — V2 스탬프 write 무효(Vault-V2 base 아님)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='rrn_encryption_version') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: customers.rrn_encryption_version 부재 — V2 버전 스탬프 write 무효(Vault-V2 base 아님)';
  END IF;
  -- ★ Vault-V2 key gate 전제: foot_rrn_key_v2 Vault secret 실재 (구 GUC app.rrn_key 아님)
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='foot_rrn_key_v2') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: vault foot_rrn_key_v2 secret 부재 — Vault-V2 key gate 해소 불가(GUC 회귀 금지)';
  END IF;
  -- 멱등/재실행 안전: 이미 seal 적용됨(재적용 무해하나 drift 감지용 NOTICE)
  v_before_def := pg_get_functiondef('public.rrn_encrypt(uuid, text)'::regprocedure);
  IF position('RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL' in v_before_def) > 0 THEN
    RAISE NOTICE 'PREFLIGHT: rrn_encrypt seal 이미 적용됨 — 멱등 재적용(무해).';
  END IF;
  -- ★ stale-base 가드: 현 base 가 Vault-V2 인지(GUC 아님) 확인 — GUC base 위 seal 접붙이기 금지
  IF position('app.rrn_key' in v_before_def) > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 현 rrn_encrypt base 에 GUC app.rrn_key 잔존 — Vault-V2 base 아님(stale-base). seal 접붙이기 abort.';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- rrn_encrypt : ADDITIVE tenant/role seal (Vault-V2 base 위 재접붙이기)
--   key gate(Vault foot_rrn_key_v2)/암호화식/V2 하드닝 write 3종/GRANT 는 prod
--   Vault-V2 base(rrn_stage2_foot_dual_key_functions.sql)와 동일. 추가분 = 선언 2변수
--   + role/tenant assert 블록 + UPDATE WHERE tenant 술어.
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
  v_new_key       TEXT;
  v_caller_clinic UUID;
  v_cust_clinic   UUID;
BEGIN
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

  -- ── 키 게이트 (Vault-V2 base-preserve: foot_rrn_key_v2 단일 경로, GUC 금지) ──────
  SELECT decrypted_secret INTO v_new_key
    FROM vault.decrypted_secrets
   WHERE name = 'foot_rrn_key_v2';

  IF v_new_key IS NULL OR v_new_key = '' THEN
    RAISE EXCEPTION 'rrn_encrypt: 신키 미설정 (vault foot_rrn_key_v2)';
  END IF;

  -- ── UPDATE (Vault-V2 base-preserve: V2 하드닝 write 3종 보존 + rrn_enc 암호화) ────
  --   UPDATE WHERE 에도 tenant 술어 belt-and-suspenders(TOCTOU 방어·NULL=any-clinic).
  UPDATE public.customers
    SET rrn_enc                = extensions.pgp_sym_encrypt(plain_rrn, v_new_key),
        resident_id            = NULL,        -- 평문 RRN 잔존 scrub (V2 하드닝)
        rrn_re_encrypted_at    = NOW(),       -- 재암호화 스탬프 (V2 하드닝)
        rrn_encryption_version = 2            -- 버전 스탬프 (V2 하드닝)
  WHERE id = customer_uuid
    AND (v_caller_clinic IS NULL OR clinic_id IS NULL OR clinic_id = v_caller_clinic);
END;
$$;

-- GRANT base-preserve: authenticated 만 (anon 재개방 0). prod Vault-V2 와 동일.
GRANT EXECUTE ON FUNCTION public.rrn_encrypt(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.rrn_encrypt(UUID, TEXT) IS
  'T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL: ADDITIVE tenant/role seal on Vault-V2 base. '
  'is_approved_user() role assert + customers.clinic_id=current_user_clinic_id() tenant assert '
  '(NULL=any-clinic 다지점 admin·foot 단일clinic 무회귀). Vault-V2 base-preserve: key gate=foot_rrn_key_v2·'
  'V2 하드닝 write 3종(resident_id NULL scrub·rrn_re_encrypted_at·version=2)·SECDEF/search_path/GRANT '
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

  -- (2) Vault-V2 base-preserve: key gate(foot_rrn_key_v2) + GUC(app.rrn_key) 부재
  IF position('foot_rrn_key_v2' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: Vault-V2 key gate(foot_rrn_key_v2) 미착지 — GUC 회귀 의심';
  END IF;
  IF position('app.rrn_key' in v_def) > 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: GUC app.rrn_key 잔존 — Vault-V2 base-preserve 위반(write-path 파손 위험)';
  END IF;

  -- (3) Vault-V2 base-preserve: V2 하드닝 write 3종 존치(평문 scrub/스탬프/버전 소실 방지)
  IF position('resident_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: resident_id NULL scrub 소실 — V2 하드닝 회귀(평문 RRN 재노출)';
  END IF;
  IF position('rrn_re_encrypted_at' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: rrn_re_encrypted_at 스탬프 소실 — V2 하드닝 회귀';
  END IF;
  IF position('rrn_encryption_version' in v_def) = 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: rrn_encryption_version 버전 스탬프 소실 — V2 하드닝 회귀';
  END IF;

  -- (4) byte-preserve: SECURITY DEFINER 유지 + search_path 유지 (proconfig 로 정밀 판정)
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rrn_encrypt'
      AND pg_get_function_identity_arguments(p.oid)='customer_uuid uuid, plain_rrn text';
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'VERIFY_FAIL: SECURITY DEFINER 소실(byte-preserve 위반)';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_proconfig, ARRAY[]::text[])) AS cfg
    WHERE cfg LIKE 'search_path=%' AND cfg LIKE '%public%' AND cfg LIKE '%extensions%'
  ) INTO v_sp_ok;
  IF NOT v_sp_ok THEN
    RAISE EXCEPTION 'VERIFY_FAIL: search_path(public,extensions) 소실(byte-preserve 위반) — proconfig=%', v_proconfig;
  END IF;

  -- (5) GRANT byte-preserve: authenticated EXECUTE 존치 AND anon 재개방 0
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

  RAISE NOTICE 'VERIFY OK: rrn_encrypt tenant/role seal 착지 + Vault-V2 base-preserve(foot_rrn_key_v2·V2 하드닝 3종·GUC 부재) + SECDEF/search_path/GRANT(authenticated only, anon 0).';
END $verify$;
