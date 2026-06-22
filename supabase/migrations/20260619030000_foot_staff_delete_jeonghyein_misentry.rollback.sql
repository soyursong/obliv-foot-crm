-- ============================================================
-- ROLLBACK · T-20260619-foot-STAFF-DELETE-JEONGHYEIN (확정방식 ①재배정 후 삭제)
-- forward 20260619030000_foot_staff_delete_jeonghyein_misentry.sql 의 atomic 역전:
--   (a) 삭제된 정혜인 staff row 재삽입 (전 컬럼 스냅샷)
--   (b) 재배정된 customers/room_assignments FK 를 정혜인으로 원복 (staff_name 복원)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
--
-- ⚠️ 실행 시 affected PK 주입 필수:
--   forward 마이그 RAISE NOTICE 'JEONGHYEIN-ROLLBACK-SNAPSHOT customers_pks=... room_assignments_pks=...'
--   에서 출력된 PK 배열을 아래 v_cust_pks / v_ra_pks 에 주입 후 실행.
--   (정연주는 다른 정상 배정도 보유하므로 PK 한정 없이 staff_id 매칭 시 정상건 오원복 위험 → PK 한정 필수)
--   precheck 문서값(참고, 실행 시 read-only 재확인):
--     · customers: 설연우(+821027749571) assigned_staff_id 1건
--     · room_assignments: 2건 (상담실1 / 상담실5[원래 staff_name='정혜인'])
--
-- 스냅샷 출처: 2026-06-19 삭제 직전 READ-ONLY SELECT
--   id=5f141f76-7f72-4560-8a67-bbcdf4938cad / clinic_id=74967aea-a60b-4da3-a0e7-9c997a930bc8
--   name=정혜인 / role=consultant / active=false / created_at=2026-04-23 23:28:49.947517+00
-- 멱등: staff id 충돌 시 무동작(ON CONFLICT DO NOTHING). FK 원복은 PK 한정 + 현재 정연주 매칭 가드.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_target   uuid := '5f141f76-7f72-4560-8a67-bbcdf4938cad';  -- 정혜인 (원복 대상)
  v_clinic   uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_to_email text := 'joo4442@naver.com';                     -- 정연주 (재배정됐던 staff)
  v_to       uuid;
  -- ▼▼ 실행 시 forward NOTICE 출력값으로 교체 ▼▼
  v_cust_pks uuid[] := '{}'::uuid[];   -- 예: '{3ef801ea-...}'
  v_ra_pks   uuid[] := '{}'::uuid[];   -- 예: '{bd2ff40c-...,215c9b5b-...}'
  -- ▲▲ 미주입(빈 배열)이면 FK 원복 0건 — staff row 만 복원 (안전측) ▲▲
  v_count    int;
BEGIN
  -- (a) 정혜인 staff row 재삽입 (멱등)
  INSERT INTO staff (id, clinic_id, name, role, active, created_at)
  VALUES (v_target, v_clinic, '정혜인', 'consultant', false, '2026-04-23 23:28:49.947517+00')
  ON CONFLICT (id) DO NOTHING;

  -- 정연주 staff_id 특정 (FK 원복 가드용)
  SELECT id INTO v_to
  FROM staff WHERE clinic_id = v_clinic AND lower(email) = lower(v_to_email) LIMIT 1;

  -- (b1) customers FK 원복 — 주입된 PK 한정 + 현재 정연주 매칭(우리가 재배정한 건만)
  IF array_length(v_cust_pks, 1) IS NOT NULL AND v_to IS NOT NULL THEN
    UPDATE customers SET assigned_staff_id = v_target
    WHERE id = ANY(v_cust_pks) AND assigned_staff_id = v_to;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'ROLLBACK customers: % rows 정연주 -> 정혜인', v_count;
  END IF;

  -- (b2) room_assignments FK 원복 — staff_name 도 정혜인으로 복원
  --   주의: 원래 staff_name 이 null 이던 행도 본 롤백은 '정혜인'으로 세팅(forward 가 '정연주'로 덮었으므로).
  --   원래 null 보존이 필요하면 실행 시 해당 PK 만 staff_name=NULL 로 별도 보정.
  IF array_length(v_ra_pks, 1) IS NOT NULL AND v_to IS NOT NULL THEN
    UPDATE room_assignments SET staff_id = v_target, staff_name = '정혜인'
    WHERE id = ANY(v_ra_pks) AND staff_id = v_to;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'ROLLBACK room_assignments: % rows 정연주 -> 정혜인', v_count;
  END IF;
END $$;

COMMIT;
