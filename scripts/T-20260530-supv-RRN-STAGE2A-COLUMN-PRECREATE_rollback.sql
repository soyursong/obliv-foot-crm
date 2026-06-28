-- ─────────────────────────────────────────────────────────────────────
-- T-20260530-supv-RRN-STAGE2A-COLUMN-PRECREATE — ROLLBACK
-- 전제: STAGE2 dual-key 함수 미배포 = 이들 컬럼에 write 미발생 → DROP 안전(무손실)
-- ⚠️ STAGE2 함수 배포 후에는 절대 실행 금지 (재암호화 audit 데이터 손실)
-- ─────────────────────────────────────────────────────────────────────
BEGIN;
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS rrn_vault_id,
  DROP COLUMN IF EXISTS rrn_re_encrypted_at,
  DROP COLUMN IF EXISTS rrn_encryption_version;
COMMIT;
