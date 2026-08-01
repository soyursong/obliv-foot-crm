/**
 * PlanbSusuScheduleButton.tsx — 레드페이 플랜B OPT3 '카드 수납예정등록' 진입 버튼
 * ════════════════════════════════════════════════════════════════════════════════
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #1 · §③ 버튼 위치
 *
 * ★ 대원칙: 기능플래그(VITE_PAYMENT_PLANB) ON 일 때만 렌더 — OFF 면 null(기존 화면 무변경, 회귀 가드).
 * §③ 위치: 결제 섹션에서 [결제 등록] 버튼 '위'에 배치(호출부 CheckInDetailSheet 가 순서 보장).
 *   자동 연결률 89% 는 담당자가 이 버튼을 써야 나오는 수치 → 눈에 먼저 띄어야 함(총괄 v2 §③ 근거).
 * ★ 버튼명 = '카드 수납예정등록' (속도약속 문구 금지).
 */

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isPaymentPlanbEnabled } from '@/lib/paymentPlanb';
import PlanbSusuScheduleDialog from '@/components/PlanbSusuScheduleDialog';

interface Props {
  checkInId: string;
  clinicId: string;
  customerId: string | null;
  customerLabel?: string;
  /** 등록/취소/매칭 등 상태 변화 시 상위 갱신(배지 리페치). */
  onChanged?: () => void;
}

export default function PlanbSusuScheduleButton({
  checkInId,
  clinicId,
  customerId,
  customerLabel,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  if (!isPaymentPlanbEnabled()) return null; // 기능플래그 OFF → 미노출(기존 화면 무변경)

  return (
    <>
      <Button
        size="sm"
        className="w-full gap-1 bg-teal-600 text-white hover:bg-teal-700"
        disabled={!customerId}
        data-testid="btn-planb-susu-schedule"
        onClick={() => setOpen(true)}
      >
        <CreditCard className="h-3.5 w-3.5" /> 카드 수납예정등록
      </Button>
      <PlanbSusuScheduleDialog
        open={open}
        onOpenChange={setOpen}
        checkInId={checkInId}
        clinicId={clinicId}
        customerId={customerId}
        customerLabel={customerLabel}
        onChanged={onChanged}
      />
    </>
  );
}
