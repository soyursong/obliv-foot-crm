/**
 * prefillAmount.ts — 코밴 CAT 직결결제 팝업 금액칸 default value(미납잔액) 파생 SSOT
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL (FE-only · db_change=false)
 *
 * 요구(최필경 총괄): 코밴 CAT 직결결제 팝업이 열릴 때 금액 입력칸에 해당 수납의 미납잔액
 *   (수납잔액)을 default value 로 자동 세팅해 수동 타이핑 오기입('불필요·위험')을 없앤다.
 *
 * ★ 계약(불변식):
 *   · 소스 = 상위(PaymentMiniWindow) 의 수납잔액 계산 SSOT(displayAmount=deductMode?deductAmount:
 *     payableTotalWithSurcharge). 여기서 재계산하지 않는다(신규 산출 경로 신설 금지).
 *   · 반환 = amount state 에 그대로 넣을 '쉼표 없는 raw 정수 문자열'(AmountInput 이 표시 포맷 담당).
 *   · 잔액 ≤ 0 / null / undefined / 비유한수 → '' (자동입력 스킵, 빈칸=기존 수동입력 동작 유지).
 *   · 소수부는 버림(정수부만) — 수납금액은 원 단위 정수.
 *   ⚠ 결제 실행·payments write·결제수단 로직과 무관 — 오직 입력칸 '초기값'만 만든다.
 */
export function resolveCbandDefaultAmount(defaultAmount?: number | null): string {
  if (defaultAmount == null) return '';
  if (!Number.isFinite(defaultAmount)) return '';
  if (defaultAmount <= 0) return '';
  return String(Math.trunc(defaultAmount));
}
