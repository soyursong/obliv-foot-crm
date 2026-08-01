/**
 * PlanbSusuScheduleDialog.tsx — 레드페이 플랜B OPT3 '카드 수납예정등록' 팝업(Dialog)
 * ════════════════════════════════════════════════════════════════════════════════
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #1 (제3안 별도버튼·팝업)
 *
 * NOWAIT-PAYPAGE-BUILD(deployed) 의 풀페이지 route(PaymentPlanb.tsx)를 팝업(Dialog)으로 재배치.
 *   흐름:
 *     [카드 수납예정등록] 버튼 → 이 팝업 open
 *       → 예상 결제 금액 자동채움(usePlanbExpectedAmount, 편집 가능)
 *       → 안내문구/툴팁 표시
 *       → [카드 수납예정등록] 확정 → pending_payment 선점(open) INSERT
 *       → 팝업 내 '수신 대기' 상태 표시 + [수신대기 취소] 노출(open 한정)
 *       → (백그라운드) 웹훅 raw 도착 → 매칭 워커가 예상금액 매칭 → status=matched → '수납 완료' 표시
 *
 * ★ 대원칙: 기능플래그(VITE_PAYMENT_PLANB) ON 일 때만 진입 버튼이 렌더 → 이 팝업은 그 하위.
 *   매출 무접점(§550 Model A): pending_payment 만 write, payments 무접촉.
 * ★ 버튼명 = '카드 수납예정등록' (정본 §③ — '즉시'·'자동기록' 등 속도약속 문구 금지).
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어.
 */

import { useEffect, useMemo, useState } from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, Info, Clock, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AmountInput, parseAmountRaw } from '@/components/ui/AmountInput';
import { toast } from '@/lib/toast';
import { formatAmount } from '@/lib/format';
import { usePlanbExpectedAmount } from '@/hooks/usePlanbExpectedAmount';
import { usePlanbClaimStatus } from '@/hooks/usePlanbClaimStatus';
import {
  createPendingPayment,
  cancelPendingPayment,
  REDPAY_PLANB_AUTO_RECORD_NOTICE,
  REDPAY_PLANB_TTL,
} from '@/lib/paymentPlanb';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkInId: string;
  clinicId: string;
  customerId: string | null;
  /** 표시용 라벨(환자명 + 차트번호). */
  customerLabel?: string;
  /** 등록/취소/매칭 등 상태 변화 시 상위 갱신(배지 리페치 등). */
  onChanged?: () => void;
}

export default function PlanbSusuScheduleDialog({
  open,
  onOpenChange,
  checkInId,
  clinicId,
  customerId,
  customerLabel,
  onChanged,
}: Props) {
  const [amountDisplay, setAmountDisplay] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);

  // 예상 결제 금액 자동채움 — 팝업 open + 미등록 상태에서만 조회.
  const expected = usePlanbExpectedAmount(checkInId, open && pendingId === null);
  const claim = usePlanbClaimStatus(pendingId);
  const claimStatus = claim.data?.status ?? 'open';

  const amount = useMemo(() => {
    const n = Number(parseAmountRaw(amountDisplay));
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [amountDisplay]);

  // 자동채움: 조회 완료 + 직원이 아직 손대지 않았을 때만 채운다(수기 입력 덮어쓰기 방지).
  useEffect(() => {
    if (!open || pendingId !== null) return;
    if (amountTouched) return;
    if (typeof expected.data === 'number' && expected.data > 0) {
      setAmountDisplay(String(expected.data));
    }
  }, [open, pendingId, amountTouched, expected.data]);

  // 팝업 닫힐 때 상태 리셋(다음 진입 시 깨끗한 시작).
  useEffect(() => {
    if (!open) {
      setAmountDisplay('');
      setAmountTouched(false);
      setSubmitting(false);
      setCancelling(false);
      setPendingId(null);
    }
  }, [open]);

  async function handleRegister() {
    if (!customerId) {
      toast.error('환자 정보를 확인할 수 없습니다.');
      return;
    }
    if (amount <= 0) {
      toast.error('결제 예상 금액을 입력하세요.');
      return;
    }
    setSubmitting(true);
    const res = await createPendingPayment({
      clinicId,
      customerId,
      checkInId,
      expectedAmount: amount,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.message ?? '수납 예정 등록에 실패했습니다.');
      return;
    }
    setPendingId(res.id!);
    onChanged?.();
  }

  async function handleCancel() {
    if (!pendingId) return;
    setCancelling(true);
    const res = await cancelPendingPayment(pendingId);
    setCancelling(false);
    if (!res.ok) {
      toast.error(res.message ?? '취소에 실패했습니다.');
      // 이미 매칭/만료된 경우 상위 갱신하고 팝업 닫기.
      onChanged?.();
      onOpenChange(false);
      return;
    }
    toast.success('수신 대기를 취소했습니다.');
    onChanged?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        hideClose
        data-testid="planb-susu-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-800">
            <CreditCard className="h-5 w-5 text-teal-600" /> 카드 수납예정등록
          </DialogTitle>
        </DialogHeader>

        {pendingId === null ? (
          /* ── 1) 금액 입력 + 등록 ─────────────────────────────────────── */
          <div className="space-y-4">
            {customerLabel && (
              <div className="rounded-xl bg-teal-50 px-4 py-2.5 text-teal-900">
                <div className="text-xs text-teal-600">결제 대상</div>
                <div className="text-lg font-semibold">{customerLabel}</div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                결제 예상 금액
                {expected.isFetching && !amountTouched && (
                  <span className="ml-2 text-xs text-slate-400">자동 계산 중…</span>
                )}
              </label>
              <AmountInput
                value={amountDisplay}
                onChange={(v) => {
                  setAmountTouched(true);
                  setAmountDisplay(v);
                }}
                data-testid="planb-susu-amount-input"
                className="h-14 text-2xl"
                placeholder="0"
              />
              <div className="mt-1 text-right text-sm text-slate-500">{formatAmount(amount)}원</div>
            </div>

            {/* 안내문구 + 툴팁(정본 §4-1 안내상수) */}
            <div
              className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
              data-testid="planb-susu-notice"
            >
              <span
                className="mt-0.5 shrink-0 cursor-help text-teal-500"
                title={`카드 단말에서 결제를 받으면 승인 알림이 도착하는 대로 자동으로 수납 기록됩니다. 최대 ${REDPAY_PLANB_TTL.autoConnectMin}분 이내(미도착 시 수기 입력).`}
              >
                <Info className="h-4 w-4" />
              </span>
              <span>{REDPAY_PLANB_AUTO_RECORD_NOTICE}. 카드 단말에서 결제를 진행하세요.</span>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-14 flex-1"
                onClick={() => onOpenChange(false)}
                data-testid="planb-susu-close"
              >
                닫기
              </Button>
              <Button
                className="h-14 flex-[2] gap-2 bg-teal-600 text-base font-bold hover:bg-teal-700"
                disabled={submitting || amount <= 0 || !customerId}
                onClick={handleRegister}
                data-testid="planb-susu-register"
              >
                <CreditCard className="h-5 w-5" />
                {submitting ? '등록 중…' : '카드 수납예정등록'}
              </Button>
            </div>
          </div>
        ) : claimStatus === 'matched' ? (
          /* ── 3) 매칭 완료(자동 수납 기록) ─────────────────────────────── */
          <div
            className="flex flex-col items-center gap-3 rounded-xl bg-emerald-50 p-8 text-center"
            data-testid="planb-susu-matched"
          >
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
            <div className="text-xl font-bold text-emerald-800">수납 완료</div>
            <div className="text-emerald-700">
              {formatAmount(claim.data?.expected_amount ?? amount)}원 자동 기록됨
            </div>
            <Button
              className="mt-1 h-12 w-full max-w-xs bg-emerald-600 hover:bg-emerald-700"
              onClick={() => onOpenChange(false)}
            >
              확인
            </Button>
          </div>
        ) : claimStatus === 'expired' || claimStatus === 'failed' || claimStatus === 'cancelled' ? (
          /* ── 만료/실패/취소 → 수기입력 폴백 ─────────────────────────── */
          <div
            className="flex flex-col items-center gap-3 rounded-xl bg-amber-50 p-8 text-center"
            data-testid="planb-susu-expired"
          >
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <div className="text-lg font-bold text-amber-800">자동 기록되지 않았습니다</div>
            <p className="text-sm text-amber-700">
              결제 알림이 {REDPAY_PLANB_TTL.autoConnectMin}분 내 도착하지 않았습니다.
              <br />기존 화면에서 수기로 입력해 주세요.
            </p>
            <Button
              className="mt-1 h-12 w-full max-w-xs bg-amber-600 hover:bg-amber-700"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </Button>
          </div>
        ) : (
          /* ── 2) 수신 대기(open) — 취소 가능 ───────────────────────────── */
          <div
            className="flex flex-col items-center gap-3 rounded-xl bg-teal-50 p-8 text-center"
            data-testid="planb-susu-waiting"
          >
            <Clock className="h-12 w-12 text-teal-400" />
            <div className="text-xl font-bold text-teal-800">수신 대기 중</div>
            <div className="text-teal-700">{formatAmount(amount)}원 · 카드 승인 알림 대기</div>
            <div className="rounded-full bg-teal-100 px-4 py-1.5 text-sm text-teal-800">
              {REDPAY_PLANB_AUTO_RECORD_NOTICE}
            </div>
            <div className="mt-1 flex w-full max-w-xs gap-2">
              <Button
                variant="outline"
                className="h-12 flex-1 gap-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                disabled={cancelling}
                onClick={handleCancel}
                data-testid="planb-susu-cancel-waiting"
              >
                <X className="h-4 w-4" />
                {cancelling ? '취소 중…' : '수신대기 취소'}
              </Button>
              <Button
                className="h-12 flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={() => onOpenChange(false)}
              >
                계속
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
