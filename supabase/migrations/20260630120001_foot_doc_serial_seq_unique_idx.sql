-- T-20260629-foot-SERIAL-UNIQUE-HARDEN — partial UNIQUE INDEX (동시발번 중복0 enforcer)
-- ⚠ CREATE UNIQUE INDEX CONCURRENTLY 는 트랜잭션 블록 안에서 실행 불가 → 본 파일에 BEGIN/COMMIT 없음.
--    각 문장이 psql autocommit 으로 단독 실행되어야 함. 반드시 20260630120000_foot_doc_serial_seq_harden.sql
--    (ADD COLUMN + backfill + 중복0 assert) COMMIT 완료 후 실행(의무④ — 중복0 확인 후 인덱스 생성).
-- rollback: 20260630120001_foot_doc_serial_seq_unique_idx.rollback.sql (DROP INDEX CONCURRENTLY)
--
-- 검수② (silent-fail 해소): UNIQUE (clinic_id, doc_serial_seq) 선두 컬럼 = 발번 partition = clinic_id 로
--   완전 일치 → l3a3 #1 silent-fail(제약 컬럼집합 ≠ 발번 파티션) 구조 해소. 발번 스코프와 동일 컬럼에 복합 UNIQUE.
-- partial (WHERE doc_serial_seq IS NOT NULL): 미발번(NULL) 행은 제약 무관 → 비-연번호 서류(영수증 재발급 등)
--   다수 NULL 공존 허용. 기존 visit_no 중복 3군은 JSONB 에만 있고 INT 컬럼엔 없으므로 생성 안 막음.
-- ⚠ ACCESS EXCLUSIVE 풀스캔 락 회피 위해 plain ALTER ADD CONSTRAINT 대신 CONCURRENTLY 채택.
--   partial index 는 ADD CONSTRAINT USING INDEX 로 승격 불가(Postgres 제약) → 인덱스 자체가 enforcer(동등 보장).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_form_submissions_clinic_doc_serial_seq
  ON form_submissions (clinic_id, doc_serial_seq)
  WHERE doc_serial_seq IS NOT NULL;

COMMENT ON INDEX uq_form_submissions_clinic_doc_serial_seq IS
  'T-20260629-foot-SERIAL-UNIQUE-HARDEN: 서류 발급순번 동시발번 중복0 enforcer. partial UNIQUE(clinic_id, doc_serial_seq) WHERE NOT NULL. 발번 파티션=(clinic_id)와 컬럼 완전 일치(silent-fail 해소). issue_foot_doc_serial() 의 23505 재시도 게이트.';

-- ── CONCURRENTLY 안전 runbook (의무④) ────────────────────────────────────────────────
--  생성 후 indisvalid 검증:
--    SELECT i.relname, idx.indisvalid
--      FROM pg_class i JOIN pg_index idx ON idx.indexrelid = i.oid
--     WHERE i.relname = 'uq_form_submissions_clinic_doc_serial_seq';
--  → indisvalid=false 이면 (CONCURRENTLY 중 실패로 INVALID 잔존):
--      DROP INDEX CONCURRENTLY IF EXISTS uq_form_submissions_clinic_doc_serial_seq;
--      -- 중복 원인 해소(중복0 재확인) 후 본 CREATE 문 재실행.
--  → indisvalid=true 이면 정상 enforce.
