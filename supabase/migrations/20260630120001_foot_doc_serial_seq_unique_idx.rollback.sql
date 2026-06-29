-- ROLLBACK: T-20260629-foot-SERIAL-UNIQUE-HARDEN — partial UNIQUE INDEX
-- ⚠ DROP INDEX CONCURRENTLY 도 트랜잭션 밖 실행 필수 → BEGIN/COMMIT 없음.
-- 무손실 — 인덱스만 제거. doc_serial_seq 컬럼/값/visit_no 문자열 무영향.
--   (인덱스 제거 후 동시발번 중복0 보장만 해제 — 데이터 유실 0)
-- 순서: 본 파일(인덱스 DROP) → 20260630120000_..._harden.rollback.sql(컬럼/RPC DROP).

DROP INDEX CONCURRENTLY IF EXISTS uq_form_submissions_clinic_doc_serial_seq;
