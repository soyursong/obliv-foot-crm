-- ============================================================================
-- T-20260426-foot-052: staff.user_id 매핑 시드 — RLS 자기배정 판정 정상화
-- ============================================================================
-- foot-006(20260426000000)에서 staff.user_id (FK→auth.users) 컬럼이 추가됐으나
-- 모든 row에서 NULL. is_assigned_to_checkin() 헬퍼 함수가
-- staff.user_id ↔ auth.uid() 매칭으로 판정하므로, 매핑이 비어있으면
-- consultant/coordinator/therapist/technician 모두 자기 배정 check_in 조차 차단됨.
--
-- 본 마이그레이션은 보수적(idempotent) 시드:
--   - name + clinic_id + role 정확 일치 시에만 매핑
--   - WHERE user_id IS NULL 가드 → 재실행 안전
--   - admin/manager는 RLS에서 우회되므로 매핑 불요 (단 director↔admin/manager는 매칭 시도)
--
-- 현 dev DB 상태 (2026-04-26 02:05 KST 정찰):
--   - staff: 21명 (모두 더미, 4/23 동시 생성, user_id 모두 NULL)
--   - user_profiles: 4명 (모두 admin)
--   - 매칭 후보 페어: 0건 → no-op (forward-compatible)
--
-- 운영 시작 시:
--   - foot-048 AdminRegister가 진짜 직원 계정 생성 후 본 SQL 재실행하면 자동 매핑
--   - (또는 foot-048에서 staff INSERT + user_id 동시 매핑 로직 추가가 더 안전 — 별 티켓 권장)
-- ============================================================================

BEGIN;

-- 1) 사전 진단: 매핑 후보 카운트
DO $$
DECLARE
  v_staff_total INT;
  v_staff_unmapped INT;
  v_userprofiles_candidates INT;
BEGIN
  SELECT COUNT(*) INTO v_staff_total
    FROM staff
   WHERE active = true;

  SELECT COUNT(*) INTO v_staff_unmapped
    FROM staff
   WHERE active = true AND user_id IS NULL;

  SELECT COUNT(*) INTO v_userprofiles_candidates
    FROM user_profiles
   WHERE active = true
     AND approved = true
     AND role IN ('director','consultant','coordinator','therapist','technician','admin','manager');

  RAISE NOTICE '[foot-052 pre] staff_total=%, staff_unmapped=%, userprofile_candidates=%',
    v_staff_total, v_staff_unmapped, v_userprofiles_candidates;
END $$;

-- 2) 백업 테이블: 시드 전 staff(id, user_id) 스냅샷 (롤백용)
--    IF NOT EXISTS로 재실행 안전. 다른 시드 작업과 격리 위해 timestamp suffix 부여.
CREATE TABLE IF NOT EXISTS _backup_staff_user_id_20260426 AS
SELECT id, user_id, now() AS snapshot_at
  FROM staff;

COMMENT ON TABLE _backup_staff_user_id_20260426 IS
  'T-20260426-foot-052 시드 전 staff.user_id 스냅샷. 롤백 시 .down.sql이 사용. 시드 안정화 후 별 티켓으로 정리.';

-- 3) 보수적 매핑 — name + clinic_id + role 정확 일치만
--    - WHERE s.user_id IS NULL 로 idempotent 보장
--    - up.approved=true, up.active=true 필터로 비활성/미승인 user 제외
--    - role 매칭 로직:
--      (a) 동일 role 1:1 (consultant↔consultant, coordinator↔coordinator 등)
--      (b) staff.director ↔ user_profiles.admin/manager 일반화 매칭
--    - 1:N 매칭 위험 차단: name+clinic_id+role 조합이 unique하다고 가정
--      (현 staff 더미는 모두 unique한 이름 — 운영 시작 시 동명이인 발생하면 별도 처리)
UPDATE staff s
   SET user_id = up.id
  FROM user_profiles up
 WHERE s.user_id IS NULL
   AND s.active = true
   AND up.active = true
   AND up.approved = true
   AND s.name = up.name
   AND s.clinic_id = up.clinic_id
   AND (
        s.role = up.role
     OR (s.role = 'director' AND up.role IN ('admin','manager'))
   );

-- 4) 사후 진단: 매핑 결과
DO $$
DECLARE
  v_now_mapped INT;
  v_still_null INT;
BEGIN
  SELECT COUNT(*) INTO v_now_mapped
    FROM staff
   WHERE active = true AND user_id IS NOT NULL;

  SELECT COUNT(*) INTO v_still_null
    FROM staff
   WHERE active = true AND user_id IS NULL;

  RAISE NOTICE '[foot-052 post] mapped=%, still_unmapped=%', v_now_mapped, v_still_null;

  IF v_still_null > 0 THEN
    RAISE NOTICE '[foot-052 warn] % staff row remain unmapped. Run AdminRegister sync (foot-048) or supply CSV manually.', v_still_null;
  END IF;
END $$;

COMMIT;
