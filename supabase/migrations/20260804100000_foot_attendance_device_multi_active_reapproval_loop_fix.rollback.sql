-- ============================================================================
-- ROLLBACK — T-20260804-foot attendance_device multi-active reapproval-loop fix
--   20260804100000_foot_attendance_device_multi_active_reapproval_loop_fix.sql 되돌림.
--   (1) device_token_hash 전역 UNIQUE(uq_attendance_device_token_hash) DROP
--   (2) 직원당 1 active 유니크(uq_attendance_device_active_staff) 재생성
--   (3) approve_attendance_device 형제 auto-revoke 복원
--
-- ⚠⚠ [DA GO 조건] 롤백 = 조건부 one-way door ⚠⚠
--   uq_attendance_device_active_staff 재생성은 '직원당 active ≤ 1' 을 물리 강제한다. FIX 배포 후
--   다기기가 축적되면(동일 staff_id 에 active ≥ 2) CREATE UNIQUE INDEX 는 23505 로 실패한다.
--   → 롤백은 multi-active 데이터가 쌓이기 前(배포 직후)에만 무손실로 가능.
--   ★ foot prod=현재 0행(현장 사용 前)이라 round-trip 무조건 안전. 단, 향후 데이터 축적 시엔
--      먼저 staff당 1 active 로 정리(초과 active revoke)한 뒤에만 본 파일을 실행해야 함
--      (그 정리 = 정책 되돌림 = CEO 재게이트 대상·별도 Backfill SOP, 여기서 자동수행 X).
--      ↓ §0 안전가드가 축적 감지 시 롤백을 명시 중단한다.
--   predicate 는 원본 20260802180000_attendance_qr_port L160-161 원문 그대로 복사(추정 재작성 금지).
--
-- ⚠ attendance_device 행 데이터 무손실(이 롤백은 스키마/함수만 원복).
-- ⚠ 이 파일에는 top-level txn-control(BEGIN/COMMIT) 미포함 — 러너 암묵 배치 txn 원자성.
--   무영속 dry-run 대상이면 별도 봉투에서 BEGIN..ROLLBACK 로 감싼다.
-- ============================================================================

-- 0) 안전가드 — 축적된 multi-active 존재 시 롤백 중단(파괴 방지, 명시적 사전정리 강제).
DO $$
DECLARE
  v_dupe INT;
BEGIN
  SELECT count(*) INTO v_dupe FROM (
    SELECT staff_id
    FROM public.attendance_device
    WHERE status = 'active' AND staff_id IS NOT NULL
    GROUP BY staff_id
    HAVING count(*) > 1
  ) d;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'ROLLBACK 중단(one-way door): 직원당 active≥2 인 staff % 명 존재. uq_attendance_device_active_staff 재생성 불가 — 먼저 staff당 1 active 로 정리(정책 되돌림=CEO 재게이트·별도 Backfill SOP) 후 재실행.', v_dupe;
  END IF;
END $$;

-- 1) device_token_hash 전역 UNIQUE 제거(FIX §2 원복)
DROP INDEX IF EXISTS public.uq_attendance_device_token_hash;

-- 2) 직원당 1 active 부분 유니크 인덱스 재생성 (20260802180000 L160-161 원문 복사)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_device_active_staff
  ON public.attendance_device (staff_id) WHERE status = 'active';

-- 3) approve_attendance_device 형제 auto-revoke 블록 복원
--    (베이스 = 20260802180000 이식본 def: user_profiles 매니저·v_mgr_clinic 스코프 + 형제 revoke UPDATE 복원)
CREATE OR REPLACE FUNCTION public.approve_attendance_device(
  p_device_id UUID,
  p_staff_id  UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_mgr_clinic   UUID;
  v_dev_clinic   UUID;
  v_dev_status   TEXT;
  v_staff_clinic UUID;
  v_staff_active BOOLEAN;
BEGIN
  SELECT clinic_id INTO v_mgr_clinic FROM public.user_profiles
  WHERE id = v_uid AND active = true AND approved = true
    AND role IN ('admin','manager','director');
  IF v_mgr_clinic IS NULL THEN
    RAISE EXCEPTION '권한이 없습니다 (관리자 이상만 기기를 승인할 수 있어요)';
  END IF;

  SELECT clinic_id, status INTO v_dev_clinic, v_dev_status
  FROM public.attendance_device WHERE id = p_device_id;
  IF v_dev_clinic IS NULL THEN
    RAISE EXCEPTION '기기 등록 요청을 찾을 수 없어요';
  END IF;
  IF v_dev_clinic <> v_mgr_clinic THEN
    RAISE EXCEPTION '다른 지점의 기기 요청은 승인할 수 없어요';
  END IF;
  IF v_dev_status <> 'pending' THEN
    RAISE EXCEPTION '이미 처리된 기기 요청이에요 (상태: %)', v_dev_status;
  END IF;

  SELECT clinic_id, active INTO v_staff_clinic, v_staff_active
  FROM public.staff WHERE id = p_staff_id;
  IF v_staff_clinic IS NULL OR v_staff_clinic <> v_mgr_clinic THEN
    RAISE EXCEPTION '직원을 찾을 수 없어요(지점 불일치)';
  END IF;
  IF NOT COALESCE(v_staff_active, false) THEN
    RAISE EXCEPTION '비활성 직원에게는 기기를 바인딩할 수 없어요';
  END IF;

  -- staff당 1 active — 기존 active 기기 revoke(신규 바인딩 우선) [rollback: 복원됨]
  UPDATE public.attendance_device
     SET status = 'revoked'
   WHERE staff_id = p_staff_id AND status = 'active' AND id <> p_device_id;

  UPDATE public.attendance_device
     SET staff_id = p_staff_id, status = 'active',
         approved_by = v_uid, approved_at = now(), bound_at = now()
   WHERE id = p_device_id;

  INSERT INTO public.attendance_audit (clinic_id, staff_id, action, detail)
  VALUES (v_mgr_clinic, p_staff_id, 'device_approved',
          'device ' || p_device_id::text || ' approved by ' || COALESCE(v_uid::text,'?'));

  RETURN jsonb_build_object('ok', true, 'device_id', p_device_id, 'staff_id', p_staff_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_attendance_device(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_attendance_device(UUID, UUID) TO authenticated;
