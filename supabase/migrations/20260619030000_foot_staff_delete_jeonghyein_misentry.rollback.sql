-- ============================================================
-- ROLLBACK · T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX (AC5)
-- 20260619030000_foot_staff_delete_jeonghyein_misentry.sql 의 역전:
--   삭제된 정혜인 staff row 를 삭제 직전 스냅샷(전 컬럼)으로 재삽입한다.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
--
-- 스냅샷 출처: 2026-06-19 삭제 직전 READ-ONLY SELECT
--   id         = 5f141f76-7f72-4560-8a67-bbcdf4938cad
--   clinic_id  = 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   name       = 정혜인
--   role       = consultant
--   active     = false
--   created_at = 2026-04-23 23:28:49.947517+00
--
-- 멱등: id 충돌(이미 존재) 시 무동작(ON CONFLICT DO NOTHING).
--   원래 id 를 보존 재삽입하므로 SET NULL 로 끊긴 customers.assigned_staff_id 등은
--   별도 재연결이 필요할 수 있음(본 롤백은 staff row 복원까지만 보장).
-- ============================================================

BEGIN;

INSERT INTO staff (id, clinic_id, name, role, active, created_at)
VALUES (
  '5f141f76-7f72-4560-8a67-bbcdf4938cad',
  '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  '정혜인',
  'consultant',
  false,
  '2026-04-23 23:28:49.947517+00'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
