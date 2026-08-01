/**
 * PlanbPendingReceiveList.tsx — 레드페이 플랜B OPT3 수신 대기 목록 (#6)
 * ════════════════════════════════════════════════════════════════════════════════
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #6
 *
 * status='open' 인 pending_payment(수신 대기중 = 카드 승인 알림 대기) 소형 리스트 뷰.
 *   등록만 되고 아직 매칭/만료되지 않은 건을 한눈에 확인 + 개별 [취소] 가능.
 *
 * ★ 대원칙: 기능플래그(VITE_PAYMENT_PLANB) ON 일 때만 렌더 — OFF 면 null(기존 화면 무변경).
 *   저비용 read(listOpenPendingPayments) + 취소만(payments 무접촉, §550 Model A).
 */

import { useQuery } from '@tanstack/react-query';
import { Clock, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import {
  isPaymentPlanbEnabled,
  listOpenPendingPayments,
  cancelPendingPayment,
  type OpenPendingListRow,
} from '@/lib/paymentPlanb';

function kstTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '-';
  }
}

export default function PlanbPendingReceiveList({ clinicId }: { clinicId?: string | null }) {
  const enabled = isPaymentPlanbEnabled();
  const { data, isLoading, refetch } = useQuery<OpenPendingListRow[]>({
    queryKey: ['planb_open_pending_list', clinicId ?? 'all'],
    enabled,
    staleTime: 3_000,
    refetchInterval: 5_000, // 수신 대기 → 매칭/만료 자동 전환 반영.
    queryFn: () => listOpenPendingPayments(clinicId ?? null),
  });

  if (!enabled) return null; // 기능플래그 OFF → 미노출.

  const rows = data ?? [];

  async function handleCancel(id: string) {
    const res = await cancelPendingPayment(id);
    if (!res.ok && !res.notOpen) {
      toast.error(res.message ?? '취소에 실패했습니다.');
    }
    refetch();
  }

  return (
    <Card data-testid="planb-pending-receive-list">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Clock className="h-4 w-4 text-teal-600" />
          수신 대기 목록
          <Badge variant="teal" className="ml-1">{rows.length}건</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 px-3 text-left font-medium w-16">등록시각</th>
                <th className="py-2 px-2 text-right font-medium w-28">예상 금액</th>
                <th className="py-2 px-2 text-center font-medium w-20">상태</th>
                <th className="py-2 px-2 text-center font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    수신 대기중인 결제가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b bg-teal-50/40 transition-colors">
                  <td className="py-2 px-3 tabular-nums text-xs">{kstTime(r.created_at)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">
                    {formatAmount(r.expected_amount)}원
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Badge variant="teal" className="text-xs">수신 대기</Badge>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-rose-600 hover:bg-rose-50"
                      data-testid={`btn-planb-pending-cancel-${r.id}`}
                      onClick={() => handleCancel(r.id)}
                    >
                      <X className="h-3.5 w-3.5" /> 취소
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
