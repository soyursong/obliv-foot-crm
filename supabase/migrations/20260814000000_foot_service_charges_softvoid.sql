-- T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — CARVE-A: service_charges soft-void 프리미티브
-- DA REPLY MSG-20260814-000358-6osg (Q1 service_charges = Tier-0 매출/insurance-split ledger)
--   · dev-foot CARVE census MSG-20260814-001534-xduh (commit ca3f5dc2) · dispatch MSG-20260814-001939-vc7k
--
-- 목적: service_charges(급여 명세 grain·매출/insurance-split ledger) 라인의 물리삭제(hard-DELETE)를
--   차단하고 라인그레인 soft-void 로 대체(Tier-0 원장규율). DocumentPrintPanel.tsx:3161 handleDeleteItem
--   (세부내역서 편집 '항목 삭제') = 앱 유일 removal 콜사이트(census 확정) → voided_at UPDATE 로 전환.
--
-- ★storage 술어 = B-2 sibling `voided_at` verbatim 신설(mirror-not-invent):
--   선례 = 20260714190000_closing_manual_payments_softvoid.sql / 20260805110000_foot_check_in_services_softvoid.sql
--   (동일 3컬럼 shape). `is_deleted` envelope 부적합(매출 line=voided_at 축·census 기존 flag 부재).
--   ★envelope Q3(is_deleted vs deleted_at·MSG-233438-2n14) 잔여 HOLD 와 독립축 — 병렬 forward(voided_at).
--
-- change-class = ADDITIVE (신규 NULLABLE 3컬럼 only·기존 data 불변·backfill 0·DROP 0·reversible)
--   → autonomy §3.1 대표게이트(CEO) 면제(방향 경영BO 승인·exposure-neutral·데이터손실 감소).
--   잔여 게이트 = supervisor DDL-diff + 물리 GO-token(db_apply_guard.sh) 선행. apply_before_go 금지.
--
-- ★원자배포 계약: 본 DDL(컬럼 ADD) 이 FE(`.is('voided_at', null)` G2 parity 필터) 보다 반드시 선행/동시 배포.
--   미배포 상태로 FE ship 시 PostgREST "column does not exist" 오류.
--   배포 직후 전건 voided_at=NULL → 급여 3값(급여총액·본부금·공단부담) 집계 불변(net-zero).
--
-- 파괴적 DDL 0. 멱등 가드(IF NOT EXISTS).
BEGIN;

ALTER TABLE service_charges ADD COLUMN IF NOT EXISTS voided_at     timestamptz NULL;
ALTER TABLE service_charges ADD COLUMN IF NOT EXISTS voided_reason text        NULL;
ALTER TABLE service_charges ADD COLUMN IF NOT EXISTS voided_by     text        NULL;

COMMENT ON COLUMN service_charges.voided_at IS
  'soft-void 무효화 시각(UTC). NULL=유효행(급여 3값 집계·명세서 렌더 포함). NOT NULL=무효(전 집계/렌더 제외·G2 parity). T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-A';
COMMENT ON COLUMN service_charges.voided_reason IS
  'soft-void 사유(자유텍스트). 세부내역 편집 삭제·오등록 등. handleDeleteItem 기입(pre-settlement/post-recognition 라벨 포함).';
COMMENT ON COLUMN service_charges.voided_by IS
  'soft-void 실행 주체(auth user id 또는 staff 식별자). handleDeleteItem 기입.';

COMMIT;
