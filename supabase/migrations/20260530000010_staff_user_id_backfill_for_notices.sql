-- ============================================================================
-- T-20260530-foot-NOTICE-CREATEDBY-BACKFILL: staff.user_id 백필 (공지 작성자 추적 복원)
-- ============================================================================
-- 배경:
--   notices.created_by FK → staff(id) 인데, 로그인 사용자(auth.uid())는
--   user_profiles 에만 있고 staff.user_id 매핑이 비어있어 FE가 created_by=null 로
--   고정해 왔다(부모 티켓 T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL).
--   FE 는 본 티켓에서 staff.user_id 역조회로 created_by 를 채우도록 수정됐고,
--   그 전제 데이터(staff.user_id)를 idempotent 하게 보강하는 것이 이 마이그레이션.
--
-- 성격:
--   - 보수적 idempotent 백필. name + clinic_id 정확 일치 + WHERE user_id IS NULL 가드.
--   - 기존 매핑(20260426020500 / 20260523010000)을 덮어쓰지 않음 (재실행 안전).
--   - notices 데이터는 손대지 않음 → 기존 created_by=null 레코드 영향 없음 (AC-4).
--   - dry-run 진단 RAISE NOTICE 로 사전/사후 카운트 출력.
--   - 롤백: 20260530000010_staff_user_id_backfill_for_notices.down.sql
--           (이 마이그레이션이 새로 채운 user_id 만 백업 테이블 기준으로 NULL 복원)
--
-- ⚠️ supervisor 적용 (risk GO_WARN). dry-run NOTICE 확인 후 COMMIT.
-- ============================================================================

BEGIN;

-- 1) 사전 진단
DO $$
DECLARE
  v_staff_total INT;
  v_staff_unmapped INT;
  v_up_candidates INT;
BEGIN
  SELECT COUNT(*) INTO v_staff_total       FROM staff WHERE active = true;
  SELECT COUNT(*) INTO v_staff_unmapped    FROM staff WHERE active = true AND user_id IS NULL;
  SELECT COUNT(*) INTO v_up_candidates     FROM user_profiles WHERE active = true AND approved = true;
  RAISE NOTICE '[notice-backfill pre] staff_total=%, staff_unmapped=%, userprofile_candidates=%',
    v_staff_total, v_staff_unmapped, v_up_candidates;
END $$;

-- 2) 롤백용 스냅샷: 이 마이그레이션이 손대기 직전 상태 (id, user_id)
--    IF NOT EXISTS 로 재실행 안전. .down.sql 이 이 테이블로 복원.
CREATE TABLE IF NOT EXISTS _backup_staff_user_id_20260530 AS
SELECT id, user_id, now() AS snapshot_at
  FROM staff;

COMMENT ON TABLE _backup_staff_user_id_20260530 IS
  'T-20260530-foot-NOTICE-CREATEDBY-BACKFILL 백필 직전 staff.user_id 스냅샷. .down.sql 롤백 기준.';

-- 3) 보수적 매핑 — name + clinic_id 정확 일치, user_id 미설정 건만
--    - WHERE s.user_id IS NULL → 기존 매핑 보존 + idempotent
--    - up.approved/active 필터로 비활성·미승인 계정 제외
--    - role 매칭: 동일 role 또는 staff.director ↔ user_profiles.admin/manager 일반화
--    - 1:N 위험 차단: 동일 (name, clinic_id) 후보가 2명 이상이면 모호하므로 건너뜀
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
   )
   -- 모호 매칭 차단: 같은 (name, clinic_id) user_profiles 후보가 정확히 1명일 때만
   AND (
     SELECT COUNT(*) FROM user_profiles up2
      WHERE up2.active = true AND up2.approved = true
        AND up2.name = s.name AND up2.clinic_id = s.clinic_id
   ) = 1;

-- 4) 사후 진단
DO $$
DECLARE
  v_now_mapped INT;
  v_still_null INT;
BEGIN
  SELECT COUNT(*) INTO v_now_mapped FROM staff WHERE active = true AND user_id IS NOT NULL;
  SELECT COUNT(*) INTO v_still_null FROM staff WHERE active = true AND user_id IS NULL;
  RAISE NOTICE '[notice-backfill post] mapped=%, still_unmapped=%', v_now_mapped, v_still_null;
  IF v_still_null > 0 THEN
    RAISE NOTICE '[notice-backfill warn] % active staff 가 여전히 미매핑. 해당 계정 작성 공지는 created_by=null(FE graceful fallback) 로 저장됨. AdminRegister 동기화 또는 수기 매핑 필요.', v_still_null;
  END IF;
END $$;

COMMIT;
