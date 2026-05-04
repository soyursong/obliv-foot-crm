import { useRef, useEffect } from 'react';
import { STATUS_KO, STATUS_FLAGS, STATUS_FLAG_LABEL, STATUS_FLAG_DOT, stagesFor } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { CheckIn, CheckInStatus, StatusFlag } from '@/lib/types';

interface Props {
  checkIn: CheckIn;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onStatusChange: (checkIn: CheckIn, newStatus: CheckInStatus) => void;
  onFlagChange?: (checkIn: CheckIn, flag: StatusFlag | null) => void;
}

export function StatusContextMenu({ checkIn, position, onClose, onStatusChange, onFlagChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (position) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [position, onClose]);

  if (!position) return null;

  const stages = stagesFor(checkIn.visit_type);
  const currentIdx = stages.indexOf(checkIn.status);

  // 화면 경계 보정 — 메뉴가 아래/오른쪽으로 잘리지 않도록
  const x = Math.min(position.x, window.innerWidth - 210);
  const y = Math.min(position.y, window.innerHeight - 520);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[190px] rounded-lg border bg-white shadow-lg py-1"
      style={{ top: y, left: x }}
    >
      {/* ── 상태 플래그 섹션 (상단 고정) ─────────────────────────────────────── */}
      <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b">
        상태 플래그
      </div>
      {STATUS_FLAGS.map((flag) => {
        const isActive = (checkIn.status_flag ?? 'white') === flag;
        return (
          <button
            key={flag}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition',
              isActive
                ? 'bg-teal-50 text-teal-700 font-semibold'
                : 'hover:bg-muted/60 text-gray-700',
            )}
            onClick={() => {
              if (!onFlagChange) { onClose(); return; }
              // 이미 선택된 플래그 클릭 → null로 초기화 (정상)
              onFlagChange(checkIn, isActive && flag !== 'white' ? null : flag);
              onClose();
            }}
          >
            <span className={cn('h-3 w-3 rounded-full shrink-0', STATUS_FLAG_DOT[flag])} />
            {STATUS_FLAG_LABEL[flag]}
            {isActive && <span className="ml-auto text-teal-500 text-[10px]">✓</span>}
          </button>
        );
      })}

      {/* ── 현 진행단계 변경 섹션 ─────────────────────────────────────────────── */}
      <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-t border-b mt-1">
        현 진행단계
      </div>
      <div className="px-3 py-1 text-xs text-muted-foreground">
        {checkIn.customer_name} — {STATUS_KO[checkIn.status]}
      </div>
      {stages.map((status, i) => {
        const isCurrent = status === checkIn.status;
        const isPast = i < currentIdx;
        const isBackward = isPast && !isCurrent;
        return (
          <button
            key={status}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition',
              isCurrent && 'bg-teal-50 text-teal-700 font-semibold',
              isPast && 'text-muted-foreground opacity-50',
              !isCurrent && !isPast && 'hover:bg-muted/60',
            )}
            onClick={() => {
              if (isCurrent) { onClose(); return; }
              if (isBackward) return;
              onStatusChange(checkIn, status);
              onClose();
            }}
            disabled={isCurrent || isBackward}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full shrink-0',
                isCurrent ? 'bg-teal-500' : isPast ? 'bg-gray-300' : 'bg-gray-400',
              )}
            />
            {STATUS_KO[status]}
          </button>
        );
      })}
      <div className="border-t mt-1 pt-1">
        <button
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
          onClick={() => {
            if (!window.confirm(`${checkIn.customer_name} 체크인을 취소하시겠습니까?`)) { onClose(); return; }
            onStatusChange(checkIn, 'cancelled');
            onClose();
          }}
        >
          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
          취소
        </button>
      </div>
    </div>
  );
}
