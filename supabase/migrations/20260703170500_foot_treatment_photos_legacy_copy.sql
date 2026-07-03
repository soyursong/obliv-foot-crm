-- T-20260703-foot-STAFFPHOTO-CHART-LINK — 레거시 backfill (DA RECON 결정①)
-- 구 check_ins.treatment_photos(TEXT[]) 항목 → canonical treatment_photos 테이블 행으로 복사.
--
-- ★DA RECON MSG-20260703-103635-6ymo 결정①:
--   · source='legacy_string_array', created_at/taken_at = 원 check_in 기준.
--   · 구 컬럼은 DROP 하지 않음(freeze·read-compat 유지) — 물리 제거는 별도 cleanup 티켓.
--   · 레거시 object 는 물리 이동하지 않음 → storage_bucket='photos'(구 shared 버킷) 로 표기,
--     read 경로가 per-row 버킷으로 signed URL 발급.
--
-- ★멱등(재실행 안전): NOT EXISTS 가드로 (check_in_id, photo_url, source) 중복 삽입 방지.
--   → freeze 전 drift 창(구 컬럼에 신규 write 유입) 발생 시 재실행으로 흡수 가능.
-- ★customer_id NOT NULL 제약: check_in.customer_id IS NULL(익명접수 미매칭) 행은 backfill 대상 제외
--   (고아 사진 — 별도 orphan 리포트, dry-run 스크립트가 카운트).
-- ★DML 마이그 — supervisor DDL-diff PHI DB-GATE 에서 dry-run + 행수대조 후 APPLY.
--   PROD 실측(2026-07-03): 대상 0행(구 컬럼 비어있음) → 현재 apply = no-op. 향후 유입분 대비 존치.

BEGIN;

INSERT INTO public.treatment_photos
  (customer_id, check_in_id, clinic_id, photo_url, storage_bucket,
   photo_type, source, taken_at, created_at)
SELECT
  ci.customer_id,
  ci.id,
  ci.clinic_id,
  p.path,
  'photos',
  CASE
    WHEN p.path ILIKE '%before%' THEN 'before'
    WHEN p.path ILIKE '%after%'  THEN 'after'
    ELSE 'progress'
  END,
  'legacy_string_array',
  ci.created_at,
  ci.created_at
FROM public.check_ins ci
CROSS JOIN LATERAL unnest(ci.treatment_photos) AS p(path)
WHERE ci.treatment_photos IS NOT NULL
  AND cardinality(ci.treatment_photos) > 0
  AND ci.customer_id IS NOT NULL
  AND p.path IS NOT NULL
  AND length(trim(p.path)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.treatment_photos tp
    WHERE tp.check_in_id = ci.id
      AND tp.photo_url = p.path
      AND tp.source = 'legacy_string_array'
  );

COMMIT;
