/**
 * UnapprovedPaymentBadge.tsx — '미승인 수납' 미처리 건수 배지 (read-only, 상시 노출)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-AUTOCANCEL-UNAPPROVED-INBOX · AC-1
 *
 * 역할: 카드 선점(pending_payment)이 승인(자동매칭)에 이르지 못하고 보관창까지 닫힌
 *   '사람이 처리해야 확정되는' 건수를 상시 노출한다(자동취소/수동연결 대상 예고).
 *
 * ★ 불변식:
 *   · read-only — fetchUnapprovedPaymentCount 만 소비(payments 무접점, db_change 없음).
 *   · 기능플래그 VITE_PAYMENT_PLANB OFF(기본) → 렌더 안 함(기존 화면 무접촉, 회귀 0).
 *   · self-contained 드롭인 — UNASSIGNED-INBOX-BUILD admin 섹션이 그대로 import 하도록 설계.
 *     (인터림 마운트: RedpayReconcileTab. inbox 섹션 병합 시 그쪽으로 fold.)
 *
 * UX(풋 태블릿): 한국어·teal/emerald·건수>0 시 red alert 강조. 60초 폴링 + 수동 새로고침 없이도 갱신.
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { isPaymentPlanbEnabled } from '@/lib/paymentPlanb';
import { fetchUnapprovedPaymentCount } from '@/lib/redpayPlanbUnapprovedCount';

interface UnapprovedPaymentBadgeProps {
  clinicId: string;
  /** 0건일 때도 노출할지 (기본 true — '상시 노출'). false 면 0건 시 숨김. */
  showWhenZero?: boolean;
  className?: string;
}

export function UnapprovedPaymentBadge({
  clinicId,
  showWhenZero = true,
  className,
}: UnapprovedPaymentBadgeProps) {
  // 기능플래그 OFF(기본) → 완전 미노출. 기존 화면 무접촉.
  // (hook 은 rules-of-hooks 위해 항상 호출하고 enabled/렌더로 게이트)
  const planbEnabled = isPaymentPlanbEnabled();

  const { data: count = 0, isLoading } = useQuery<number>({
    queryKey: ['redpay-unapproved-count', clinicId],
    enabled: planbEnabled && !!clinicId,
    queryFn: () => fetchUnapprovedPaymentCount(clinicId),
    refetchInterval: 60_000, // 60초 폴링 — 보관창(1h) 단위 변화라 저빈도로 충분
    staleTime: 30_000,
  });

  if (!planbEnabled) return null;
  if (isLoading && count === 0) return null;
  if (count === 0 && !showWhenZero) return null;

  const alert = count > 0;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
        alert
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-emerald-50 border-emerald-200 text-emerald-700',
        className,
      )}
      role="status"
      aria-label={alert ? `미승인 수납 ${count}건 처리 필요` : '미승인 수납 없음'}
      data-testid="unapproved-payment-badge"
    >
      {alert ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      )}
      <span>
        미승인 수납{' '}
        {alert ? (
          <span className="font-bold" data-testid="unapproved-payment-count">{count}건</span>
        ) : (
          '없음'
        )}
      </span>
    </div>
  );
}

export default UnapprovedPaymentBadge;
