// redpayReverseMatch — [수납] 저장 훅 → 레드페이 역방향 매칭 1회 트리거(클라이언트 오케스트레이션)
// ════════════════════════════════════════════════════════════════════════════════
// T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD (write-path 배선 · planner D1~D4)
//
// 역할: [수납]으로 카드 payment 를 저장한 직후, 그 payment.id 를 redpay-reverse-match EF 에 넘겨
//   "이미 도착했으나 미매칭으로 남은 레드페이 승인 raw" 1건을 자동 연결하도록 요청한다.
//
// ★대원칙 §2 회귀 가드 (AC5): fire-and-forget — 이 훅의 실패/no-op 는 [수납] 저장 UX 를 절대 블록하지 않는다.
//   · 후보 없음/모호/비대상/race-loss = EF 가 no-op 판정(matched:false) → 기존 수납 흐름 완전 무변경.
//   · 네트워크/EF 오류 = catch 로 흡수(로그만) → 결제는 이미 저장 완료(정상).
//
// D1 원자성(claim-first 3-write)·D2 race-loss(payment 유지)·D3 매출-일자 앵커(accounting_date=approved_at KST)
//   ·D4 cue.paid parity(annotate-on-existing, 재발화 없음)는 모두 EF(redpay-reverse-match) 서버측에서 강제.
//   클라이언트는 트리거·관측만 담당(민감 write 권한을 클라에 두지 않음 = service_role EF 격리).
import { supabase } from './supabase';
import { EDGE_FUNCTIONS } from './externalServices';

export interface ReverseMatchTriggerResult {
  matched: boolean;
  reason?: string;
  paymentId: string;
  rawId?: string;
  accountingDate?: string | null;
  error?: string;
}

/**
 * 단일 payment 에 대해 역방향 매칭 1회 트리거(fire-and-forget 안전).
 * @returns 관측용 결과(호출측이 로깅/무시). throw 하지 않음 — [수납] 흐름 무영향 보장.
 */
export async function triggerReverseMatch(paymentId: string): Promise<ReverseMatchTriggerResult> {
  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.REDPAY_REVERSE_MATCH, {
      body: { payment_id: paymentId },
    });
    if (error) {
      console.warn('[reverse-match] EF 호출 오류(non-fatal):', error.message);
      return { matched: false, reason: 'invoke_error', paymentId, error: error.message };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      matched: r.matched === true,
      reason: r.reason as string | undefined,
      paymentId,
      rawId: r.raw_id as string | undefined,
      accountingDate: (r.accounting_date as string | null | undefined) ?? null,
    };
  } catch (e) {
    // non-fatal — 결제는 이미 저장 완료. 미매칭 raw 는 워커/다음 저장에서 재시도 가능.
    console.warn('[reverse-match] 트리거 예외(non-fatal):', e instanceof Error ? e.message : String(e));
    return { matched: false, reason: 'exception', paymentId, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 방금 [수납] 저장된 카드 payment 들에 대해 역방향 매칭 트리거(각 건 독립, fire-and-forget).
 *   현금/이체 등 비-카드는 레드페이(VAN 카드) 대조 대상이 아니므로 트리거하지 않는다.
 *   각 건은 독립 pass — 같은 raw 를 2건이 노려도 EF 의 claim 가드(matched_payment_id IS NULL, rows-affected=1)가
 *   1건만 승자로 확정(D1) → 중복 입금/이중 귀속 0.
 * @returns 관측용 결과 배열(await 불필요 — 호출측이 fire-and-forget 하려면 결과를 무시하면 됨).
 */
export async function triggerReverseMatchForCardPayments(
  cardPaymentIds: string[],
): Promise<ReverseMatchTriggerResult[]> {
  if (!cardPaymentIds.length) return [];
  return Promise.all(cardPaymentIds.map((id) => triggerReverseMatch(id)));
}
