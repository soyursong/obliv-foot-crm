-- ROLLBACK : T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C) prescription_codes.description
-- forward  : 20260618130000_prescription_codes_description.sql
--
-- 컬럼 1개 DROP. ADDITIVE 의 역연산 — 설명 데이터(자유텍스트 메모)는 함께 소멸.
--   메모성 데이터라 손실 영향 제한적이나, 롤백 전 백업 권장:
--     COPY (SELECT id, description FROM public.prescription_codes WHERE description IS NOT NULL)
--       TO '/tmp/rx_description_backup_20260618.csv' CSV HEADER;
--
-- 다른 컬럼/정책/인덱스 미접촉(description 단일 컬럼만).

ALTER TABLE public.prescription_codes
  DROP COLUMN IF EXISTS description;
