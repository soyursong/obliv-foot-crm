-- ============================================================
-- Migration: payments.card_no_masked (마스킹 카드번호 표시컬럼) + payments-scoped PCI 마스킹 가드
-- Ticket: T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY  (AC-5/AC-6)
-- ============================================================
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md
--   §7 ADDENDUM (DA-20260804-FOOT-CBAND-CARDNO-MASKED-PLACEMENT) — CONSULT-REPLY(078b) GO.
--   change-class = ADDITIVE (payments card_no_masked nullable 신규컬럼 + BEFORE 트리거 가드, 파괴변경 0·매출 shape 무접촉)
--     → autonomy §3.1 CEO 대표게이트 면제 CONFIRMED. gate = supervisor PHI DB-GATE(카드 마스킹 가드 원자착지·scalp RRN 정규식 상속금지) + DDL-diff.
--
-- 무엇 (§7-1/§7-2 정본):
--   · payments.card_no_masked text NULLABLE — CAT 응답의 6번째 구조화 필드(AUTHNO/TID/TAMT/accounting_date/MERNO 5형제와 동일 grain·write-path).
--     착지홈 = payments PRIMARY (§7-1). attempt read-through = REJECT(attempt write-path lossy — updateAttempt 사일런트-실패 시 유실).
--   · ★payments-scoped BEFORE INSERT/UPDATE PCI 가드 = 마스킹 CARDNO 컬럼과 **동일 마이그 원자착지**(§7-2, blob/카드컬럼과 가드 분리배포 금지).
--     - ∃마스킹char(*/X) 있으면 무조건 통과(마스킹값 자연통과·§7-2).
--     - 마스킹 마커 없는 연속 13~19자리 Luhn-valid 숫자런(=평문 PAN)만 RAISE.
--     - ★scalp naive 정규식(13~19 무조건 차단) 상속 절대 금지 → foot_is_luhn 게이팅(승인번호 8자리/TID/거래번호 오차단 0). §7-2 HARD 제약 (a).
--     - PCI enforcement SSOT = cband_pa_pci_guard(raw_response) Rule B 와 **동일 enforcement 개념 재사용**(발산 금지, §7-2 HARD 제약 (b)). foot_is_luhn 헬퍼 공유.
--   · ⚠ 예외 메시지에 매칭값 절대 echo 금지(그 자체가 유출).
--
-- backfill = N/A (§7-4): field-soak payment(cf57b805)의 attempt raw_response=null(사일런트-실패) + RedPay 피드 카드번호 전무 → 소급 소스 0 = forward-only 캡처. 과거 payments = card_no_masked 영구 공백(note).
-- 무회귀: ADDITIVE-ONLY(ADD COLUMN IF NOT EXISTS + BEFORE 트리거). 기존 payments 행 무변(default NULL·위반행 0).
-- 선행: foot_is_luhn 헬퍼(mig 20260731190000 로 prod 존재). 부재 대비 본 마이그도 CREATE OR REPLACE 로 자체 보장.
-- rollback: 20260804193000_foot_payments_card_no_masked.rollback.sql
-- dryrun  : 20260804193000_foot_payments_card_no_masked.dryrun.mjs (No-Persistence: txn-strip + ROLLBACK + post-probe)
-- ============================================================

BEGIN;

-- 1. 컬럼 (ADDITIVE, nullable) ─────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS card_no_masked text;

COMMENT ON COLUMN public.payments.card_no_masked IS
  '코밴 CAT 직결결제 마스킹 카드번호(단말이 이미 마스킹, 예: 55318440****364*). ⚠평문 PAN 저장 금지 — trg_payments_card_no_masked_pci_guard 로 코드레벨 차단. verbatim 캡처(재-mask/un-mask 없음). T-20260804-foot-CBAND-PAYRESP-RECORD-PERSIST-VERIFY(DA §7)';

-- 2. Luhn 헬퍼 — PAN 후보 판정. mig 20260731190000 로 prod 존재하나 부재 대비 자체 보장(idempotent CREATE OR REPLACE).
--    ★PCI enforcement SSOT 단일화(§7-2 (b)): cband_pa_pci_guard 와 동일 헬퍼 재사용(발산 금지).
CREATE OR REPLACE FUNCTION public.foot_is_luhn(p_num text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_sum int := 0; v_d int; v_i int; v_n int;
BEGIN
  IF p_num IS NULL OR p_num !~ '^\d+$' THEN RETURN false; END IF;
  v_n := length(p_num);
  FOR v_i IN 1..v_n LOOP
    v_d := substr(p_num, v_n - v_i + 1, 1)::int;
    IF (v_i % 2) = 0 THEN v_d := v_d * 2; IF v_d > 9 THEN v_d := v_d - 9; END IF; END IF;
    v_sum := v_sum + v_d;
  END LOOP;
  RETURN (v_sum % 10) = 0;
END;
$$;

-- 3. payments-scoped 마스킹 카드번호 PCI 가드 (★card_no_masked 컬럼과 동일 마이그 원자착지, §7-2) ──────
--    ∃마스킹char(*/X) → 통과. 마스킹 마커 없는 연속 13~19자리 Luhn-valid 숫자런(평문 PAN)만 RAISE.
--    ★scalp naive(13~19 무조건 차단) 상속 금지 = foot_is_luhn 게이팅(§7-2 (a)). 예외 메시지에 값 echo 금지.
CREATE OR REPLACE FUNCTION public.payments_card_no_masked_pci_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_val    text;
  v_digits text;
BEGIN
  IF NEW.card_no_masked IS NULL THEN RETURN NEW; END IF;
  v_val := NEW.card_no_masked;

  -- ∃마스킹 마커(*/X) 있으면 마스킹값 = 자연통과(§7-2). 마스킹 char 가 연속숫자열을 끊어 Luhn-valid PAN 불성립.
  IF v_val ~ '[*Xx]' THEN
    RETURN NEW;
  END IF;

  -- 마스킹 마커 없음 → 평문 PAN 위험. 구분자 제거 후 13~19자리 Luhn-valid 이면 미마스킹 PAN 으로 판정·차단.
  --   ★foot_is_luhn 게이팅 = AUTHNO(8자리)/TID/거래번호(Luhn 미통과) 오차단 회피(scalp naive 상속 금지).
  v_digits := regexp_replace(v_val, '[^0-9]', '', 'g');
  IF length(v_digits) BETWEEN 13 AND 19 AND public.foot_is_luhn(v_digits) THEN
    RAISE EXCEPTION 'PCI guard: payments.card_no_masked 에 미마스킹 카드번호(PAN)로 보이는 값이 포함됨. 마스킹(first6/last4) 값만 저장하세요.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_card_no_masked_pci_guard ON public.payments;
CREATE TRIGGER trg_payments_card_no_masked_pci_guard
  BEFORE INSERT OR UPDATE OF card_no_masked ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_card_no_masked_pci_guard();

COMMIT;
