/**
 * VisitCallResultBadge — 도파민TM '내원콜 방문확인'(예방콜) 결과 read-only 표시 배지.
 *
 * T-20260725-foot-VISITCALL-RECEIVER-404-POPUP-MISS (RC-1b)
 *   기존엔 예방콜 결과 배지가 CustomerChartPage 2번차트 사이드바의
 *   `latestCheckIn === null && status === 'confirmed'`(접수 전) 블록 안에만 렌더되어,
 *   환자가 체크인(→checked_in)하거나 예약이 no_show/cancelled 로 진행되면 결과가 사라졌다.
 *   실 동기 레코드는 전부 접수 이후 status(접수전 0건)라 현장에서 안 보였다(박민지 TM팀장 리포트).
 *   → 결과 표시를 status 와 무관한 read-only 배지로 분리해 접수/체크인/노쇼/취소 어느 상태에서도 보이게 한다.
 *   canonical(reachable/absent)→FE 라벨은 VISIT_CALL_RESULT_LABEL SSOT 재사용. write 무접점(도파민 write, 풋 read-only).
 */
import { VISIT_CALL_RESULT_LABEL } from '@/lib/types';
import { cn } from '@/lib/utils';

export function VisitCallResultBadge({
  result,
  compact = false,
  className,
}: {
  result?: 'reachable' | 'absent' | null;
  /** 통합시간표 카드처럼 극소 폭 슬롯용 축약 스타일 */
  compact?: boolean;
  className?: string;
}) {
  if (!result) return null;
  const isReachable = result === 'reachable';
  return (
    <span
      data-testid="visit-call-result-badge"
      title={`도파민TM 내원콜: ${VISIT_CALL_RESULT_LABEL[result]}`}
      className={cn(
        'shrink-0 inline-flex items-center rounded font-semibold leading-tight',
        compact ? 'px-0.5 text-[8px]' : 'px-1.5 py-0.5 text-[10px] gap-1',
        isReachable ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
        className,
      )}
    >
      {compact ? VISIT_CALL_RESULT_LABEL[result] : `내원콜 ${VISIT_CALL_RESULT_LABEL[result]}`}
    </span>
  );
}
