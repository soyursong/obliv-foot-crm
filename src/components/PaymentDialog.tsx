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
import { InsuranceCopaymentPanel } from '@/components/insurance/InsuranceCopaymentPanel';
import type { CheckIn, PackageTemplate } from '@/lib/types';

// T-20260522-foot-PAY-DROPDOWN-LONGRE: 롱레 CRM 정합성 — membership 추가
// AC-5: payments CHECK ✅ membership 허용
//        package_payments CHECK ❌ membership 제외 (card/cash/transfer 3종만)
//        → paymentMode==='package'에서 membership 필터링으로 해결
type PayMethod = 'card' | 'cash' | 'transfer' | 'membership';
type PaymentMode = 'single' | 'package';

interface StaffOption {
  id: string;
  name: string;
}

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
  { value: 'membership', label: '멤버십', icon: '🎫' },
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
  // T-20260523-foot-PKG-TMPL-LINK: 하드코딩 PACKAGE_PRESETS → package_templates DB 연동
  const [pkgTemplates, setPkgTemplates] = useState<PackageTemplate[]>([]);
  const [pkgTemplatesLoading, setPkgTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [method, setMethod] = useState<PayMethod>('card');
  const [amountStr, setAmountStr] = useState('');
  const [installment, setInstallment] = useState(0);
  const [isSplit, setIsSplit] = useState(false);
  const [splitCardStr, setSplitCardStr] = useState('');
  const [splitCashStr, setSplitCashStr] = useState('');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // T-20260515-foot-RECEIPT-TAX-SPLIT AC-1: 현금영수증
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false);
  const [cashReceiptType, setCashReceiptType] = useState<'income_deduction' | 'expense_proof'>('income_deduction');
  const [cashReceiptNumber, setCashReceiptNumber] = useState('');
  // T-20260515-foot-RECEIPT-TAX-SPLIT AC-2: 과세/비과세 분리
  const [taxableAmountStr, setTaxableAmountStr] = useState('');
  const [taxExemptAmountStr, setTaxExemptAmountStr] = useState('');
  // C2-MANAGER-PAYMENT-MAP: 결제담당 선택
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  // T-20260523-foot-PKG-TMPL-LINK: clinic_id 기준으로 package_templates 로드
  useEffect(() => {
    if (!checkIn?.clinic_id) return;
    setPkgTemplatesLoading(true);
    supabase
      .from('package_templates')
      .select('*')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setPkgTemplates((data ?? []) as PackageTemplate[]);
        setPkgTemplatesLoading(false);
      });
  }, [checkIn?.clinic_id]);

  useEffect(() => {
    if (checkIn) {
      setPaymentMode(initialMode ?? 'single');
      setSelectedTemplateId(null);
      setMethod('card');
      setAmountStr('');
      setInstallment(0);
      setIsSplit(false);
      setSplitCardStr('');
      setSplitCashStr('');
      setMemo('');
      // T-20260514-foot-PAYMENT-CONSECUTIVE-STUCK BUG3 fix:
      // checkIn 변경 시 submitting 리셋 — 연속 결제 시 이전 환자의 submitting=true 잔류 방지
      setSubmitting(false);
      // T-20260515-foot-RECEIPT-TAX-SPLIT: 신규 필드 초기화
      setCashReceiptIssued(false);
      setCashReceiptType('income_deduction');
      setCashReceiptNumber('');
      setTaxableAmountStr('');
      setTaxExemptAmountStr('');
      // 결제담당: 체크인의 기존 consultant_id로 초기화
      setSelectedStaffId(checkIn.consultant_id ?? '');
      // 활성 직원 목록 로드
      supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director'])
        .order('name')
        .then(({ data }) => { setStaffList((data ?? []) as StaffOption[]); });
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
  // T-20260523-foot-PKG-TMPL-LINK: DB 템플릿에서 선택된 항목
  const selectedTemplate = selectedTemplateId
    ? (pkgTemplates.find((t) => t.id === selectedTemplateId) ?? null)
    : null;
  // T-20260515-foot-RECEIPT-TAX-SPLIT: 과세/비과세 금액
  const taxable = parseAmount(taxableAmountStr);
  const taxExempt = parseAmount(taxExemptAmountStr);
  // 현금 결제가 포함된 경우 (단건 현금 or 분할 현금 > 0)
  const hasCashPayment = !isSplit ? method === 'cash' : splitCash > 0;
  // 현재 결제 총액
  const totalPayment = isSplit ? splitCard + splitCash : amount;
  // AC-5(A): package_payments CHECK ❌ membership 제외 — UI 레벨 필터
  // 패키지 모드에서는 membership 버튼 숨김 (card/cash/transfer 3종만 노출)
  const visibleMethodOptions = paymentMode === 'package'
    ? METHOD_OPTIONS.filter((m) => m.value !== 'membership')
    : METHOD_OPTIONS;

  // T-20260523-foot-PKG-TMPL-LINK: 템플릿 선택 시 금액 자동 세팅 (total_price 기준)
  const handleSelectTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const t = pkgTemplates.find((tmpl) => tmpl.id === id);
    if (t) setAmountStr(String(t.total_price));
  };

  const insertPayments = async (
    rows: Array<{
      amount: number;
      method: PayMethod;
      installment: number | null;
      memo: string | null;
      payment_type: string;
      package_id?: string | null;
      // T-20260515-foot-RECEIPT-TAX-SPLIT AC-3: 새 필드 (optional)
      cash_receipt_issued?: boolean | null;
      cash_receipt_type?: string | null;
      cash_receipt_number?: string | null;
      taxable_amount?: number | null;
      tax_exempt_amount?: number | null;
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
      cash_receipt_issued: r.cash_receipt_issued ?? null,
      cash_receipt_type: r.cash_receipt_type ?? null,
      cash_receipt_number: r.cash_receipt_number ?? null,
      taxable_amount: r.taxable_amount ?? null,
      tax_exempt_amount: r.tax_exempt_amount ?? null,
    }));
    return supabase.from('payments').insert(payload);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    // T-20260514-foot-PAYMENTDLG-TRYCATCH: 네트워크 오류 등 미처리 예외 → submitting 영구 멈춤 방지
    try {

    if (paymentMode === 'package') {
      // AC-5(B): package_payments CHECK ❌ membership 제외 — submit 가드
      if (!isSplit && method === 'membership') {
        toast.error('패키지 결제는 멤버십 결제수단을 지원하지 않습니다');
        setSubmitting(false);
        return;
      }
      // T-20260523-foot-PKG-TMPL-LINK: 선택된 템플릿 기준 검증
      if (!selectedTemplate) {
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

      // T-20260523-foot-PKG-TMPL-LINK AC-3: template_id 연결 + 스냅샷 필드 저장
      const tmplTotalSessions =
        selectedTemplate.heated_sessions +
        selectedTemplate.unheated_sessions +
        selectedTemplate.iv_sessions +
        selectedTemplate.podologe_sessions +
        (selectedTemplate.trial_sessions ?? 0);

      const { data: pkgRow, error: pkgErr } = await supabase
        .from('packages')
        .insert({
          clinic_id: checkIn.clinic_id,
          customer_id: checkIn.customer_id,
          package_name: selectedTemplate.name,
          package_type: 'template',
          template_id: selectedTemplate.id,
          total_sessions: tmplTotalSessions,
          heated_sessions: selectedTemplate.heated_sessions,
          heated_unit_price: selectedTemplate.heated_unit_price,
          unheated_sessions: selectedTemplate.unheated_sessions,
          unheated_unit_price: selectedTemplate.unheated_unit_price,
          iv_sessions: selectedTemplate.iv_sessions,
          iv_unit_price: selectedTemplate.iv_unit_price,
          iv_company: selectedTemplate.iv_company ?? null,
          podologe_sessions: selectedTemplate.podologe_sessions,
          podologe_unit_price: selectedTemplate.podologe_unit_price,
          trial_sessions: selectedTemplate.trial_sessions ?? 0,
          trial_unit_price: selectedTemplate.trial_unit_price ?? 0,
          preconditioning_sessions: 0,
          shot_upgrade: false,
          af_upgrade: false,
          upgrade_surcharge: 0,
          // AC-4: total_amount = 템플릿 기준가(스냅샷), paid_amount = 실납부액
          total_amount: selectedTemplate.total_price,
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

      // ── T-20260520-foot-PAID-CALLBACK-EMIT (TA4) ─────────────────────
      // 도파민 경유 예약(source_system='dopamine')의 첫 패키지 결제 시 paid 콜백 발사.
      // fire-and-forget: 콜백 실패가 결제 완료 UX를 블록하지 않음.
      // EF 내부에서 is_first_package 판정 + outbound_log 멱등 보장.
      if (checkIn.reservation_id) {
        (async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;

            const { data: rsvRow } = await supabase
              .from('reservations')
              .select('source_system, external_id')
              .eq('id', checkIn.reservation_id!)
              .single();

            if (rsvRow?.source_system === 'dopamine' && rsvRow?.external_id) {
              await supabase.functions.invoke('dopamine-callback', {
                body: {
                  type: 'paid',
                  check_in_id: checkIn.id,
                  package_id: newPackageId,
                  amount: totalAmount,
                  package_name: selectedTemplate.name,
                },
              });
            }
          } catch (cbErr) {
            // non-fatal — outbound_log에 pending 기록이 남아 재처리 가능
            console.warn('[paid-callback] 도파민 paid 콜백 발사 오류 (non-fatal):', cbErr);
          }
        })();
      }
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
          cash_receipt_issued?: boolean | null;
          cash_receipt_type?: string | null;
          cash_receipt_number?: string | null;
          taxable_amount?: number | null;
          tax_exempt_amount?: number | null;
        }> = [];
        if (splitCard > 0) {
          rows.push({
            amount: splitCard,
            method: 'card',
            installment: installment || null,
            memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
            payment_type: 'payment',
            // T-20260515-foot-RECEIPT-TAX-SPLIT: 카드 분할행 — 현금영수증 없음
            cash_receipt_issued: null,
            cash_receipt_type: null,
            cash_receipt_number: null,
            taxable_amount: null,
            tax_exempt_amount: null,
          });
        }
        if (splitCash > 0) {
          rows.push({
            amount: splitCash,
            method: 'cash',
            installment: null,
            memo: `분할: 카드 ${formatAmount(splitCard)} + 현금 ${formatAmount(splitCash)}`,
            payment_type: 'payment',
            // T-20260515-foot-RECEIPT-TAX-SPLIT: 현금 분할행 — 과세/비과세 + 현금영수증
            cash_receipt_issued: cashReceiptIssued ? true : null,
            cash_receipt_type: cashReceiptIssued ? cashReceiptType : null,
            cash_receipt_number: cashReceiptIssued && cashReceiptNumber ? cashReceiptNumber : null,
            taxable_amount: taxable > 0 ? taxable : null,
            tax_exempt_amount: taxExempt > 0 ? taxExempt : null,
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
            // T-20260515-foot-RECEIPT-TAX-SPLIT: 과세/비과세 + 현금영수증
            cash_receipt_issued: method === 'cash' && cashReceiptIssued ? true : null,
            cash_receipt_type: method === 'cash' && cashReceiptIssued ? cashReceiptType : null,
            cash_receipt_number: method === 'cash' && cashReceiptIssued && cashReceiptNumber ? cashReceiptNumber : null,
            taxable_amount: taxable > 0 ? taxable : null,
            tax_exempt_amount: taxExempt > 0 ? taxExempt : null,
          },
        ]);
        if (error) {
          toast.error(`결제 실패: ${error.message}`);
          setSubmitting(false);
          return;
        }
      }
    }

    // C2-MANAGER-PAYMENT-MAP: 결제담당 선택 시 check_in.consultant_id 업데이트
    if (selectedStaffId && selectedStaffId !== (checkIn.consultant_id ?? '')) {
      await supabase
        .from('check_ins')
        .update({ consultant_id: selectedStaffId })
        .eq('id', checkIn.id);
    }

    // AC-1/AC-4 (T-20260514-foot-PAYMENT-AUTO-DONE):
    // payment_waiting → done (수납 완료 = 최종 완료)
    // consultation / consult_waiting → treatment_waiting (상담 후 시술 대기 흐름)
    if (checkIn.status === 'payment_waiting') {
      await supabase
        .from('check_ins')
        .update({ status: 'done' })
        .eq('id', checkIn.id);
      await supabase.from('status_transitions').insert({
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        from_status: checkIn.status,
        to_status: 'done',
      });
    } else if (['consultation', 'consult_waiting'].includes(checkIn.status)) {
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
    onPaid();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '결제 처리 중 오류가 발생했습니다';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
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
                onClick={() => {
                  if (canShowPackageMode) {
                    setPaymentMode('package');
                    // AC-5: 패키지 모드 전환 시 membership이 선택돼 있으면 card로 리셋
                    if (method === 'membership') setMethod('card');
                  }
                }}
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

            {/* 패키지 선택 (패키지 모드일 때만) — T-20260523-foot-PKG-TMPL-LINK */}
            {paymentMode === 'package' && canShowPackageMode && (
              <div className="space-y-2">
                <Label>패키지 선택</Label>
                {pkgTemplatesLoading ? (
                  <div className="text-sm text-muted-foreground py-2">패키지 목록 로딩 중…</div>
                ) : pkgTemplates.length === 0 ? (
                  <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-4 text-sm text-center text-muted-foreground">
                    등록된 패키지 템플릿이 없습니다
                    <div className="text-[11px] mt-0.5">관리자 → 패키지 템플릿 관리에서 추가하세요</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {pkgTemplates.map((t) => {
                      const totalSess =
                        t.heated_sessions + t.unheated_sessions + t.iv_sessions +
                        t.podologe_sessions + (t.trial_sessions ?? 0);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTemplate(t.id)}
                          className={cn(
                            'rounded-md border px-3 py-2 text-left transition',
                            selectedTemplateId === t.id
                              ? 'border-violet-600 bg-violet-50'
                              : 'border-input hover:bg-muted',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatAmount(t.total_price)}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            총 {totalSess}회
                            {t.heated_sessions > 0 && ` · 가열 ${t.heated_sessions}`}
                            {t.unheated_sessions > 0 && ` · 비가열 ${t.unheated_sessions}`}
                            {t.iv_sessions > 0 && ` · 수액 ${t.iv_sessions}`}
                            {t.podologe_sessions > 0 && ` · 포돌로게 ${t.podologe_sessions}`}
                            {(t.trial_sessions ?? 0) > 0 && ` · 체험 ${t.trial_sessions}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedTemplate && (
                  <div className="text-xs text-muted-foreground">
                    선택: {selectedTemplate.name} (권장가 {formatAmount(selectedTemplate.total_price)} — 할인 가능)
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
                    {visibleMethodOptions.map((m) => (
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

            {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-2: 과세/비과세 분리 */}
            {paymentMode === 'single' && (
              <div className="space-y-2 rounded-md border border-dashed border-muted-foreground/30 p-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground font-medium">과세/비과세 분리 <span className="text-[10px] font-normal">(선택)</span></Label>
                  {(taxable > 0 || taxExempt > 0) && totalPayment > 0 && (
                    <span className={cn(
                      'text-[10px] tabular-nums',
                      taxable + taxExempt === totalPayment ? 'text-emerald-600' : 'text-amber-600',
                    )}>
                      {taxable + taxExempt === totalPayment ? '✓ 합계 일치' : `⚠ 합계 ${formatAmount(taxable + taxExempt)} (결제금액 ${formatAmount(totalPayment)})`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">과세 금액</Label>
                    <Input
                      value={taxableAmountStr}
                      onChange={(e) => setTaxableAmountStr(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      className="text-right tabular-nums h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">비과세(면세) 금액</Label>
                    <Input
                      value={taxExemptAmountStr}
                      onChange={(e) => setTaxExemptAmountStr(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      className="text-right tabular-nums h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-1: 현금영수증 (현금 결제 시만 활성) */}
            {hasCashPayment && (
              <div className="space-y-2 rounded-md border border-dashed border-muted-foreground/30 p-3 bg-muted/20">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="cash-receipt-issued"
                    checked={cashReceiptIssued}
                    onChange={(e) => setCashReceiptIssued(e.target.checked)}
                    className="h-4 w-4 rounded border border-input accent-teal-600 cursor-pointer"
                  />
                  <Label htmlFor="cash-receipt-issued" className="cursor-pointer text-sm font-medium">
                    현금영수증 발행
                  </Label>
                </div>
                {cashReceiptIssued && (
                  <div className="space-y-2 pl-6">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCashReceiptType('income_deduction')}
                        className={cn(
                          'rounded border px-2 h-8 text-xs font-medium transition',
                          cashReceiptType === 'income_deduction'
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-input hover:bg-muted',
                        )}
                      >
                        소득공제용
                      </button>
                      <button
                        type="button"
                        onClick={() => setCashReceiptType('expense_proof')}
                        className={cn(
                          'rounded border px-2 h-8 text-xs font-medium transition',
                          cashReceiptType === 'expense_proof'
                            ? 'border-teal-600 bg-teal-50 text-teal-700'
                            : 'border-input hover:bg-muted',
                        )}
                      >
                        지출증빙용
                      </button>
                    </div>
                    <Input
                      value={cashReceiptNumber}
                      onChange={(e) => setCashReceiptNumber(e.target.value)}
                      placeholder="010-0000-0000 또는 사업자번호"
                      className="text-sm h-8"
                      data-testid="input-cash-receipt-number"
                    />
                  </div>
                )}
              </div>
            )}

            {/* C2-MANAGER-PAYMENT-MAP: 결제담당 선택 */}
            {staffList.length > 0 && (
              <div className="space-y-2">
                <Label>결제담당 <span className="text-xs font-normal text-muted-foreground">(선택)</span></Label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— 선택 안 함 —</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
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
