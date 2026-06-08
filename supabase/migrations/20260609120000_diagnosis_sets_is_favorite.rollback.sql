-- ROLLBACK — T-20260609-foot-DX-BUNDLE-REFINE (AC-3, 20260609120000_diagnosis_sets_is_favorite.sql)
-- 추가한 인덱스 + 컬럼 제거. 무손실(즐겨찾기 플래그만 소실, 세트/항목 데이터 무관).
-- ⚠️ 운영 적용 후 즐겨찾기 사용 중이라면 DROP 전 상태 백업 권장(supervisor 판단).

DROP INDEX IF EXISTS public.idx_diagnosis_sets_clinic_fav;

ALTER TABLE public.diagnosis_sets
  DROP COLUMN IF EXISTS is_favorite;
