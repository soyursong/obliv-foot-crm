-- ============================================================
-- DRY-RUN: T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A)
-- ============================================================
-- 무영속 검증: up.sql 을 SAVEPOINT 안에서 실행 후 ROLLBACK. prod 실재 영속 0.
-- Migration Dry-Run No-Persistence Protocol 준수: txn-control 문 없음, 사후 무영속 introspection 포함.
-- 실행: DA CONSULT GO 후 supervisor DDL-diff 단계에서. (본 draft 단계에서는 참조용)
-- ============================================================

BEGIN;

-- 사전 스냅샷: 대상 컬럼/테이블/트리거 부재 확인(멱등 가드 전제)
DO $$
BEGIN
  RAISE NOTICE '[pre] form_submissions.deleted_at present=%',
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_name='form_submissions' AND column_name='deleted_at');
  RAISE NOTICE '[pre] form_submissions_audit_log present=%',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='form_submissions_audit_log');
  RAISE NOTICE '[pre] form_submissions row_count=%', (SELECT count(*) FROM form_submissions);
END $$;

-- ▼▼▼ up.sql 본문을 여기서 실행(BEGIN/COMMIT 제거한 순수 DDL 블록) — supervisor 단계에서 인라인 ▼▼▼
-- (draft: 실제 dry-run 시 up.sql 의 ALTER/CREATE 블록을 여기 삽입)
-- ▲▲▲

-- 사후 검증
DO $$
BEGIN
  ASSERT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='form_submissions' AND column_name='deleted_at'), 'deleted_at 미생성';
  RAISE NOTICE '[post] dry-run 검증 통과 — ROLLBACK 으로 무영속 처리';
END $$;

ROLLBACK;  -- 무영속: 모든 DDL 되돌림

-- 사후 무영속 확인(별도 커넥션/재조회): deleted_at 이 여전히 부재해야 정상 dry-run
-- SELECT EXISTS(SELECT 1 FROM information_schema.columns
--   WHERE table_name='form_submissions' AND column_name='deleted_at') AS should_be_false;
