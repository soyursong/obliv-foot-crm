-- T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR
-- V-B archive-first MOVE 를 위한 payments 원본 스냅샷 보존 테이블 (DDL / additive)
--
-- 근거: data-architect CONSULT-REPLY awo9 (V-B 조건부 GO) + planner bd77 게이트 재무장.
--   single payments → active package_payments 재앵커(MOVE) 는 payments 원장 접점(파괴적 DELETE).
--   orphan_archive_fk_guard_sop §1~§4: 제거 전 원본 전 컬럼 스냅샷을 archive 테이블에 보존 → 순소실0 → 가역.
--   reversal/void(음수결제) 채택 금지(환불 아님).
--
-- 이 마이그레이션은 ADDITIVE(CREATE TABLE only) — 기존 payments/package_payments/packages 무접점.
-- 실제 MOVE(archive INSERT + single DELETE + package_payments INSERT + paid_amount 재집계)는
--   gate3 GO 후 apply 스크립트가 단일 트랜잭션으로 수행. 본 파일은 스냅샷 그릇만 생성.
--
-- migration_ledger_reconciliation 대상: 본 CREATE 는 schema_migrations 원장에 신규 1행 추가.
--   apply(prod) 후 정본(prod 실재) == 원장 == 파일선언 3자 정합 확인 필수(supervisor DB-GATE).

BEGIN;

CREATE TABLE IF NOT EXISTS public.payments_archive (
  archive_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at    timestamptz NOT NULL DEFAULT now(),
  archive_ticket text        NOT NULL,   -- 정정 티켓 id (감사 추적)
  archive_reason text        NOT NULL,   -- RC 태그 (예: RC-B/RC-C single→pkg MOVE)
  original_id    uuid        NOT NULL,   -- 제거된 payments.id (가역 복원 키)
  original_row   jsonb       NOT NULL    -- payments 전 컬럼 스냅샷 (순소실0 / rollback 원본)
);

COMMENT ON TABLE public.payments_archive IS
  'archive-first MOVE 시 제거되는 payments 원본 스냅샷 보존소. orphan_archive_fk_guard_sop §1~§4 순소실0·가역 봉투. 매출/원장 집계 무접점(canonical = payments net + package_payments net).';

-- 감사 조회 인덱스 (원본 id 로 복원·중복 archive 방지 확인)
CREATE INDEX IF NOT EXISTS idx_payments_archive_original_id ON public.payments_archive (original_id);
CREATE INDEX IF NOT EXISTS idx_payments_archive_ticket      ON public.payments_archive (archive_ticket);

-- RLS: 서비스 롤 전용(감사 아티팩트, 앱 클라이언트 미노출). PHI-성 결제 스냅샷 보호.
ALTER TABLE public.payments_archive ENABLE ROW LEVEL SECURITY;
-- 정책 미부여 = anon/authenticated 접근 0 (service_role 은 RLS 우회). 앱 read/write 경로 없음.

COMMIT;
