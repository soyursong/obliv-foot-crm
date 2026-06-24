-- ROLLBACK: T-20260624-foot-CHARTNO-RACE-ATOMICITY
-- assign_foot_customer_chart_number() 본문을 advisory 락 추가 직전(20260505000000) 상태로 복원.
-- 회귀 0 — 락 1줄 제거 외 무변경. 트리거 재등록 불필요(시그니처 동일).

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
