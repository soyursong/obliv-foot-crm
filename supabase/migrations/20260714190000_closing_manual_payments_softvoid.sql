-- T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE
-- soft-void forward 프리미티브: closing_manual_payments 에 무효화(soft-void) 메타 3컬럼 ADDITIVE 신설.
--
-- 게이트: ADDITIVE(신규 NULLABLE only, 기존 data 불변) + DA GO(Q2 승인, 본 요청 발신)
--        → autonomy §3.1 대표 게이트 면제. supervisor DDL-diff 게이트만.
-- risk_verdict: GO_WARN.
--
-- 원자배포 계약: 본 DDL + FE/집계 `WHERE voided_at IS NULL` 필터 동시 배포.
--   배포 직후 기존행 전부 voided_at=NULL → 3버킷(급여본인/비급여/공단부담) 합계 불변(net-zero).
--   forward 전용 — 방향 뒤집기/재집행 아님. RETRO/DAILYCLOSE-MISU 정정과 독립.
--
-- 파괴적 DDL 0. 멱등 가드(IF NOT EXISTS). No-Persistence dry-run 러너: apply_20260714190000_*.mjs
BEGIN;

ALTER TABLE closing_manual_payments ADD COLUMN IF NOT EXISTS voided_at     timestamptz NULL;
ALTER TABLE closing_manual_payments ADD COLUMN IF NOT EXISTS voided_reason text        NULL;
ALTER TABLE closing_manual_payments ADD COLUMN IF NOT EXISTS voided_by     text        NULL;

COMMENT ON COLUMN closing_manual_payments.voided_at IS
  'soft-void 무효화 시각(UTC). NULL=유효행(전 합산경로 포함). NOT NULL=무효(합산 제외). T-20260714-SOFTVOID-INFRA-FWD-PRIMITIVE';
COMMENT ON COLUMN closing_manual_payments.voided_reason IS
  'soft-void 사유(자유텍스트). 실행 티켓에서 기입.';
COMMENT ON COLUMN closing_manual_payments.voided_by IS
  'soft-void 실행 주체(staff id 또는 이름). 실행 티켓에서 기입.';

COMMIT;
