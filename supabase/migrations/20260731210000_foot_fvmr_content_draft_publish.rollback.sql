-- ROLLBACK: T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST
--   20260731210000_foot_fvmr_content_draft_publish.sql 역적용.
--   ADDITIVE 3건만 되돌림. 기존 status enum·published 불변 트리거·RLS 는 본 마이그가 만든 것이 아니므로
--   손대지 않는다(다른 서류·KOH·소견서 발행본 공통 방어막 — DROP 절대 금지).
-- ============================================================
BEGIN;

-- (c) publish RPC 제거.
DROP FUNCTION IF EXISTS public.publish_first_visit_mgmt_record(uuid, jsonb, uuid);

-- (b) draft-dedup partial unique index = 본 마이그 미생성(DEFERRED) → 롤백 대상 없음.

-- (a) lineage FK 컬럼 제거.
--   ⚠ published 행이 이미 이 컬럼을 참조(발행 이력)할 수 있음 — 컬럼 DROP 은 그 lineage 정보만 소실시킬 뿐
--     발행 이력 행(status='published') 자체는 유지된다. 발행 이력 데이터 손실 아님.
ALTER TABLE form_submissions DROP COLUMN IF EXISTS source_submission_id;

COMMIT;
