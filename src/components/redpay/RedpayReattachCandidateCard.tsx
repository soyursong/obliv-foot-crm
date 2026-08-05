/**
 * RedpayReattachCandidateCard.tsx — 승인번호 없는 수기수납 '후보 연결' 카드
 * ════════════════════════════════════════════════════════════════════════════════
 * T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY
 *
 * 승인번호가 없는 수기 영수증 수납에 대해, 금액+날짜가 맞는 레드페이 승인건을 '후보'로만 보여준다.
 *   ★자동으로 연결하지 않는다 — "이 수기 기록이 이 결제일 수 있습니다" 후보카드까지만.
 *   담당자가 실제 일치 건을 눈으로 확인하고 [이 결제로 연결] 을 눌러야 승인번호가 기존 수기행에 채워진다.
 *   원칙: "의심 건 리스트업까지만, 실제 수정은 담당자".
 *
 * ★대원칙: 기능플래그(VITE_PAYMENT_PLANB) ON 일 때만 렌더 — OFF 면 null(기존 화면 무변경).
 *   조회(list)는 read-only(payment write 0), 연결(confirm)만 담당자 클릭 게이트로 기존행 UPDATE.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { isPaymentPlanbEnabled } from '@/lib/paymentPlanb';
import {
  listReattachCandidates,
  confirmReattach,
  type ReattachReceipt,
} from '@/lib/redpayReattachCandidates';

function kstDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '-';
  }
}

export default function RedpayReattachCandidateCard({ clinicId }: { clinicId?: string | null }) {
  const enabled = isPaymentPlanbEnabled();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<ReattachReceipt[]>({
    queryKey: ['redpay_reattach_candidates', clinicId ?? 'all'],
    enabled: enabled && !!clinicId,
    staleTime: 5_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await listReattachCandidates(clinicId as string);
      return res.receipts;
    },
  });

  if (!enabled) return null; // 기능플래그 OFF → 미노출(기존 화면 무변경).

  const receipts = data ?? [];
  // 후보가 하나라도 있는 수기수납만 노출(후보 0건은 자동 생성/표시 안 함 — 시나리오3).
  const withCandidates = receipts.filter((r) => r.candidate_count > 0);

  async function handleConfirm(paymentId: string, rawId: string) {
    const key = `${paymentId}::${rawId}`;
    setBusyKey(key);
    try {
      const res = await confirmReattach(paymentId, rawId);
      if (res.ok && res.matched) {
        toast.confirm(`승인번호 ${res.approvalNo ?? ''} 를 수기 수납에 연결했습니다.`);
        await refetch();
      } else if (res.reason === 'race_lost' || res.reason === 'invalid_candidate') {
        toast.error('이미 다른 곳에 연결되었거나 후보가 바뀌었습니다. 목록을 새로고침합니다.');
        await refetch();
      } else if (res.reason === 'not_case_b') {
        toast.error('이미 승인번호가 있는 건입니다.');
        await refetch();
      } else {
        toast.error(res.error ?? '연결에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card data-testid="reattach-candidate-card" className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            승인번호 없는 수기 수납 · 후보 연결{' '}
            <span className="text-xs font-normal text-muted-foreground">
              (금액·날짜가 맞는 결제 후보만 표시 — 확인 후 담당자가 직접 연결)
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : withCandidates.length === 0 ? (
          <div data-testid="reattach-empty" className="py-4 text-center text-sm text-muted-foreground">
            연결할 후보가 있는 수기 수납이 없습니다.
          </div>
        ) : (
          <ul className="space-y-3">
            {withCandidates.map((rc) => (
              <li
                key={rc.payment_id}
                data-testid="reattach-receipt-row"
                className="rounded-lg border border-amber-200 bg-amber-50/60 p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm">
                    <span className="font-semibold tabular-nums">{formatAmount(rc.amount)}원</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      수기 수납 · {rc.accounting_date ?? kstDateTime(rc.created_at)}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-white border-amber-300 text-amber-700 shrink-0">
                    후보 {rc.candidate_count}건
                  </Badge>
                </div>
                {rc.candidate_count > 1 && (
                  <p className="text-[11px] text-amber-700 mb-2">
                    ※ 같은 금액·날짜 후보가 여러 건입니다. 실제 일치하는 건을 직접 확인해 연결해 주세요(자동 연결 안 함).
                  </p>
                )}
                <ul className="space-y-2">
                  {rc.candidates.map((c) => {
                    const key = `${rc.payment_id}::${c.raw_id}`;
                    return (
                      <li
                        key={c.raw_id}
                        data-testid="reattach-candidate-item"
                        className="flex items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                      >
                        <div className="text-xs">
                          <div className="font-medium">
                            승인번호 <span className="tabular-nums">{c.approval_no ?? '-'}</span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            승인시각 {kstDateTime(c.approved_at)}
                            {c.tid ? ` · 단말 ${c.tid}` : ''}
                          </div>
                        </div>
                        <Button
                          data-testid="reattach-confirm-btn"
                          size="sm"
                          className="shrink-0 bg-teal-600 hover:bg-teal-700 h-9"
                          disabled={busyKey === key}
                          onClick={() => handleConfirm(rc.payment_id, c.raw_id)}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          {busyKey === key ? '연결 중…' : '이 결제로 연결'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
