-- T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND rollback
-- 신규 메타 테이블만 제거. 'documents' 버킷 파일 실체·기존 테이블 전부 보존 → 데이터 손실 0.
DROP TABLE IF EXISTS patient_file_records;
