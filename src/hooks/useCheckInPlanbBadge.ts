/**
 * useCheckInPlanbBadge.ts — OPT3 §④ [미결제] 배지 확장 데이터 훅
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #④
 *   기능플래그 ON 일 때만 조회 → 체크인의 최신 open|matched 선점 상태.
 *   OFF(enabled=false) 면 요청 자체를 하지 않음(기존 배지 로직 무변경, 회귀 0).
 *   open 이면 3초 폴링(수납 대기 → 완료 자동 전환 반영), 그 외 정지.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchCheckInPlanbBadge, type CheckInPlanbBadge } from '@/lib/paymentPlanb';

const POLL_INTERVAL_MS = 3_000;

export function useCheckInPlanbBadge(checkInId: string | null | undefined, enabled: boolean) {
  return useQuery<CheckInPlanbBadge | null>({
    queryKey: ['checkin_planb_badge', checkInId],
    enabled: enabled && !!checkInId,
    staleTime: 2_000,
    queryFn: () => fetchCheckInPlanbBadge(checkInId as string),
    refetchInterval: (query) => {
      const row = query.state.data as CheckInPlanbBadge | null | undefined;
      // 수납 대기(open) 중이면 폴링 유지(완료 자동 전환 반영). matched/없음 이면 정지.
      return row && row.status === 'open' ? POLL_INTERVAL_MS : false;
    },
  });
}
