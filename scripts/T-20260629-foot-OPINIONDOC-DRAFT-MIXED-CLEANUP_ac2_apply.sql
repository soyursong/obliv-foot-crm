-- T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP — AC-2 apply (MUTATION)
-- ⛔ supervisor `mutation_gate: supervisor_required` GO 후에만 실행. dev 단독 실행 금지.
-- NO-DDL. form_submissions 1행 UPDATE only (jongno-foot, id ff9fd4ad…).
--
-- 정규화 근거(_ac1_dryrun.mjs, READ-ONLY 확인):
--   대상 1건  : id ff9fd4ad-1f91-4923-b688-9d8f8dfb878b (jongno-foot, draft, 2026-06-23)
--   doc_type  : opinion → 금기증 우선 (부모 applyPrefillExclusivity 동일 규칙)
--   before    : ["oral_x", "bp_med"]  (진단서 oral_x + 금기증 bp_med 혼합)
--   after     : ["bp_med"]            (금기증 유지, 진단서 oral_x clear)

BEGIN;

-- 0) backup — 실행 전 원본 selected_keys 캡처(rollback 근거 보존).
--    SELECT id, field_data->'selected_keys' AS backup_selected_keys
--    FROM form_submissions WHERE id = 'ff9fd4ad-1f91-4923-b688-9d8f8dfb878b';

-- 1) 정규화 UPDATE — selected_keys 만 교체(나머지 field_data 보존).
--    WHERE 가드: 정확히 혼합 원본 상태인 draft 1건만 → race/旣변경 방어(멱등). 매칭 0건이면 무변경.
UPDATE form_submissions
SET field_data = jsonb_set(field_data, '{selected_keys}', '["bp_med"]'::jsonb, false)
WHERE id = 'ff9fd4ad-1f91-4923-b688-9d8f8dfb878b'
  AND status = 'draft'
  AND field_data->'selected_keys' = '["oral_x", "bp_med"]'::jsonb;
-- ⇒ 실행기는 affected rows = 1 확인. 0 이면 ROLLBACK 후 _ac1_dryrun.mjs 재확인(이미 변경/부재).

-- 2) affected rows = 1 확인 후에만 COMMIT.
COMMIT;

-- 3) post-verify — 혼합행 0건 재확인(node scripts/..._ac1_dryrun.mjs 로도 검증 가능: "혼합행 0건" 기대).
-- SELECT id, field_data->'selected_keys' AS selected_keys
-- FROM form_submissions WHERE id = 'ff9fd4ad-1f91-4923-b688-9d8f8dfb878b';
-- 기대: ["bp_med"]
