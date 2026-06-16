/**
 * T-20260616-foot-PKG-OUTSTANDING-BALANCE ②: 대기열·예약 '잔금 O원' 뱃지.
 *
 * 활성 패키지의 패키지 잔금(fee_kind='package')이 0보다 클 때만 빨강 뱃지로 노출한다.
 * §4-A: 진료비 잔금은 패키지 잔금과 합산하지 않는다 — 진료비 잔금이 있으면 별도 작은 칩으로 병기.
 * 데이터는 부모가 loadCustomerOutstanding()로 일괄 조회해 Map 으로 넘긴다(카드별 N+1 방지).
 * data 미전달/잔금 0이면 아무것도 렌더하지 않는다(무파괴 additive 인디케이터).
 */
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CustomerOutstanding } from '@/lib/footBilling';

export function PkgOutstandingBadge({
  data,
  className,
}: {
  data?: CustomerOutstanding;
  className?: string;
}) {
  const packageDue = data?.packageDue ?? 0;
  const consultationDue = data?.consultationDue ?? 0;
  if (packageDue <= 0 && consultationDue <= 0) return null;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {packageDue > 0 && (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 tabular-nums">
          잔금 {formatAmount(packageDue)}
        </span>
      )}
      {/* §4-A: 진료비 잔금은 패키지 잔금과 합치지 않고 별도 칩으로 표기 */}
      {consultationDue > 0 && (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 tabular-nums">
          진료비 {formatAmount(consultationDue)}
        </span>
      )}
    </span>
  );
}
