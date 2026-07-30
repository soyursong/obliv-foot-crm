// paymentRow.ts — 레드페이 플랜B 경로A(EF matchPass→payments INSERT) 결제행 빌더 (순수 모듈)
// T-20260730-foot-REDPAY-PLANB-OPT3-PAYWRITE-BUILD-P2
//   SSOT: da_consult_reply_foot_redpay_planb_opt3_paywrite_20260730.md (verdict=GO, ADDITIVE, no-DDL)
//
// 역할: matched 전이 성공 뒤(경로A) INSERT 할 payments 행을 (pending, raw)에서 결정적으로 조립한다.
//   DB I/O·claim·txn 배선은 index.ts matchPass 런타임 통합영역이고, 여기서는 '행 shape' 만 고정한다
//   → shape-parity 를 Deno 단위 테스트로 봉인(payload self-test, paymentrow-shape-parity.test.ts).
//
// ── shape-parity (DA AC2) — recordManualPayment checkin/single 카드분기 행과 필드동형 ─────────
//   기준: src/lib/manualPaymentWritePath.ts:107 recordManualPayment (옵션A checkin/single 분기)
//     { clinic_id, check_in_id, customer_id, amount, method:'card', installment:0,
//       payment_type:'payment', memo, created_at }
//   경로A는 그 canonical shape 를 그대로 두고, 레드페이 관측(Model A ②)·매출-일자 앵커만 ADDITIVE 로 얹는다.
//
// ── foot-native 컬럼 매핑 (§788 canonical≠prod divergence) ─────────────────────────────────
//   DA 필드계약은 `pg_provider='redpay'`·`method_standard='card'` 를 명명하나, foot prod payments 에는
//   그 두 컬럼이 부재(precondition 실측 2026-07-30). foot 는 canonical `method`(card/cash/transfer/
//   membership) 만 보유 → shape-parity 기준점(recordManualPayment)도 `method='card'` 를 쓴다.
//   · method_standard='card' 의도 = `method='card'` 로 실현(shape-parity 동형).
//   · pg_provider='redpay'(≠'external'/'manual') 의도 = foot 는 redpay_raw_transactions 실 VAN 승인행을
//     보유하므로, external_trxid/approval_no/status/tid 를 그 raw 에서 populate 하는 것으로 '레드페이 관측됨'
//     을 구조적으로 표현(derm Opt2 의 raw-feed 부재 'external' 라벨과 다름). 별도 provider 라벨 컬럼 불요.
//   ⚠ 신규 컬럼(pg_provider/method_standard) write 금지 — 부재 컬럼 write = INSERT 실패 또는 DDL(db_change=false 위반).
//
// ── 매출-일자 앵커 (DA AC6) = raw.approved_at (VAN 승인시각) ───────────────────────────────
//   payments.created_at = raw.approved_at (Closing 은 created_at 기준 일자집계 — manualPaymentWritePath.ts:68).
//   payments.accounting_date = approved_at 의 Asia/Seoul 달력일 을 '명시' set — trg_payments_set_accounting_date
//   BEFORE INSERT 트리거가 accounting_date IS NULL 일 때 now()(=INSERT 시각) 을 찍는 drift 를 사전차단.
//   감지시각/INSERT 시각 앵커 금지(늦게 도착한 웹훅이 익일 마감에 잡히는 일경계 drift 방지).

/** 결제행 조립에 필요한 pending_payment 최소 형태(선점표). check_in_id/customer_id 는 스키마상 NOT NULL. */
export interface PlanbPendingRow {
  id: string;
  clinic_id: string;
  customer_id: string;
  check_in_id: string;
  expected_amount: number;
}

/** 결제행 조립에 필요한 redpay_raw_transactions 최소 형태(VAN 승인행). */
export interface PlanbRawRow {
  id: string;
  external_trxid: string;      // NOT NULL
  external_status: string;     // 'Y'(승인) — NOT NULL
  approval_no: string | null;
  tid: string | null;
  approved_at: string | null;  // VAN 승인시각(매출-일자 앵커)
  received_at: string | null;  // 웹훅 수신시각(매출 앵커 fallback 전용, INSERT 시각 아님)
}

/** payments INSERT 행(경로A). id 는 claim-first 를 위해 클라 생성 UUID 를 주입한다. */
export interface PlanbPaymentInsertRow {
  id: string;
  clinic_id: string;
  check_in_id: string;
  customer_id: string;
  amount: number;
  method: 'card';
  installment: 0;
  payment_type: 'payment';
  memo: string;
  created_at: string;          // = revenue anchor(approved_at)
  accounting_date: string;     // = revenue anchor 의 Asia/Seoul 달력일(YYYY-MM-DD)
  external_trxid: string;
  external_approval_no: string | null;
  external_status: string;
  external_tid: string | null;
  reconciled_at: string;       // 사전 reconciled 스탬프 → reconcile 재매칭 skip(orphan 재유입 차단)
}

export interface BuildPlanbPaymentOptions {
  /** 클라 생성 payment UUID(claim-first 앵커). raw.id claim 과 동일 값으로 결속. */
  paymentId: string;
  /** reconciled_at 스탬프(=매칭 감지시각). 매출-일자 앵커 아님 — created_at/accounting_date 와 구분. */
  reconciledAtIso: string;
  /** 메모 override(선택). 미지정 시 기본. */
  memo?: string;
}

export interface BuildPlanbPaymentResult {
  row: PlanbPaymentInsertRow;
  /** 진단(비치명) — approved_at 부재로 received_at fallback 사용 등. */
  warnings: string[];
}

export class PlanbPaymentBuildError extends Error {}

const DEFAULT_MEMO = '레드페이 자동수납(플랜B)';

/** ISO timestamptz → Asia/Seoul 달력일(YYYY-MM-DD). accounting_date 명시 set 으로 트리거 now() drift 차단. */
export function seoulDateOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new PlanbPaymentBuildError(`유효하지 않은 시각: ${iso}`);
  // en-CA = YYYY-MM-DD 포맷. timeZone 으로 Asia/Seoul 달력일 확정(UTC 오프셋 수동계산 회피).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * 경로A payments INSERT 행 조립. (pending, raw) 로부터 결정적으로 shape-parity 행을 만든다.
 * @throws PlanbPaymentBuildError check_in_id 미해소(AC5 orphan payment 금지)·금액 부정 시.
 *   → 호출측은 INSERT 차단 + 수동폴백(raw claim 도 취하지 않음).
 */
export function buildPlanbPaymentRow(
  pending: PlanbPendingRow,
  raw: PlanbRawRow,
  opts: BuildPlanbPaymentOptions,
): BuildPlanbPaymentResult {
  const warnings: string[] = [];

  // AC5 — check_in_id 결속 필수(orphan payment 금지). pending.check_in_id 는 NOT NULL 이나 방어.
  if (!pending.check_in_id) {
    throw new PlanbPaymentBuildError('check_in_id 미해소 — orphan payment 금지(INSERT 차단·수동폴백)');
  }
  if (!pending.customer_id) {
    throw new PlanbPaymentBuildError('customer_id 미해소 — 귀속 불가(INSERT 차단·수동폴백)');
  }
  const amount = Math.trunc(Number(pending.expected_amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PlanbPaymentBuildError(`금액이 올바르지 않습니다: ${pending.expected_amount}`);
  }

  // AC6 — 매출-일자 앵커 = raw.approved_at. 부재 시 received_at fallback(둘 다 VAN-근접, INSERT 시각 아님).
  let revenueAt = raw.approved_at;
  if (!revenueAt) {
    if (raw.received_at) {
      revenueAt = raw.received_at;
      warnings.push(`raw.approved_at 부재 → received_at fallback(${raw.received_at}). INSERT 시각 앵커 회피.`);
    } else {
      throw new PlanbPaymentBuildError('approved_at·received_at 모두 부재 — 매출-일자 앵커 불가(INSERT 차단)');
    }
  }

  const row: PlanbPaymentInsertRow = {
    id: opts.paymentId,
    clinic_id: pending.clinic_id,
    check_in_id: pending.check_in_id,
    customer_id: pending.customer_id,
    amount,
    method: 'card',
    installment: 0,
    payment_type: 'payment',
    memo: opts.memo ?? DEFAULT_MEMO,
    created_at: revenueAt,
    accounting_date: seoulDateOf(revenueAt),
    // Model A ② 주석컬럼(AC7) — raw 에서 동시 populate. reconciled_at 사전스탬프로 reconcile 재매칭 skip.
    external_trxid: raw.external_trxid,
    external_approval_no: raw.approval_no,
    external_status: raw.external_status,
    external_tid: raw.tid,
    reconciled_at: opts.reconciledAtIso,
  };

  return { row, warnings };
}
