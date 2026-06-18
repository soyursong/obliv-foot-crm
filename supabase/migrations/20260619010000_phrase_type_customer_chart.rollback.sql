-- T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-2 롤백
-- phrase_type CHECK 를 2값(pen_chart, medical_chart)으로 환원.
-- DA 권고: customer_chart 로 등록된 rows 가 있으면 CHECK 환원 전 pen_chart 로 선행 UPDATE(가드) — 위반 row 0 보장.

BEGIN;

-- 가드: customer_chart rows → pen_chart (CHECK 2값 환원 시 위반 방지)
UPDATE phrase_templates
   SET phrase_type = 'pen_chart', updated_at = now()
 WHERE phrase_type = 'customer_chart';

ALTER TABLE phrase_templates
  DROP CONSTRAINT IF EXISTS chk_phrase_templates_type;

ALTER TABLE phrase_templates
  ADD CONSTRAINT chk_phrase_templates_type
    CHECK (phrase_type IN ('pen_chart', 'medical_chart'));

COMMENT ON COLUMN phrase_templates.phrase_type IS
  'pen_chart(펜차트 상용구) | medical_chart(진료차트 상용구) — T-20260526-foot-MEDCHART-SYNC';

COMMIT;
