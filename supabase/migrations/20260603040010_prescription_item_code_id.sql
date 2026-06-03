-- T-20260603-foot-RX-CHART-ENHANCE AC-5: 처방항목 prescription_code_id 연결 (additive)
--
-- 데이터 모델: 처방항목(PrescriptionItem)은 별도 관계형 테이블이 아니라
--   prescription_sets.items / medical_charts.prescription_items 의 JSONB 배열 원소다.
--   따라서 컬럼 추가 DDL이 아니라 JSONB 원소 shape 의 additive 확장(schema-on-read)이다.
--
-- 확장 키 (각 처방항목 JSONB 원소에 nullable 추가):
--   prescription_code_id : UUID — prescription_codes(id) 참조 (자유텍스트 수기입력 시 null)
--   classification       : TEXT — prescription_codes.classification 스냅샷 (AC-3 색상매핑 프록시)
--
-- 무결성: JSONB 내부값이므로 DB 레벨 FK 강제는 불가. 애플리케이션(FE)에서 prescription_codes 검색
--   선택 시에만 채우며, 레거시/수기입력 항목은 null 로 무중단 공존.
--
-- 본 마이그는 의미 기록용 COMMENT 만 갱신한다 (구조 변경 없음 · 완전 무해 · 재실행 안전).

COMMENT ON COLUMN prescription_sets.items IS
  '처방항목 JSONB 배열. 원소 shape: {name,dosage,route,frequency,days,notes, prescription_code_id?:UUID(nullable, prescription_codes 참조), classification?:TEXT(스냅샷)}';

COMMENT ON COLUMN medical_charts.prescription_items IS
  '처방내역 JSONB 배열. 원소 shape: {name,dosage,route,frequency,days,notes, prescription_code_id?:UUID(nullable, prescription_codes 참조), classification?:TEXT(스냅샷)}. AC-2 금기증 게이트는 prescription_code_id 기준으로만 매칭(텍스트 약명매칭 금지).';
