-- ROLLBACK — T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED derive-seed 백필 (되돌림)
-- 2026-08-03 23:05 KST
-- ⚠ freeze 스냅샷(archive_visit_nature_deriveseed_20260803)을 근거로 백필이 채운 값만 정밀 원복.
--    본 백필이 세팅한 값(mapped)과 현재값이 일치하는 행만 prev_visit_nature(=원래 NULL)로 되돌린다.
--    그 사이 스태프/TM 이 다른 값으로 바꾼 행은 무접촉(스태프 개입 존중, over-revert 회피).
-- ⚠ visit_type 컬럼 무접촉. 신규 visit_nature 컬럼 값만 대상.
-- =====================================================

BEGIN;

UPDATE public.reservations r
SET visit_nature = a.prev_visit_nature       -- 최초 스냅샷값(통상 NULL)
FROM public.archive_visit_nature_deriveseed_20260803 a
WHERE a.anchor_table = 'reservations'
  AND r.id = a.row_id
  AND a.mapped_visit_nature IS NOT NULL
  AND r.visit_nature IS NOT DISTINCT FROM a.mapped_visit_nature;  -- 백필이 세팅한 값 그대로일 때만 원복

UPDATE public.check_ins ci
SET visit_nature = a.prev_visit_nature
FROM public.archive_visit_nature_deriveseed_20260803 a
WHERE a.anchor_table = 'check_ins'
  AND ci.id = a.row_id
  AND a.mapped_visit_nature IS NOT NULL
  AND ci.visit_nature IS NOT DISTINCT FROM a.mapped_visit_nature;

-- freeze 스냅샷 테이블 제거(감사 보존이 필요하면 아래 DROP 주석 유지)
-- DROP TABLE IF EXISTS public.archive_visit_nature_deriveseed_20260803;

COMMIT;
