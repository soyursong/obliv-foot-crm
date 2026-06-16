-- ROLLBACK: T-20260616-foot-OPINION-DOC-FEATURE (Phase 2)
-- 20260616120000_opinion_documents.sql 원복 (ADDITIVE → 신규 객체 DROP).
-- 순서: documents(템플릿 FK 참조) → 트리거/함수 → templates.
-- ⚠ opinion_documents 는 의무기록 — 롤백(DROP)은 데이터 유실. 발행본 존재 시 DROP 전 백업/확인 필수.

BEGIN;

-- documents 먼저(immutable 트리거가 DROP TABLE 을 막지는 않음 — DDL 은 트리거 무관)
DROP TABLE IF EXISTS public.opinion_documents;
DROP FUNCTION IF EXISTS public.opinion_documents_immutable_guard();

-- templates (documents.template_id FK 가 위에서 제거됨)
DROP TABLE IF EXISTS public.opinion_doc_templates;

COMMIT;
