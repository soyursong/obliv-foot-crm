-- ============================================================
-- Migration: foot POS 스키마 정합 사전 triage + PCI/PII 마스킹 가드 codify
-- Ticket: T-20260703-foot-POS-FORK-SCHEMA-ALIGN
-- ============================================================
-- 배경 (DA-20260703-POS-META-FOLD INFO / cross_crm_data_contract v1.8 §10-3a):
--   T-20260513 POS(레드페이) FE 계약은 fork 계보(foot/derm/scalp/women) 공유.
--   body 는 body_254 로 payments/package_payments 에 pos_* 3컬럼을 복구했으나,
--   나머지 4벌(foot 포함)은 미점검. foot 의 payments/package_payments 에 pos_* 부재 시
--   실수납 파이프 활성화 순간 42703(undefined column) 전건 실패 잠복.
--   → prod 장애 발견 전 사전 triage 로 스키마 정합 확보.
--
--   [점검 결과] 2026-07-03 기준 foot payments/package_payments 에 pos_* 3컬럼 부재 확인
--   (initial_schema 20260419000000, 이후 pos_* 추가 migration 없음). → ADDITIVE 추가.
--
--   [AC1/AC2] payments + package_payments 에 pos_provider/pos_transaction_id/pos_response
--             ADDITIVE 추가 (ADD COLUMN IF NOT EXISTS → 이미 존재하면 no-op).
--             body_254 pos_* 패턴 + cross_crm_data_contract v1.8 §10-3a 정합형.
--             FE 코드 변경 0 (스키마 정합만). pos_* = raw fidelity 레인(enum 미등재,
--             매출 split SSOT·method_standard 와 직교 — split 분자 불변).
--
--   [AC3] PCI/PII 마스킹 가드 codify — pos_response(JSONB) 에 카드 PAN 전체·track2·CVV·
--         주민번호 원문 저장 금지. write-path 트리거로 코드레벨 차단(BEFORE INSERT/UPDATE).
--         마스킹/토큰화(first6/last4, * 마스킹) 후 적재만 허용. 미마스킹 원문 = 예외 raise.
--         (fork 최초 codify — 나머지 fork 이식용 레퍼런스 패턴)
--
-- 변경 요약: ADDITIVE-ONLY. 컬럼 추가(부재 시) + PCI 가드 함수/트리거. rename/drop 0. 회귀 0.
-- DA CONSULT GO(계약소유·요청자) → supervisor DDL-diff 게이트, 대표게이트 면제(autonomy §3.1).
-- risk_verdict: GO_WARN. rollback: 20260703183000_foot_pos_schema_align_pci_guard.rollback.sql
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. POS 컬럼 정합 (AC1/AC2) — payments + package_payments
--    ADD COLUMN IF NOT EXISTS → 이미 존재하면 no-op(스키마 정합 확인만).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS pos_provider       TEXT,
  ADD COLUMN IF NOT EXISTS pos_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS pos_response       JSONB;

ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS pos_provider       TEXT,
  ADD COLUMN IF NOT EXISTS pos_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS pos_response       JSONB;

COMMENT ON COLUMN public.payments.pos_provider IS
  'POS 연동사(redpay 등). fork POS 계약(T-20260513) 스키마 정합 — T-20260703-foot-POS-FORK-SCHEMA-ALIGN';
COMMENT ON COLUMN public.payments.pos_transaction_id IS
  'POS 승인 거래 ID. 동 티켓';
COMMENT ON COLUMN public.payments.pos_response IS
  'POS 원응답(JSON, raw fidelity). ⚠PCI/PII: 카드 PAN 전체·track2·CVV·주민번호 원문 저장 금지(마스킹/토큰화 후 적재). trg_*_pos_pci_guard 로 코드레벨 차단. 동 티켓';
COMMENT ON COLUMN public.package_payments.pos_provider IS
  'POS 연동사(redpay 등). fork POS 계약 스키마 정합 — T-20260703-foot-POS-FORK-SCHEMA-ALIGN';
COMMENT ON COLUMN public.package_payments.pos_transaction_id IS
  'POS 승인 거래 ID. 동 티켓';
COMMENT ON COLUMN public.package_payments.pos_response IS
  'POS 원응답(JSON, raw fidelity). ⚠PCI/PII 원문 저장 금지 — trg_*_pos_pci_guard 차단. 동 티켓';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Luhn 검증 헬퍼 — PAN 후보의 카드번호 여부 판정(오탐 축소용).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.foot_is_luhn(p_num text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sum int := 0;
  v_d   int;
  v_i   int;
  v_n   int;
BEGIN
  IF p_num IS NULL OR p_num !~ '^\d+$' THEN
    RETURN false;
  END IF;
  v_n := length(p_num);
  FOR v_i IN 1..v_n LOOP
    -- 오른쪽에서부터 i번째 자리
    v_d := substr(p_num, v_n - v_i + 1, 1)::int;
    IF (v_i % 2) = 0 THEN
      v_d := v_d * 2;
      IF v_d > 9 THEN
        v_d := v_d - 9;
      END IF;
    END IF;
    v_sum := v_sum + v_d;
  END LOOP;
  RETURN (v_sum % 10) = 0;
END;
$$;

COMMENT ON FUNCTION public.foot_is_luhn(text) IS
  'Luhn(mod-10) 체크섬 검증. pos_response PCI 가드에서 PAN 후보 판정에 사용. T-20260703-foot-POS-FORK-SCHEMA-ALIGN';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PCI/PII 마스킹 가드 (AC3, codify) — pos_response 원문 민감정보 차단.
--    BEFORE INSERT/UPDATE 트리거. 마스킹 형태(*,X 포함)는 통과, 원문만 예외.
--    ⚠ 예외 메시지에 매칭된 실제 값을 절대 echo 하지 않음(그 자체가 유출).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.foot_pos_response_pci_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_text   text;
  v_cand   text;
  v_digits text;
BEGIN
  IF NEW.pos_response IS NULL THEN
    RETURN NEW;
  END IF;

  v_text := NEW.pos_response::text;

  -- Rule A: 민감 인증데이터(SAD) 키 — PCI DSS 저장 자체 금지(track/CVV/PIN/full-PAN/카드비밀번호).
  --   키가 non-null·non-empty 값을 가지면 차단. (":null" / ":\"\"" 는 통과)
  IF v_text ~* '"(track1|track2|track_?data|full_?pan|cvv2?|cvc2?|cvn2?|csc|pin_?block|pin|card_?password|card_?pw)"\s*:\s*("[^"]+"|-?\d)' THEN
    RAISE EXCEPTION 'PCI guard: pos_response 에 저장 금지 민감 인증데이터(track/CVV/PIN/full-PAN/카드비밀번호)가 포함됨. 마스킹/토큰화 값만 저장하세요.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule B: 미마스킹 카드 PAN — 13~19자리 digit run + Luhn 통과 시 차단.
  --   마스킹 형태(1234 56** **** 7890)는 '*'/'X' 로 digit run 이 끊겨 미검출.
  FOR v_cand IN
    SELECT m[1] FROM regexp_matches(v_text, '\d[\d \-]{11,21}\d', 'g') AS m
  LOOP
    v_digits := regexp_replace(v_cand, '[ \-]', '', 'g');
    IF length(v_digits) BETWEEN 13 AND 19 AND public.foot_is_luhn(v_digits) THEN
      RAISE EXCEPTION 'PCI guard: pos_response 에 미마스킹 카드번호(PAN)로 보이는 값이 포함됨. first6/last4 마스킹 또는 토큰화 후 저장하세요.'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Rule C: 주민등록번호(RRN) YYMMDD-GXXXXXX — MMDD 유효 + 성별코드[1-8] 시 차단.
  IF v_text ~ '\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[ \-]?[1-8]\d{6}' THEN
    RAISE EXCEPTION 'PCI/PII guard: pos_response 에 미마스킹 주민등록번호로 보이는 값이 포함됨. 마스킹/토큰화 후 저장하세요.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.foot_pos_response_pci_guard() IS
  'pos_response(JSONB) 원문 민감정보(카드 PAN/track2/CVV/주민번호) write-path 차단. AC3 codify — T-20260703-foot-POS-FORK-SCHEMA-ALIGN';

DROP TRIGGER IF EXISTS trg_payments_pos_pci_guard ON public.payments;
CREATE TRIGGER trg_payments_pos_pci_guard
  BEFORE INSERT OR UPDATE OF pos_response ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.foot_pos_response_pci_guard();

DROP TRIGGER IF EXISTS trg_package_payments_pos_pci_guard ON public.package_payments;
CREATE TRIGGER trg_package_payments_pos_pci_guard
  BEFORE INSERT OR UPDATE OF pos_response ON public.package_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.foot_pos_response_pci_guard();

COMMIT;

-- ⚠️ 스키마 캐시 리로드 (신규 컬럼 → anon/service REST 노출)
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증 쿼리 (apply 후 확인):
--   -- (1) 컬럼 정합 — payments/package_payments 각 3건 반환 기대
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_name IN ('payments','package_payments')
--      AND column_name IN ('pos_provider','pos_transaction_id','pos_response')
--    ORDER BY 1,2;
--
--   -- (2) PCI 가드 — 아래는 예외 raise 기대(차단):
--   --   INSERT INTO payments(amount,method,pos_response) VALUES
--   --     (1000,'card','{"pan":"4111111111111111"}'::jsonb);            -- Rule B (Luhn PAN)
--   --   INSERT ... pos_response = '{"cvv":"123"}'::jsonb;               -- Rule A (CVV)
--   --   INSERT ... pos_response = '{"rrn":"900101-1234567"}'::jsonb;    -- Rule C (RRN)
--   -- 아래는 통과 기대(마스킹):
--   --   INSERT ... pos_response = '{"pan":"411111******1111","approval":"A123"}'::jsonb;
-- ============================================================
