-- T-20260521-foot-WALKIN-MEMO-GAP
-- reservation_memo_history에 check_in_id 컬럼 추가 (3순위 fallback)
--
-- Root Cause:
--   T-20260520-foot-RESV-MEMO-WALKIN 으로 customer_id nullable + customer_id FK 추가됨.
--   그러나 staff가 전화번호 없이 수기 생성한 walk-in check_in의 경우
--   check_ins.customer_id = NULL → effectiveKey = null → 메모 비활성.
--
-- Fix:
--   3순위 fallback으로 check_in_id 추가
--   우선순위: reservation_id > customer_id > check_in_id
--   CHECK 제약: 세 컬럼 중 최소 하나는 NOT NULL
--
-- AC:
--   AC-1: reservation_id 없어도 customer_id 기준 INSERT 가능 (T-20260520 이미 커버)
--   AC-2: customer_id 없어도 check_in_id 기준 INSERT/SELECT 가능
--   AC-3: 기존 reservation_id/customer_id 기반 데이터 회귀 없음
--   AC-4: 세 컬럼 모두 NULL인 행 삽입 차단 (CHECK 제약)
--
-- Rollback: 20260521050000_resv_memo_checkin_id.down.sql
-- Ticket:   T-20260521-foot-WALKIN-MEMO-GAP
-- Applied:  2026-05-21

-- ============================================================
-- 1. check_in_id 컬럼 추가
-- ============================================================
ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS check_in_id uuid REFERENCES check_ins(id) ON DELETE CASCADE;

-- ============================================================
-- 2. check_in_id 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rmh_check_in_id ON reservation_memo_history(check_in_id);

-- ============================================================
-- 3. 기존 CHECK 제약 갱신 (chk_rmh_id_present: reservation_id OR customer_id → + check_in_id)
-- ============================================================
ALTER TABLE reservation_memo_history
  DROP CONSTRAINT IF EXISTS chk_rmh_id_present;

ALTER TABLE reservation_memo_history
  ADD CONSTRAINT chk_rmh_id_present
  CHECK (
    reservation_id IS NOT NULL
    OR customer_id IS NOT NULL
    OR check_in_id IS NOT NULL
  );

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'reservation_memo_history'
--    AND column_name IN ('reservation_id', 'customer_id', 'check_in_id');
-- 기대: 세 컬럼 모두 is_nullable=YES
--
-- INSERT 테스트 (체크인만 있는 워크인):
-- INSERT INTO reservation_memo_history (check_in_id, clinic_id, content, created_by_name)
--   VALUES ('<valid_check_in_id>', '<clinic_id>', '체크인 기반 워크인 테스트', '테스트');  -- 성공 기대
--
-- CHECK 제약 테스트:
-- INSERT INTO reservation_memo_history (clinic_id, content, created_by_name)
--   VALUES ('<clinic_id>', '제약 테스트', '테스트');  -- 실패 기대 (CHECK 위반)
