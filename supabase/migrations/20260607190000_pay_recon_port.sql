-- ══════════════════════════════════════════════════════════════════
-- T-20260607-foot-REDPAY-PORT — Redpay Reconciliation 스키마 풋센터 이식
-- ══════════════════════════════════════════════════════════════════
-- 출처: T-20260520-crm-PAY-RECON-001 (롱레CRM 1차 검증 완료) M0~M3 스키마 이식.
--       롱레 마이그레이션 6종(schema / cancelled_at / poller_state /
--       m3_alert_tracking / m2_unique_constraints)을 풋CRM에 단일 파일로 통합.
--
-- AC-1: payments 6컬럼(2종 기존 no-op) + redpay_raw_transactions +
--       payment_reconciliation_log + redpay_poller_state + 무결성 제약.
--
-- 풋 변형:
--   - payments 는 source_system 컬럼 없음(단일 도메인) → 매칭은 EF 레벨에서 처리.
--   - external_approval_no / external_tid 는 20260523040000_pay_external_fields 에서
--     이미 추가됨 → ADD COLUMN IF NOT EXISTS 로 no-op 보장.
--   - 단일 클리닉(종로 풋, business_no 511-60-00988) → 멀티테넌트 우려 낮음.
--
-- Zero-Impact Guards (부모 §):
--   G1 — ADD COLUMN only, NULL 허용 (기존 INSERT 무영향)
--   G8 — 롤백 SQL 페어: 20260607190000_pay_recon_port.rollback.sql
--   ADDITIVE-ONLY: 기존 컬럼/CHECK/트리거 변경 0건.
--
-- 주의: timezone_fix(롱레 기존 89건 1회성 데이터 패치)·M4 manual RPC(코디 UI,
--       풋 shadow 검증 후 별도 트랙)는 본 이식 범위에서 제외.
--
-- risk: GO_WARN (additive, null allowed, no constraint change on existing tables)
-- ══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. payments 테이블 — redpay 매칭 컬럼 (총 6종 중 4종 신규)
--    external_approval_no / external_tid 는 기존 존재(no-op)
-- ============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS external_trxid         TEXT,          -- redpay trxid 매칭 키
  ADD COLUMN IF NOT EXISTS external_approval_no   TEXT,          -- (기존) redpay approval_no
  ADD COLUMN IF NOT EXISTS external_status        TEXT,          -- Y/N/M/X 거울값
  ADD COLUMN IF NOT EXISTS external_root_trxid    TEXT,          -- 원거래 식별 (환불 추적)
  ADD COLUMN IF NOT EXISTS external_tid           TEXT,          -- (기존) 단말기 식별
  ADD COLUMN IF NOT EXISTS reconciled_at          TIMESTAMPTZ;   -- 매칭 완료 시각 (NULL = 미매칭)

COMMENT ON COLUMN public.payments.external_trxid       IS 'Redpay 거래 ID (reconciliation 매칭 키)';
COMMENT ON COLUMN public.payments.external_status      IS 'Redpay 거래 상태: Y=승인 N=취소 M=부분취소 X=오류';
COMMENT ON COLUMN public.payments.external_root_trxid  IS 'Redpay 원거래 ID (환불/취소 시 원거래 참조)';
COMMENT ON COLUMN public.payments.reconciled_at        IS 'Reconciliation 매칭 완료 시각 (NULL = 미매칭 상태)';

-- payments 인덱스 (reconciliation 조회 최적화)
CREATE INDEX IF NOT EXISTS payments_external_trxid_idx
  ON public.payments (external_trxid)
  WHERE external_trxid IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_external_approval_no_idx
  ON public.payments (external_approval_no)
  WHERE external_approval_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_unreconciled_idx
  ON public.payments (clinic_id, created_at)
  WHERE reconciled_at IS NULL AND payment_type = 'payment';


-- ============================================================
-- 2. redpay_raw_transactions — Redpay API 원시 데이터 적재 (M1)
--    폴러가 5분마다 fetch 후 upsert. 매칭 전 staging 역할.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.redpay_raw_transactions (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID          NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  external_trxid      TEXT          NOT NULL,
  external_status     TEXT          NOT NULL,   -- Y/N/M/X
  amount              INTEGER       NOT NULL,
  approval_no         TEXT,
  root_trxid          TEXT,
  tid                 TEXT,
  approved_at         TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,              -- 취소 일시 (KST→UTC. 0000-00-00 → NULL)
  raw_payload         JSONB,                    -- redpay 원본 JSON 보관
  matched_payment_id  UUID          REFERENCES public.payments (id) ON DELETE SET NULL,
  match_rule          TEXT,                     -- 4-Tier 매칭 규칙 | NULL(미매칭)
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- 멱등성: 동일 거래 중복 upsert 방지 (AC-2)
  CONSTRAINT redpay_raw_trx_unique UNIQUE (external_trxid, external_status, amount)
);

COMMENT ON TABLE public.redpay_raw_transactions IS
  'Redpay API 원시 데이터 적재 테이블 (M1 폴러 upsert 대상). '
  'matched_payment_id IS NULL = 미매칭. M2에서 4-Tier 매칭 규칙 적용.';

COMMENT ON COLUMN public.redpay_raw_transactions.cancelled_at IS
  'Redpay 취소 일시 (KST→UTC 변환. 0000-00-00 00:00:00 → NULL 정규화)';

CREATE INDEX IF NOT EXISTS redpay_raw_clinic_approved_idx
  ON public.redpay_raw_transactions (clinic_id, approved_at DESC);

CREATE INDEX IF NOT EXISTS redpay_raw_unmatched_idx
  ON public.redpay_raw_transactions (clinic_id)
  WHERE matched_payment_id IS NULL;

CREATE INDEX IF NOT EXISTS redpay_raw_trxid_idx
  ON public.redpay_raw_transactions (external_trxid);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_redpay_raw_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS redpay_raw_updated_at_trigger ON public.redpay_raw_transactions;
CREATE TRIGGER redpay_raw_updated_at_trigger
  BEFORE UPDATE ON public.redpay_raw_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_redpay_raw_updated_at();

-- RLS
ALTER TABLE public.redpay_raw_transactions ENABLE ROW LEVEL SECURITY;

-- authenticated 유저는 자기 clinic_id 데이터만 SELECT
-- INSERT/UPDATE는 service_role(워커)만 (RLS 바이패스)
DROP POLICY IF EXISTS "redpay_raw_read_own_clinic" ON public.redpay_raw_transactions;
CREATE POLICY "redpay_raw_read_own_clinic"
  ON public.redpay_raw_transactions FOR SELECT
  USING (
    clinic_id = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );


-- ============================================================
-- 3. payment_reconciliation_log — 이벤트 소싱 로그
--    자동 매칭·수동 매칭·불일치 알림 이력 보존
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_reconciliation_log (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID          NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  raw_transaction_id  UUID          REFERENCES public.redpay_raw_transactions (id) ON DELETE SET NULL,
  payment_id          UUID          REFERENCES public.payments (id) ON DELETE SET NULL,
  event_type          TEXT          NOT NULL,
  -- 'auto_matched' / 'manual_matched' / 'missing_in_crm' / 'missing_at_van'
  -- / 'amount_mismatch' / 'refund_not_in_crm' / 'match_failed'
  match_rule          TEXT,         -- 4-Tier 값 | 'manual'
  mismatch_reason     TEXT,
  operator_id         UUID          REFERENCES auth.users (id),
  external_trxid      TEXT,
  external_amount     INTEGER,
  crm_amount          INTEGER,
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_reconciliation_log IS
  'Reconciliation 이벤트 소싱 로그. 자동/수동 매칭 이력 + 불일치 알림 근거.';

CREATE INDEX IF NOT EXISTS recon_log_clinic_created_idx
  ON public.payment_reconciliation_log (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS recon_log_payment_id_idx
  ON public.payment_reconciliation_log (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recon_log_event_type_idx
  ON public.payment_reconciliation_log (clinic_id, event_type, created_at DESC);

-- RLS
ALTER TABLE public.payment_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recon_log_read_own_clinic" ON public.payment_reconciliation_log;
CREATE POLICY "recon_log_read_own_clinic"
  ON public.payment_reconciliation_log FOR SELECT
  USING (
    clinic_id = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );
-- INSERT는 service_role(워커) 전용


-- ============================================================
-- 4. redpay_poller_state — 윈도 슬라이딩 상태 (singleton id=1)
--    5분 폴러가 매 사이클 성공 to 시각 추적 → 다음 from = last_to - 2분 오버랩.
--    last_alert_sent_at: M3 Slack 알림 30분 쿨다운 추적.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.redpay_poller_state (
  id                    integer     PRIMARY KEY CHECK (id = 1),
  last_incremental_to   timestamptz,
  last_daily_to         timestamptz,
  last_fetched_count    integer     DEFAULT 0,
  last_upserted_count   integer     DEFAULT 0,
  last_alert_sent_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.redpay_poller_state IS
  'redpay 폴러 윈도 슬라이딩 상태. singleton(id=1).';
COMMENT ON COLUMN public.redpay_poller_state.last_incremental_to IS
  '5분 폴러 마지막 성공 to. 다음 사이클 from = this - 2분 오버랩.';
COMMENT ON COLUMN public.redpay_poller_state.last_alert_sent_at IS
  'M3: Slack 알림 마지막 발송 시각. NULL = 미발송. 30분 쿨다운으로 중복 발송 방지.';

INSERT INTO public.redpay_poller_state (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.redpay_poller_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "redpay_poller_state_service_role_only" ON public.redpay_poller_state;
CREATE POLICY "redpay_poller_state_service_role_only" ON public.redpay_poller_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- 5. 이중 매칭 방지 UNIQUE constraints + match_rule CHECK (M2)
--    1. redpay_raw_transactions.matched_payment_id UNIQUE (1 raw → 1 payment)
--    2. payments.external_trxid UNIQUE (per clinic_id) (1 payment → 1 raw)
--    3. match_rule CHECK (4-Tier + 구 값 호환)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS redpay_raw_matched_payment_unique
  ON public.redpay_raw_transactions (matched_payment_id)
  WHERE matched_payment_id IS NOT NULL;

COMMENT ON INDEX public.redpay_raw_matched_payment_unique IS
  '이중 매칭 방지: 하나의 CRM payment 는 하나의 raw 트랜잭션에만 매칭 가능';

CREATE UNIQUE INDEX IF NOT EXISTS payments_external_trxid_unique
  ON public.payments (clinic_id, external_trxid)
  WHERE external_trxid IS NOT NULL;

COMMENT ON INDEX public.payments_external_trxid_unique IS
  '이중 매칭 방지: 하나의 redpay 거래 ID 는 하나의 CRM payment 에만 연결 가능';

ALTER TABLE public.payment_reconciliation_log
  DROP CONSTRAINT IF EXISTS recon_log_match_rule_check;
ALTER TABLE public.payment_reconciliation_log
  ADD CONSTRAINT recon_log_match_rule_check
    CHECK (match_rule IN (
      'tier0_direct', 'tier1_tight', 'tier2_loose', 'tier3_daily_unique', 'tier4_manual',
      'approval_no', 'tid_time', 'manual'
    ) OR match_rule IS NULL);

ALTER TABLE public.redpay_raw_transactions
  DROP CONSTRAINT IF EXISTS redpay_raw_match_rule_check;
ALTER TABLE public.redpay_raw_transactions
  ADD CONSTRAINT redpay_raw_match_rule_check
    CHECK (match_rule IN (
      'tier0_direct', 'tier1_tight', 'tier2_loose', 'tier3_daily_unique', 'tier4_manual',
      'approval_no', 'tid_time', 'manual'
    ) OR match_rule IS NULL);

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'payments' AND column_name LIKE 'external_%' OR column_name='reconciled_at';
-- SELECT to_regclass('public.redpay_raw_transactions'), to_regclass('public.payment_reconciliation_log'),
--        to_regclass('public.redpay_poller_state');
