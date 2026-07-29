/**
 * PaymentPlanb.tsx — 레드페이 플랜B 비대기형(NOWAIT) 결제페이지 (신규 route)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어 · FE route)
 *
 * 흐름(현장 클릭 시나리오 1):
 *   [결제받기] → 금액 입력 → pending_payment 선점(open) INSERT
 *     → (카드 단말 = 물리 장비, 직원이 단말에서 결제 진행 — FE 무호출)
 *     → 화면 즉시 다음으로 전환(대기 0, 로딩 스피너로 멈추지 않음)
 *     → 안내 "결제는 최대 5분 내 자동 기록" 표시
 *     → (백그라운드) 웹훅 raw 도착 → 매칭 워커(redpay-planb-match)가 예상금액 매칭 → status=matched
 *     → 완료 뱃지 자동 표시
 *   시나리오 2: 선점 잠금 6분 만료+미매칭 → status=expired → 수기입력 폴백 안내.
 *
 * ★ 대원칙(§2): 기존 결제 화면·수기입력 절대 무접촉. 본 route 는 기능플래그(VITE_PAYMENT_PLANB)
 *   ON 일 때만 도달 — OFF 면 진입 즉시 /admin 리다이렉트(신규 노출 0).
 * 태블릿 UX: teal-emerald · 큰 버튼 · 천단위 콤마 · 한국어.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Clock, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AmountInput, parseAmountRaw } from '@/components/ui/AmountInput';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { formatAmount, chartNoBadge } from '@/lib/format';
import { usePlanbClaimStatus } from '@/hooks/usePlanbClaimStatus';
import {
  isPaymentPlanbEnabled,
  createPendingPayment,
  REDPAY_PLANB_AUTO_RECORD_NOTICE,
  REDPAY_PLANB_TTL,
} from '@/lib/paymentPlanb';

interface CheckInLite {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  customer_name: string | null;
  chart_number: string | null;
}

async function fetchCheckInLite(checkInId: string): Promise<CheckInLite | null> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('id, clinic_id, customer_id, customer_name, customers(name, chart_number)')
    .eq('id', checkInId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cust = (data as { customers?: { name?: string | null; chart_number?: string | null } | null }).customers ?? null;
  return {
    id: data.id as string,
    clinic_id: data.clinic_id as string,
    customer_id: (data.customer_id as string | null) ?? null,
    customer_name: (data.customer_name as string | null) ?? cust?.name ?? null,
    chart_number: cust?.chart_number ?? null,
  };
}

export default function PaymentPlanb() {
  const { checkInId } = useParams<{ checkInId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [amountDisplay, setAmountDisplay] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // 기능 플래그 OFF → 신규 route 미노출(진입 즉시 리다이렉트).
  const enabled = isPaymentPlanbEnabled();

  const { data: checkIn, isLoading: ciLoading } = useQuery<CheckInLite | null>({
    queryKey: ['planb_checkin', checkInId],
    enabled: enabled && !!checkInId,
    queryFn: () => fetchCheckInLite(checkInId as string),
  });

  const claim = usePlanbClaimStatus(pendingId);
  const claimStatus = claim.data?.status ?? 'open';

  const amount = useMemo(() => {
    const raw = parseAmountRaw(amountDisplay);
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [amountDisplay]);

  if (!enabled) return <Navigate to="/admin" replace />;

  async function handleSubmit() {
    if (!checkIn || !checkIn.customer_id) {
      toast.error('환자 정보를 확인할 수 없습니다.');
      return;
    }
    if (amount <= 0) {
      toast.error('결제 금액을 입력하세요.');
      return;
    }
    setSubmitting(true);
    const res = await createPendingPayment({
      clinicId: checkIn.clinic_id,
      customerId: checkIn.customer_id,
      checkInId: checkIn.id,
      expectedAmount: amount,
      createdBy: profile?.id ?? profile?.name ?? null,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.message ?? '선점 생성에 실패했습니다.');
      return;
    }
    // ★ 즉시 전환 — 카드 단말은 직원이 물리적으로 진행, FE 는 대기하지 않는다(대기 0).
    setPendingId(res.id!);
  }

  const custLabel = checkIn
    ? `${checkIn.customer_name ?? '환자'} ${chartNoBadge(checkIn.chart_number)}`
    : '';

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6" data-testid="payment-planb-page">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('/admin')}>
          <ArrowLeft className="h-4 w-4" /> 뒤로
        </Button>
        <h1 className="text-lg font-bold text-emerald-800">비대기형 결제 (자동 기록)</h1>
      </div>

      {ciLoading ? (
        <div className="py-16 text-center text-slate-400">환자 정보를 불러오는 중…</div>
      ) : !checkIn ? (
        <div className="py-16 text-center text-rose-500">체크인 정보를 찾을 수 없습니다.</div>
      ) : pendingId === null ? (
        /* ── 1) 금액 입력 화면 ─────────────────────────────────────────── */
        <div className="space-y-6 rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
          <div className="rounded-xl bg-teal-50 px-4 py-3 text-teal-900">
            <div className="text-sm text-teal-600">결제 대상</div>
            <div className="text-xl font-semibold">{custLabel}</div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">결제 예상 금액</label>
            <AmountInput
              value={amountDisplay}
              onChange={setAmountDisplay}
              data-testid="planb-amount-input"
              className="h-14 text-2xl"
              placeholder="0"
            />
            <div className="mt-1 text-right text-sm text-slate-500">{formatAmount(amount)}원</div>
          </div>

          <Button
            className="h-16 w-full gap-2 bg-teal-600 text-lg font-bold hover:bg-teal-700"
            disabled={submitting || amount <= 0}
            onClick={handleSubmit}
            data-testid="planb-submit"
          >
            <CreditCard className="h-6 w-6" />
            {submitting ? '선점 생성 중…' : '결제 진행'}
          </Button>
          <p className="text-center text-xs text-slate-400">
            결제 진행을 누르면 카드 단말에서 결제를 받으세요. 화면은 즉시 다음으로 넘어갑니다(대기 없음).
          </p>
        </div>
      ) : claimStatus === 'matched' ? (
        /* ── 3) 완료(자동 매칭) ────────────────────────────────────────── */
        <div
          className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center"
          data-testid="planb-matched-badge"
        >
          <CheckCircle2 className="h-16 w-16 text-emerald-500" />
          <div className="text-2xl font-bold text-emerald-800">결제 완료</div>
          <div className="text-emerald-700">
            {custLabel} · {formatAmount(claim.data?.expected_amount ?? amount)}원 자동 기록됨
          </div>
          <Button className="mt-2 h-14 w-full max-w-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate('/admin')}>
            확인
          </Button>
        </div>
      ) : claimStatus === 'expired' || claimStatus === 'failed' ? (
        /* ── 2) 만료/실패 → 수기입력 폴백 안내 ──────────────────────────── */
        <div
          className="flex flex-col items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-10 text-center"
          data-testid="planb-expired-fallback"
        >
          <AlertTriangle className="h-14 w-14 text-amber-500" />
          <div className="text-xl font-bold text-amber-800">자동 기록되지 않았습니다</div>
          <p className="text-amber-700">
            결제 알림이 {REDPAY_PLANB_TTL.lockMin}분 내 도착하지 않았습니다.
            <br />
            기존 화면에서 <b>수기로 입력</b>해 주세요.
          </p>
          <Button
            className="mt-2 h-14 w-full max-w-xs bg-amber-600 hover:bg-amber-700"
            onClick={() => navigate('/admin')}
            data-testid="planb-manual-fallback-btn"
          >
            수기 입력하러 가기
          </Button>
        </div>
      ) : (
        /* ── 대기(비대기형) — 즉시 전환, 스피너로 막지 않음 ───────────────── */
        <div
          className="flex flex-col items-center gap-4 rounded-2xl border border-teal-100 bg-white p-10 text-center shadow-sm"
          data-testid="planb-waiting"
        >
          <Clock className="h-14 w-14 text-teal-400" />
          <div className="text-2xl font-bold text-teal-800">{custLabel}</div>
          <div className="text-lg text-slate-700">{formatAmount(amount)}원 결제 접수됨</div>
          <div
            className="rounded-full bg-teal-100 px-5 py-2 text-teal-800"
            data-testid="planb-auto-record-notice"
          >
            {REDPAY_PLANB_AUTO_RECORD_NOTICE}
          </div>
          <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={() => navigate('/admin')}>
            다음 환자 접수
          </Button>
        </div>
      )}
    </div>
  );
}
