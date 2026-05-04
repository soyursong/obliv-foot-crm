-- T-20260505-foot-CHART-NUMBER-AUTO
-- 풋센터 차트번호 자동생성: BEFORE INSERT 트리거 + 기존 고객 백필 + UNIQUE 제약
-- 형식: F-0001, F-0002, ... (F- 접두어 + 4자리 zero-padded 순번)
-- 멱등(IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS) — 재실행 안전

-- ============================================================
-- 1. 기존 고객 백필: chart_number IS NULL / '' 인 행 전원 채번
--    created_at ASC 순 (동률 시 id ASC) → 가장 오래된 고객이 F-0001
-- ============================================================
WITH numbered AS (
  SELECT id,
         'F-' || LPAD(
           ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC)::TEXT,
           4, '0'
         ) AS new_chart
    FROM public.customers
   WHERE chart_number IS NULL OR chart_number = ''
)
UPDATE public.customers c
   SET chart_number = n.new_chart
  FROM numbered n
 WHERE c.id = n.id;

-- ============================================================
-- 2. UNIQUE 인덱스 (백필 완료 후 적용 — NULL 허용 partial index)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS customers_chart_number_unique
  ON public.customers (chart_number)
  WHERE chart_number IS NOT NULL;

-- ============================================================
-- 3. NOT NULL 제약 (백필로 전원 채번 완료 확인 후 적용)
-- ============================================================
ALTER TABLE public.customers
  ALTER COLUMN chart_number SET NOT NULL;

-- ============================================================
-- 4. 자동 채번 트리거 함수
--    NEW.chart_number 가 NULL 또는 빈 문자열일 때만 자동 부여
--    F-[숫자] 형식의 MAX 값 + 1 → F-XXXX (4자리, 9999 초과 시 자리수 확장)
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_foot_customer_chart_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_no  INT;
  cur_max  INT;
BEGIN
  IF NEW.chart_number IS NULL OR NEW.chart_number = '' THEN
    SELECT COALESCE(
             MAX(CAST(SUBSTRING(chart_number FROM 3) AS INT)),
             0
           )
      INTO cur_max
      FROM public.customers
     WHERE chart_number ~ '^F-[0-9]+$';

    next_no := cur_max + 1;
    NEW.chart_number := 'F-' || LPAD(next_no::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. 트리거 등록 (DROP + CREATE — 멱등)
-- ============================================================
DROP TRIGGER IF EXISTS customers_chart_number_before_insert
  ON public.customers;

CREATE TRIGGER customers_chart_number_before_insert
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_foot_customer_chart_number();

-- ============================================================
-- 검증 쿼리 (apply 후 Supabase SQL Editor에서 실행):
-- SELECT COUNT(*) FROM public.customers WHERE chart_number IS NULL;   -- 0 이어야 함
-- SELECT chart_number FROM public.customers ORDER BY created_at LIMIT 5; -- F-0001, F-0002 ...
-- SELECT chart_number FROM public.customers ORDER BY chart_number DESC LIMIT 3; -- 가장 큰 번호 확인
-- ============================================================
