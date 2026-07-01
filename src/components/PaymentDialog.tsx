import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
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
import { AmountInput } from '@/components/ui/AmountInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { applyStatusFlagTransition } from '@/lib/statusFlagTransition';
import { promoteVisitTypeToReturning } from '@/lib/visitType';
import { formatAmount, parseAmount, chartNoBadge } from '@/lib/format';
import { isSinglePaymentByCount, netPaidFromPayments, computeOutstanding, type PackagePaymentRow } from '@/lib/footBilling';
// T-20260612-foot-MEDLAW22-B-GATE: 급여 방문 진료기록 미작성 → 수납 완료 하드차단(방어적 적용).
import { evaluateMedicalRecordGate, MEDLAW22_BLOCK_MESSAGE } from '@/lib/medicalRecordGate';
import { cn } from '@/lib/utils';
// T-20260616-foot-PAYDLG-INSURANCE-PANEL-ROLLBACK: 라이브 수납 차단 P0 핫픽스 —
// 결제 미니창 상단 '급여 진료비 미리보기(건강보험)' 패널 렌더 롤백. 패널 컴포넌트/보험기능은 보존.
// import { InsuranceCopaymentPanel } from '@/components/insurance/InsuranceCopaymentPanel';
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

// T-20260522-foot-PAY-DROPDOWN-LONGRE Phase2: 라벨 멤버십→패키지 / 아이콘 🎫→📦 (DB value 'membership' 유지)
const METHOD_OPTIONS: { value: PayMethod; label: string; icon: string }[] = [
  { value: 'card', label: '카드', icon: '💳' },
  { value: 'cash', label: '현금', icon: '💵' },
  { value: 'transfer', label: '이체', icon: '🏦' },
  { value: 'membership', label: '패키지', icon: '📦' },
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
  const { profile } = useAuth();
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
  // T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 승인번호·TID 입력 칸 제거 (매처 자동 채움)
  // T-20260524-foot-PKG-LABEL-AMOUNT AC-2: 고객 활성 패키지 (단건 membership 결제 시 단가 auto-fill)
  const [customerPackage, setCustomerPackage] = useState<{
    id: string;
    package_name: string;
    total_amount: number;
    total_sessions: number;
    consultation_fee: number;
  } | null>(null);
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 고객 활성 패키지의 패키지/진료비 잔금(파생값) + 잔금결제 모드.
  const [pkgBalanceDue, setPkgBalanceDue] = useState(0);
  const [consultBalanceDue, setConsultBalanceDue] = useState(0);
  const [balanceKind, setBalanceKind] = useState<'package' | 'consultation' | null>(null);

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
      // T-20260524-foot-PKG-LABEL-AMOUNT AC-2: 고객 패키지 초기화 후 재조회
      setCustomerPackage(null);
      // T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 잔금 상태 초기화
      setPkgBalanceDue(0);
      setConsultBalanceDue(0);
      setBalanceKind(null);
      // 활성 직원 목록 로드
      supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director'])
        .order('name')
        .then(({ data }) => { setStaffList((data ?? []) as StaffOption[]); });
      // T-20260524-foot-PKG-LABEL-AMOUNT AC-2: 고객 활성 패키지 조회 (단건+membership 금액 auto-fill)
      // T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: consultation_fee + 결제행 동반 조회 → 패키지/진료비 잔금 산출.
      if (checkIn.customer_id && checkIn.clinic_id) {
        (async () => {
          const { data: pkg } = await supabase
            .from('packages')
            .select('id, package_name, total_amount, total_sessions, consultation_fee')
            .eq('customer_id', checkIn.customer_id)
            .eq('clinic_id', checkIn.clinic_id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!pkg) { setCustomerPackage(null); setPkgBalanceDue(0); setConsultBalanceDue(0); return; }
          const cp = {
            id: pkg.id as string,
            package_name: pkg.package_name as string,
            total_amount: (pkg.total_amount as number) ?? 0,
            total_sessions: (pkg.total_sessions as number) ?? 0,
            consultation_fee: (pkg.consultation_fee as number) ?? 0,
          };
          setCustomerPackage(cp);
          const { data: pays } = await supabase
            .from('package_payments')
            .select('amount, payment_type, fee_kind')
            .eq('package_id', cp.id);
          const rows = (pays ?? []) as PackagePaymentRow[];
          setPkgBalanceDue(computeOutstanding(cp.total_amount, netPaidFromPayments(rows, 'package')));
          setConsultBalanceDue(computeOutstanding(cp.consultation_fee, netPaidFromPayments(rows, 'consultation')));
        })();
      }
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
  // T-20260623-foot-PAYMINI-DESK-SETTLE ④a: 결제수단에서 [패키지](membership) 버튼 제거 — 단건·패키지 모드 모두.
  //   현장 김주연 총괄 지시(2026-06-23, 스샷). 결제수단은 카드/현금/이체 3종만 노출.
  //   ⚠ 상단 [패키지 결제] 모드 토글(paymentMode)은 유지 → 패키지 결제 기능 자체는 보존(비파괴).
  //   audit(policy_superseded): 이 [패키지] 결제수단 버튼은 5/22 T-20260522-foot-PAY-DROPDOWN-LONGRE(대표 김승현)
  //     에서 추가된 항목 → button-only 제거(기능 전체 제거 아님). 기존 AC-5(A) 패키지모드 membership 숨김을 전 모드로 확장.
  const visibleMethodOptions = METHOD_OPTIONS.filter((m) => m.value !== 'membership');

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
      external_approval_no: null, // T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 매처 자동 채움
      external_tid: null,
    }));
    return supabase.from('payments').insert(payload);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    // T-20260514-foot-PAYMENTDLG-TRYCATCH: 네트워크 오류 등 미처리 예외 → submitting 영구 멈춤 방지
    try {

    // ── T-20260612-foot-MEDLAW22-B-GATE: 수납 완료(payment_waiting→done) 전 진료기록 게이트 ──
    //   수납 완료로 done 전이되는 경우에만 평가(상담→시술 전이는 무관). 급여 방문 + 서명 진료기록
    //   미존재 → 하드차단(사유 우회 없음). 비급여는 즉시 통과. 평가 오류는 과차단 방지 위해 통과.
    if (checkIn.status === 'payment_waiting') {
      try {
        const gate = await evaluateMedicalRecordGate(checkIn);
        if (gate.blocked) {
          toast.error(gate.reason ?? MEDLAW22_BLOCK_MESSAGE);
          setSubmitting(false);
          return;
        }
      } catch {
        // 비차단(운영 연속성 우선).
      }
    }

    if (balanceKind) {
      // ── T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 잔금(미수금) 결제 ──────────────
      // 활성 패키지의 패키지 잔금(fee_kind='package') 또는 진료비 잔금(fee_kind='consultation')을
      // package_payments 에 분리 적재한다(§4-A: 두 잔금은 별도 결제 — 합산 단일 결제 금지).
      // 단건(payments)·신규패키지 생성 경로를 타지 않는 독립 분기. CHECK(card/cash/transfer)로
      // membership 은 card 로 보정.
      if (!customerPackage) {
        toast.error('활성 패키지가 없습니다');
        setSubmitting(false);
        return;
      }
      if (amount <= 0) {
        toast.error('금액을 입력하세요');
        setSubmitting(false);
        return;
      }
      const { error: balErr } = await supabase.from('package_payments').insert({
        clinic_id: checkIn.clinic_id,
        package_id: customerPackage.id,
        customer_id: checkIn.customer_id,
        amount,
        method: method === 'membership' ? 'card' : method,
        installment: method === 'card' && installment > 0 ? installment : null,
        memo: memo || (balanceKind === 'package' ? '패키지 잔금 결제' : '진료비 잔금 결제'),
        payment_type: 'payment',
        fee_kind: balanceKind,
        external_approval_no: null,
        external_tid: null,
      });
      if (balErr) {
        toast.error(`잔금 결제 실패: ${balErr.message}`);
        setSubmitting(false);
        return;
      }
    } else if (paymentMode === 'package') {
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

      // ── T-20260610-foot-PKGCLASS-SESSION1-SINGLE (AC-1·회수1 발행=단건) ─────────────
      // 패키지 총 회수=1 이면 발행 결제를 단건(payments)으로 분류한다. 1차 키=회수(금액 보조).
      // 패키지 row 는 그대로 존속(paid_amount=totalAmount 기 설정, 1회 세션 소진 추적) +
      // check_ins.package_id 연결도 유지 → 소진 동선 무변경. 단지 매출 분류만 단건 버킷으로 보낸다.
      // 체험권(회수1) 단건 처리(TRIAL-REVENUE-ZERO)의 일반화 — 회귀 없음(AC-6).
      if (isSinglePaymentByCount(tmplTotalSessions)) {
        const { error: pErr } = await insertPayments(
          ppRows.map((r) => ({
            amount: r.amount,
            method: r.method,
            installment: r.installment,
            memo: memo || null,
            payment_type: 'payment',
          })),
        );
        if (pErr) {
          toast.error(`결제 기록 실패: ${pErr.message}`);
          setSubmitting(false);
          return;
        }
      } else {
        const { error: ppErr } = await supabase.from('package_payments').insert(
          ppRows.map((r) => ({
            clinic_id: checkIn.clinic_id,
            package_id: newPackageId,
            customer_id: checkIn.customer_id,
            amount: r.amount,
            method: r.method,
            installment: r.installment,
            memo: memo || null,
            // T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 매처 자동 채움 (UI 입력 제거)
            external_approval_no: null,
            external_tid: null,
          })),
        );
        if (ppErr) {
          toast.error(`결제 기록 실패: ${ppErr.message}`);
          setSubmitting(false);
          return;
        }
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
      // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: 수납완료 = status_flag 'dark_gray'(회색) 자동전환.
      //   AUTO-DONE(f2d803d)이 status='done'(칸반 완료 이동)만 갱신하고 status_flag는 안 건드려
      //   수납완료(회색) 플래그가 누락됐던 동기화 결함 수복. PAYMENT-MINI-WINDOW AC-11 의도된 양방향 동선.
      //   status_flag 전이는 applyStatusFlagTransition(SSOT)에 위임 — 병렬 2nd write 신설 금지.
      //   best-effort: 결제·status='done'은 이미 커밋됨 → 플래그 실패가 결제 흐름을 롤백하지 않음.
      try {
        await applyStatusFlagTransition(checkIn, 'dark_gray', {
          id: profile?.id ?? null,
          name: profile?.name ?? null,
          role: profile?.role ?? null,
        });
      } catch (flagErr) {
        console.error('status_flag dark_gray 전이 실패(결제는 정상 완료):', flagErr);
      }
      // T-20260602-foot-VISITTYPE-RETURNING-AUTOSET: 완료 시 visit_type 자동 승격 (best-effort)
      await promoteVisitTypeToReturning(checkIn.customer_id);
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

    toast.success(balanceKind ? '잔금 결제 완료' : paymentMode === 'package' ? '패키지 결제 완료' : '결제 완료');
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
              {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
              <span className="text-sm font-mono font-normal text-teal-700">{chartNoBadge(checkIn.customers?.chart_number ?? null)}</span>
              {checkIn.queue_number != null && (
                <span className="text-sm text-teal-700">#{checkIn.queue_number}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* ── 건보 본인부담 미리보기 (T-20260504-foot-INSURANCE-COPAYMENT) ──
                 T-20260616-foot-PAYDLG-INSURANCE-PANEL-ROLLBACK: 라이브 수납 차단 P0 핫픽스로 렌더 롤백.
                 보험 청구 기능 복구 시 아래 줄 + 상단 import 주석 해제.
            <InsuranceCopaymentPanel checkIn={checkIn} /> */}

            {/* 단건 / 패키지 토글 */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPaymentMode('single'); setBalanceKind(null); }}
                className={cn(
                  'flex-1 rounded-md border py-2 text-sm font-medium transition',
                  paymentMode === 'single' && !balanceKind
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
                    setBalanceKind(null);
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

            {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 활성 패키지 미수금(잔금) 안내 + 잔금 프리필 결제.
                §4-A: 패키지 잔금/진료비 잔금 각각 별도 표기·별도 결제(합산 단일표기 금지). */}
            {customerPackage && (pkgBalanceDue > 0 || consultBalanceDue > 0) && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-3 space-y-2" data-testid="payment-balance-panel">
                <div className="text-xs font-semibold text-red-700">미수금 — {customerPackage.package_name}</div>
                {pkgBalanceDue > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">패키지 잔금 <span className="font-bold text-red-600 tabular-nums">{formatAmount(pkgBalanceDue)}</span></span>
                    <Button
                      type="button" size="sm" variant={balanceKind === 'package' ? 'default' : 'outline'}
                      data-testid="btn-pay-package-balance"
                      onClick={() => { setBalanceKind('package'); setPaymentMode('single'); setIsSplit(false); setAmountStr(String(pkgBalanceDue)); if (method === 'membership') setMethod('card'); }}
                    >
                      잔금 결제
                    </Button>
                  </div>
                )}
                {consultBalanceDue > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">진료비 잔금 <span className="opacity-60">(별도)</span> <span className="font-bold text-amber-600 tabular-nums">{formatAmount(consultBalanceDue)}</span></span>
                    <Button
                      type="button" size="sm" variant={balanceKind === 'consultation' ? 'default' : 'outline'}
                      data-testid="btn-pay-consultation-balance"
                      onClick={() => { setBalanceKind('consultation'); setPaymentMode('single'); setIsSplit(false); setAmountStr(String(consultBalanceDue)); if (method === 'membership') setMethod('card'); }}
                    >
                      잔금 결제
                    </Button>
                  </div>
                )}
                {balanceKind && (
                  <div className="flex items-center justify-between rounded bg-white/70 px-2 py-1 text-[11px] text-red-700">
                    <span>{balanceKind === 'package' ? '패키지' : '진료비'} 잔금 결제 모드 — 아래 [잔금 결제]로 기록됩니다</span>
                    <button type="button" className="underline" onClick={() => { setBalanceKind(null); setAmountStr(''); }}>일반 결제로</button>
                  </div>
                )}
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
                  <AmountInput
                    value={splitCardStr}
                    onChange={(raw) => setSplitCardStr(raw)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>현금 금액</Label>
                  <AmountInput
                    value={splitCashStr}
                    onChange={(raw) => setSplitCashStr(raw)}
                    placeholder="0"
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
                {/* T-20260522-foot-PAY-DROPDOWN-LONGRE AC-7:
                    membership 선택 → amountStr·selectedTemplateId 초기화
                    membership 해제 → selectedTemplateId 초기화 */}
                <div className="space-y-2">
                  <Label>결제 수단</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {visibleMethodOptions.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => {
                          if (m.value === 'membership') {
                            // T-20260524-foot-PKG-LABEL-AMOUNT AC-2:
                            // 고객 활성 패키지 회당 단가 auto-fill (총액/총회차, 수동 수정 허용)
                            if (customerPackage && customerPackage.total_sessions > 0) {
                              setAmountStr(String(Math.round(customerPackage.total_amount / customerPackage.total_sessions)));
                            } else {
                              setAmountStr('');
                            }
                            setSelectedTemplateId(null);
                          } else {
                            // 다른 수단으로 바꾸면 패키지 선택 초기화
                            setSelectedTemplateId(null);
                          }
                          setMethod(m.value);
                        }}
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

                {/* T-20260524-foot-PKG-LABEL-AMOUNT AC-2:
                    단건 결제 + 패키지 수단 선택 시 → 고객 활성 패키지 회당 단가 표시 */}
                {method === 'membership' && (
                  <div className={cn(
                    'rounded-md border px-3 py-2 text-sm',
                    customerPackage ? 'border-teal-200 bg-teal-50/40' : 'border-dashed border-muted-foreground/30 bg-muted/10',
                  )}>
                    {customerPackage ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-teal-800">{customerPackage.package_name}</div>
                        <div className="text-xs text-teal-600">
                          회당 단가&nbsp;
                          <span className="tabular-nums font-semibold">
                            {formatAmount(Math.round(customerPackage.total_amount / customerPackage.total_sessions))}
                          </span>
                          <span className="ml-1 text-muted-foreground">
                            (총액 {formatAmount(customerPackage.total_amount)} ÷ {customerPackage.total_sessions}회)
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">보유 패키지 없음 — 금액을 직접 입력하세요</p>
                    )}
                  </div>
                )}

                {/* 금액 */}
                <div className="space-y-2">
                  <Label>금액</Label>
                  <AmountInput
                    value={amountStr}
                    onChange={(raw) => setAmountStr(raw)}
                    placeholder="0"
                    className="text-lg"
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
                    <AmountInput
                      value={taxableAmountStr}
                      onChange={(raw) => setTaxableAmountStr(raw)}
                      placeholder="0"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">비과세(면세) 금액</Label>
                    <AmountInput
                      value={taxExemptAmountStr}
                      onChange={(raw) => setTaxExemptAmountStr(raw)}
                      placeholder="0"
                      className="h-8 text-xs"
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
                : balanceKind
                  ? '잔금 결제'
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
