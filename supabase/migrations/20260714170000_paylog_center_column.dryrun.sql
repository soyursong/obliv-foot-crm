-- DRY-RUN: T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER (payment_reconciliation_log.center)
-- 목적: (1) center 컬럼 ADD 무오류, (2) 기존행 전량 'foot' 자동 backfill(회귀 0 증명),
--       (3) CHECK(center IN ('foot','body')) 강제 확인, (4) NOT NULL 강제 확인.
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 txn-control 문(COMMIT/SAVEPOINT release 등) 없음 → BEGIN..ROLLBACK 로 무영속 보장.
--   · 마지막 post-probe(트랜잭션 밖)로 center 컬럼 미영속 재확인 = sentinel-bypass 차단.
-- 실 데이터 무변경. supervisor DB-GATE 증거용. 프로드 rxlomoozakkjesdqjtvd.
-- 실행: psql "$FOOT_DB_URL" -f 이 파일

-- ── 사전 스냅샷: 적용 전 center 컬럼 부재 + 기존 행수 ──
SELECT 'PRE: center_col_exists' AS check,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_reconciliation_log'
                 AND column_name='center') AS val;
SELECT 'PRE: log_row_count' AS check, count(*) AS val FROM public.payment_reconciliation_log;

BEGIN;

-- ── 본 마이그 §1~4 발췌 (txn-control 문 없음) ──
ALTER TABLE public.payment_reconciliation_log
  ADD COLUMN IF NOT EXISTS center text NOT NULL DEFAULT 'foot';
ALTER TABLE public.payment_reconciliation_log
  DROP CONSTRAINT IF EXISTS payment_reconciliation_log_center_check;
ALTER TABLE public.payment_reconciliation_log
  ADD CONSTRAINT payment_reconciliation_log_center_check
    CHECK (center IN ('foot', 'body'));
UPDATE public.payment_reconciliation_log SET center = 'foot' WHERE center IS NULL;
CREATE INDEX IF NOT EXISTS recon_log_clinic_center_created_idx
  ON public.payment_reconciliation_log (clinic_id, center, created_at DESC);

-- ── (A) 컬럼 존재 + NOT NULL + default='foot' ──
SELECT 'A: center_col' AS check,
       (is_nullable = 'NO') AS not_null_pass,
       (column_default LIKE '%foot%') AS default_pass
FROM information_schema.columns
WHERE table_schema='public' AND table_name='payment_reconciliation_log' AND column_name='center';

-- ── (B) 기존행 전량 'foot' (회귀 0 — 오염 없음) ──
SELECT 'B: existing_all_foot' AS check,
       count(*) FILTER (WHERE center = 'foot') AS foot_rows,
       count(*) AS total_rows,
       (count(*) FILTER (WHERE center = 'foot') = count(*)) AS pass
FROM public.payment_reconciliation_log;

-- ── (C) CHECK 강제 — 잘못된 값 INSERT 거부(예외 = 정상) ──
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payment_reconciliation_log (clinic_id, event_type, center)
    VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'auto_matched', 'dohsu');
    RAISE EXCEPTION 'DRYRUN-FAIL: CHECK 이 잘못된 center=dohsu 를 허용함(회피 위험)';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'C: CHECK 정상 — center=dohsu 거부됨(canonical body/foot 만 허용)';
  END;
END $$;

-- ── (D) 유효값 body/foot INSERT 는 통과(FK 회피 위해 롤백 예정) ──
--   FK(clinic_id→clinics) 때문에 실제 INSERT 는 생략. CHECK 만 §C 에서 검증.

ROLLBACK;

-- ── POST-PROBE (트랜잭션 밖) — center 컬럼 미영속 재확인 = No-Persistence 증명 ──
SELECT 'POST: center_col_persisted (MUST be false)' AS check,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='payment_reconciliation_log'
                 AND column_name='center') AS val;
