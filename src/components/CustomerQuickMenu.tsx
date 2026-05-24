/**
 * CustomerQuickMenu — 대시보드 고객 카드 이름 우클릭/롱프레스 메뉴
 * T-20260515-foot-CONTEXT-MENU-4ITEM: 4항목 확장
 * T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 항목 추가 (5항목)
 * 순서: 고객차트 → 진료차트 → 예약하기 → 수납 → 예약 취소
 */
import { useEffect, useRef } from 'react';
import { Ban, BookOpen, CalendarPlus, CreditCard, Stethoscope } from 'lucide-react';
import type { CheckIn } from '@/lib/types';

interface Props {
  checkIn: CheckIn | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onOpenChart: (checkIn: CheckIn) => void;
  onOpenMedicalChart: (checkIn: CheckIn) => void;
  onNewReservation: (checkIn: CheckIn) => void;
  onOpenPayment: (checkIn: CheckIn) => void;
  /** T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 콜백 — 제공 시만 메뉴 항목 표시 */
  onCancelReservation?: (checkIn: CheckIn) => void;
}

export function CustomerQuickMenu({
  checkIn,
  position,
  onClose,
  onOpenChart,
  onOpenMedicalChart,
  onNewReservation,
  onOpenPayment,
  onCancelReservation,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [position, onClose]);

  if (!position || !checkIn) return null;

  // 화면 경계 보정 — 5항목 높이 고려 (예약 취소 추가)
  const x = Math.min(position.x, window.innerWidth - 190);
  const y = Math.min(position.y, window.innerHeight - 240);

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[170px] rounded-lg border bg-white shadow-xl py-1 select-none"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-teal-700 border-b truncate">
        {checkIn.customer_name}
      </div>

      {/* 1. 고객차트 — 기존 유지 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onOpenChart(checkIn);
          onClose();
        }}
      >
        <BookOpen className="h-4 w-4 text-teal-600 shrink-0" />
        고객차트
      </button>

      {/* 2. 진료차트 — T-20260515-foot-CONTEXT-MENU-4ITEM AC-2 신규 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onOpenMedicalChart(checkIn);
          onClose();
        }}
      >
        <Stethoscope className="h-4 w-4 text-teal-600 shrink-0" />
        진료차트
      </button>

      {/* 3. 예약하기 — 기존 유지 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onNewReservation(checkIn);
          onClose();
        }}
      >
        <CalendarPlus className="h-4 w-4 text-teal-600 shrink-0" />
        예약하기
      </button>

      {/* 4. 수납 — T-20260515-foot-CONTEXT-MENU-4ITEM AC-3 신규 */}
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onOpenPayment(checkIn);
          onClose();
        }}
      >
        <CreditCard className="h-4 w-4 text-teal-600 shrink-0" />
        수납
      </button>

      {/* 5. 예약 취소 — T-20260525-foot-RESV-CANCEL-CTX: 예약 연결 고객에게만 표시 */}
      {onCancelReservation && checkIn.reservation_id && (
        <>
          <div className="border-t my-0.5" />
          <button
            data-testid="quick-menu-cancel-resv-btn"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 transition text-left"
            onClick={() => {
              onCancelReservation(checkIn);
              onClose();
            }}
          >
            <Ban className="h-4 w-4 shrink-0" />
            예약 취소
          </button>
        </>
      )}
    </div>
  );
}
