import { useRef, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { STATUS_KO, STATUS_FLAGS, STATUS_FLAG_LABEL, STATUS_FLAG_DOT, stagesFor } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { CheckIn, CheckInStatus, StatusFlag } from '@/lib/types';

interface Props {
  checkIn: CheckIn;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onStatusChange: (checkIn: CheckIn, newStatus: CheckInStatus) => void;
  onFlagChange?: (checkIn: CheckIn, flag: StatusFlag | null) => void;
  /** 레이저실 목록 (이름 배열) — T-20260504-foot-TABLET-LASER-ROOM-SELECT */
  laserRooms?: string[];
  /** 레이저실 번호 선택 후 콜백 — status='laser' + laser_room 동시 업데이트 */
  onLaserStatusChange?: (checkIn: CheckIn, laserRoom: string) => void;
}

export function StatusContextMenu({
  checkIn,
  position,
  onClose,
  onStatusChange,
  onFlagChange,
  laserRooms = [],
  onLaserStatusChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [showLaserSubmenu, setShowLaserSubmenu] = useState(false);

  // 외부 클릭/터치 시 닫기 — 태블릿 호환성: touchstart 병행 등록
  useEffect(() => {
    const handleOutside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (position) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside, { passive: true });
      return () => {
        document.removeEventListener('mousedown', handleOutside);
        document.removeEventListener('touchstart', handleOutside);
      };
    }
  }, [position, onClose]);

  // 메뉴 닫힐 때 서브메뉴 초기화
  useEffect(() => {
    if (!position) setShowLaserSubmenu(false);
  }, [position]);

  if (!position) return null;

  const stages = stagesFor(checkIn.visit_type);
  const currentIdx = stages.indexOf(checkIn.status);
  const hasLaserRooms = laserRooms.length > 0;

  // 화면 경계 보정 — 서브메뉴 공간 고려해 넉넉하게
  const x = Math.min(position.x, window.innerWidth - 240);
  const y = Math.min(position.y, window.innerHeight - 580);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] rounded-lg border bg-white shadow-lg py-1 max-h-[85vh] overflow-y-auto"
      style={{ top: y, left: x }}
    >
      {/* ── 상태 플래그 섹션 ─────────────────────────────────────────────────── */}
      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b">
        상태 플래그
      </div>
      {STATUS_FLAGS.map((flag) => {
        const isActive = (checkIn.status_flag ?? 'white') === flag;
        return (
          <button
            key={flag}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2.5 text-sm transition',
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

      {/* ── 현 진행단계 변경 섹션 ───────────────────────────────────────────── */}
      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-t border-b mt-1">
        현 진행단계
      </div>
      <div className="px-3 py-1.5 text-xs text-muted-foreground">
        {checkIn.customer_name} — {STATUS_KO[checkIn.status]}
      </div>
      {stages.map((status, i) => {
        const isCurrent = status === checkIn.status;
        const isPast = i < currentIdx;
        const isBackward = isPast && !isCurrent;
        const isLaser = status === 'laser';
        const showSubArrow = isLaser && hasLaserRooms && !isCurrent && !isBackward;

        return (
          <div key={status}>
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2.5 text-sm transition',
                isCurrent && 'bg-teal-50 text-teal-700 font-semibold',
                isPast && 'text-muted-foreground opacity-50',
                !isCurrent && !isPast && 'hover:bg-muted/60',
              )}
              onClick={() => {
                if (isCurrent) { onClose(); return; }
                if (isBackward) return;
                // 레이저실 목록이 있으면 서브메뉴 토글, 없으면 즉시 변경
                if (isLaser && hasLaserRooms) {
                  setShowLaserSubmenu((v) => !v);
                  return;
                }
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
              {showSubArrow && (
                <ChevronRight
                  className={cn(
                    'ml-auto h-3.5 w-3.5 text-gray-400 transition-transform duration-150',
                    showLaserSubmenu && 'rotate-90 text-emerald-500',
                  )}
                />
              )}
              {isCurrent && <span className="ml-auto text-teal-500 text-[10px]">현재</span>}
            </button>

            {/* ── 레이저실 번호 선택 서브메뉴 (T-20260504-foot-TABLET-LASER-ROOM-SELECT) ── */}
            {isLaser && showLaserSubmenu && hasLaserRooms && (
              <div className="border-t border-b border-emerald-100 bg-emerald-50/50 py-1 px-2">
                <div className="px-2 py-1 text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">
                  레이저실 선택
                </div>
                {laserRooms.map((roomName) => (
                  <button
                    key={roomName}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm text-emerald-900 hover:bg-emerald-100 active:bg-emerald-200 transition font-medium"
                    onClick={() => {
                      if (onLaserStatusChange) {
                        onLaserStatusChange(checkIn, roomName);
                      } else {
                        onStatusChange(checkIn, 'laser');
                      }
                      onClose();
                    }}
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    {roomName}
                  </button>
                ))}
                {/* 실 미배정으로 입실 — 레이저실 없이 상태만 변경 */}
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 transition"
                  onClick={() => {
                    onStatusChange(checkIn, 'laser');
                    onClose();
                  }}
                >
                  <span className="h-2 w-2 rounded-full bg-gray-300 shrink-0" />
                  실 미배정
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="border-t mt-1 pt-1">
        <button
          className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 transition"
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
