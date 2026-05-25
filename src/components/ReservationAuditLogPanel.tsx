// T-20260522-foot-RESV-HISTORY-SYNC AC-2/3
// 예약 변경·추가 이력 공유 패널 컴포넌트
// 대시보드(2번차트 2구역 예약내역) + 예약관리 양쪽에서 동일 컴포넌트 사용 (AC-3)
// 화면별 분리 구현 절대 금지 (김주연 총괄 명시 지시)
// T-20260525-foot-RESV-CHANGE-REASON AC-3: 변경 사유 인라인 표시

import { History } from 'lucide-react';
import { useReservationAuditLog } from '@/hooks/useReservationAuditLog';

interface ReservationAuditLogPanelProps {
  reservationId: string | null | undefined;
  /** compact=true 면 최대 3건만 표시 후 "…N건 더 있음" */
  compact?: boolean;
}

/**
 * 예약 변경·추가 이력 패널 (AC-3: useReservationAuditLog 단일 훅 사용)
 *
 * - 'create': "5/22 14:00 신규 예약 (5/22 09:38)"
 * - 'reschedule': "5/22 10:00 예약 → 5/22 14:00 변경 (5/22 09:38)"
 * - reschedule + 사유: 이력 라인 아래에 "사유: {내용}" 표시
 * - 이력 없음: "변경 이력이 없습니다" (AC-1 요구 시나리오 4)
 */
export function ReservationAuditLogPanel({
  reservationId,
  compact = false,
}: ReservationAuditLogPanelProps) {
  const { logs, loading } = useReservationAuditLog(reservationId);

  if (loading) {
    return (
      <div className="text-[10px] text-muted-foreground py-0.5">이력 조회 중…</div>
    );
  }

  const displayLogs = compact ? logs.slice(0, 3) : logs;

  if (displayLogs.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground italic">
        변경 이력이 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {displayLogs.map((entry) => (
        <div key={entry.id} className="space-y-0.5">
          <div className="flex items-start gap-1 text-[10px] leading-snug">
            <History className="h-3 w-3 shrink-0 mt-[1px] text-teal-500 opacity-70" />
            <span className="text-gray-600 break-all">{entry.label}</span>
          </div>
          {/* T-20260525-foot-RESV-CHANGE-REASON AC-3: reschedule 사유 표시 */}
          {entry.action === 'reschedule' && entry.change_reason && (
            <p
              className="text-[10px] text-gray-500 pl-4 leading-snug break-all"
              data-testid="audit-change-reason"
            >
              사유: {entry.change_reason}
            </p>
          )}
        </div>
      ))}
      {compact && logs.length > 3 && (
        <div className="text-[10px] text-teal-600 pl-4">
          …{logs.length - 3}건 더 있음
        </div>
      )}
    </div>
  );
}
