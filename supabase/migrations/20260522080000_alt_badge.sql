-- T-20260522-foot-ALT-BADGE
-- ALT(올트) 배지 시스템:
--   (1) customers 테이블 — alt_status, alt_detail, alt_activated_at
--   (2) reservation_memo_history — is_pinned, pinned_at (고객메모 고정 기능)
-- Risk: GO_WARN — DB 스키마 변경 + 비즈니스 로직 핵심 경로
-- 승인: planner 지시 (MSG-20260522-123508-a4z2)

-- ── (1) customers: ALT 상태 컬럼 ─────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS alt_status        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alt_detail        text,
  ADD COLUMN IF NOT EXISTS alt_activated_at  timestamptz;

COMMENT ON COLUMN customers.alt_status
  IS 'ALT(올트) 활성 여부 — 보험 반려 후 포돌로게+레이저 병행 대상자 표식';
COMMENT ON COLUMN customers.alt_detail
  IS 'ALT 상세 설명 — 예: "3회차까지 진행, 보험 반려됨"';
COMMENT ON COLUMN customers.alt_activated_at
  IS 'ALT 최초 활성화 일시';

-- alt_status=true 고객 조회용 부분 인덱스 (대시보드 배지 배치 조인)
CREATE INDEX IF NOT EXISTS idx_customers_alt_status
  ON customers(id)
  WHERE alt_status = true;

-- ── (2) reservation_memo_history: 고정 메모 컬럼 ──────────────────────────────

ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS is_pinned  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at  timestamptz;

COMMENT ON COLUMN reservation_memo_history.is_pinned
  IS '고객메모 상단 고정 여부';
COMMENT ON COLUMN reservation_memo_history.pinned_at
  IS '고정 설정 일시 (고정 해제 시 NULL)';

-- 고정 메모 정렬 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_rmh_customer_pinned
  ON reservation_memo_history(customer_id, is_pinned, created_at DESC)
  WHERE customer_id IS NOT NULL;
