-- T-20260804-foot-COSMETIC-CORRECTION-CRM — check_in_services soft-void 프리미티브 (Tier-C 라인제외)
-- DA-20260805-foot-COSMETIC-VOID-SEMANTIC (gate CLOSED) · SSOT §ADDENDUM-CENSUS-COMPLETE
--
-- 목적: 비진성(net cash-in 0 · 오등록/미판매) 화장품 라인을 라인그레인 soft-void 로 표시.
--   customers.is_simulation(고객그레인·매출유니버스 밖) ⊥ customers.is_test(고객그레인·view-hide)
--   ⊥ check_in_services.voided_at(라인그레인·화장품 표시매출 귀속제외) = 3축 직교 방화벽.
--
-- change-class = ADDITIVE (신규 NULLABLE 3컬럼, 기존 data 불변·DELETE 0·reversible)
--   → autonomy §3.1 대표게이트(CEO) 면제 유지. 파괴 트리거(DROP·행DELETE·비가역·grain-migration) 미발동.
--   잔여 게이트 = supervisor DDL-diff + FE co-deploy 배포순서(MIG-GATE).
--
-- ★firewall(by construction): 이 flag 는 오직 Tier-C 표시 read-path(SalesStaffTab·SalesTreatmentTab
--   ·Closing procedureServicesRaw 표시카드)에서만 `voided_at IS NULL` 로 read.
--   Tier-F(payment-authority: v_daily_revenue·매출 split·마감 payload/grossTotal·footBilling·planbExpected)
--   = flag 절대 read 금지. revenue=payment-grain(§7-3) ⊥ check_in_services line-flag → 매출 은닉 구조적 불가.
--
-- ★원자배포 계약: 본 DDL(컬럼 ADD) 이 FE(`.is('voided_at', null)` 필터) 보다 반드시 선행/동시 배포.
--   미배포 상태로 FE ship 시 PostgREST "column does not exist" 오류.
--   배포 직후 전건 voided_at=NULL → 표시매출 불변(net-zero). 4-PK freeze 는 별도 apply(현장 confirm 후).
--
-- 선례 = 20260714190000_closing_manual_payments_softvoid.sql (동일 3컬럼 shape).
-- 파괴적 DDL 0. 멱등 가드(IF NOT EXISTS).
BEGIN;

ALTER TABLE check_in_services ADD COLUMN IF NOT EXISTS voided_at     timestamptz NULL;
ALTER TABLE check_in_services ADD COLUMN IF NOT EXISTS voided_reason text        NULL;
ALTER TABLE check_in_services ADD COLUMN IF NOT EXISTS voided_by     text        NULL;

COMMENT ON COLUMN check_in_services.voided_at IS
  'soft-void 무효화 시각(UTC). NULL=유효행(Tier-C 표시매출 집계 포함). NOT NULL=비진성(집계 제외). T-20260804-foot-COSMETIC-CORRECTION-CRM';
COMMENT ON COLUMN check_in_services.voided_reason IS
  'soft-void 사유(자유텍스트). 오등록/미판매/phantom 등. 실행 티켓에서 기입.';
COMMENT ON COLUMN check_in_services.voided_by IS
  'soft-void 실행 주체(staff id 또는 이름). 실행 티켓에서 기입.';

COMMIT;
