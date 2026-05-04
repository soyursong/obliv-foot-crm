-- T-20260505-foot-CHART-NUMBER-AUTO rollback
-- 차트번호 자동생성 롤백: 트리거 제거 + UNIQUE 해제 + NOT NULL 해제
-- ※ 백필 데이터(F-XXXX 값) 는 유지됨 (데이터 삭제 불가 — 의무기록 연계)

-- 1. 트리거 제거
DROP TRIGGER IF EXISTS customers_chart_number_before_insert
  ON public.customers;

-- 2. 함수 제거
DROP FUNCTION IF EXISTS public.assign_foot_customer_chart_number();

-- 3. UNIQUE 인덱스 제거
DROP INDEX IF EXISTS customers_chart_number_unique;

-- 4. NOT NULL 제약 해제
ALTER TABLE public.customers
  ALTER COLUMN chart_number DROP NOT NULL;

-- ※ chart_number 컬럼 자체는 유지 (이전 마이그레이션 20260430000001 에서 추가됨)
--   컬럼 제거 필요 시: ALTER TABLE customers DROP COLUMN chart_number;
