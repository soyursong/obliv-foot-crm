/**
 * usePlanbClaimStatus.ts — 레드페이 플랜B 선점 상태 폴링 훅
 * ────────────────────────────────────────────────────────────────────────
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어)
 *
 * 비대기형 결제: FE 가 pending_payment 선점(open) 을 만든 뒤 화면을 즉시 전환하고,
 *   백그라운드 매칭 워커(redpay-planb-match EF, cron)가 웹훅 raw 를 매칭할 때까지
 *   이 훅으로 상태를 폴링한다. terminal(matched/expired/failed/cancelled) 도달 시 폴링 중단.
 *
 * 폴링 간격: 3초(DoctorCallDashboard refetchInterval 컨벤션 계승). TTL 5분 내 자동매칭 =
 *   최대 ~100틱. terminal 상태면 refetchInterval=false 로 자동 정지.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchPendingPaymentStatus,
  isTerminalStatus,
  type PendingPaymentRow,
} from '@/lib/paymentPlanb';

const POLL_INTERVAL_MS = 3_000;

export function usePlanbClaimStatus(pendingPaymentId: string | null | undefined) {
  return useQuery<PendingPaymentRow | null>({
    queryKey: ['pending_payment_status', pendingPaymentId],
    enabled: !!pendingPaymentId,
    staleTime: 2_000,
    queryFn: () => fetchPendingPaymentStatus(pendingPaymentId as string),
    // terminal 도달 시 폴링 정지(불필요 요청 차단). open 이면 3초 폴링 지속.
    refetchInterval: (query) => {
      const row = query.state.data as PendingPaymentRow | null | undefined;
      if (row && isTerminalStatus(row.status)) return false;
      return POLL_INTERVAL_MS;
    },
  });
}
