-- ROLLBACK: T-20260624-foot-CHART2-MEMO-EDIT-DELETE
-- UPDATE/DELETE RLS를 본인 작성분 한정으로 복원 + soft-delete 컬럼 제거.
-- ⚠️ deleted_at 컬럼 DROP 시 무효화 표식 손실 — 운영 데이터 백업 후에만 실행.

BEGIN;

-- ── 치료메모 ──
DROP POLICY IF EXISTS "manage_update_ctm" ON customer_treatment_memos;
CREATE POLICY "own_update_ctm" ON customer_treatment_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');
CREATE POLICY "own_delete_ctm" ON customer_treatment_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');
ALTER TABLE customer_treatment_memos DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;

-- ── 예약메모 ──
DROP POLICY IF EXISTS "manage_update_crm" ON customer_reservation_memos;
CREATE POLICY "own_update_crm" ON customer_reservation_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');
CREATE POLICY "own_delete_crm" ON customer_reservation_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');
ALTER TABLE customer_reservation_memos DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;

-- ── 상담메모 ──
DROP POLICY IF EXISTS "manage_update_ccm" ON customer_consult_memos;
CREATE POLICY "own_update_ccm" ON customer_consult_memos
  FOR UPDATE TO authenticated
  USING   (created_by = auth.jwt()->>'email')
  WITH CHECK (created_by = auth.jwt()->>'email');
CREATE POLICY "own_delete_ccm" ON customer_consult_memos
  FOR DELETE TO authenticated
  USING (created_by = auth.jwt()->>'email');
ALTER TABLE customer_consult_memos DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;

COMMIT;
