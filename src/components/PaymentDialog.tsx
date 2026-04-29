import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CreditCard, FileText, Package as PackageIcon } from 'lucide-react';
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
import { useConsentForms, ConsentFormDialog, type FormType } from '@/components/ConsentFormDialog';
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

// 결제 전 필수 동의서
const REQUIRED_CONSENTS: FormType[] = ['refund', 'non_covered'];
const REQUIRED_CONSENT_LABELS: Record<string, string> = {
  refund: '환불 동의서',
  non_covered: '비급여 확인 동의서',
};

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

  // ── 동의서 게이트 ──
  const { signed, signedDates, loading: consentLoading, refresh: refreshConsents } = useConsentForms(
    checkIn?.id ?? null,
  );
  const [consentFormType, setConsentFormType] = useState<FormType | null>(null);
  const didAutoOpen = useRef(false);

  // 체크인 변경 시 자동 열기 플래그 초기화
  useEffect(() => {
    didAutoOpen.current = false;
  }, [checkIn?.id]);

  // 동의서 로딩 완료 시 첫 번째 미작성 동의서 자동 열기
  useEffect(() => {
    if (!checkIn || consentLoading || didAutoOpen.current) return;
    const missing = REQUIRED_CONSENTS.filter((ft) => !signed.has(ft));
    if (missing.length > 0) {
      setConsentFormType(missing[0]);
      didAutoOpen.current = true;
    }
  }, [checkIn?.id, consentLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const missingConsents = REQUIRED_CONSENTS.filter((ft) => !signed.has(ft));
  const consentReady = missingConsents.length === 0;

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
    return checkIn.visit_type !== 'returning' && !checkIn.package_id;
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
    if (!consentReady) {
      toast.error('필수 동의서를 먼저 완료해 주세요');
      return;
    }
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
          package_type: `preset_${selectedPreset.total}`,
          total_sessions: selectedPreset.total,
          total_amount: selectedPreset.suggestedPrice,
          paid_amount: totalAmount,
          status: 'active',
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
            {/* ── 동의서 확인 섹션 ── */}
            {!consentLoading && !consentReady && (
              <div
                data-testid="consent-gate"
                className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-amber-700" />
                  <span className="text-sm font-semibold text-amber-900">필수 동의서 미작성</span>
                </div>
                <p className="text-xs text-amber-700">
                  아래 동의서를 완료해야 결제가 진행됩니다. 동의서를 탭하면 서명 화면이 열립니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  {REQUIRED_CONSENTS.map((ft) => (
                    <Button
                      key={ft}
                      size="sm"
                      data-testid={`payment-consent-btn-${ft}`}
                      variant={signed.has(ft) ? 'default' : 'outline'}
                      className={cn(
                        'text-xs gap-1 h-9',
                        signed.has(ft)
                          ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600'
                          : 'border-amber-400 text-amber-900 hover:bg-amber-100',
                      )}
                      onClick={() => { if (!signed.has(ft)) setConsentFormType(ft); }}
                    >
                      {signed.has(ft) ? '✓' : <FileText className="h-3 w-3" />}
                      {REQUIRED_CONSENT_LABELS[ft]}
                    </Button>
                  ))}
                </div>
                {missingConsents.length > 0 && (
                  <p className="text-[11px] text-amber-600">
                    미완료: {missingConsents.map((ft) => REQUIRED_CONSENT_LABELS[ft]).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* 동의서 완료 상태 표시 */}
            {!consentLoading && consentReady && (
              <div
                data-testid="consent-complete"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1"
              >
                <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
                  ✓ 필수 동의서 완료
                </span>
                <div className="flex flex-wrap gap-2">
                  {REQUIRED_CONSENTS.map((ft) => (
                    <span key={ft} className="text-[11px] text-emerald-700">
                      {REQUIRED_CONSENT_LABELS[ft]}
                      {signedDates[ft] && (
                        <span className="text-emerald-500 ml-0.5">
                          ({format(new Date(signedDates[ft]!), 'M/d HH:mm')})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

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
                    ? '재진 환자 또는 이미 패키지 연결된 체크인입니다. 회차 소진은 패키지 페이지에서.'
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
                재진 환자 또는 이미 패키지 연결된 체크인입니다. 패키지 페이지에서 회차 소진하세요.
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
              disabled={submitting || !consentReady}
              title={!consentReady ? '필수 동의서를 먼저 완료해 주세요' : ''}
            >
              {submitting
                ? '처리 중…'
                : !consentReady
                  ? '동의서 먼저 완료'
                  : paymentMode === 'package'
                    ? '패키지 결제 완료'
                    : '결제 완료'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 동의서 서명 다이얼로그 (PaymentDialog 위에 overlay) */}
      <ConsentFormDialog
        checkIn={checkIn}
        formType={consentFormType ?? 'refund'}
        open={!!consentFormType}
        onOpenChange={(o) => { if (!o) setConsentFormType(null); }}
        onSigned={async () => {
          const justSigned = consentFormType;
          setConsentFormType(null);
          await refreshConsents();
          // 다음 미서명 동의서 자동 열기
          const remaining = REQUIRED_CONSENTS.filter(
            (ft) => !signed.has(ft) && ft !== justSigned,
          );
          if (remaining.length > 0) {
            setTimeout(() => setConsentFormType(remaining[0]), 350);
          }
        }}
      />
    </>
  );
}
