-- T-20260520-foot-RESV-MEMO-WALKIN
-- 워크인(예약 없는) 고객도 예약메모 작성/열람 활성화
--
-- Root Cause:
--   reservation_memo_history.reservation_id 가 NOT NULL → 예약 없는 워크인 고객은
--   메모 INSERT 불가, timeline도 빈 상태 (조건 분기에서 "연결된 예약 없음" fallback)
--
-- Fix (A안):
--   1. reservation_id DROP NOT NULL (FK는 유지 — 기존 참조 깨지지 않음)
--   2. customer_id 컬럼 추가 (nullable FK → customers.id ON DELETE CASCADE)
--   3. customer_id 인덱스 생성
--   4. CHECK: reservation_id 또는 customer_id 중 하나는 반드시 존재
--
-- AC:
--   AC-1: reservation_id 없어도 INSERT 가능
--   AC-2: customer_id 기준 SELECT 가능
--   AC-3: 기존 reservation_id 기반 데이터 회귀 없음
--   AC-4: 두 컬럼 모두 NULL인 행 삽입 차단 (CHECK 제약)
--
-- Rollback: 20260520130000_resv_memo_walkin.down.sql
-- Ticket:   T-20260520-foot-RESV-MEMO-WALKIN
-- Applied:  2026-05-20

-- ============================================================
-- 1. reservation_id NOT NULL 제거 (FK 유지)
-- ============================================================
ALTER TABLE reservation_memo_history
  ALTER COLUMN reservation_id DROP NOT NULL;

-- ============================================================
-- 2. customer_id 컬럼 추가
-- ============================================================
ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE CASCADE;

-- ============================================================
-- 3. customer_id 인덱스
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rmh_customer_id ON reservation_memo_history(customer_id);

-- ============================================================
-- 4. 최소 하나 필수 CHECK 제약
--    reservation_id 또는 customer_id 중 하나는 반드시 존재
-- ============================================================
ALTER TABLE reservation_memo_history
  ADD CONSTRAINT chk_rmh_id_present
  CHECK (reservation_id IS NOT NULL OR customer_id IS NOT NULL);

-- ============================================================
-- 검증 쿼리 (apply 후 supervisor 수동 확인용)
-- ============================================================
-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'reservation_memo_history'
--    AND column_name IN ('reservation_id', 'customer_id');
-- 기대: reservation_id → YES(nullable), customer_id → YES(nullable)
--
-- INSERT 테스트 (예약 없는 워크인):
-- INSERT INTO reservation_memo_history (customer_id, clinic_id, content, created_by_name)
--   VALUES ('<valid_customer_id>', '<clinic_id>', '워크인 테스트', '테스트');  -- 성공 기대
--
-- CHECK 제약 테스트:
-- INSERT INTO reservation_memo_history (clinic_id, content, created_by_name)
--   VALUES ('<clinic_id>', '제약 테스트', '테스트');  -- 실패 기대 (CHECK 위반)
