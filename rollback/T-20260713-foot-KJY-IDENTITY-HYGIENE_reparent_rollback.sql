-- T-20260713-foot-KJY-IDENTITY-HYGIENE — reparent 롤백 (created_by canon→gmail 복원)
-- ⚠ 유효 조건: gmail 계정(a7e2e012) hard-DELETE 이전에만. 삭제 후엔 FK 위반으로 복원 불가(비가역).
-- 대상 = freeze한 9개 assignment_actions.id 만. 정본 b36e74a3 무접점.
-- generated: 2026-07-13T15:39:35.204Z
BEGIN;
UPDATE public.assignment_actions
   SET created_by = 'a7e2e012-735c-4ecc-8f54-c7c5c545bddd'
 WHERE id IN (
   'f7f8a5c5-a10d-4ada-8e11-fa9745ca582a',
   '593907ef-ef9b-4bf0-81d6-2669daee02be',
   'bf4cf656-708b-4cbd-9aaa-a50f8144c409',
   '66c7fa60-c44b-4c78-9cf0-8c2772c2d370',
   '794c6b62-222f-448b-a438-9086ac6411f0',
   '9f93e062-b6a7-4fba-b9f3-175d0dd620c8',
   '1f7bd58b-cb61-4766-96f5-5ae446ff8916',
   '2c75fca0-9afb-4323-b610-1fe87157961e',
   '05cca3ac-7785-474e-b302-c466c5e18623'
 )
   AND created_by = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';  -- reparent로 바뀐 것만 되돌림
-- 영향 행 = 9 확인 후 COMMIT;
COMMIT;