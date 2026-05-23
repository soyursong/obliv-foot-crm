-- T-20260522-foot-PAY-INPUT-001
-- 종로 풋센터 데스크 결제 입력 UI — 카드 승인번호·TID 컬럼 추가 (1차)
-- PAY-RECON-001 롱레CRM 명세와 완전 동일 네이밍 (2차 reconciliation 자동 흡수)
-- ADDITIVE-ONLY: 기존 컬럼·CHECK·트리거 변경 0건. 기존 INSERT 무영향.
-- 롤백: 20260523040000_pay_external_fields.down.sql
--
-- risk: GO_WARN (additive, null allowed, no constraint change)
-- deadline: 2026-05-24 (종로 풋 가오픈 D-Day)

-- ── payments 테이블 ────────────────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS external_approval_no TEXT,  -- 카드 승인번호 (영수증 6~12자리)
  ADD COLUMN IF NOT EXISTS external_tid          TEXT;  -- 단말기 TID (영수증 10자리)

-- ── package_payments 테이블 ───────────────────────────────────────────
ALTER TABLE package_payments
  ADD COLUMN IF NOT EXISTS external_approval_no TEXT,  -- 카드 승인번호
  ADD COLUMN IF NOT EXISTS external_tid          TEXT;  -- 단말기 TID

-- 확인: 컬럼 존재 여부
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name IN ('payments','package_payments')
-- AND column_name LIKE 'external_%';
