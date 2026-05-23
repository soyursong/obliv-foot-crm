-- T-20260523-foot-PENCHART-INSURANCE (스펙 정정)
-- 보험차트 양식 명칭 갱신: '펜차트 양식' → '[보험차트]'
-- AC-3: 양식 선택 패널 명칭 [보험차트]
-- AC-4: 양식 헤더 명칭 [보험차트]
-- 사유: 보험 청구 목적 특정, 범위 = 이 양식 1종만 (발건강 질문지·환불동의서 무영향)

UPDATE form_templates
SET    name_ko = '[보험차트]'
WHERE  form_key = 'pen_chart';

-- rollback:
-- UPDATE form_templates SET name_ko = '펜차트 양식' WHERE form_key = 'pen_chart';
