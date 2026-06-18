-- T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-2
-- phrase_templates.phrase_type CHECK constraint에 'customer_chart'(고객차트/2번차트 surface) additive 추가.
--
-- 근거: cross-party 조율 완료 — 고객차트는 펜차트(pen_chart)·진료차트(medical_chart)와 별개인 제3 surface.
-- 게이트: data-architect CONSULT-REPLY GO (additive) — MSG-20260619-001458-5t5o.
--         ADDITIVE(신규 enum 값 + 기존 rows 무영향) → 대표 게이트 면제(autonomy §3.1), supervisor DDL-diff만.
-- 권고 반영: 단일 트랜잭션 DROP+ADD(3값), COMMENT 갱신, 롤백에 customer_chart→pen_chart 선행 UPDATE 가드.
-- 롤백: 20260619010000_phrase_type_customer_chart.rollback.sql

BEGIN;

ALTER TABLE phrase_templates
  DROP CONSTRAINT IF EXISTS chk_phrase_templates_type;

ALTER TABLE phrase_templates
  ADD CONSTRAINT chk_phrase_templates_type
    CHECK (phrase_type IN ('pen_chart', 'medical_chart', 'customer_chart'));

COMMENT ON COLUMN phrase_templates.phrase_type IS
  'pen_chart(펜차트 상용구) | medical_chart(진료차트 상용구, 진료관리) | customer_chart(고객차트 상용구, 2번차트 3구역) — T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU';

-- 검증: 제약이 3값을 허용하는지 확인 (기존 rows 무변경 — additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'chk_phrase_templates_type'
       AND check_clause LIKE '%customer_chart%'
  ) THEN
    RAISE EXCEPTION 'chk_phrase_templates_type 에 customer_chart 추가 실패';
  END IF;
END $$;

COMMIT;
