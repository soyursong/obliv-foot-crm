/**
 * entryVisibility.ts — 결제 미니창(PaymentMiniWindow)에서 코밴 CAT 직결결제 진입버튼
 * [카드 단말 결제(코밴)] 의 결제수단 탭별 노출 정책(순수 술어).
 *
 * T-20260806-foot-PLANA-PKG-PAY-EXPAND (reopened 2026-08-07, field-soak NEGATIVE):
 *   reporter(최필경 총괄) 화면 = 결제 미니창의 결제수단 탭. 카드 탭엔 [카드 단말 결제(코밴)] 있고
 *   '패키지'(membership) 탭엔 없었음 → 패키지 탭에도 노출(카드 탭과 동일 컴포넌트/착지경로 재사용).
 *
 * ※ 이 술어는 '노출(visibility)' 게이트만 담당한다. 실제 활성/비활성(disabled)·기능플래그(VITE_CBAND_PAY)·
 *   단말 감지·건당 500만원 한도(AC-2, exceedsPerTxnLimit) 는 CbandPayEntryButton 내부 게이트가 담당한다.
 *   여기서 노출 대상이 아닌 탭(현금/이체)은 코밴 카드단말 결제 개념 자체가 성립하지 않음.
 */

// PaymentMiniWindow 의 PayMethod 전체 집합과 정합(health_maintenance 포함) — 신규 수단 추가 시 컴파일 강제.
export type CbandEntryPayMethod = 'card' | 'cash' | 'transfer' | 'membership' | 'health_maintenance';

/**
 * 결제 미니창에서 코밴 진입버튼을 노출할지 여부.
 * @param payMethod 선택된 단일 결제수단 탭
 * @param splitMode 분할결제(복수 결제수단) 토글 상태
 * @returns 노출(true) / 미노출(false)
 */
export function shouldShowCbandEntry(payMethod: CbandEntryPayMethod, splitMode: boolean): boolean {
  // 카드 탭 · 패키지(membership) 탭 · 분할결제(카드 행 가능성) → 노출.
  // 현금/이체 단일 탭 → 카드 단말 결제 무의미 → 미노출.
  return payMethod === 'card' || payMethod === 'membership' || splitMode === true;
}
