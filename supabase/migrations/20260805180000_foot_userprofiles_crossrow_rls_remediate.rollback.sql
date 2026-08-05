-- ============================================================================
-- T-20260805-foot-USERPROFILES-CROSSROW-RLS-REMEDIATE · DOWN (rollback)
--   UP 마이그(20260805180000_foot_userprofiles_crossrow_rls_remediate.sql)의 정확한 역연산.
--   데이터 mutation 0 · 비파괴 · 트리거 재배선 없음(함수 본문만 원복). UP 이전 prod 실측 def 복원.
--   ⚠ 보안 하드닝의 rollback = 취약 재개통 — 사고 대응(회귀 발생) 시에만 사용.
-- ============================================================================

-- ── (b1) self_guard 원복: UP 이전 3컬럼(role/approved/clinic_id) def ────────────
CREATE OR REPLACE FUNCTION public.user_profiles_self_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = NEW.id AND NOT is_admin_or_manager() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF COALESCE(NEW.approved,false) IS DISTINCT FROM COALESCE(OLD.approved,false) THEN
      RAISE EXCEPTION 'approved 변경 권한 없음 (admin/manager만 가능)';
    END IF;
    IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
      RAISE EXCEPTION 'clinic_id 변경 권한 없음 (admin/manager만 가능)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.user_profiles_self_guard() IS NULL;

-- ── (b2) force_safe_insert 원복: UP 이전 def(exempt 코어싱 제거) ────────────────
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
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.user_profiles_force_safe_insert() IS NULL;

-- ── (a) 원복: OOB permissive UPDATE 정책 재생성 (UP 이전 prod 실측 shape) ───────
--   USING/CHECK = is_approved_user(), self-scope 부재(원 상태 그대로 — 취약 재개통).
DROP POLICY IF EXISTS "approved users update profiles" ON public.user_profiles;
CREATE POLICY "approved users update profiles" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (is_approved_user())
  WITH CHECK (is_approved_user());
