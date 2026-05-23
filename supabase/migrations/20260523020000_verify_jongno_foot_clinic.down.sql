-- Rollback: 20260523020000_verify_jongno_foot_clinic.sql
-- 주의: jongno-foot은 초기 시드(20260419000002_seed_data.sql)부터 존재하는 핵심 레코드.
-- 롤백 시 연관 데이터(customers, check_ins, reservations 등) 전체 삭제 필요 → 운영 환경 실행 금지.
-- 개발/테스트 환경에서만 사용:
--
-- DELETE FROM clinics WHERE slug = 'jongno-foot';
--
-- 운영 환경에서는 이 마이그레이션의 INSERT ON CONFLICT DO NOTHING은 no-op이므로
-- 롤백할 내용 없음.
SELECT 'rollback: no-op (jongno-foot is a core seed record; manual deletion required if needed)' AS note;
