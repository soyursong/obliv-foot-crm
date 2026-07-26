// ExamItemActions.tsx — 치료테이블 [균검사]/[피검사] 접수 항목 행 액션 3종(보류/신청취소/재검사).
// Ticket: T-20260726-foot-TREATTABLE-TESTITEM-ACTIONS-3BTN
//
// 확정 스펙(2026-07-26 김주연 총괄) 상태별 노출:
//   신청됨(active)    → [보류] [신청취소]
//   보류중(hold)      → [재검사](재활성) + '보류' 뱃지
//   취소됨(cancelled) → [재검사](신규 신청) + '취소' 뱃지
// 권한 = 권한 A(canActOnExamItem)만 노출·동작. 하위 권한 = 미노출(부모에서 canAct=false).
// 태블릿 UX: 큰 버튼(h-7), 아이콘+라벨. 실제 전이·RPC 는 부모가 상태에 따라 분기(재검사 하이브리드).

import { Button } from '@/components/ui/button';
import { PauseCircle, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { EXAM_STATUS_META, type ExamItemStatus } from '@/lib/examItemStatus';

interface Props {
  status: ExamItemStatus;
  onHold: () => void;
  onCancel: () => void;
  onRetest: () => void;
  busy?: boolean;
  testidPrefix?: string;
}

export default function ExamItemActions({
  status,
  onHold,
  onCancel,
  onRetest,
  busy = false,
  testidPrefix = 'exam-item',
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1" data-testid={`${testidPrefix}-actions`} data-status={status}>
      {/* 보류중/취소됨 = 상태 뱃지(Q3) */}
      {status !== 'active' && (
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${EXAM_STATUS_META[status].badgeClass}`}
          data-testid={`${testidPrefix}-status-badge`}
        >
          {EXAM_STATUS_META[status].label}
        </span>
      )}

      {status === 'active' && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="h-7 gap-1 px-2 text-[11px]"
            data-testid={`${testidPrefix}-hold-btn`}
            onClick={onHold}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PauseCircle className="h-3 w-3" />}
            보류
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="h-7 gap-1 px-2 text-[11px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            data-testid={`${testidPrefix}-cancel-btn`}
            onClick={onCancel}
          >
            <Ban className="h-3 w-3" />
            신청취소
          </Button>
        </>
      )}

      {status !== 'active' && (
        <Button
          size="sm"
          disabled={busy}
          className="h-7 gap-1 px-2 text-[11px] bg-teal-600 text-white hover:bg-teal-700"
          data-testid={`${testidPrefix}-retest-btn`}
          onClick={onRetest}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          재검사
        </Button>
      )}
    </div>
  );
}
