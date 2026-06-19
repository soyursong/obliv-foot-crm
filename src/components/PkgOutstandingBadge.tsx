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
import { hasOutstandingDue, type CustomerOutstanding } from '@/lib/footBilling';

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

/**
 * T-20260618-foot-OUTSTANDING-BADGE-TIMETABLE-CHECKIN: 통합시간표 셀·체크인 고객박스용
 * 컴팩트 "미수" 빨강 배지. 금액 비노출(좁은 셀 가독성) — 미수 여부만 빨강으로 신호.
 *
 * 노출 조건 = hasOutstandingDue(data) (= outstanding>0). 결제완료로 outstanding 0 전환 시
 * 부모가 재조회한 Map 에서 자동으로 사라진다(무파괴 additive 인디케이터, 신규 산출 로직 없음).
 * data 미전달/미수 0이면 아무것도 렌더하지 않는다.
 */
export function OutstandingDueBadge({
  data,
  className,
}: {
  data?: CustomerOutstanding;
  className?: string;
}) {
  if (!hasOutstandingDue(data)) return null;
  return (
    <span
      data-testid="outstanding-due-badge"
      className={cn(
        'inline-flex items-center shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-bold leading-tight text-white',
        className,
      )}
      title="미수금 있음 (잔금 미결제)"
    >
      미수
    </span>
  );
}
