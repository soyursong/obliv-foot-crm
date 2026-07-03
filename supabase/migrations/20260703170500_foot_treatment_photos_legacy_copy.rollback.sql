-- ROLLBACK: T-20260703-foot-STAFFPHOTO-CHART-LINK 레거시 backfill
-- backfill 로 삽입된 행만 제거(source='legacy_string_array'). 원본 check_ins.treatment_photos 컬럼은 무변경(보존).
--
-- ⚠ 의료법 §22: backfill 행은 '복사본'이며 원본 string[] 이 그대로 남아 있으므로 삭제해도 원본 손실 없음.
--   단 backfill 후 현장에서 이 행에 note/삭제 등 편집이 가해졌다면 그 편집분이 사라진다(배포 직후 롤백 전제).
DELETE FROM public.treatment_photos WHERE source = 'legacy_string_array';
