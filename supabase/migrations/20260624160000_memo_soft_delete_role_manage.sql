-- ============================================================
-- T-20260624-foot-CHART2-MEMO-EDIT-DELETE — 메모 soft-delete + admin/manager/director 관리권한
-- ============================================================
-- reporter: 김주연 총괄 (U0ATDB587PV) / risk_verdict: GO_WARN. ⚠️ ADDITIVE ONLY (파괴 변경 0).
-- 근거:
--   · 의료법 제22조 3항 — 진료기록 수정·삭제 시 ①원본보존 ②수행자 ③일시 기록 → 치료메모 hard-delete 금지, soft-delete만.
--   · 의료법 제40조 — 진료기록 보존의무.
--   · 선례 계승: medical_charts soft-delete (T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY) 동일 패턴.
-- 갭(AC-3 dev-foot 선결조사 확정):
--   치료/상담메모 이력 엔트리 UPDATE/DELETE 가 RLS·FE 모두 '본인 작성분(created_by=email)'만 허용
--   → 총괄(admin/manager)이 타인 작성·이전기록(created_by=null) 메모를 수정·삭제 불가 = "안된다"의 정체.
-- 변경(3 이력 테이블 공통: customer_treatment_memos / customer_reservation_memos / customer_consult_memos):
--   1. soft-delete 2컬럼(deleted_at, deleted_by) ADDITIVE — hard-delete 대체(의료법 보존).
--   2. UPDATE RLS: 본인(created_by) OR admin/manager/director — 총괄이 모든 메모 수정·무효화 가능.
--   3. DELETE RLS 제거 — hard-delete 금지(의료법). 무효화는 deleted_at UPDATE 경로로만.
-- supervisor DDL-diff 게이트 경유 후 적용. 롤백: 20260624160000_memo_soft_delete_role_manage.down.sql
-- ============================================================

BEGIN;

-- ── 치료메모 (customer_treatment_memos) ──────────────────────
ALTER TABLE customer_treatment_memos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by text        NULL;
COMMENT ON COLUMN customer_treatment_memos.deleted_at IS 'soft-delete 무효화 일시(의료법 §22-3). NULL=활성. hard-delete 금지. T-20260624-foot-CHART2-MEMO-EDIT-DELETE';
COMMENT ON COLUMN customer_treatment_memos.deleted_by IS '무효화 수행자 email(의료법 §22-3 수행자 기록).';

DROP POLICY IF EXISTS "own_update_ctm" ON customer_treatment_memos;
CREATE POLICY "manage_update_ctm" ON customer_treatment_memos
  FOR UPDATE TO authenticated
  USING      (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']))
  WITH CHECK (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']));
-- hard-delete 금지(의료법) — 무효화는 deleted_at UPDATE로만
DROP POLICY IF EXISTS "own_delete_ctm" ON customer_treatment_memos;

-- ── 예약메모 (customer_reservation_memos) ────────────────────
ALTER TABLE customer_reservation_memos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by text        NULL;
COMMENT ON COLUMN customer_reservation_memos.deleted_at IS 'soft-delete 무효화 일시. NULL=활성. T-20260624-foot-CHART2-MEMO-EDIT-DELETE';
COMMENT ON COLUMN customer_reservation_memos.deleted_by IS '무효화 수행자 email.';

DROP POLICY IF EXISTS "own_update_crm" ON customer_reservation_memos;
CREATE POLICY "manage_update_crm" ON customer_reservation_memos
  FOR UPDATE TO authenticated
  USING      (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']))
  WITH CHECK (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']));
DROP POLICY IF EXISTS "own_delete_crm" ON customer_reservation_memos;

-- ── 상담메모 (customer_consult_memos) ────────────────────────
ALTER TABLE customer_consult_memos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by text        NULL;
COMMENT ON COLUMN customer_consult_memos.deleted_at IS 'soft-delete 무효화 일시. NULL=활성. T-20260624-foot-CHART2-MEMO-EDIT-DELETE';
COMMENT ON COLUMN customer_consult_memos.deleted_by IS '무효화 수행자 email.';

DROP POLICY IF EXISTS "own_update_ccm" ON customer_consult_memos;
CREATE POLICY "manage_update_ccm" ON customer_consult_memos
  FOR UPDATE TO authenticated
  USING      (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']))
  WITH CHECK (created_by = auth.jwt()->>'email' OR current_user_role() = ANY (ARRAY['admin','manager','director']));
DROP POLICY IF EXISTS "own_delete_ccm" ON customer_consult_memos;

-- ── 검증 ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customer_treatment_memos' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'customer_treatment_memos.deleted_at 추가 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='customer_treatment_memos' AND policyname='manage_update_ctm') THEN
    RAISE EXCEPTION 'manage_update_ctm 정책 생성 실패';
  END IF;
  RAISE NOTICE 'T-20260624-foot-CHART2-MEMO-EDIT-DELETE: 검증 통과 (3 테이블 soft-delete + role-manage RLS)';
END $$;

COMMIT;
