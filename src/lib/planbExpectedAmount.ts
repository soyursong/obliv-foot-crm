/**
 * planbExpectedAmount.ts — 레드페이 플랜B OPT3 팝업 금액 자동채움 소스
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #1 — '카드 수납예정등록' 팝업 진입 시
 *   이미 계산된 예상 결제 금액을 자동으로 채운다(정본 §4-1, Q2 확인).
 *
 * 산출: 해당 체크인의 check_in_services(가격>0) 를 price × quantity 로 합산.
 *   PMW(PaymentMiniWindow) 의 pricingItems 합계(grandTotal)와 동치 소스 — 코드 항목(상병/처방)은
 *   price=0 로 저장되어 자연 제외(gt('price', 0)). 보험 split(급여/본인/공단) 은 자동채움 단계에서
 *   적용하지 않음 — 팝업 금액은 편집 가능(직원이 카드 단말 승인 금액에 맞춰 조정) = '예정' 값.
 *
 * ★ 이 값은 편집 가능한 기본값(default)일 뿐 — pending_payment.expected_amount 는 직원 확정값을 write.
 */

import { supabase } from '@/lib/supabase';

/**
 * 체크인의 예상 결제 금액(자동채움 기본값). check_in_services price×quantity 합.
 *   서비스 없음/오류 시 0 반환(팝업은 빈 값으로 시작 → 직원 수기 입력).
 */
export async function fetchPlanbExpectedAmount(checkInId: string): Promise<number> {
  const { data, error } = await supabase
    .from('check_in_services')
    .select('price, quantity')
    .eq('check_in_id', checkInId)
    .gt('price', 0);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => {
    const price = Number((r as { price: number }).price) || 0;
    const qty = Number((r as { quantity: number | null }).quantity) || 1;
    return sum + price * qty;
  }, 0);
}
