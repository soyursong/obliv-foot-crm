/**
 * ReservationContextMenu — 예약 박스 우클릭/롱프레스 컨텍스트메뉴
 * T-20260525-foot-RESV-CANCEL-CTX: 대시보드 타임라인 예약 박스용
 *
 * AC-1: 우클릭(데스크탑) + 브라우저 longpress(태블릿) 공용
 * AC-5: 빈 슬롯 우클릭 시 미표시 (호출 측 조건부 렌더)
 */
import { useEffect, useRef } from 'react';
import { Ban, MessageSquare, Trash2 } from 'lucide-react';
import type { Reservation } from '@/lib/types';

interface Props {
  reservation: Reservation | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onCancelReservation: (reservation: Reservation) => void;
  // T-20260610-foot-RESV-CTXMENU-HARDDELETE: 완전 삭제(hard delete) 콜백 (status 무관 노출)
  onDeleteReservation: (reservation: Reservation) => void;
  // T-20260610-foot-RESV-OVERHAUL-7 AC-1: [SMS 보내기] parity — CustomerQuickMenu(예약관리)와 동일 항목 미러링.
  //   제공 시(admin/manager)만 노출. 기존 SendSmsDialog 경로 재사용(신규 SMS 경로 신설 금지).
  onSendSms?: (reservation: Reservation) => void;
}

export function ReservationContextMenu({ reservation, position, onClose, onCancelReservation, onDeleteReservation, onSendSms }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleTouch = (e: TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleTouch, { passive: true });
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleTouch);
      document.removeEventListener('keydown', handleKey);
    };
  }, [position, onClose]);

  if (!position || !reservation) return null;

  // 화면 경계 보정
  const x = Math.min(position.x, window.innerWidth - 190);
  const y = Math.min(position.y, window.innerHeight - 120);

  return (
    <div
      ref={ref}
      data-testid="resv-context-menu"
      className="fixed z-[60] min-w-[160px] rounded-lg border bg-white shadow-xl py-1 select-none"
      style={{ top: y, left: x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-gray-700 border-b truncate">
        {reservation.customer_name ?? '(이름 없음)'}
      </div>

      {/* T-20260610-foot-RESV-OVERHAUL-7 AC-1: SMS 보내기 — CustomerQuickMenu(예약관리) parity.
          admin/manager(onSendSms 제공 시)만 노출. 기존 SendSmsDialog 경로 재사용. */}
      {onSendSms && (
        <button
          data-testid="resv-ctx-sms-btn"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 active:bg-teal-100 transition text-left"
          onClick={() => {
            onSendSms(reservation);
            onClose();
          }}
        >
          <MessageSquare className="h-4 w-4 text-teal-600 shrink-0" />
          SMS 보내기
        </button>
      )}

      {/* 예약 취소 — 취소/노쇼 상태 예약은 비활성 */}
      <button
        data-testid="resv-ctx-cancel-btn"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 transition text-left disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={reservation.status === 'cancelled' || reservation.status === 'noshow'}
        onClick={() => {
          if (reservation.status === 'cancelled' || reservation.status === 'noshow') return;
          onCancelReservation(reservation);
          onClose();
        }}
      >
        <Ban className="h-4 w-4 shrink-0" />
        {reservation.status === 'cancelled' ? '이미 취소됨' : '예약 취소'}
      </button>

      {/* T-20260610-foot-RESV-CTXMENU-HARDDELETE: 완전 삭제 — status 무관 전체 표시, 파괴적 액션 */}
      <div className="my-1 border-t" />
      <button
        data-testid="resv-ctx-harddelete-btn"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 transition text-left"
        onClick={() => {
          if (!window.confirm('예약을 완전 삭제하시겠습니까? 이력이 남지 않습니다.')) return;
          onDeleteReservation(reservation);
          onClose();
        }}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        완전 삭제
      </button>
    </div>
  );
}
