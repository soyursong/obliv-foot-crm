/**
 * CustomerQuickMenu — 대시보드 고객 카드 이름 우클릭/롱프레스 메뉴
 * T-20260515-foot-CONTEXT-MENU-4ITEM: 4항목 확장
 * T-20260525-foot-RESV-CANCEL-CTX: 예약 취소 항목 추가 (5항목)
 * T-20260606-foot-CTXMENU-SMS-SEND: [문자] 항목 추가 (수납 다음) — admin/manager 한정
 * T-20260610-foot-RESV-CTXMENU-POPUP-SYNC AC-3: 3번 항목 라벨을 reservationActionLabel 로 분기
 *   (예약관리 예약 우클릭=예약상세 / 대시보드 고객카드=예약하기 기본).
 * T-20260611-foot-CTXMENU-UNIFY-CANONICAL: 우클릭 메뉴 5항목 통일 — [예약 취소]·[완전 삭제] 메뉴 항목 제거
 *   (둘 다 ReservationDetailPopup 버튼에서만). 전 사용처에서 onCancelReservation/onDeleteReservation 미전달.
 * T-20260611-foot-CTXMENU-DEADPROP-CLEANUP: 위 미전달로 dead 가 된 onCancelReservation/onDeleteReservation
 *   prop·타입·내부 분기 제거(latent 1-click hard-delete 부활 차단). 동작 변화 0.
 * 순서: 고객차트 → 진료차트 → 예약하기|예약상세 → 수납 → 문자
 */
import { useEffect, useRef } from 'react';
import { BookOpen, CalendarPlus, CreditCard, MessageSquare, Stethoscope } from 'lucide-react';
import type { CheckIn } from '@/lib/types';

interface Props {
  checkIn: CheckIn | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onOpenChart: (checkIn: CheckIn) => void;
  onOpenMedicalChart: (checkIn: CheckIn) => void;
  onNewReservation: (checkIn: CheckIn) => void;
  onOpenPayment: (checkIn: CheckIn) => void;
  /** T-20260606-foot-CTXMENU-SMS-SEND: 문자 발송 콜백 — 제공 시(admin/manager)만 메뉴 항목 표시 */
  onSendSms?: (checkIn: CheckIn) => void;
  /**
   * T-20260610-foot-RESV-CTXMENU-POPUP-SYNC AC-3: 예약 액션 항목 라벨.
   * 예약관리(기존 예약 우클릭)에서는 '예약상세'로, 대시보드 고객카드(체크인=신규 예약 생성)에서는 기본 '예약하기'.
   * 텍스트만 분기 — onNewReservation 와이어링은 (a) 팝업 대상 확정 후 별도 변경(REGISTRAR 트랙).
   */
  reservationActionLabel?: string;
}

export function CustomerQuickMenu({
  checkIn,
  position,
  onClose,
  onOpenChart,
  onOpenMedicalChart,
  onNewReservation,
  onOpenPayment,
  onSendSms,
  reservationActionLabel = '예약하기',
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

  // 화면 경계 보정 — 항목 수에 따른 높이 고려 (문자 가변)
  const itemCount = 4 + (onSendSms ? 1 : 0);
  const x = Math.min(position.x, window.innerWidth - 190);
  const y = Math.min(position.y, window.innerHeight - (60 + itemCount * 44));

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

      {/* 3. 예약 액션 — T-20260610-foot-RESV-CTXMENU-POPUP-SYNC AC-3: 라벨 reservationActionLabel 분기
          (예약관리=예약상세 / 대시보드 고객카드=예약하기 기본). 와이어링(onNewReservation)은 (a) 확정 후 변경. */}
      <button
        data-testid="quick-menu-resv-action-btn"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => {
          onNewReservation(checkIn);
          onClose();
        }}
      >
        <CalendarPlus className="h-4 w-4 text-teal-600 shrink-0" />
        {reservationActionLabel}
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

      {/* 5. 문자 — T-20260606-foot-CTXMENU-SMS-SEND: admin/manager(onSendSms 제공 시)만 노출 */}
      {onSendSms && (
        <button
          data-testid="quick-menu-sms-btn"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
          onClick={() => {
            onSendSms(checkIn);
            onClose();
          }}
        >
          <MessageSquare className="h-4 w-4 text-teal-600 shrink-0" />
          문자
        </button>
      )}

      {/* T-20260611-foot-CTXMENU-UNIFY-CANONICAL AC3 + DEADPROP-CLEANUP:
          [예약 취소]·[완전 삭제] 메뉴 항목 제거됨 — 둘 다 ReservationDetailPopup 내 버튼에서만.
          관련 dead prop/handler(onCancelReservation/onDeleteReservation) 영구 제거(latent hard-delete 차단). */}
    </div>
  );
}
