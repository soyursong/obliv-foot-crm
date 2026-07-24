-- T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX — 결제 낙관적 선점(preempt) 캡처 레이어
--
-- DA CONSULT-REPLY: MSG-20260725-034740-uwjm (verdict = GO / ADDITIVE)
--   근거 계약 = cross_crm_data_contract §3-2-g(Model A)·§4-2d·§550. 본건은 §3-2-g Model A
--   확장 subsection(preempt capture layer)으로 codify — foot-계열 fork(women/body/scalp2)가
--   동일 컬럼명·의미 재사용 의무(재발명 drift 금지).
--
-- ── 무엇 / 왜 ─────────────────────────────────────────────────────────────────
--   [결제받기]→카드 시 화면이 5~8분 웹훅 도착까지 블로킹되던 문제를, "미확정 intent"를 별도
--   테이블에 선점(pending)만 하고 화면은 즉시 진행하는 낙관적 UX로 헷지한다. RedPay 웹훅 도착 시
--   백그라운드 매처가 열린 선점과 raw 를 매칭 → payments 를 (그때) INSERT + 완료 표시. TTL 10분
--   무매칭 시 expired → 기존 수기 '수납 확인' 폴백으로 처리.
--
-- ── Q1: 왜 신규 테이블인가 (payments 상태컬럼 확장 반려) ─────────────────────────
--   preempt = 미확정 intent. payments = '확정 수납' 원장(§550). Model A ②는 payments 에 미매칭
--   orphan 을 담는 것을 금지한다. 더 결정적으로: payments INSERT 는 다수 다운스트림의 앵커다
--   (Model A reconcile / 매출 split·ROAS 분자 / 결제 sync-back §4-2d). 미확정 preempt 가 payments
--   row 가 되면 이 전부가 미확정 금액에 발화 → 전환신호 오염·ROAS 왜곡·매출 과대계상. 신규 테이블은
--   payments 본체 불변 → 회귀 0, 롤백=DROP TABLE(비파괴).
--   ★불변식: payments INSERT 는 웹훅 매칭 성공 시에만 발생(preempt 생성 시점엔 payments 무생성).
--
-- ── ADDITIVE / 게이트 ────────────────────────────────────────────────────────
--   신규 테이블 1개 + 인덱스 + RLS 만. payments/reservations/기존 reconcile 아티팩트/기존 sync-back
--   전부 불변 → cross-CRM payments 계약(§550/§3-2-g/§4-2d) 무침해. autonomy §3.1 → 대표게이트
--   면제, supervisor DDL-diff 게이트만. 롤백 SQL(.rollback.sql) 동봉 · 멱등키(부분유니크
--   check_in_id) · FK ON DELETE SET NULL.
--
-- ── merchant_hint 용도 (DA ★명확화 요청 회신) ────────────────────────────────
--   merchant_hint = 직원 표시용 breadcrumb(단말/가맹점 이름) 전용. ★매칭 키 아님.
--   매칭 스코프 narrowing 의 canon = tid whitelist(REDPAY_TID_WHITELIST, §787/§519 불변식)이며
--   매처는 반드시 `tid IN (foot TID)` 로 좁힌다. merchant_hint / business_no 를 매칭키로 쓰지 않는다
--   (511/506/457 공유 merchant → foot 스코프 불충분). 표시 편의 텍스트일 뿐 매칭 판정에 미참여.

CREATE TABLE IF NOT EXISTS public.payment_preempts (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 테넌트 스코프(RLS 앵커) + 방문/고객 연결. 부모 삭제 시 preempt 는 감사 흔적으로 남되 FK 는 해제.
  clinic_id           uuid        NOT NULL REFERENCES public.clinics(id),
  check_in_id         uuid        REFERENCES public.check_ins(id) ON DELETE SET NULL,
  customer_id         uuid        REFERENCES public.customers(id) ON DELETE SET NULL,

  -- pre-confirm 기대금액(KRW 원 int). ★payments.amount(§OCR line, 확정금액 단일권위)와 구분.
  --   어떤 매출/정합 뷰도 expected_amount 를 읽어선 안 됨(pre-match 기대치 전용).
  expected_amount     integer,

  -- RedPay preempt = 카드 VAN 전용. payments.method 어휘 미러(병행 taxonomy 발명 금지) — 현재 card 만.
  method              text        NOT NULL DEFAULT 'card'
                                    CHECK (method IN ('card')),

  -- 상태 머신. FE 상태값과 이 CHECK 를 정확히 일치시킬 것(§Lovable CHECK 규율).
  --   pending   = 선점 생성, 웹훅 매칭 대기(TTL 카운트 중)
  --   matched   = 웹훅 매칭 성공 → payments INSERT 완료(matched_payment_id 세팅)
  --   expired   = TTL(10분) 무매칭 → 수동확인 필요(직원 폴백)
  --   failed    = 웹훅 취소(status=N)·승인거절·tie-break 모호 → 자동기록 금지, 수동확인
  --   cancelled = 직원이 선점을 중도 취소(오선택 등)
  status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','matched','expired','failed','cancelled')),

  -- 매칭 성공 시 생성된 payments 행 역참조(방향: preempt→payments, payments 불변성 보존). SET NULL.
  matched_payment_id  uuid        REFERENCES public.payments(id) ON DELETE SET NULL,

  -- ★표시용 breadcrumb 전용(단말/가맹점 이름). 매칭 키 아님 — 스코프 canon = tid whitelist.
  merchant_hint       text,

  -- 선점 생성 직원(§reservation soft-delete 패턴 정합, ON DELETE SET NULL).
  created_by          uuid        REFERENCES public.staff(id) ON DELETE SET NULL,

  -- 라이프사이클 시각. TTL = 10분(관측 최대지연 8분40초 + 여유, AC3).
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  matched_at          timestamptz,               -- status=matched 전이 시각
  resolved_at         timestamptz,               -- terminal 전이(expired/failed/cancelled) 시각

  -- failed 사유 breadcrumb(tie_break_ambiguous / webhook_cancelled / approval_declined 등). 자유텍스트.
  fail_reason         text
);

-- ── 멱등키: 방문당 1개의 열린 선점만 (staff 더블클릭 이중선점 차단) ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS payment_preempts_open_per_checkin_unique
  ON public.payment_preempts (check_in_id)
  WHERE status = 'pending' AND check_in_id IS NOT NULL;

-- ── 매처 스캔: clinic 내 pending 선점 조회 ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS payment_preempts_clinic_status_idx
  ON public.payment_preempts (clinic_id, status);

-- ── TTL sweep: 만료 대상 pending 선점 조회 ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS payment_preempts_ttl_sweep_idx
  ON public.payment_preempts (expires_at)
  WHERE status = 'pending';

COMMENT ON TABLE  public.payment_preempts IS
  'T-20260724-foot-PAY-OPTIMISTIC-PREEMPT-UX: 결제 낙관적 선점 캡처 레이어(§3-2-g Model A 확장). preempt=미확정 intent, payments=확정수납(선점→웹훅매칭 성공 시에만 payments INSERT). expired/failed/cancelled 는 매출/ROAS/reconcile 절대 미유입.';
COMMENT ON COLUMN public.payment_preempts.expected_amount    IS 'pre-confirm 기대금액(KRW int). 확정금액 단일권위=payments.amount. 매출/정합 뷰 읽기 금지.';
COMMENT ON COLUMN public.payment_preempts.method             IS 'RedPay preempt = 카드 VAN 전용(card). payments.method 어휘 미러.';
COMMENT ON COLUMN public.payment_preempts.status             IS 'pending/matched/expired/failed/cancelled. FE 상태값과 CHECK 정확 일치 강제(§Lovable CHECK 규율).';
COMMENT ON COLUMN public.payment_preempts.matched_payment_id IS '매칭 성공 시 생성된 payments 행(preempt→payments 방향, ON DELETE SET NULL).';
COMMENT ON COLUMN public.payment_preempts.merchant_hint      IS '★표시용 breadcrumb 전용(단말/가맹점 이름). 매칭 키 아님 — 스코프 canon=tid whitelist. business_no/hint 로 매칭 판정 금지.';
COMMENT ON COLUMN public.payment_preempts.fail_reason        IS 'status=failed 사유(tie_break_ambiguous/webhook_cancelled/approval_declined 등).';

-- ── RLS (payments 정책 미러) ────────────────────────────────────────────────
--   FE(authenticated 스태프)는 선점 생성(INSERT)·조회(SELECT)·중도취소(UPDATE). matched/expired 전이는
--   매처/TTL sweep EF 가 service_role(RLS 우회)로 수행 → 별도 authenticated UPDATE 는 취소용만 필요.
ALTER TABLE public.payment_preempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_preempts_admin_all       ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_consult_insert  ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_consult_update  ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_approved_read   ON public.payment_preempts;

CREATE POLICY payment_preempts_admin_all ON public.payment_preempts FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

CREATE POLICY payment_preempts_consult_insert ON public.payment_preempts FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above());

CREATE POLICY payment_preempts_consult_update ON public.payment_preempts FOR UPDATE TO authenticated
  USING (is_consultant_or_above()) WITH CHECK (is_consultant_or_above());

CREATE POLICY payment_preempts_approved_read ON public.payment_preempts FOR SELECT TO authenticated
  USING (is_approved_user());

GRANT SELECT, INSERT, UPDATE ON public.payment_preempts TO authenticated;
