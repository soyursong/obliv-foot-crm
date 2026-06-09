-- ============================================================================
-- T-20260609-foot-TRIAL-REVENUE-ZERO — BACKFILL ROLLBACK SQL
-- 생성: 2026-06-09T22:22:56.389Z (rollback_capture.mjs, READ-ONLY 캡처)
-- 목적: _backfill_apply.mjs (APPLY=1) 집행분의 무손실 역복원.
-- 사용: 백필 집행 후 문제 발생 시 supabase SQL editor 에서 BEGIN; ... COMMIT; 으로 실행.
--      각 UPDATE 는 백필이 건드린 정확한 행(full UUID)을 캡처 시점 원값으로 되돌린다.
-- 멱등: WHERE 절이 백필-후 상태를 가드하므로 미집행/중복 실행 시 0 row affected (안전).
-- ----------------------------------------------------------------------------
-- [A] 매출 복구분 역복원: 2건 (amount→0, tax_type→'선수금', cis.is_package_session→true)
-- [B] 선수금 재분류분 역복원: 2건 (tax_type→'선수금', amount 무변경)
-- ============================================================================
BEGIN;

-- ── [A] 매출 복구분 되돌리기 ──────────────────────────────────────────────
-- pay fb73c931-c3fc-46d9-add1-cf4c76f06bb8 (acct 2026-05-26) : 백필이 amount 0→10000, tax '선수금'→null 로 바꿈 → 역복원
UPDATE payments SET amount = 0, tax_type = '선수금'
  WHERE id = 'fb73c931-c3fc-46d9-add1-cf4c76f06bb8' AND amount = 10000 AND tax_type IS NULL;
UPDATE check_in_services SET is_package_session = true
  WHERE id = '76650a92-fedc-42fb-bed4-7028b326a192';  -- check_in b0a82bea-be9a-406b-82d4-5a95e698a7d0

-- pay 9c1682a3-0067-418a-a143-24251b0cfd3d (acct 2026-05-26) : 백필이 amount 0→59000, tax '선수금'→null 로 바꿈 → 역복원
UPDATE payments SET amount = 0, tax_type = '선수금'
  WHERE id = '9c1682a3-0067-418a-a143-24251b0cfd3d' AND amount = 59000 AND tax_type IS NULL;
UPDATE check_in_services SET is_package_session = true
  WHERE id = '8da25cb9-643a-48d7-94a6-627445586b51';  -- check_in 10610132-a5d9-4a07-87a9-d4e9f4dcde34

-- ── [B] 선수금 재분류분 되돌리기 ─────────────────────────────────────────
-- pay 002d6b05-9f62-467d-bb9b-8b1890d3e152 (acct 2026-05-26) : 백필이 tax '선수금'→null (amount 10000 유지) → 역복원
UPDATE payments SET tax_type = '선수금'
  WHERE id = '002d6b05-9f62-467d-bb9b-8b1890d3e152' AND tax_type IS NULL AND amount = 10000;

-- pay aabc5806-1d1f-4afc-a4a8-b4b3d1d3f77d (acct 2026-06-08) : 백필이 tax '선수금'→null (amount 10000 유지) → 역복원
UPDATE payments SET tax_type = '선수금'
  WHERE id = 'aabc5806-1d1f-4afc-a4a8-b4b3d1d3f77d' AND tax_type IS NULL AND amount = 10000;

COMMIT;
-- ROLLBACK 끝. 적용 후 _backfill_apply.mjs dry-run 으로 A/B 가 다시 잡히는지(=원복) 확인 권장.
