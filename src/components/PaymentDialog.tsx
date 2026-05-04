import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, Package as PackageIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PACKAGE_PRESETS } from '@/lib/packagePresets';
import { InsuranceCopaymentPanel } from '@/components/insurance/InsuranceCopaymentPanel';
import type { CheckIn } from '@/lib/types';

type PayMethod = 'card' | 'cash' | 'transfer';
type PaymentMode = 'single' | 'package';

interface Props {
  checkIn: CheckIn | null;
  onClose: () => void;
  onPaid: () => void;
  /** 다이얼로그 오픈 시 기본 결제 모드 (기본값: 'single') */
  initialMode?: PaymentMode;
}

const METHOD_OPTIONS: { value: PayMethod; label: string; icon: string }[] = [
  { value: 'card', label: '카드', icon: '💳' },
  { value: 'cash', label: '현금', icon: '💵' },
  { value: 'transfer', label: '이체', icon: '🏦' },
];

const INSTALLMENT_OPTIONS = [
  { value: 0, label: '일시불' },
  { value: 2, label: '2개월' },
  { value: 3, label: '3개월' },
  { value: 6, label: '6개월' },
  { value: 10, label: '10개월' },
  { value: 12, label: '12개월' },
];

export function PaymentDialog({ checkIn, onClose, onPaid, initialMode }: Props) {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initialMode ?? 'single');
  const [selectedPackageKey, setSelectedPackageKey] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>('card');
  const [amountStr, setAmountStr] = useState('');
  const [installment, setInstallment] = useState(0);
  const [isSplit, setIsSplit] = useState(false);
  const [splitCardStr, setSplitCardStr] = useState('');
  const [splitCashStr, setSplitCashStr] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (checkIn) {
      setPaymentMode(initialMode ?? 'single');
      setSelectedPackageKey(null);
      setMethod('card');
      setAmountStr('');
      setInstallment(0);
      setIsSplit(false);
      setSplitCardStr('');
      setSplitCashStr('');
      setMemo('');
    }
  }, [checkIn?.id]);

  const canShowPackageMode = useMemo(() => {
    if (!checkIn) return false;
    // 패키지 미연결 시 모든 방문유형 허용 (재진 포함 — PACKAGE-CREATE-IN-SHEET AC1 정합)
    // 재진도 패키지 소진 시 신규 생성 가능 (대표 지시 T-20260430-foot-PACKAGE-CREATE-IN-SHEET)
    return !checkIn.package_id;
  }, [checkIn]);

  if (!checkIn) return null;

  const amount = parseAmount(amountStr);
  const splitCard = parseAmount(splitCardStr);
  const splitCash = parseAmount(splitCashStr);
  const selectedPreset = selectedPackageKey ? PACKAGE_PRESETS[selectedPackageKey] : null;

  const handleSelectPackage = (key: string) => {
    setSelectedPackageKey(key);
    const p = PACKAGE_PRESETS[key];
    if (p) setAmountStr(String(p.suggestedPrice));
  };

  const insertPayments = async (
    rows: Array<{
      amount: number;
      method: PayMethod;
      installment: number | null;
      memo: string | null;
      payment_type: string;
      package_id?: string | null;
    }>,
  ) => {
    const payload = rows.map((r) => ({
      clinic_id: checkIn.clinic_id,
      check_in_id: checkIn.id,
      customer_id: checkIn.customer_id,
      amount: r.amount,
      method: r.method,
      installment: r.installment,
      memo: r.memo,
      payment_type: r.payment_type,
    }));
    return supabase.from('payments').insert(payload);
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    if (paymentMode === 'package') {
      if (!selectedPreset) {
        toast.error('패키지를 선택하세요');
        setSubmitting(false);
        return;
      }
      const totalAmount = isSplit ? splitCard + splitCash : amount;
      if (totalAmount <= 0) {
        toast.error('금액을 입력하세요');
        setSubmitting(false);
        return;
      }

      const { data: pkgRow, error: pkgErr } = await supabase
        .from('packages')
        .insert({
          clinic_id: checkIn.clinic_id,
          customer_id: checkIn.customer_id,
          package_name: selectedPreset.label,
          package_type: selectedPackageKey ?? `preset_${selectedPreset.total}`,
          total_sessions: selectedPreset.total,
          heated_sessions: selectedPreset.heated,
          unheated_sessions: selectedPreset.unheated,
          iv_sessions: selectedPreset.iv,
          preconditioning_sessions: selectedPreset.preconditioning,
          total_amount: selectedPreset.suggestedPrice,
          paid_amount: totalAmount,
          status: 'active',
          contract_date: new Date().toISOString().slice(0, 10),
        })
        .select('id')
        .single();

      if (pkgErr || !pkgRow) {
        toast.error(`패키지 생성 실패: ${pkgErr?.message ?? 'unknown'}`);
        setSubmitting(false);
        return;
      }
      const newPackageId = pkgRow.id as string;

      const ppRows: Array<{
        amount: number;
        method: PayMethod;
        installment: number | null;
      }> = isSplit
        ? [
            ...(splitCard > 0 ? [{ amount: splitCard, method: 'card' as PayMethod, installment: installment || null }] : []),
            ...(splitCash > 0 ? [{ amount: splitCash, method: 'cash' as PayMethod, installment: null }] : []),
          ]
        : [{ amount, method, installment: method === 'card' && installment > 0 ? installment : null }];

      const { error: ppErr } = await supabase.from('package_payments').insert(
        ppRows.map((r) => ({
          clinic_id: checkIn.clinic_id,
          package_id: newPackageId,
          customer_id: checkIn.customer_id,
          amount: r.amount,
          method: r.method,
          installment: r.installment,
          memo: memo || null,
        })),
      );
      if (ppErr) {
        toast.error(`결제 기록 실패: ${ppErr.message}`);
        setSubmitting(false);
        return;
      }

      await supabase
        .from('check_ins')
        .update({ package_id: newPackageId })
        .eq('id', checkIn.id);
    } else {
      // 단건 결제 (기존 로직)
      if (isSplit) {
        if (splitCard <= 0 && splitCash <= 0) {
          toast.error('금액을 입력하세요');
          setSubmitting(false);
          return;
        }
        const rows: Array<{
          amount: number;
          method: PayMethod;
          installment: number | null;
          memo: string | null;
          payment_type: string;
        }> = [];
        if (splitCard > 0) {
          rows.push({
            amount: splitCard,
            method: 'card',
            installment: installment || null,
            memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
            payment_type: 'payment',
          });
        }
        if (splitCash > 0) {
          rows.push({
            amount: splitCash,
            method: 'cash',
            installment: null,
            memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
            payment_type: 'payment',
          });
        }
        const { error } = await insertPayments(rows);
        if (error) {
          toast.error(`결제 실패: ${error.message}`);
          setSubmitting(false);
          return;
        }
      } else {
        if (amount <= 0) {
          toast.error('금액을 입력하세요');
          setSubmitting(false);
          return;
        }
        const { error } = await insertPayments([
          {
            amount,
            method,
            installment: method === 'card' && installment > 0 ? installment : null,
            memo: memo || null,
            payment_type: 'payment',
          },
        ]);
        if (error) {
          toast.error(`결제 실패: ${error.message}`);
          setSubmitting(false);
          return;
        }
      }
    }

    const autoTransitionStatuses = ['payment_waiting', 'consultation', 'consult_waiting'];
    if (autoTransitionStatuses.includes(checkIn.status)) {
      await supabase
        .from('check_ins')
        .update({ status: 'treatment_waiting' })
        .eq('id', checkIn.id);
      await supabase.from('status_transitions').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        from_status: checkIn.status,
        to_status: 'treatment_waiting',
      });
    }

    toast.success(paymentMode === 'package' ? '패키지 결제 완료' : '결제 완료');
    setSubmitting(false);
    onPaid();
  };

  return (
    <>
      <Dialog open={!!checkIn} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              결제 — {checkIn.customer_name}
              {checkIn.queue_number != null && (
                <span className="text-sm text-teal-700">#{checkIn.queue_number}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── 건보 본인부담 미리보기 (T-20260504-foot-INSURANCE-COPAYMENT) ── */}
            <InsuranceCopaymentPanel checkIn={checkIn} />

            {/* 단건 / 패키지 토글 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaymentMode('single')}
                className={cn(
                  'flex-1 rounded-md border py-2 text-sm font-medium transition',
                  paymentMode === 'single'
                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                    : 'border-input hover:bg-muted',
                )}
              >
                단건 결제
              </button>
              <button
                type="button"
                onClick={() => canShowPackageMode && setPaymentMode('package')}
                disabled={!canShowPackageMode}
                title={
                  !canShowPackageMode
                    ? '이미 패키지가 연결된 체크인입니다. 회차 소진은 패키지 페이지에서.'
                    : ''
                }
                className={cn(
                  'flex-1 rounded-md border py-2 text-sm font-medium transition flex items-center justify-center gap-1',
                  paymentMode === 'package' && canShowPackageMode
                    ? 'border-violet-600 bg-violet-50 text-violet-700'
                    : 'border-input hover:bg-muted',
                  !canShowPackageMode && 'opacity-50 cursor-not-allowed',
                )}
              >
                <PackageIcon className="h-4 w-4" /> 패키지 결제
              </button>
            </div>

            {paymentMode === 'package' && !canShowPackageMode && (
              <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
                이미 패키지가 연결된 체크인입니다. 패키지 페이지에서 회차 소진하세요.
              </div>
            )}

            {/* 패키지 선택 (패키지 모드일 때만) */}
            {paymentMode === 'package' && canShowPackageMode && (
              <div className="space-y-2">
                <Label>패키지 선택</Label>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(PACKAGE_PRESETS).map(([key, p]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectPackage(key)}
                      className={cn(
                        'rounded-md border px-3 py-2 text-left transition',
                        selectedPackageKey === key
                          ? 'border-violet-600 bg-violet-50'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{p.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatAmount(p.suggestedPrice)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        총 {p.total}회 · 가열 {p.heated} · 비가열 {p.unheated} · 수액 {p.iv} · 프리컨 {p.preconditioning}
                      </div>
                    </button>
                  ))}
                </div>
                {selectedPreset && (
                  <div className="text-xs text-muted-foreground">
                    선택: {selectedPreset.label} (권장가 {formatAmount(selectedPreset.suggestedPrice)} — 할인 가능)
                  </div>
                )}
              </div>
            )}

            {/* 단일 / 분할 토글 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsSplit(false)}
                className={cn(
                  'flex-1 rounded-md border py-2 text-sm font-medium transition',
                  !isSplit ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                )}
              >
                일시 결제
              </button>
              <button
                type="button"
                onClick={() => setIsSplit(true)}
                className={cn(
                  'flex-1 rounded-md border py-2 text-sm font-medium transition',
                  isSplit ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                )}
              >
                분할 결제
              </button>
            </div>

            {isSplit ? (
              <>
                <div className="space-y-2">
                  <Label>카드 금액</Label>
                  <Input
                    value={splitCardStr}
                    onChange={(e) => setSplitCardStr(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="text-right tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label>현금 금액</Label>
                  <Input
                    value={splitCashStr}
                    onChange={(e) => setSplitCashStr(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="text-right tabular-nums"
                  />
                </div>
                {/* UX-8: 분할결제 합계 + 비율 시각화 */}
                {splitCard + splitCash > 0 && (
                  <div className="space-y-1 rounded bg-muted px-3 py-2">
                    <div className="flex justify-between text-sm font-medium">
                      <span>합계</span>
                      <span className="tabular-nums">{formatAmount(splitCard + splitCash)}</span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-background">
                      {splitCard > 0 && (
                        <div
                          className="bg-blue-500"
                          style={{ width: `${(splitCard / (splitCard + splitCash)) * 100}%` }}
                          title={`카드 ${formatAmount(splitCard)}`}
                        />
                      )}
                      {splitCash > 0 && (
                        <div
                          className="bg-emerald-500"
                          style={{ width: `${(splitCash / (splitCard + splitCash)) * 100}%` }}
                          title={`현금 ${formatAmount(splitCash)}`}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>💳 카드 {formatAmount(splitCard)}</span>
                      <span>💵 현금 {formatAmount(splitCash)}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* 결제 수단 */}
                <div className="space-y-2">
                  <Label>결제 수단</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {METHOD_OPTIONS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMethod(m.value)}
                        className={cn(
                          'flex items-center justify-center gap-1 rounded-md border py-2 text-sm font-medium transition',
                          method === m.value
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-input hover:bg-muted',
                        )}
                      >
                        {m.icon} {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 금액 */}
                <div className="space-y-2">
                  <Label>금액</Label>
                  <Input
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    className="text-right text-lg tabular-nums"
                    autoFocus
                  />
                </div>

                {/* 할부 (카드만) */}
                {method === 'card' && (
                  <div className="space-y-2">
                    <Label>할부</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {INSTALLMENT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setInstallment(opt.value)}
                          className={cn(
                            'rounded border px-2 h-9 text-xs font-medium transition',
                            installment === opt.value
                              ? 'border-teal-600 bg-teal-50 text-teal-700'
                              : 'border-input hover:bg-muted',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label>메모</Label>
              <Textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="결제 메모"
                rows={2}
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button
              data-testid="btn-payment-submit"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? '처리 중…'
                : paymentMode === 'package'
                  ? '패키지 결제 완료'
                  : '결제 완료'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
