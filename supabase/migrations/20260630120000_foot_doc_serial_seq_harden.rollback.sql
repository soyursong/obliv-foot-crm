-- ROLLBACK: T-20260629-foot-SERIAL-UNIQUE-HARDEN — DDL/backfill/RPC 부분
-- 무손실 원상복귀 — ADD 한 것만 DROP. 기존 데이터/visit_no(field_data)/제약/RLS 무영향.
--   · DROP FUNCTION issue_foot_doc_serial
--   · DROP COLUMN form_submissions.doc_serial_seq (백필된 INT 값 함께 소멸 — visit_no 문자열·행 전부 보존, 유실 0)
-- ⚠ 인덱스(20260630120001)가 먼저 DROP 되어야 함(컬럼 의존). 순서: 인덱스 rollback → 본 파일.
--   (본 파일 단독 실행 시 인덱스가 컬럼을 참조하면 DROP COLUMN 이 CASCADE 없이는 막힘 → 인덱스 먼저)
-- ⚠ FE(SERIAL-RPC-FE-REWIRE)가 RPC 를 호출 중이면 먼저 FE 롤백/배포 되돌림(번들 동시 롤백).

BEGIN;

DROP FUNCTION IF EXISTS issue_foot_doc_serial(uuid, uuid);

ALTER TABLE form_submissions
  DROP COLUMN IF EXISTS doc_serial_seq;

COMMIT;
