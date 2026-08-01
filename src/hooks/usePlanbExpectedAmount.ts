/**
 * usePlanbExpectedAmount.ts — OPT3 팝업 금액 자동채움 훅
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #1
 *   팝업이 열릴 때(enabled) 해당 체크인의 예상 결제 금액을 조회 → 자동채움 기본값.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchPlanbExpectedAmount } from '@/lib/planbExpectedAmount';

export function usePlanbExpectedAmount(checkInId: string | null | undefined, enabled: boolean) {
  return useQuery<number>({
    queryKey: ['planb_expected_amount', checkInId],
    enabled: enabled && !!checkInId,
    staleTime: 10_000,
    queryFn: () => fetchPlanbExpectedAmount(checkInId as string),
  });
}
