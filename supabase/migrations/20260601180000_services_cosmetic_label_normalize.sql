-- T-20260601-foot-SVC-COSMETIC-LABEL-BACKFILL
-- 서비스관리 '풋화장품' 탭 미표시 버그 데이터 정규화.
--
-- 원인: 풋화장품 탭 필터는 category_label='풋화장품'(무공백) 기준 동작.
--   그런데 활성 풋화장품 상품 7건은 category_label/category 가 '풋 화장품'(공백 1개)
--   변형으로 등록되어 탭에서 필터아웃 → 전체 탭에서만 노출됨.
--   (무공백 '풋화장품' 5건은 모두 비활성이라 기본 숨김 → 탭이 비어 보임)
--
-- 조치: '풋 화장품'(공백) → '풋화장품'(무공백) 으로 category_label + category 동시 정규화.
--   대상: clinic 74967aea-a60b-4da3-a0e7-9c997a930bc8, 7 row (active).
--   idempotent: 재실행해도 영향 row 0 (이미 무공백이므로).
UPDATE services
SET category_label = '풋화장품',
    category       = '풋화장품'
WHERE category_label = '풋 화장품';
