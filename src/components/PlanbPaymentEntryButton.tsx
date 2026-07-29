/**
 * PlanbPaymentEntryButton.tsx — 비대기형 결제(플랜B) 진입 버튼 (기능플래그 게이트)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어 · 진입점)
 *
 * ★ 대원칙(§2): 기존 결제 화면·수기입력 흐름 절대 무접촉. 이 버튼은 기능플래그
 *   (VITE_PAYMENT_PLANB) ON 일 때만 렌더 — OFF 면 null 반환(기존 화면 완전 무변경, 회귀 가드).
 *   CheckInDetailSheet 는 이 컴포넌트 1줄만 추가하면 되고, 모든 플랜B 로직은 여기에 격리.
 */

import { useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isPaymentPlanbEnabled } from '@/lib/paymentPlanb';

interface Props {
  checkInId: string;
  /** 미배정(customer_id 없음) 방문은 선점 매칭 키가 없어 비활성. */
  hasCustomer: boolean;
}

export default function PlanbPaymentEntryButton({ checkInId, hasCustomer }: Props) {
  const navigate = useNavigate();
  if (!isPaymentPlanbEnabled()) return null; // 기능플래그 OFF → 미노출(기존 화면 무변경)

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
      disabled={!hasCustomer}
      data-testid="btn-planb-payment-entry"
      onClick={() => navigate(`/admin/payment-planb/${checkInId}`)}
    >
      <Zap className="h-3.5 w-3.5" /> 비대기형 결제(자동 기록)
    </Button>
  );
}
