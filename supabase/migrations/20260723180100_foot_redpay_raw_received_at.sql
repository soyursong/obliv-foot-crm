-- ══════════════════════════════════════════════════════════════════
-- T-20260723-foot-REDPAY-PLANB-DDL-BUILD — redpay_raw_transactions.received_at 신설 (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════
-- DA 판정: GO (ADDITIVE) as-is — DA-20260723-FOOT-REDPAY-PLANB-DDL §②.
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_redpay_planb_ddl_20260723.md §②.
--
-- ── 설계 근거 ──────────────────────────────────────────────────────────
--   · received_at = 웹훅 수신시각(EF 가 명시 set). created_at 대용 불가:
--       created_at = row insert 시각 → 폴러가 웹훅 도착 전 선적재 시 created_at ≠ 웹훅 수신시각.
--   · ★ DEFAULT 없음(NULL 허용) 필수 — DEFAULT now() 면 폴러 행에도 값이 들어가 관측 오염.
--       웹훅 EF 만 명시적으로 received_at=now() set(후속 build A), 폴러 경로는 NULL 유지.
--   · 용도: 웹훅 지연 관측 + TTL(pending_payment.expires_at) 확정 기준(관측 2~3일 후 별도 ADDITIVE).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: 컬럼 1(nullable, DEFAULT 없음) + COMMENT. 파괴적 변경 0. 제약·인덱스·트리거·RLS 무변경.
--   조립 정합(AC5): 현행 redpay-webhook / redpay-reconcile(폴러) 어느 코드도 received_at 를 참조/기입하지 않음
--     → 두 경로의 기존 INSERT/UPSERT 는 컬럼 생략 = NULL 로 안전(하위호환). 웹훅 received_at=now() 배선은 build A(후속).
--     폴러 NULL 검증: redpay-reconcile row 빌더가 received_at 미포함 → 항상 NULL(관측 오염 없음).
--   무접촉(AC7): payments / payment_reconciliation_log / 기존 매출 split. redpay_raw 다른 컬럼 무변경.
--   멱등: ADD COLUMN IF NOT EXISTS (재실행 무해).
--   Rollback: 20260723180100_foot_redpay_raw_received_at.rollback.sql (DROP COLUMN — 웹훅 수신시각 관측치 소실).
--   Dry-run(무영속): 20260723180100_foot_redpay_raw_received_at.dryrun.mjs.
--
-- risk: GO(ADDITIVE, nullable 컬럼, 소비처 0). db_only → E2E spec 면제, MIG-GATE evidence 4필드 의무.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.redpay_raw_transactions
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;  -- DEFAULT 없음. 웹훅 경로만 set, 폴러 NULL.

COMMENT ON COLUMN public.redpay_raw_transactions.received_at IS
  '웹훅 수신시각(EF 가 명시 set). 폴러 선적재 경로 NULL. 웹훅 지연 관측·TTL 확정 기준. created_at 대용 불가. '
  'T-20260723-foot-REDPAY-PLANB-DDL-BUILD (DA-20260723-FOOT-REDPAY-PLANB-DDL §②, ADDITIVE).';

COMMIT;
