-- ============================================================================
-- T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE · UP  (STAGE-2 remediation)
--   user_profiles cross-row RLS 과다권한 봉합(벡터B CONFIRMED) + guard 방어심화.
--   change-class = security-TIGHTENING (비파괴·가역·데이터 mutation 0).
--   게이트: DA CONSULT GO(g1k9) + census-clean CONFIRM(m3yk) · CEO 면제(autonomy §3.1)
--          · supervisor PHI DB-GATE(DDL-diff + behavioral 5 assertion + down) = 다음 게이트.
--   SSOT: da_replies/DA-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE.md
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 실취약 (STAGE-1 census, catalog-authoritative · READ-ONLY, commit 81e6cf6d)
-- ══════════════════════════════════════════════════════════════════════════════
--   OOB UPDATE 정책 `approved users update profiles`(USING/CHECK=is_approved_user(),
--   self-scope 부재) → 승인직원이 cross-row 로 임의 user_profiles UPDATE 가능 →
--   authenticated(승인직원) tier → admin 전권상승. guard trg_user_profiles_self_guard 는
--   auth.uid()=NEW.id(own-row)에서만 발화 → cross-row 승격이 guard 완전 우회.
--   census verdict = sub-case-1(clean DROP): legit cross-row caller 공집합
--     · 계정 승인 = 전용 SECDEF chokepoint admin_approve_and_confirm_user (broad 정책 미탑승)
--     · 유일 cross-row 클라 write = Accounts.tsx 2건 (admin/director route-gated → 잔여 admin_all/
--       update_own_or_admin 가 커버) → lockout 0.
--
-- ── (a) PRIMARY: OOB 정책 clean DROP ──────────────────────────────────────────
--   `approved users update profiles` DROP → 잔여 UPDATE 정책 = user_profiles_self_update
--   (id=auth.uid()) / user_profiles_update_own_or_admin (self OR admin) / user_profiles_admin_all
--   (ALL, is_admin_or_manager). 결과: 비-admin = own-row 만 write(guard 발화), cross-row =
--   admin/manager/director(계정관리 legit)만.
--
-- ── (b) 동반 방어심화: guard 3컬럼 확장 + INSERT 병렬 가드 (DA MATERIAL FINDING) ─
--   보호 대상 3컬럼 = access_tier · active · exempt_from_restrictions (crm/women self-pin
--   exact-parity). foot 은 own-row 자기수정/자기생성에 두 기전(belt)이 이미 존재하므로 각 idiom 으로 확장:
--
--   (b1) UPDATE 경로 = trg_user_profiles_self_guard → user_profiles_self_guard()  [REJECT 방식]
--        기존 보호 role/approved/clinic_id 에 access_tier/active/exempt_from_restrictions 3컬럼 편입.
--        ★verify-gate 판정 = YES(co-primary, blocking): foot src/lib/permissions.ts canAccess()
--          L189 `if (isExemptFromRestrictions(s)) return true;` → exempt_from_restrictions 는
--          PERM_MATRIX 전체를 단락하는 실 elevation flag(women permissions.ts:121 동형) →
--          own-row exempt self-set = 실 권한상승 경로 → guard 편입 필수.
--        (a) DROP 은 cross-row 만 봉함 → own-row exempt/tier/active self-set 잔존(직교 gap,
--        women v2.91 (a') LIVE 동형) → (b1)로 봉합.
--
--   (b2) INSERT 경로 = trg_user_profiles_force_safe_insert → user_profiles_force_safe_insert()  [COERCE 방식]
--        ★census 정련(STAGE-2 구현 중 실측): foot 은 self_guard 외에 BEFORE INSERT 코어싱 트리거
--        force_safe_insert 가 이미 존재(OOB·무-마이그 잔차, STAGE-1 census 는 UPDATE 초점이라 미표면화).
--        현행이 role(admin→staff)·access_tier(admin→member)·approved(:=false)·active(coalesce true)를
--        이미 safe-coerce → 자가가입 tier/role/approved elevated 주입은 旣봉합. ★단 유일 미봉합 컬럼 =
--        exempt_from_restrictions (2026-06-20 후발 추가, force_safe_insert 미갱신) = 자가가입 INSERT
--        elevated exempt 주입 경로 잔존. → 현행 코어싱을 그대로 보존하고 `exempt_from_restrictions := false`
--        만 ADDITIVE 추가(coerce idiom 유지). 이로써 DA 3컬럼 INSERT 병렬가드 property 완결
--        (tier/role/approved=旣coerce, exempt=신규coerce, active=旣coalesce).
--        ※ with_check pin 대신 코어싱 트리거 확장 채택 근거: user_profiles self-insert 허용 PERMISSIVE
--          정책 3개 공존(OR-union) → 단일 with_check pin 은 타 정책이 무력화. 트리거는 정책 무관 발화 →
--          OR-union-proof. + legit 자가등록(handle_new_user SECDEF)은 exempt 미지정 → coerce 무해(회귀 0).
--        force_safe_insert 를 CREATE OR REPLACE 로 in-repo 편입(OOB→tracked 개선).
--
-- ── 성격 / 게이트 ──────────────────────────────────────────────────────────────
--   비파괴(DROP POLICY + CREATE OR REPLACE FUNCTION x2). 신규 컬럼/타입/enum/테이블 0.
--   데이터 mutation 0. 멱등(DROP ... IF EXISTS + CREATE OR REPLACE). 트리거 재배선 없음
--   (기존 trg_user_profiles_self_guard=BEFORE UPDATE / trg_user_profiles_force_safe_insert=BEFORE INSERT
--    타이밍·이름 그대로 → 함수 본문만 교체).
--   down: 20260805180000_foot_userprofiles_crossrow_rls_remediate.rollback.sql
--   dryrun: 20260805180000_foot_userprofiles_crossrow_rls_remediate.dryrun.mjs (무영속·state-restored probe)
-- 작성: dev-foot / 2026-08-05
-- ============================================================================

-- ── (0) PREFLIGHT: foot DB 실재 + 대상 오브젝트 확인(오적용 방지, 무영속 abort) ──
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='user_profiles') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: user_profiles 부재 — wrong DB?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — guard 술어 의존 미충족';
  END IF;
  -- (b1) self_guard 트리거·함수 실재(교체 대상)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='user_profiles_self_guard') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: user_profiles_self_guard() 부재 — (b1) 교체 대상 없음';
  END IF;
  -- (b2) force_safe_insert 트리거·함수 실재(교체 대상; OOB 잔차라도 prod 존재 확인)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='public' AND p.proname='user_profiles_force_safe_insert') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: user_profiles_force_safe_insert() 부재 — (b2) 교체 대상 없음(census 정련 전제 위배)';
  END IF;
  -- (b) 대상 3컬럼 실재(참조 컬럼 prod-ABSENT fail-closed, deploy-precheck C12 정합)
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_profiles'
          AND column_name IN ('access_tier','active','exempt_from_restrictions')) < 3 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: guard 대상 3컬럼(access_tier/active/exempt_from_restrictions) 중 일부 부재';
  END IF;
END $preflight$;

-- ── (a) PRIMARY: OOB cross-row escalation 정책 clean DROP ──────────────────────
--   self-scope 부재 permissive UPDATE 정책 제거. legit 의존 0(census sub-case-1). 멱등.
DROP POLICY IF EXISTS "approved users update profiles" ON public.user_profiles;

-- ── (b1) UPDATE guard 재정의: 기존 3컬럼 + access_tier/active/exempt 3컬럼 (own-row·non-admin) ──
CREATE OR REPLACE FUNCTION public.user_profiles_self_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- own-row 자기수정 한정. cross-row·admin/manager/director 는 RLS 정책이 관장(guard 무관).
  IF auth.uid() = NEW.id AND NOT is_admin_or_manager() THEN
    -- 기존 3컬럼(role/approved/clinic_id) — 무회귀 보존
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF COALESCE(NEW.approved,false) IS DISTINCT FROM COALESCE(OLD.approved,false) THEN
      RAISE EXCEPTION 'approved 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
      RAISE EXCEPTION 'clinic_id 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    -- (b1) 신규 3컬럼(access_tier/active/exempt_from_restrictions) — 권한상승 벡터 봉합
    IF NEW.access_tier IS DISTINCT FROM OLD.access_tier THEN
      RAISE EXCEPTION 'access_tier 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF COALESCE(NEW.active,true) IS DISTINCT FROM COALESCE(OLD.active,true) THEN
      RAISE EXCEPTION 'active 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF NEW.exempt_from_restrictions IS DISTINCT FROM OLD.exempt_from_restrictions THEN
      RAISE EXCEPTION 'exempt_from_restrictions 변경 권한 없음 (admin/manager만 가능)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_profiles_self_guard() IS
  'T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE (b1): own-row 자기수정 시 admin/manager 전용 '
  '컬럼 변경 차단(REJECT) — role/approved/clinic_id/access_tier/active/exempt_from_restrictions 6컬럼. '
  'cross-row·admin 은 RLS 정책 관장. (BEFORE UPDATE)';

-- ── (b2) INSERT 코어싱 재정의: 현행 보존 + exempt_from_restrictions 코어싱 ADDITIVE ──
--   현행(role admin→staff / access_tier admin→member / approved:=false / active coalesce)을
--   그대로 유지하고 exempt_from_restrictions:=false 만 추가(자가가입 elevated exempt 주입 중화).
CREATE OR REPLACE FUNCTION public.user_profiles_force_safe_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce on self-insert from non-admins. Admins inserting via privileged paths bypass via SECURITY DEFINER calls.
  NEW.approved := false;
  NEW.active := COALESCE(NEW.active, true);
  IF NEW.role IN ('admin') THEN
    NEW.role := 'staff';
  END IF;
  IF NEW.access_tier IN ('admin') THEN
    NEW.access_tier := 'member';
  END IF;
  -- (b2) T-20260805 추가: 자가가입 INSERT elevated exempt 주입 중화(coerce). legit 자가등록은 미지정 → 무해.
  NEW.exempt_from_restrictions := false;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_profiles_force_safe_insert() IS
  'T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE (b2): 자가가입(BEFORE INSERT) 시 권한상승 컬럼 '
  'safe-coerce — approved:=false, role admin→staff, access_tier admin→member, active coalesce true, '
  'exempt_from_restrictions:=false(신규). OOB 잔차 함수를 in-repo canon 편입.';

-- ── (VERIFY) 착지 상태 확인(실패 시 abort — 무영속) ───────────────────────────
DO $verify$
DECLARE
  v_oob_policy int;
  v_guard_def  text;
  v_fsi_def    text;
BEGIN
  -- (a) OOB 정책 제거 실증
  SELECT count(*) INTO v_oob_policy FROM pg_policies
    WHERE schemaname='public' AND tablename='user_profiles'
      AND policyname='approved users update profiles';
  IF v_oob_policy <> 0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: `approved users update profiles` 정책 미제거 (count=%)', v_oob_policy;
  END IF;

  -- (b1) self_guard 함수에 3컬럼 편입 실증
  SELECT pg_get_functiondef(p.oid) INTO v_guard_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='user_profiles_self_guard';
  IF v_guard_def IS NULL
     OR position('access_tier' IN v_guard_def)=0
     OR position('exempt_from_restrictions' IN v_guard_def)=0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: self_guard 함수 3컬럼 미편입';
  END IF;

  -- (b2) force_safe_insert 함수에 exempt 코어싱 편입 + 현행 코어싱 보존 실증
  SELECT pg_get_functiondef(p.oid) INTO v_fsi_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='user_profiles_force_safe_insert';
  IF v_fsi_def IS NULL
     OR position('exempt_from_restrictions' IN v_fsi_def)=0
     OR position('access_tier' IN v_fsi_def)=0
     OR position('NEW.approved := false' IN v_fsi_def)=0 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: force_safe_insert exempt 코어싱 미편입 또는 현행 코어싱 소실';
  END IF;

  RAISE NOTICE 'VERIFY OK: (a) OOB 정책 DROP + (b1) self_guard 6컬럼 + (b2) force_safe_insert exempt coerce 착지.';
END $verify$;
