// recordPlanbCardPayment — 레드페이 플랜B 카드결제 단일 정본 write-path (FE 경로B 수렴 클라이언트)
// T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK
//   SSOT: da_consult_reply_foot_redpay_planb_single_rpc_absorb_guard_20260802.md
//         (DA-20260802-FOOT-REDPAY-PLANB-SINGLE-RPC-ABSORB-GUARD)
//
// 목적(AC7 by-construction): 레드페이 raw 승인건을 payments 로 기록하는 FE 경로(수동매칭/환자연결)는
//   payments 를 인라인으로 INSERT 하지 않고 반드시 이 함수(=서버 RPC record_planb_card_payment)를 호출한다.
//   → FE(경로B)·EF(경로A auto-record matchPass)가 같은 RPC 1벌로 수렴 → dual-writer race 소멸.
//     · shape-parity(recordManualPayment checkin/single/package) · absorb-guard(CAT-origin 흡수) ·
//       raw-row 원자 claim 멱등 · MERNO tenant-isolation 전부 서버 RPC 내부에 by-construction.
//     · 인라인 payments INSERT(divergent 재구현) 금지 = single-writer 수렴(opt3 §7 ADDENDUM (a) 이행).
import { supabase } from './supabase';

export type PlanbAttribution = 'checkin' | 'single' | 'package';

/** RPC 반환 action — 호출측 UX 분기용. */
export type PlanbRecordAction =
  | 'created'                 // 신규 payments 기록됨
  | 'created_package'         // 신규 package_payments 기록됨(패키지 잔금)
  | 'absorbed'                // 기존 CAT 직결 payment 에 흡수(신규 INSERT skip, 매출 double-count 0)
  | 'already_claimed'         // 이미 처리된 raw(멱등 no-op)
  | 'already_recorded_package'
  | 'tier4_manual'            // 흡수 후보 ≥2 → 수동 배정 필요(blind auto-absorb 금지)
  | 'cross_tenant_reject'     // MERNO 가 foot 단말 아님(cross-tenant 격리)
  | 'error';

export interface RecordPlanbCardPaymentInput {
  clinicId: string;
  /** redpay_raw_transactions.id — claim 대상(카드 필드·매출앵커·멱등 앵커의 원천). */
  rawTxid: string;
  attribution: PlanbAttribution;
  customerId: string;
  /** 'checkin' 필수. */
  checkInId?: string | null;
  /** 'package' 필수. */
  packageId?: string | null;
  /** 금액 override(미지정 시 raw.amount). */
  amount?: number | null;
  memo?: string | null;
}

export interface RecordPlanbCardPaymentResult {
  ok: boolean;
  action: PlanbRecordAction;
  paymentId?: string;
  packagePaymentId?: string;
  accountingDate?: string;
  message?: string;
  raw: unknown;
}

/**
 * 레드페이 플랜B 카드결제 기록(서버 RPC 위임). FE 는 payments 를 직접 INSERT 하지 않는다.
 * @throws RPC 전송 오류 시(네트워크/권한). 논리적 no-op(already_claimed 등)은 throw 하지 않고 action 으로 반환.
 */
export async function recordPlanbCardPayment(
  input: RecordPlanbCardPaymentInput,
): Promise<RecordPlanbCardPaymentResult> {
  const { data, error } = await supabase.rpc('record_planb_card_payment', {
    p_clinic_id: input.clinicId,
    p_raw_txid: input.rawTxid,
    p_attribution: input.attribution,
    p_customer_id: input.customerId,
    p_check_in_id: input.checkInId ?? null,
    p_package_id: input.packageId ?? null,
    p_amount: input.amount ?? null,
    p_memo: input.memo ?? null,
    p_source: 'manual',
  });
  if (error) throw new Error(`레드페이 결제기록 실패: ${error.message}`);

  const res = (data ?? {}) as {
    ok?: boolean; action?: string; payment_id?: string;
    package_payment_id?: string; accounting_date?: string; message?: string;
  };
  return {
    ok: res.ok ?? false,
    action: (res.action ?? 'error') as PlanbRecordAction,
    paymentId: res.payment_id,
    packagePaymentId: res.package_payment_id,
    accountingDate: res.accounting_date,
    message: res.message,
    raw: data,
  };
}
