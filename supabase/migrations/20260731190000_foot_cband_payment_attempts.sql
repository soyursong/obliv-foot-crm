-- ============================================================
-- Migration: 코밴 CAT 직결 결제(플랜A) 시도 레코드 테이블 + raw_response PCI 가드 + is_simulation stamp
-- Ticket: T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD  (K6)
-- ============================================================
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md
--   verdict = GO_ADDITIVE_WITH_CORRECTIONS (DA-20260731-FOOT-CBAND-CAT-3WAY-CANON, zpas)
--   change-class = ADDITIVE (신규테이블 1개, 파괴변경 0, cross-product 충돌 0 foot-local) → autonomy §3.1 대표게이트 면제.
--   gate = supervisor PHI DB-GATE(raw_response 마스킹 원자착지) + DDL-diff.
--
-- 무엇 (§1 정본 저장레이아웃 · attempt grain):
--   · cband_payment_attempts = 운영/감사 grain(★매출 유니버스 진입 금지 §4 매출권위 방화벽 — 매출=payments 단독).
--   · insert-first: WS 요청 송신 '전' 저장 → 응답 유실돼도 msg_trace(12자리)로 단말 [승인내역조회] 가능(유일 키).
--   · raw_response(jsonb) = 정규화 응답 보존(PCI 가드). ★payments 미착지(pos_response 는 prod dead — 부활 금지).
--
-- 멱등 (§4/§5 살아있는 부분):
--   · L1 = UNIQUE(clinic_id, msg_trace) — insert-first 중복 차단(교차세션 유일성).
--   · L2 = partial UNIQUE(clinic_id, check_in_id) WHERE status='requested' — 체크인당 in-flight(requested) 1건 DB 백스톱.
--          (L3 WS 동시1건 = catClient 앱레이어 뮤텍스, DB 아님.)
--   · status CHECK = requested/approved/failed/attention.
--
-- PCI/PII (§3-2 PHI DB-GATE, ★자체 가드 신설):
--   · pos_response PCI 가드 함수(foot_pos_response_pci_guard)는 prod 부재(종이마이그 20260703183000) → 재사용 불가.
--   · cband_payment_attempts.raw_response 전용 BEFORE INSERT/UPDATE 가드를 테이블과 **동일 마이그 원자착지**.
--   · ★scalp RRN false-positive 정규식(13~19자리 승인/거래번호 naive 오차단) 상속 금지 →
--     PAN(Rule B)은 Luhn(mod-10) 게이팅으로 승인번호(AUTHNO 8자리)/TRANSERIAL(12자리)/MSG_TRACE(12자리) 오차단 회피.
--
-- 무회귀: ADDITIVE-ONLY(신규 테이블/함수/트리거/인덱스/RLS). 기존 객체 rename/drop 0. 기능플래그 OFF 로 런타임 격리.
-- rollback: 20260731190000_foot_cband_payment_attempts.rollback.sql
-- dryrun  : 20260731190000_foot_cband_payment_attempts.dryrun.mjs (No-Persistence Protocol: txn-strip + ROLLBACK + post-probe)
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 시도 레코드 테이블 (attempt grain, ADDITIVE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cband_payment_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL,
  check_in_id      uuid,
  customer_id      uuid,
  msg_trace        text NOT NULL,                       -- 요청 MSG_TRACE 12자리(TRANSERIAL echo). 응답유실 시 단말조회 유일키.
  merno            text,                                -- 가맹점번호(MERNO) — 정산 귀속.
  tran_type        text NOT NULL,                       -- 0210(승인) / 0430(취소).
  cat_tid          text,                                -- 단말 TID 원본(payments.external_tid 와 별도 원본 보존).
  requested_amount integer NOT NULL,
  status           text NOT NULL DEFAULT 'requested',
  auth_no          text,                                -- 취소 시 원거래 AUTHNO(insert-time) / 승인 확정 후 AUTHNO.
  response_code    text,                                -- ERRCODE(0000=성공).
  raw_response     jsonb,                               -- ★정규화 응답(PCI 가드). full PAN/track2/CVV/RRN 원문 금지.
  payment_id       uuid,                                -- 승인 성공 시 payments 역링크(보조; 정본 판별자=payments.payment_attempt_id).
  is_simulation    boolean NOT NULL DEFAULT false,      -- ★C6 테스트금액/테스트고객 격리(매출·감사 제외).
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cband_pa_status_chk CHECK (status IN ('requested','approved','failed','attention')),
  CONSTRAINT cband_pa_tran_type_chk CHECK (tran_type IN ('0210','0430'))
);

COMMENT ON TABLE public.cband_payment_attempts IS
  '코밴 CAT 직결 결제(플랜A) 시도 레코드(insert-first). 운영/감사 grain — ★매출 유니버스 진입 금지(매출=payments 단독). T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD';
COMMENT ON COLUMN public.cband_payment_attempts.raw_response IS
  '정규화 CAT 응답(jsonb). ⚠PCI/PII: full PAN/track2/CVV/RRN 원문 저장 금지 — trg_cband_pa_pci_guard 로 코드레벨 차단(마스킹 후 적재).';
COMMENT ON COLUMN public.cband_payment_attempts.payment_id IS
  '승인 성공 시 payments 역링크(보조 관측). 정본 CAT-origin 판별자 = payments.payment_attempt_id IS NOT NULL.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 멱등 인덱스 (L1/L2)
-- ─────────────────────────────────────────────────────────────────────────────
-- L1: insert-first 중복 차단.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cband_pa_clinic_msgtrace
  ON public.cband_payment_attempts (clinic_id, msg_trace);
-- L2: 체크인당 in-flight(requested) 1건 — 동시 이중요청 DB 백스톱(L3 앱뮤텍스 보완).
CREATE UNIQUE INDEX IF NOT EXISTS ux_cband_pa_inflight_checkin
  ON public.cband_payment_attempts (clinic_id, check_in_id)
  WHERE status = 'requested' AND check_in_id IS NOT NULL;
-- 조회 편의(승인 payment 역추적).
CREATE INDEX IF NOT EXISTS ix_cband_pa_payment_id
  ON public.cband_payment_attempts (payment_id) WHERE payment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at touch 트리거
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cband_pa_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cband_pa_touch_updated_at ON public.cband_payment_attempts;
CREATE TRIGGER trg_cband_pa_touch_updated_at
  BEFORE UPDATE ON public.cband_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.cband_pa_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. is_simulation stamp — 테스트고객(customers.is_simulation=true) 시도는 sim 각인(매출/감사 제외 패리티)
--    driver = customers.is_simulation(기존 customers-grain 테스트 플래그). SECURITY DEFINER(RLS 무관 조회). self-contained.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cband_pa_sim_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- 명시 true(테스트금액 C6) 보존, 워크인(customer_id NULL) 조회 생략.
  IF NEW.is_simulation IS NOT TRUE AND NEW.customer_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.is_simulation = true) THEN
      NEW.is_simulation := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cband_pa_sim_stamp ON public.cband_payment_attempts;
CREATE TRIGGER trg_cband_pa_sim_stamp
  BEFORE INSERT ON public.cband_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.cband_pa_sim_stamp();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Luhn 헬퍼 — PAN 후보 판정(오탐 축소). CREATE OR REPLACE(prod 부재 대비 자체 신설).
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. raw_response PCI/PII 마스킹 가드 (★자체 신설, 테이블과 동일 마이그 원자착지)
--    ⚠ 예외 메시지에 매칭값 절대 echo 금지(그 자체가 유출).
--    ★scalp naive 정규식 상속 금지 — PAN(Rule B)은 Luhn 게이팅으로 승인/거래번호 오차단 회피.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cband_pa_pci_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_text   text;
  v_cand   text;
  v_digits text;
BEGIN
  IF NEW.raw_response IS NULL THEN RETURN NEW; END IF;
  v_text := NEW.raw_response::text;

  -- Rule A: 민감 인증데이터(SAD) 키 — PCI DSS 저장 자체 금지(track/CVV/PIN/full-PAN/카드비밀번호).
  IF v_text ~* '"(track1|track2|track_?data|full_?pan|cvv2?|cvc2?|cvn2?|csc|pin_?block|pin|card_?password|card_?pw)"\s*:\s*("[^"]+"|-?\d)' THEN
    RAISE EXCEPTION 'PCI guard: raw_response 에 저장 금지 민감 인증데이터(track/CVV/PIN/full-PAN/카드비밀번호)가 포함됨. 마스킹/토큰화 값만 저장하세요.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule B: 미마스킹 카드 PAN — 13~19자리 digit run + Luhn 통과 시에만 차단.
  --   ★Luhn 게이팅 = scalp naive(13~19 무조건 차단) 상속 금지 근거. AUTHNO/TRANSERIAL/MSG_TRACE(≤12자리) 및
  --     Luhn 미통과 승인/거래번호는 오차단되지 않음. 마스킹 PAN(* / X)은 digit run 이 끊겨 미검출.
  FOR v_cand IN SELECT m[1] FROM regexp_matches(v_text, '\d[\d \-]{11,21}\d', 'g') AS m LOOP
    v_digits := regexp_replace(v_cand, '[ \-]', '', 'g');
    IF length(v_digits) BETWEEN 13 AND 19 AND public.foot_is_luhn(v_digits) THEN
      RAISE EXCEPTION 'PCI guard: raw_response 에 미마스킹 카드번호(PAN)로 보이는 값이 포함됨. first6/last4 마스킹 또는 토큰화 후 저장하세요.'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Rule C: 주민등록번호(RRN) YYMMDD-GXXXXXX — MMDD 유효 + 성별코드[1-8] + 13자리 연속 시 차단.
  --   ★CAT 필드(TRANDATE 6자리·TRANTIME 6자리·AUTHNO 8자리)는 13자리 연속 RRN run 을 형성하지 않음(오차단 회피).
  IF v_text ~ '\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[ \-]?[1-8]\d{6}' THEN
    RAISE EXCEPTION 'PCI/PII guard: raw_response 에 미마스킹 주민등록번호로 보이는 값이 포함됨. 마스킹/토큰화 후 저장하세요.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cband_pa_pci_guard ON public.cband_payment_attempts;
CREATE TRIGGER trg_cband_pa_pci_guard
  BEFORE INSERT OR UPDATE ON public.cband_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.cband_pa_pci_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS (§16-1 join-via-parent · PHI 인접, denorm clinic_id 미추가)
--    authenticated = 자기 clinic SELECT/INSERT/UPDATE. write 는 로그인 스태프 세션(직접 결제 저장).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cband_payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cband_pa_read_own_clinic" ON public.cband_payment_attempts;
CREATE POLICY "cband_pa_read_own_clinic"
  ON public.cband_payment_attempts FOR SELECT
  USING (clinic_id = (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "cband_pa_insert_own_clinic" ON public.cband_payment_attempts;
CREATE POLICY "cband_pa_insert_own_clinic"
  ON public.cband_payment_attempts FOR INSERT
  WITH CHECK (clinic_id = (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "cband_pa_update_own_clinic" ON public.cband_payment_attempts;
CREATE POLICY "cband_pa_update_own_clinic"
  ON public.cband_payment_attempts FOR UPDATE
  USING (clinic_id = (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()))
  WITH CHECK (clinic_id = (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));

COMMIT;
