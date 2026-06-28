-- ─────────────────────────────────────────────────────────────────────
-- RRN Rotation STAGE2A: 컬럼 선생성 ONLY (audit columns precreate)
-- 출처: rrn_stage3_columns.sql L12–22 발췌 (ADD COLUMN + COMMENT 블록만)
-- ⚠️ STAGE2A 범위: failures 테이블(Step2)·검증 DO(Step3)는 STAGE3 잔류 — 여기서 실행 금지
-- ─────────────────────────────────────────────────────────────────────
-- 적용 대상: 3 CRM × 2 환경 = 6 위치 (롱레·foot·body × dev/prod)
-- 운영 영향: ADD COLUMN IF NOT EXISTS DEFAULT NULL = 메타데이터만 변경
--           (Postgres 11+ instant·무중단·무 rewrite). idempotent. write 0건.
-- 롤백: DROP COLUMN (STAGE2 함수 미배포 = write 미발생 전제에서 안전)
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS rrn_vault_id UUID,
  ADD COLUMN IF NOT EXISTS rrn_re_encrypted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rrn_encryption_version SMALLINT DEFAULT 1;

COMMENT ON COLUMN public.customers.rrn_vault_id IS
  'v3 Vault 패턴 ID (Stage 7 SSOT 통일 후 정식 사용). NULL=v1·v2 패턴';
COMMENT ON COLUMN public.customers.rrn_re_encrypted_at IS
  'Stage 4 batch re-encrypt 시각 또는 신규 INSERT 시각 (v2 이후). 진행률 추적용';
COMMENT ON COLUMN public.customers.rrn_encryption_version IS
  '1=구키 (Stage 2 이전), 2=신키 (Stage 4 batch 완료 후), 3=Vault (Stage 7 통일 후)';

COMMIT;

-- ─── 적용 후 검증 (각 환경에서 실행 → supervisor 사후검증에 결과 회신) ───
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='customers'
--     AND column_name IN ('rrn_vault_id','rrn_re_encrypted_at','rrn_encryption_version')
--   ORDER BY column_name;
-- 기대: 3 row (rrn_encryption_version default '1', 나머지 default NULL)
