-- T-20260624-foot-CHARTNO-RACE-ATOMICITY
-- chart_number 발번 트리거 동시성 원자화 (foot)
-- 출처: DA CONSULT-REPLY MSG-20260624-124523-c9ba Q3 (cross-CRM, CRM별 분리 티켓)
-- 부모(롱레): T-20260624-crm-CHARTNO-RACE-ATOMICITY
--
-- RC: assign_foot_customer_chart_number() (20260505000000) 가
--     'MAX(SUBSTRING(chart_number FROM 3)::int)+1 WHERE chart_number ~ ^F-[0-9]+$' 패턴 사용.
--     clinic 필터 없는 전역 단일 네임스페이스 + UNIQUE customers_chart_number_unique(전역).
--     → 동시 customers INSERT 2건이 동일 MAX+1 산출 → 2번째 23505(unique violation).
--
-- 채택안 (DA 권고 (b)): advisory_xact_lock + CRM별 고유 GLOBAL 상수 키.
--   ⚠ 키는 clinic_id 아님 — 현행 발번이 전역 네임스페이스이므로 락 키도 전역 상수여야 race 차단.
--   SELECT MAX 직전 PERFORM pg_advisory_xact_lock(hashtext('foot_customers_chart_number_global')) 1줄만 추가.
--   xact 락 = commit/rollback 시 자동 해제. 스키마/데이터/포맷/네임스페이스/시그니처/UNIQUE 무변경.
--   gapless 유지, MAX+1 발번 결과 동일, UNIQUE backstop 잔존.
--
-- 멱등 (CREATE OR REPLACE) — 재실행 안전. 트리거 재등록 불필요(시그니처 동일).

CREATE OR REPLACE FUNCTION public.assign_foot_customer_chart_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_no  INT;
  cur_max  INT;
BEGIN
  IF NEW.chart_number IS NULL OR NEW.chart_number = '' THEN
    -- 동시 INSERT 직렬화: 전역 발번 네임스페이스에 대한 트랜잭션 advisory 락.
    -- 키는 clinic_id가 아니라 전역 상수 (현행 발번이 clinic 필터 없는 전역 네임스페이스).
    -- xact 락이므로 commit/rollback 시 자동 해제.
    PERFORM pg_advisory_xact_lock(hashtext('foot_customers_chart_number_global'));

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
-- 검증 (apply 후):
-- 1) 락 키 = 전역 상수 'foot_customers_chart_number_global' (clinic_id 아님) ✓
-- 2) 트리거 시그니처·UNIQUE 인덱스(customers_chart_number_unique) 무변경 ✓
-- 3) NULL/빈값 발번 가드 (IF NEW.chart_number IS NULL OR '') 유지 → 명시 발번 경로 무영향 ✓
-- 동시성 검증:
--   다중 세션에서 customers INSERT (chart_number 미지정) 동시 실행 → 23505 0건, F-NNNN 연속·유니크.
-- ============================================================
