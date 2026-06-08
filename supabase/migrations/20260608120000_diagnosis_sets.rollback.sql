-- ROLLBACK — T-20260608-foot-DX-BUNDLE-SET (20260608120000_diagnosis_sets.sql)
-- 신규 빈 테이블 2개 DROP. FK 역순(자식 → 부모). 무손실(기존 테이블 무관).
-- ⚠️ 운영 적용 후 세트 데이터가 입력된 상태라면 DROP 전 백업 필수(supervisor 판단).

DROP TABLE IF EXISTS public.diagnosis_set_items CASCADE;
DROP TABLE IF EXISTS public.diagnosis_sets CASCADE;
