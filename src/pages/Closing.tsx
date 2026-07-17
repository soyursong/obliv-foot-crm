import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import * as XLSX from 'xlsx';
import {
  Clock,
  CreditCard,
  Download,
  FileDown,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Trash2,
  Unlock,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { isStaffUnlockRole } from '@/lib/permissions';
import { getClinic } from '@/lib/clinic';
import { formatAmount, formatPhone, chartNoBadge } from '@/lib/format';
import { METHOD_KO, STATUS_KO, VISIT_TYPE_KO, staffRoleSortIndex } from '@/lib/status';
// T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL: 일일 미수금 박스 — footBilling outstanding SSOT 재사용(신규 산출 0)
import { loadCustomerOutstanding } from '@/lib/footBilling';
// T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (옵션A): 수기입력 → 정본 write-path 연동(단일 SSOT)
import { recordManualPayment, type ManualPayAttribution, type ManualPayCheckIn } from '@/lib/manualPaymentWritePath';
import type { CheckIn, CheckInStatus, Clinic, Staff, VisitType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PaymentMiniWindow } from '@/components/PaymentMiniWindow';
import { ReceiptUpload } from '@/components/ReceiptUpload';
// T-20260708-foot-REDPAY-CLOSING-TAB: 결제 탭 하위 '레드페이' 하위탭 (카드단말기 자동수집 대조)
import { RedpayReconcileTab } from '@/components/closing/RedpayReconcileTab';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────

type Method = 'card' | 'cash' | 'transfer' | 'membership';
type PaymentType = 'payment' | 'refund';

interface PaymentRow {
  /** T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용 */
  id: string;
  amount: number;
  method: Method;
  payment_type: PaymentType;
  created_at: string;
  customer_id: string | null;
  installment: number | null;
  memo: string | null;
  check_in_id: string | null;
  /** T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE: soft-delete/cancel 상태 */
  status?: string | null;
  /** T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */
  cash_receipt_issued?: boolean | null;
  cash_receipt_type?: string | null;
  taxable_amount?: number | null;
  tax_exempt_amount?: number | null;
  /** T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행 → 원결제행 링크(단건). 환불(refund) 행에서만 채워짐. */
  linked_payment_id?: string | null;
}

interface PackagePaymentRow {
  /** T-20260522-foot-CLOSING-REFUND: package_payments row id */
  id: string;
  /** T-20260522-foot-CLOSING-REFUND: refund_package_atomic에 전달할 packages.id */
  package_id: string;
  amount: number;
  method: 'card' | 'cash' | 'transfer';
  payment_type: PaymentType;
  created_at: string;
  customer_id: string;
  installment: number | null;
  memo: string | null;
  /** T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행 → 원결제행 링크(패키지). 환불(refund) 행에서만 채워짐. */
  parent_payment_id?: string | null;
}

interface UnpaidCheckIn {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  status: string;
  checked_in_at: string;
  // T-20260612-foot-CHARTNO-B2-P2: 경고카드 환자명 단독 노출 0 — 차트번호 인접 표기용 embed(읽기 전용)
  customers?: { chart_number: string | null } | null;
}

interface DailyClosingRow {
  id: string;
  clinic_id: string;
  close_date: string;
  package_card_total: number;
  package_cash_total: number;
  package_transfer_total: number;
  single_card_total: number;
  single_cash_total: number;
  single_transfer_total: number;
  actual_card_total: number;
  actual_cash_total: number;
  actual_transfer_total: number;
  difference: number;
  status: 'open' | 'closed';
  closed_at: string | null;
  memo: string | null;
}

interface CheckInDetail {
  id: string;
  customer_name: string;
  visit_type: string;
  // T-20260522-foot-CLOSING-PAY-3COL: consultant_id 제거 — assigned_staff_id 단일 소스 확정
  customer_id: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  chart_number: string | null;
  // T-20260522-foot-DAILY-SETTLE-STAFF: 2번차트 고객정보 확정
  // lead_source → visit_route (customers.visit_route 실제 컬럼)
  visit_route: string | null;
  // T-20260522-foot-DAILY-SETTLE-STAFF: 초진/재진 — customers.visit_type (2번차트 고객정보)
  visit_type: string | null;
  // T-20260510-foot-C21-STAFF-REVENUE: 담당자 매출 자동연동
  assigned_staff_id: string | null;
}

interface ManualPaymentRow {
  id: string;
  clinic_id: string;
  close_date: string;
  pay_time: string | null;
  chart_number: string | null;
  customer_name: string;
  lead_source: string | null;
  visit_type: string | null;
  staff_name: string | null;
  amount: number;
  method: string;
  memo: string | null;
  created_at: string;
}

/** 결제내역 탭에서 표시되는 통합 행 */
interface EnrichedRow {
  sort_key: string;
  pay_date: string;          // YYYY-MM-DD (날짜 컬럼용)
  pay_time: string;
  chart_number: string | null;
  customer_name: string;
  lead_source: string | null;
  visit_type_label: string;
  staff_name: string | null;
  amount: number;
  method: string;
  payment_type: PaymentType;
  source: 'payment' | 'package' | 'manual';
  manual_id?: string;
  /** 수기 수정용 raw entry */
  manual_raw?: ManualPaymentRow;
  /** T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */
  taxable_amount: number | null;
  tax_exempt_amount: number | null;
  cash_receipt_issued: boolean | null;
  cash_receipt_type: string | null;
  /** T-20260522-foot-CLOSING-REFUND: 환불 처리용 */
  payment_id?: string;       // source === 'payment' 시 payments.id
  // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING: 진료비/단건 heuristic 구분용(payments.check_in_id 유무).
  //   check_in_id 有 → 진료(내원)에 종속된 수납 = '진료비', null → 내원 비종속 별도결제 = '단건'.
  //   ⚠ 확정 비즈니스 카테고리 필드는 스키마에 없음 → planner FOLLOWUP(scenario_missing) 로 구분키 확인 요청.
  //   (표기 label 전용 — money-path(환불 금액)는 행별 amount 로 산출하므로 heuristic 오분류돼도 금액 무영향)
  pay_check_in_id?: string | null;
  package_id?: string;       // source === 'package' 시 packages.id (legacy)
  // T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 선택 결제행 단위 환불(refund_package_payment)용
  pkg_payment_id?: string;   // source === 'package' 시 package_payments.id (환불 대상 결제행)
  row_customer_id?: string;  // 원결제행 customer_id (표시용)
  // ── T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불 = 기존 행 annotate ──
  //   환불행을 별도 빨간 새 행으로 그리지 않고, 원결제행 안에 '환불' 표기 + 두 시각을 병기한다.
  /** 이 행이 환불(refund)이며 원결제행에 병합됨 → 표시 경로에서 렌더 스킵(합계 reduce 에는 그대로 남아 net 유지). */
  merged_refund?: boolean;
  /** 이 행(원결제)이 환불된 결제임 → '환불' 표기 노출. */
  refunded?: boolean;
  /** 환불 신청 시각(원결제행 표시용). 결제 업로드 시각은 기존 pay_date/pay_time. */
  refund_date?: string | null;
  refund_time?: string | null;
  /** 원결제행에 병합된 환불 총액(양수 합). */
  refund_amount?: number;
  /** 환불행 → 원결제행 매칭 키(단건=linked_payment_id / 패키지=parent_payment_id). */
  linked_payment_id?: string | null;
  parent_payment_id?: string | null;
}

const LEAD_SOURCE_OPTIONS = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];
const VISIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: '초진' },
  { value: 'returning', label: '재진' },
];

// ──────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayBoundsISO(date: string): { start: string; end: string } {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

function visitTypeLabel(vt: string | null): string {
  if (!vt) return '-';
  return VISIT_TYPE_KO[vt as VisitType] ?? vt;
}

// ──────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────────────────────

export default function Closing() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  // T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 뷰 전용
  // T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ②: 임시저장·마감확정·재오픈·수기수정·수기매출 원본보기 = 3역할 일괄 해제.
  //   isAdminOrManager(admin||manager) → STAFF_UNLOCK_ROLES(6역할). 동반 RLS 마이그(daily_closings_staff_unlock_6menu)와 FE=RLS 정합.
  //   (변수명 isAdminOrManager 유지 — 마감 쓰기 게이트 의미. canRefund 는 旣 3역할 포함이라 이 set 의 부분집합.)
  const { profile } = useAuth();
  const isAdminOrManager = isStaffUnlockRole(profile?.role);
  // T-20260525-foot-ROLE-PERM-CUSTOM AC-4 → 6MENU ②: 환불 처리도 동일 6역할 set(기존 admin/manager/consultant/coordinator/therapist 포함, +director).
  const canRefund = isAdminOrManager;

  // T-20260525-foot-CLOSING-CALC-BUG AC-1: 탭 상태를 URL hash로 persist
  // 브라우저 새로고침(F5) 시 현재 탭(summary/payments) 유지
  // hash: #payments → "payments" 탭, 그 외 → "summary" 탭 (기본값)
  const tabFromHash = (): 'summary' | 'payments' =>
    location.hash === '#payments' ? 'payments' : 'summary';
  const [tab, setTab] = useState<'summary' | 'payments'>(tabFromHash);
  // T-20260708-foot-REDPAY-CLOSING-TAB: 결제 탭 하위탭 (CRM 수납 / 레드페이). 기본=CRM 수납.
  const [paySubTab, setPaySubTab] = useState<'crm' | 'redpay'>('crm');

  // hash 변경 시(브라우저 앞/뒤 네비게이션) 탭 동기화
  useEffect(() => {
    setTab(tabFromHash());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  // 탭 전환 핸들러: URL hash 업데이트 + 상태 반영
  const handleTabChange = (v: string) => {
    const next = v as 'summary' | 'payments';
    setTab(next);
    navigate(
      { hash: next === 'payments' ? '#payments' : '' },
      { replace: true },
    );
  };
  const [date, setDate] = useState(todayStr());
  const [actualCard, setActualCard] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [actualTransfer, setActualTransfer] = useState(0);
  const [memo, setMemo] = useState('');
  const [payTarget, setPayTarget] = useState<CheckIn | null>(null);
  // T-20260616-foot-CLOSING-PAYWAIT-PMW-SWAP: 같은 checkIn 연속 재결제 시 강제 리마운트 (Dashboard BUG4 패턴)
  const [payAttemptCounter, setPayAttemptCounter] = useState(0);
  const [showManualDialog, setShowManualDialog] = useState(false);
  /** 수기 수정 대상 (null이면 신규 추가 모드) */
  const [manualEditTarget, setManualEditTarget] = useState<ManualPaymentRow | null>(null);
  /** C2-MANAGER-PAYMENT-MAP: 결제내역 담당자 필터 */
  const [staffFilter, setStaffFilter] = useState('');
  /** T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 결제내역 결제수단 필터 ('' = 전체) */
  const [methodFilter, setMethodFilter] = useState('');
  /** T-20260522-foot-CLOSING-REFUND: 환불 처리 대상 결제 행
   *  T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: 단일행 → 고객의 환불 가능 행 묶음(배열).
   *    환불창이 유형별(패키지/진료비/단건) 구분 표기 + 항목 선택(체크박스) UI 로 확장됨. */
  const [refundTarget, setRefundTarget] = useState<EnrichedRow[] | null>(null);

  /** T-20260525-foot-CLOSING-NAV-BUG AC-4: 결제내역 테이블 스크롤 위치 보존 */
  const paymentsTableRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);

  const { data: clinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: () => getClinic(),
  });

  const { start, end } = useMemo(() => dayBoundsISO(date), [date]);

  // ── 단건 결제 ───────────────────────────────────────────────
  const { data: payments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['closing-payments', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        // T-20260522-foot-CLOSING-REFUND: id 추가 (환불 RPC 호출용)
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: linked_payment_id 추가(환불행→원결제행 annotate 매칭용)
        .select('id, amount, method, payment_type, created_at, customer_id, installment, memo, check_in_id, status, cash_receipt_issued, cash_receipt_type, taxable_amount, tax_exempt_amount, linked_payment_id')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
        // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE: 삭제된 수납은 일마감 집계에서 제외
        .neq('status', 'deleted')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
  });

  // ── 패키지 결제 ────────────────────────────────────────────
  const { data: pkgPayments = [] } = useQuery<PackagePaymentRow[]>({
    queryKey: ['closing-pkg-payments', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_payments')
        // T-20260522-foot-CLOSING-REFUND: id, package_id 추가 (환불 RPC 호출용)
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: parent_payment_id 추가(패키지 환불행→원결제행 annotate 매칭용)
        .select('id, package_id, amount, method, payment_type, created_at, customer_id, installment, memo, parent_payment_id')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackagePaymentRow[];
    },
  });

  // ── T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT [FOLD]: 전 기간 환불 합계 ──
  //   AC-B1/AC-B2: 완전환불행 재환불 차단 + 교차일(원결제일≠환불일) 환불 배지.
  //   당일 표시되는 원결제행(payments/package_payments)에 연결된 환불을 '날짜 필터 없이' 조회해
  //   원결제 id 별 누적 환불액을 산출한다(같은날 병합 로직은 당일만 보므로 교차일 누락을 이 쿼리가 보완).
  //   ★ read-only 조회만 — schema/서버/데이터 무접점. 합계(net) reduce 경로는 건드리지 않음(무회귀).
  const origPayIds = useMemo(
    () => payments.filter(p => p.payment_type !== 'refund').map(p => p.id),
    [payments],
  );
  const origPkgPayIds = useMemo(
    () => pkgPayments.filter(p => p.payment_type !== 'refund').map(p => p.id),
    [pkgPayments],
  );
  const { data: refundTotalsAllDates = {} } = useQuery<Record<string, number>>({
    queryKey: ['closing-refund-alldates', clinic?.id, origPayIds, origPkgPayIds],
    enabled: !!clinic && (origPayIds.length > 0 || origPkgPayIds.length > 0),
    queryFn: async () => {
      const map: Record<string, number> = {};
      if (origPayIds.length > 0) {
        const { data } = await supabase
          .from('payments')
          .select('linked_payment_id, amount')
          .eq('clinic_id', clinic!.id)
          .eq('payment_type', 'refund')
          .neq('status', 'deleted')
          .in('linked_payment_id', origPayIds);
        for (const r of (data ?? []) as { linked_payment_id: string | null; amount: number | null }[]) {
          if (r.linked_payment_id) map[`pay:${r.linked_payment_id}`] = (map[`pay:${r.linked_payment_id}`] ?? 0) + (r.amount ?? 0);
        }
      }
      if (origPkgPayIds.length > 0) {
        const { data } = await supabase
          .from('package_payments')
          .select('parent_payment_id, amount')
          .eq('clinic_id', clinic!.id)
          .eq('payment_type', 'refund')
          .in('parent_payment_id', origPkgPayIds);
        for (const r of (data ?? []) as { parent_payment_id: string | null; amount: number | null }[]) {
          if (r.parent_payment_id) map[`pkg:${r.parent_payment_id}`] = (map[`pkg:${r.parent_payment_id}`] ?? 0) + (r.amount ?? 0);
        }
      }
      return map;
    },
  });

  // ── 미수 ────────────────────────────────────────────────────
  const { data: unpaid = [] } = useQuery<UnpaidCheckIn[]>({
    queryKey: ['closing-unpaid', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at, customers(chart_number)')
        .eq('clinic_id', clinic!.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // T-20260612-foot-CHARTNO-B2-P2: supabase embed customers는 배열로 추론 → unknown 경유 캐스트
      return (data ?? []) as unknown as UnpaidCheckIn[];
    },
  });

  // ── 일일 미수금 (T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL) ──────────────
  //   당일(date) payment_waiting 체크인 고객의 미수금을 footBilling SSOT(loadCustomerOutstanding)로 재사용.
  //   "당일" 윈도잉 = 화면 date 기준 미결제 체크인 고객. 금액 정의(패키지/진료비 분리)는
  //   PKG-OUTSTANDING-BALANCE §4-A를 따른다 — 합산 단일 '총 미수금' 산출/표기 금지. 신규 쿼리 외 산출 로직 0.
  const { data: dailyOutstanding = { packageDue: 0, consultationDue: 0, dueCustomerCount: 0 } } = useQuery<{
    packageDue: number; consultationDue: number; dueCustomerCount: number;
  }>({
    queryKey: ['closing-daily-outstanding', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('customer_id')
        .eq('clinic_id', clinic!.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (error) throw error;
      const ids = [...new Set(
        (data ?? [])
          .map((r: { customer_id: string | null }) => r.customer_id)
          .filter(Boolean) as string[],
      )];
      if (ids.length === 0) return { packageDue: 0, consultationDue: 0, dueCustomerCount: 0 };
      const map = await loadCustomerOutstanding(ids, clinic!.id);
      let packageDue = 0;
      let consultationDue = 0;
      let dueCustomerCount = 0;
      for (const o of map.values()) {
        const pd = o.packageDue ?? 0;
        const cd = o.consultationDue ?? 0;
        if (pd > 0 || cd > 0) dueCustomerCount += 1;
        packageDue += pd;
        consultationDue += cd;
      }
      return { packageDue, consultationDue, dueCustomerCount };
    },
  });

  // ── 시술별 통계 (raw 시술 항목) ─────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3:
  //   is_package_session=true 항목 제외 — 패키지 차감 세션은 이미 결제된 건
  // T-20260715-foot-DAYCLOSE-STAT-PAYONLY:
  //   집계(paid 필터·revenue 합산)는 아래 procedureStats useMemo로 이동.
  //   이 쿼리는 당일 체크인의 시술 raw 행만 조회한다.
  const { data: procedureServicesRaw = [] } = useQuery<{ service_name: string; price: number; check_in_id: string | null; is_package_session?: boolean | null }[]>({
    queryKey: ['closing-procedures', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_in_services')
        // is_package_session·check_in_id 포함해 JS에서 필터링 (null 안전성)
        .select('service_name, price, check_in_id, is_package_session')
        .in('check_in_id', (await supabase
          .from('check_ins')
          .select('id')
          .eq('clinic_id', clinic!.id)
          .gte('checked_in_at', start)
          .lte('checked_in_at', end)
          .then(r => (r.data ?? []).map((d: { id: string }) => d.id))
        ));
      if (error) throw error;
      return (data ?? []) as { service_name: string; price: number; check_in_id: string | null; is_package_session?: boolean | null }[];
    },
  });

  // ── 실수납/결제 confirmed 체크인 집합 (net>0) ────────────────
  // T-20260715-foot-DAYCLOSE-STAT-PAYONLY (A안, 김주연 총괄 결정):
  //   시술별 통계는 '완료' 상태 전환만으로는 집계하지 않고 실제 수납/결제된 건만 집계한다.
  //   AC-4 RC 확정: 환불은 payments 별도 행(payment_type='refund')으로 저장 → check_in별
  //   net = Σ(payment.amount) − Σ(refund.amount). net>0 기준(b) 채택.
  //   (payment 레코드 존재(a)는 F-4714(net=0 환불건)를 걸러내지 못하므로 부적합.)
  const paidCheckInIds = useMemo(() => {
    const net = new Map<string, number>();
    for (const p of payments) {
      if (!p.check_in_id) continue;
      net.set(p.check_in_id, (net.get(p.check_in_id) ?? 0) + (p.payment_type === 'refund' ? -p.amount : p.amount));
    }
    const set = new Set<string>();
    for (const [id, amt] of net) if (amt > 0) set.add(id);
    return set;
  }, [payments]);

  // ── 시술별 통계 (paid 필터 후 집계) ─────────────────────────
  const procedureStats = useMemo<{ service_name: string; count: number; revenue: number }[]>(() => {
    const byName: Record<string, { count: number; revenue: number }> = {};
    for (const row of procedureServicesRaw) {
      // T-20260519-foot-PKG-REVENUE-SPLIT: 패키지 세션 항목 제외
      if (row.is_package_session === true) continue;
      // T-20260715-foot-DAYCLOSE-STAT-PAYONLY: 실수납/결제 confirmed(net>0) 체크인만 집계
      if (!row.check_in_id || !paidCheckInIds.has(row.check_in_id)) continue;
      const entry = byName[row.service_name] ??= { count: 0, revenue: 0 };
      entry.count++;
      entry.revenue += row.price;
    }
    return Object.entries(byName)
      .map(([service_name, { count, revenue }]) => ({ service_name, count, revenue }))
      .sort((a, b) => b.count - a.count);
  }, [procedureServicesRaw, paidCheckInIds]);

  // ── 체크인 상세 (결제내역 탭용 enriched) ──────────────────
  const { data: checkInsDetail = [] } = useQuery<CheckInDetail[]>({
    queryKey: ['closing-checkin-detail', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, visit_type, customer_id')
        // T-20260522-foot-CLOSING-PAY-3COL: consultant_id 제거 — assigned_staff_id 단일 소스
        .eq('clinic_id', clinic!.id)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (error) throw error;
      return (data ?? []) as CheckInDetail[];
    },
  });

  // ── 체크인 고객 ID 수집 ────────────────────────────────────
  const customerIds = useMemo(() => {
    const ids = new Set<string>();
    payments.forEach(p => { if (p.customer_id) ids.add(p.customer_id); });
    pkgPayments.forEach(p => { if (p.customer_id) ids.add(p.customer_id); });
    checkInsDetail.forEach(c => { if (c.customer_id) ids.add(c.customer_id); });
    return [...ids].sort();
  }, [payments, pkgPayments, checkInsDetail]);

  // ── 고객 기본정보 ──────────────────────────────────────────
  const { data: customersBasic = [] } = useQuery<CustomerBasic[]>({
    queryKey: ['closing-customers', clinic?.id, customerIds.join(',')],
    enabled: !!clinic && customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, chart_number, visit_route, visit_type, assigned_staff_id')
        .in('id', customerIds);
      if (error) throw error;
      return (data ?? []) as CustomerBasic[];
    },
  });

  // ── 직원 목록 (결제담당 조회) ──────────────────────────────
  // T-20260522-foot-CLOSING-STAFF-DROP: 2번차트 1구역 담당자 드롭과 동일 쿼리/필터/정렬
  // 2번차트: .in('role', ['consultant','coordinator','director','therapist']).order('name')
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff', clinic?.id, 'closing'],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        // T-20260523-foot-PKG-DEDUCT-THERAPIST bugfix: display_name 컬럼 미존재 → 400 에러 방지
        // display_name은 UI에서 || name fallback으로 처리. migration 적용 전까지 select 제외.
        .select('id, name, role, clinic_id, active, created_at')
        .eq('clinic_id', clinic!.id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director', 'therapist'])
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  // ── 수기 결제내역 ──────────────────────────────────────────
  const { data: manualEntries = [] } = useQuery<ManualPaymentRow[]>({
    queryKey: ['closing-manual', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      // T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE: soft-void 무효행 제외(합산경로 (a) 일마감 grossTotal).
      //   voided_at IS NULL = 유효행만 로드 → totals(grossTotal)/enrichedRows/daily_closings payload 전부 무효행 배제.
      //   forward 프리미티브 배포 시점 전건 voided_at=NULL → 합계 불변(net-zero).
      const { data, error } = await supabase
        .from('closing_manual_payments')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
        .is('voided_at', null)
        .order('pay_time', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as ManualPaymentRow[];
    },
  });

  // ── 진행 중 체크인 (마감 전 경고용) ────────────────────────
  const { data: inProgress = [] } = useQuery<UnpaidCheckIn[]>({
    queryKey: ['closing-in-progress', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at, customers(chart_number)')
        .eq('clinic_id', clinic!.id)
        .not('status', 'in', '("done","cancelled","payment_waiting")')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // T-20260612-foot-CHARTNO-B2-P2: supabase embed customers는 배열로 추론 → unknown 경유 캐스트
      return (data ?? []) as unknown as UnpaidCheckIn[];
    },
  });

  // ── 기존 마감 레코드 ────────────────────────────────────────
  const { data: existing } = useQuery<DailyClosingRow | null>({
    queryKey: ['closing', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_closings')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as DailyClosingRow | null) ?? null;
    },
  });

  // ── 기존 마감 데이터로 폼 초기화 ────────────────────────────
  useEffect(() => {
    if (existing) {
      setActualCard(existing.actual_card_total ?? 0);
      setActualCash(existing.actual_cash_total ?? 0);
      setActualTransfer(existing.actual_transfer_total ?? 0);
      setMemo(existing.memo ?? '');
    } else {
      setActualCard(0);
      setActualCash(0);
      setActualTransfer(0);
      setMemo('');
    }
  }, [existing, date]);

  // ── Realtime: 결제·패키지결제·수기 변경 시 즉시 새로고침 ────
  // 데스크/상담실에서 결제가 들어오면 일마감 화면이 실시간 갱신됨
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase.channel(`closing-${clinic.id}-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['closing-payments', clinic.id, date] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_payments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['closing-pkg-payments', clinic.id, date] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_manual_payments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['closing-manual', clinic.id, date] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinic, date, qc]);

  // ── 합계 계산 ───────────────────────────────────────────────
  // T-20260525-foot-CLOSING-SUM-ERR 수정:
  //   구 코드는 manualEntries(수기결제)를 totals에서 누락 → 총합계 ≠ 결제내역 SUM.
  //   수기결제는 enrichedRows에는 포함되어 결제내역 탭에는 정상 표시됐지만,
  //   totals useMemo의 [payments, pkgPayments] dep array에 manualEntries 없어 grossTotal 미반영.
  //   Fix: manualCard/Cash/Transfer를 합산, manualEntries를 dep에 추가.
  //
  // T-20260525-foot-CLOSING-CALC-BUG 수정:
  //   fab1ad6(T-20260522-foot-CLOSING-REFUND)에서 refund_single_payment RPC 도입 후
  //   SummaryCard "합계" 행에 ['환불(차감 포함)', -refundAmount]를 추가했는데,
  //   sum() 헬퍼가 이미 환불을 차감해 totalCard/Cash/Transfer는 NET값임.
  //   → 환불이 이중 차감되어 표시행 합계(NET + -환불) ≠ grossTotal(NET) → 금액 불일치 표시.
  //
  //   Fix 전략: sum() = NET (환불 차감) — reconciliation(실제 정산)용
  //              sumGross() = GROSS (환불 미차감) — SummaryCard 표시행용
  //   SummaryCard "합계" rows: GROSS + ['환불', -refundAmount] → 합계 = NET = grossTotal ✓
  const totals = useMemo(() => {
    // NET sum: 환불 차감 포함 — reconciliation 및 DB 저장용
    const sum = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter(r => r.method === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    // GROSS sum: 결제(payment)행만 — SummaryCard 표시행용 (환불 행 제외)
    const sumGross = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter(r => r.method === method && r.payment_type !== 'refund')
        .reduce((s, r) => s + r.amount, 0);

    // NET (reconciliation/DB)
    const pkgCard     = sum(pkgPayments, 'card');
    const pkgCash     = sum(pkgPayments, 'cash');
    const pkgTransfer = sum(pkgPayments, 'transfer');
    const singleCard      = sum(payments, 'card');
    const singleCash      = sum(payments, 'cash');
    const singleTransfer  = sum(payments, 'transfer');
    const singleMembership = sum(payments, 'membership');

    // GROSS (display)
    const pkgCardGross     = sumGross(pkgPayments, 'card');
    const pkgCashGross     = sumGross(pkgPayments, 'cash');
    const pkgTransferGross = sumGross(pkgPayments, 'transfer');
    const singleCardGross     = sumGross(payments, 'card');
    const singleCashGross     = sumGross(payments, 'cash');
    const singleTransferGross = sumGross(payments, 'transfer');

    // T-20260526-foot-CLOSING-PAYCOUNT: 건 수 — SummaryCard 결제수단별 건 수 표기
    const countGross = (rows: { method: string; payment_type: PaymentType }[], method: string) =>
      rows.filter(r => r.method === method && r.payment_type !== 'refund').length;
    const countRefund = (rows: { payment_type: PaymentType }[]) =>
      rows.filter(r => r.payment_type === 'refund').length;

    // 패키지 결제 건 수 (GROSS: 결제만, 환불 제외)
    const pkgCardCount     = countGross(pkgPayments, 'card');
    const pkgCashCount     = countGross(pkgPayments, 'cash');
    const pkgTransferCount = countGross(pkgPayments, 'transfer');
    const pkgRefundCount   = countRefund(pkgPayments);

    // 단건 결제 건 수
    const singleCardCount     = countGross(payments, 'card');
    const singleCashCount     = countGross(payments, 'cash');
    const singleTransferCount = countGross(payments, 'transfer');
    const singleRefundCount   = countRefund(payments);

    // 수기결제: manual entries는 항상 payment_type='payment' (환불 없음) — 직접 합산
    const manualCard     = manualEntries.filter(m => m.method === 'card').reduce((s, m) => s + m.amount, 0);
    const manualCash     = manualEntries.filter(m => m.method === 'cash').reduce((s, m) => s + m.amount, 0);
    const manualTransfer = manualEntries.filter(m => m.method === 'transfer').reduce((s, m) => s + m.amount, 0);
    const manualTotal    = manualCard + manualCash + manualTransfer;

    // 수기결제 건 수
    const manualCardCount     = manualEntries.filter(m => m.method === 'card').length;
    const manualCashCount     = manualEntries.filter(m => m.method === 'cash').length;
    const manualTransferCount = manualEntries.filter(m => m.method === 'transfer').length;

    // 합계 건 수
    const totalCardCount     = pkgCardCount + singleCardCount + manualCardCount;
    const totalCashCount     = pkgCashCount + singleCashCount + manualCashCount;
    const totalTransferCount = pkgTransferCount + singleTransferCount + manualTransferCount;
    const totalRefundCount   = pkgRefundCount + singleRefundCount;

    // NET totals (reconciliation/DB저장)
    const totalCard     = pkgCard + singleCard + manualCard;
    const totalCash     = pkgCash + singleCash + manualCash;
    const totalTransfer = pkgTransfer + singleTransfer + manualTransfer;

    // GROSS totals (SummaryCard 표시용)
    const totalCardGross     = pkgCardGross + singleCardGross + manualCard;
    const totalCashGross     = pkgCashGross + singleCashGross + manualCash;
    const totalTransferGross = pkgTransferGross + singleTransferGross + manualTransfer;

    // 환불 합계 (절댓값)
    const refundSingleAmount =
      payments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    const refundPkgAmount =
      pkgPayments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    const refundAmount = refundSingleAmount + refundPkgAmount;

    // T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3:
    // grossTotal에서 singleMembership 제외.
    // 'membership' method = 전액 패키지 차감건(amount=0 마커) 또는 구형 패키지차감건
    // 패키지는 최초 구매 시점(package_payments)에 이미 집계됨 → 차감 시점에 재집계 불가
    // grossTotal = NET (환불 차감 후, membership 제외) — reconciliation 기준점
    const grossTotal = totalCard + totalCash + totalTransfer;

    return {
      // NET (reconciliation/DB)
      pkgCard, pkgCash, pkgTransfer,
      singleCard, singleCash, singleTransfer, singleMembership,
      totalCard, totalCash, totalTransfer,
      // GROSS (SummaryCard 표시)
      pkgCardGross, pkgCashGross, pkgTransferGross,
      singleCardGross, singleCashGross, singleTransferGross,
      totalCardGross, totalCashGross, totalTransferGross,
      // Manual (공통)
      manualCard, manualCash, manualTransfer, manualTotal,
      manualCardCount, manualCashCount, manualTransferCount,
      // 환불
      refundAmount, refundSingleAmount, refundPkgAmount,
      // 합계
      grossTotal,
      // T-20260526-foot-CLOSING-PAYCOUNT: 건 수
      pkgCardCount, pkgCashCount, pkgTransferCount, pkgRefundCount,
      singleCardCount, singleCashCount, singleTransferCount, singleRefundCount,
      totalCardCount, totalCashCount, totalTransferCount, totalRefundCount,
    };
  }, [payments, pkgPayments, manualEntries]);

  const cardDiff = actualCard - totals.totalCard;
  const cashDiff = actualCash - totals.totalCash;
  const transferDiff = actualTransfer - totals.totalTransfer;
  const totalDiff = cardDiff + cashDiff + transferDiff;
  const isClosed = existing?.status === 'closed';

  // ── 조회 맵 ────────────────────────────────────────────────
  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerBasic>();
    for (const c of customersBasic) map.set(c.id, c);
    return map;
  }, [customersBasic]);

  // T-20260522-foot-STAFF-NAME-UNIFY: id → display_name(구성명) fallback to name
  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffList) map.set(s.id, s.display_name || s.name);
    return map;
  }, [staffList]);

  const checkInDetailMap = useMemo(() => {
    const map = new Map<string, CheckInDetail>();
    for (const c of checkInsDetail) map.set(c.id, c);
    return map;
  }, [checkInsDetail]);

  // ── 통합 결제내역 (enriched) ────────────────────────────────
  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    const rows: EnrichedRow[] = [];

    // 단건 결제
    for (const p of payments) {
      const ci = p.check_in_id ? checkInDetailMap.get(p.check_in_id) : null;
      const customerId = p.customer_id ?? ci?.customer_id ?? null;
      const cust = customerId ? customerMap.get(customerId) : null;
      // T-20260522-foot-CLOSING-PAY-3COL: 결제담당자 = customers.assigned_staff_id (2번차트 1구역 담당자 드롭 단일 소스)
      // consultant_id 혼재 제거 — 현장 확정 2026-05-22
      const payStaffId = cust?.assigned_staff_id ?? null;
      const consultantName = payStaffId ? (staffMap.get(payStaffId) ?? null) : null;
      const customerName = ci?.customer_name ?? cust?.name ?? '-';
      const dt = new Date(p.created_at);

      rows.push({
        sort_key: p.created_at,
        pay_date: format(dt, 'yyyy-MM-dd'),
        pay_time: format(dt, 'HH:mm'),
        chart_number: cust?.chart_number ?? null,
        customer_name: customerName,
        // T-20260522-foot-DAILY-SETTLE-STAFF: 내원경로=customers.visit_route, 초진재진=customers.visit_type
        lead_source: cust?.visit_route ?? null,
        visit_type_label: visitTypeLabel(cust?.visit_type ?? null),
        staff_name: consultantName,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'payment',
        // T-20260515-foot-RECEIPT-TAX-SPLIT AC-4
        taxable_amount: p.taxable_amount ?? null,
        tax_exempt_amount: p.tax_exempt_amount ?? null,
        cash_receipt_issued: p.cash_receipt_issued ?? null,
        cash_receipt_type: p.cash_receipt_type ?? null,
        // T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용
        payment_id: p.id,
        // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING: 진료비/단건 heuristic(check_in_id 유무)
        pay_check_in_id: p.check_in_id ?? null,
        row_customer_id: p.customer_id ?? undefined,
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행→원결제행 매칭 키
        linked_payment_id: p.linked_payment_id ?? null,
      });
    }

    // 패키지 결제 — T-20260510-foot-C21-STAFF-REVENUE: 담당자 자동연동
    for (const p of pkgPayments) {
      const cust = p.customer_id ? customerMap.get(p.customer_id) : null;
      const dt = new Date(p.created_at);
      const assignedStaffName = cust?.assigned_staff_id ? (staffMap.get(cust.assigned_staff_id) ?? null) : null;
      rows.push({
        sort_key: p.created_at,
        pay_date: format(dt, 'yyyy-MM-dd'),
        pay_time: format(dt, 'HH:mm'),
        chart_number: cust?.chart_number ?? null,
        customer_name: cust?.name ?? '-',
        // T-20260522-foot-DAILY-SETTLE-STAFF: 내원경로=customers.visit_route, 초진재진=customers.visit_type
        lead_source: cust?.visit_route ?? null,
        visit_type_label: visitTypeLabel(cust?.visit_type ?? null),
        staff_name: assignedStaffName,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'package',
        taxable_amount: null,
        tax_exempt_amount: null,
        cash_receipt_issued: null,
        cash_receipt_type: null,
        // T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용
        package_id: p.package_id,
        // T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 선택 결제행 단위 환불 대상 = 이 package_payments row
        pkg_payment_id: p.id,
        row_customer_id: p.customer_id,
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 패키지 환불행→원결제행 매칭 키
        parent_payment_id: p.parent_payment_id ?? null,
      });
    }

    // 수기 추가
    for (const m of manualEntries) {
      rows.push({
        sort_key: m.close_date + 'T' + (m.pay_time ?? '00:00') + ':00+09:00',
        pay_date: m.close_date,
        pay_time: m.pay_time ?? '-',
        chart_number: m.chart_number,
        customer_name: m.customer_name,
        lead_source: m.lead_source,
        visit_type_label: visitTypeLabel(m.visit_type),
        staff_name: m.staff_name,
        amount: m.amount,
        method: m.method,
        payment_type: 'payment',
        source: 'manual',
        manual_id: m.id,
        manual_raw: m,
        taxable_amount: null,
        tax_exempt_amount: null,
        cash_receipt_issued: null,
        cash_receipt_type: null,
      });
    }

    // ── T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불 = 기존 행 annotate ──────
    //   환불(refund) 행을 별도 빨간 새 행으로 그리지 않고, 원결제행에 '환불' 표기 + 환불 신청 시각을
    //   병기한다. 매칭: 단건=linked_payment_id→payment_id / 패키지=parent_payment_id→pkg_payment_id.
    //   ★ 합계 불변식: 병합해도 refund 행은 rows 배열에 그대로 남긴다(merged_refund 플래그만 세팅) →
    //     모든 합계 reduce(payment_type==='refund'?-amount:amount)는 net 값을 그대로 유지(회귀 0).
    //     표시 경로(.map/Excel/PDF)에서만 merged_refund 행을 스킵한다.
    //   ★ 데이터 무손실: 원결제행이 당일 목록에 없는 '고아 환불'(과거일 결제 환불 등)은 병합하지 않고
    //     기존처럼 자체 행으로 렌더(regression-safe fallback).
    const originalByPaymentId = new Map<string, EnrichedRow>();
    const originalByPkgPaymentId = new Map<string, EnrichedRow>();
    for (const r of rows) {
      if (r.payment_type === 'refund') continue;
      if (r.source === 'payment' && r.payment_id) originalByPaymentId.set(r.payment_id, r);
      if (r.source === 'package' && r.pkg_payment_id) originalByPkgPaymentId.set(r.pkg_payment_id, r);
    }
    for (const r of rows) {
      if (r.payment_type !== 'refund') continue;
      const orig =
        r.source === 'payment' && r.linked_payment_id
          ? originalByPaymentId.get(r.linked_payment_id)
          : r.source === 'package' && r.parent_payment_id
          ? originalByPkgPaymentId.get(r.parent_payment_id)
          : undefined;
      if (!orig) continue; // 고아 환불 → 자체 행 유지(fallback)
      r.merged_refund = true;                 // 표시에서 스킵(합계 reduce 에는 잔존)
      orig.refunded = true;
      orig.refund_amount = (orig.refund_amount ?? 0) + r.amount;
      // 마지막(최신) 환불 신청 시각을 원결제행에 표기
      orig.refund_date = r.pay_date;
      orig.refund_time = r.pay_time;
    }

    rows.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    return rows;
  }, [payments, pkgPayments, manualEntries, checkInDetailMap, customerMap, staffMap]);

  // ── T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: 환불 상태 헬퍼 ──
  //   전 기간(교차일 포함) 누적 환불액 / 완전환불 판정 / 고객 단위 환불행 묶기.
  const refundedTotalForRow = (r: EnrichedRow): number => {
    if (r.source === 'payment' && r.payment_id) return refundTotalsAllDates[`pay:${r.payment_id}`] ?? 0;
    if (r.source === 'package' && r.pkg_payment_id) return refundTotalsAllDates[`pkg:${r.pkg_payment_id}`] ?? 0;
    return 0;
  };
  // AC-B1: 잔여 환불가능 0(원결제 ≤ 누적 환불) → 완전환불 = 재환불 불가.
  const isFullyRefunded = (r: EnrichedRow): boolean =>
    (r.source === 'payment' || r.source === 'package') && r.amount > 0 && refundedTotalForRow(r) >= r.amount;
  // 환불창 오픈 시 같은 고객(row_customer_id)의 환불 가능 결제행(payment/package, 환불행 제외) 묶음.
  //   row_customer_id 없으면(고객 미매칭 payment 등) 해당 행 단독.
  const gatherCustomerRefundRows = (r: EnrichedRow): EnrichedRow[] => {
    if (!r.row_customer_id) return [r];
    const set = enrichedRows.filter(
      x =>
        (x.source === 'payment' || x.source === 'package') &&
        x.payment_type !== 'refund' &&
        x.row_customer_id === r.row_customer_id,
    );
    return set.length > 0 ? set : [r];
  };

  // C2-MANAGER-PAYMENT-MAP: 담당자 필터 적용
  // T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' 통일
  // T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 담당자 + 결제수단 AND 결합
  const filteredEnrichedRows = useMemo<EnrichedRow[]>(() => {
    if (!staffFilter && !methodFilter) return enrichedRows;
    return enrichedRows.filter(r =>
      (!staffFilter || (r.staff_name ?? '미지정') === staffFilter) &&
      (!methodFilter || r.method === methodFilter)
    );
  }, [enrichedRows, staffFilter, methodFilter]);

  // ── T-20260715-foot-DAYCLOSE-LIST-PATIENT-GROUP: 동일 환자(차트번호+성함) 건 그룹 묶음 ──
  //   현장(김주연 총괄) 요청: 결제 시각순으로 흩어진 동일 환자 건을 최초 결제 시각 아래로 묶어 표시.
  //   ★ 순수 표시(render) 재배열 — 합계/집계 reduce 는 filteredEnrichedRows 를 그대로 사용하므로 숫자 무회귀.
  //   ★ Excel/PDF(exportExcel/handlePrint)는 enrichedRows(시간순) 그대로 → 출력물 형식 무변경(AC11).
  //   ★ 병합된 환불행(merged_refund)은 표시 스킵 규칙을 유지한 채 그룹화(REFUNDROW reconcile).
  //   그룹 키: chart_number + customer_name (chart_number null → customer_name 만으로 그룹).
  //   filteredEnrichedRows 는 이미 sort_key(pay_time) 오름차순 → Map 삽입순 = 그룹 최초시각 오름차순,
  //   그룹 내부 = 등장순 = 시각 오름차순(AC2/AC3 자동 충족).
  const groupedDisplayRows = useMemo<Array<{ row: EnrichedRow; indexInGroup: number; groupSize: number }>>(() => {
    const display = filteredEnrichedRows.filter(r => !r.merged_refund);
    // key: null-char 구분자로 chart_number 접두 → chart null(빈 접두)과 chart 값 절대 충돌 없음.
    // chart null 이면 접두가 빈 문자열 → customer_name 만으로 그룹화(AC9).
    const groups = new Map<string, EnrichedRow[]>();
    for (const r of display) {
      const key = `${r.chart_number ?? ''}\u0000${r.customer_name}`;
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    const flat: Array<{ row: EnrichedRow; indexInGroup: number; groupSize: number }> = [];
    for (const g of groups.values()) {
      g.forEach((row, idx) => flat.push({ row, indexInGroup: idx, groupSize: g.length }));
    }
    return flat;
  }, [filteredEnrichedRows]);

  // ── AC-4: 자동 갱신 시 결제내역 스크롤 위치 보존 ──────────────
  // T-20260525-foot-CLOSING-NAV-BUG:
  //   qc.invalidateQueries → 데이터 갱신 → filteredEnrichedRows 변경 →
  //   useLayoutEffect 실행(paint 전) → scrollTop 복원 → 시각적 점프 없음
  useLayoutEffect(() => {
    const el = paymentsTableRef.current;
    if (!el) return;
    el.scrollTop = scrollTopRef.current;
  }, [filteredEnrichedRows]);

  // T-20260522-foot-DAILY-SETTLE-STAFF AC-2: 담당자별 매출 집계 — 카드/현금/이체 소계 추가
  // AC-3: NULL staff_id → '미지정' 표시 (enrichedRows 기준 — 필터 무관)
  const staffTotals = useMemo<Array<{ name: string; total: number; card: number; cash: number; transfer: number }>>(() => {
    const map = new Map<string, { name: string; total: number; card: number; cash: number; transfer: number }>();
    for (const r of enrichedRows) {
      const key = r.staff_name ?? '미지정';
      const existing = map.get(key) ?? { name: key, total: 0, card: 0, cash: 0, transfer: 0 };
      const amt = r.payment_type === 'refund' ? -r.amount : r.amount;
      existing.total += amt;
      if (r.method === 'card' || r.method === 'membership') existing.card += amt;
      else if (r.method === 'cash') existing.cash += amt;
      else if (r.method === 'transfer') existing.transfer += amt;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [enrichedRows]);

  // ── T-20260717-foot-CLOSING-REFUND-STATS-MISSING: 금일 환불 별도 집계 섹션(표시 전용) ──
  //   [REOPEN 실제 요구] '차감 여부'는 이미 정상(refundAmount가 grossTotal에서 NET 차감).
  //   본 작업은 환불 건을 '별도 집계 섹션'으로 노출만 추가한다(additive display).
  //   ★ 환불 식별·금액은 확정 소스 재사용: enrichedRows 의 payment_type==='refund' 행
  //     (단건=payments / 패키지=package_payments, payment_type='refund') — 새 산식 발명 0.
  //   ★ 합계·차감·담당자별 로직 무접점 — refundRows 는 표시용 파생값일 뿐(reduce 경로 불변).
  //   ★ merged_refund(원결제행에 병합 표시된 환불) 포함 — 병합은 '결제내역 목록' 표기 규칙일 뿐
  //     환불 집계에서는 모든 refund 행을 세야 totals.refundAmount/totalRefundCount 와 정합(AC-R4).
  const refundRows = useMemo<EnrichedRow[]>(
    () =>
      enrichedRows
        .filter(r => r.payment_type === 'refund')
        .sort((a, b) => a.sort_key.localeCompare(b.sort_key)),
    [enrichedRows],
  );

  // ── 핸들러 ────────────────────────────────────────────────
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['closing', clinic?.id, date] });
  };

  const refreshPayments = () => {
    qc.invalidateQueries({ queryKey: ['closing-payments', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-pkg-payments', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-manual', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-unpaid', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-checkin-detail', clinic?.id, date] });
  };

  const saveDraft = async (close: boolean) => {
    if (!clinic) return;
    const payload = {
      clinic_id: clinic.id,
      close_date: date,
      package_card_total: totals.pkgCard,
      package_cash_total: totals.pkgCash,
      package_transfer_total: totals.pkgTransfer,
      single_card_total: totals.singleCard,
      single_cash_total: totals.singleCash,
      single_transfer_total: totals.singleTransfer,
      actual_card_total: actualCard,
      actual_cash_total: actualCash,
      actual_transfer_total: actualTransfer,
      difference: totalDiff,
      status: close ? 'closed' : 'open',
      closed_at: close ? new Date().toISOString() : null,
      memo: memo || null,
    };
    let error;
    if (existing) {
      ({ error } = await supabase.from('daily_closings').update(payload).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('daily_closings').insert(payload));
    }
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(close ? '마감 완료' : '저장 완료');
    refresh();
  };

  const reopen = async () => {
    if (!existing) return;
    const { error } = await supabase
      .from('daily_closings')
      .update({ status: 'open', closed_at: null })
      .eq('id', existing.id);
    if (error) { toast.error(`재오픈 실패: ${error.message}`); return; }
    toast.success('재오픈');
    refresh();
  };

  // ── CSV 내보내기 (총 합계 탭) ─────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT: grossTotal은 패키지차감(membership) 제외
  // T-20260525-foot-CLOSING-CALC-BUG: GROSS 표시 + 환불 별도 행 → 행합계 = NET(grossTotal) ✓
  const exportCSV = () => {
    const rows = [
      ['구분', '카드(GROSS)', '현금(GROSS)', '이체(GROSS)', '패키지차감(매출제외)', '매출합계(NET)'],
      ['패키지구매', totals.pkgCardGross, totals.pkgCashGross, totals.pkgTransferGross, 0,
        totals.pkgCard + totals.pkgCash + totals.pkgTransfer],
      ['단건', totals.singleCardGross, totals.singleCashGross, totals.singleTransferGross, totals.singleMembership,
        totals.singleCard + totals.singleCash + totals.singleTransfer],
      ['합계(멤버십제외)', totals.totalCardGross, totals.totalCashGross, totals.totalTransferGross, totals.singleMembership, totals.grossTotal],
      ['환불(차감)', -totals.refundSingleAmount, '', '', '', -totals.refundPkgAmount],
      [],
      ['정산', '시스템(NET)', '실제', '차이'],
      ['카드', totals.totalCard, actualCard, cardDiff],
      ['현금', totals.totalCash, actualCash, cashDiff],
      ['이체', totals.totalTransfer, actualTransfer, transferDiff],
      ['총 차이', '', '', totalDiff],
      [],
      ['환불합계', totals.refundAmount],
      ['  └단건환불', totals.refundSingleAmount],
      ['  └패키지환불', totals.refundPkgAmount],
      ['미수건수', unpaid.length],
    ];
    if (memo) rows.push([], ['메모', memo]);
    const bom = '﻿';
    const escapeCell = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = bom + rows.map(r => r.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `마감_총합계_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV 다운로드 완료');
  };

  // ── Excel 내보내기 (결제내역 탭) ──────────────────────────
  const exportExcel = () => {
    const header = ['날짜', '시간', '차트번호', '성함', '내원경로', '초진/재진', '결제담당', '결제금액', '결제수단', '구분'];
    const dataRows = enrichedRows.map(r => [
      r.pay_date,
      r.pay_time,
      r.chart_number ?? '',
      r.customer_name,
      r.lead_source ?? '',
      r.visit_type_label,
      r.staff_name ?? '',
      r.payment_type === 'refund' ? -r.amount : r.amount,
      METHOD_KO[r.method] ?? r.method,
      r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건',
    ]);
    const totalRow = ['합계', '', '', '', '', '', '', enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0), '', ''];

    const wsData = [header, ...dataRows, [], totalRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 컬럼 너비 조정 (10개 컬럼)
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '결제내역');
    XLSX.writeFile(wb, `결제내역_${date}.xlsx`);
    toast.success('Excel 다운로드 완료');
  };

  // ── PDF 내보내기 (결제내역 탭) ──────────────────────────
  // 새 창에 인쇄 친화 HTML을 띄우고 자동 인쇄 다이얼로그 호출
  // 사용자가 "PDF로 저장" 옵션 선택 → 한글 안전 PDF 생성 (별도 패키지 불필요)
  const exportPaymentsPDF = () => {
    const fmt = (n: number) => n.toLocaleString('ko-KR');
    const total = enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumByMethod = (m: string) =>
      enrichedRows.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const methodSubtotals = (['card', 'cash', 'transfer', 'membership'] as const)
      .map(m => ({ method: m, label: METHOD_KO[m], amount: sumByMethod(m) }))
      .filter(x => x.amount !== 0);

    const rowsHtml = enrichedRows.map(r => `
      <tr class="${r.payment_type === 'refund' ? 'refund' : ''}${r.source === 'manual' ? ' manual' : ''}">
        <td>${r.pay_date}</td>
        <td>${r.pay_time}</td>
        <td>${r.chart_number ?? '-'}</td>
        <td>${r.customer_name}</td>
        <td>${r.lead_source ?? '-'}</td>
        <td>${r.visit_type_label}</td>
        <td>${r.staff_name ?? '-'}</td>
        <td class="num">${r.payment_type === 'refund' ? '-' : ''}${fmt(r.amount)}</td>
        <td>${METHOD_KO[r.method] ?? r.method}</td>
        <td>${r.payment_type === 'refund' ? '환불' : r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건'}</td>
      </tr>
    `).join('');

    const subtotalsHtml = methodSubtotals.map(x => `
      <div class="subtotal"><span>${x.label}</span><span class="num">${fmt(x.amount)}</span></div>
    `).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>결제내역 — ${date}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:14mm;color:#111;font-size:11px;margin:0}
  h1{font-size:18px;text-align:center;margin:0 0 4px}
  .meta{text-align:center;color:#666;font-size:11px;margin-bottom:14px}
  .summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:8px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px}
  .summary .total-label{font-weight:600;color:#0f766e}
  .summary .total-amount{font-size:16px;font-weight:700;color:#0f766e}
  .subtotals{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px}
  .subtotal{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;min-width:120px;font-size:11px}
  .subtotal span:first-child{color:#64748b}
  .subtotal .num{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{background:#f1f5f9;padding:6px 4px;text-align:left;border:1px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:5px 4px;border:1px solid #e2e8f0;vertical-align:middle}
  td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
  tr.refund{color:#b91c1c;background:#fef2f2}
  tr.manual{background:#f0f9ff}
  tfoot tr{background:#f1f5f9;font-weight:700}
  tfoot td{border-top:2px solid #475569}
  @media print{body{padding:8mm}.no-print{display:none}}
</style></head><body>
<h1>결제내역 — 일마감</h1>
<div class="meta">${date} · ${enrichedRows.length}건</div>
<div class="summary">
  <span class="total-label">총 결제 합계</span>
  <span class="total-amount">${fmt(total)}원</span>
</div>
${methodSubtotals.length ? `<div class="subtotals">${subtotalsHtml}</div>` : ''}
<table>
<thead>
<tr>
  <th>날짜</th><th>시간</th><th>차트번호</th><th>성함</th><th>내원경로</th>
  <th>초진/재진</th><th>결제담당</th><th>결제금액</th><th>결제수단</th><th>구분</th>
</tr>
</thead>
<tbody>${rowsHtml || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8">결제내역이 없습니다</td></tr>'}</tbody>
${enrichedRows.length ? `<tfoot><tr><td colspan="7">합계</td><td class="num">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>` : ''}
</table>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    toast.success('PDF 인쇄 다이얼로그를 열었어요. "PDF로 저장"을 선택하세요.');
  };

  // ── PDF 내보내기 (총 합계 탭) ──────────────────────────
  const exportSummaryPDF = () => {
    const fmt = (n: number) => n.toLocaleString('ko-KR');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>일마감 — ${date}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:14mm;color:#111;font-size:12px;margin:0}
  h1{font-size:20px;text-align:center;margin:0 0 4px}
  .meta{text-align:center;color:#666;font-size:11px;margin-bottom:18px}
  .grand{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:12px 16px;background:#f0fdfa;border:2px solid #14b8a6;border-radius:8px}
  .grand .label{font-size:13px;font-weight:600;color:#0f766e}
  .grand .amount{font-size:22px;font-weight:800;color:#0f766e}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11.5px}
  th{background:#f1f5f9;padding:7px 8px;text-align:left;border:1px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:6px 8px;border:1px solid #e2e8f0}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tr.total td{font-weight:700;background:#f8fafc}
  h3{margin:18px 0 6px;font-size:13px;color:#334155;border-bottom:2px solid #14b8a6;padding-bottom:4px}
  .recon{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .recon .row{padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc}
  .recon .row .lbl{font-size:11px;color:#64748b}
  .recon .row .vals{display:flex;justify-content:space-between;margin-top:4px}
  .recon .diff{font-weight:700}
  .recon .diff.zero{color:#0f766e}
  .recon .diff.pos{color:#0f766e}
  .recon .diff.neg{color:#b91c1c}
  .memo{padding:10px 12px;background:#fefce8;border:1px solid #fde047;border-radius:6px;white-space:pre-wrap}
  @media print{body{padding:8mm}}
</style></head><body>
<h1>일마감 — ${date}</h1>
<div class="meta">${clinic?.name ?? '오블리브 풋센터'}${isClosed ? ' · 마감 확정' : ' · 임시저장'}</div>

<div class="grand">
  <span class="label">당일 매출 합계 (패키지차감 제외)</span>
  <span class="amount">${fmt(totals.grossTotal)}원</span>
</div>

<h3>결제수단별 내역</h3>
<table>
<thead><tr><th>구분</th><th>카드</th><th>현금</th><th>이체</th><th>패키지차감(매출제외)</th><th>매출합계</th></tr></thead>
<tbody>
<tr><td>패키지구매</td><td class="num">${fmt(totals.pkgCardGross)}</td><td class="num">${fmt(totals.pkgCashGross)}</td><td class="num">${fmt(totals.pkgTransferGross)}</td><td class="num">0</td><td class="num">${fmt(totals.pkgCard + totals.pkgCash + totals.pkgTransfer)}</td></tr>
<tr><td>단건</td><td class="num">${fmt(totals.singleCardGross)}</td><td class="num">${fmt(totals.singleCashGross)}</td><td class="num">${fmt(totals.singleTransferGross)}</td><td class="num">${fmt(totals.singleMembership)}</td><td class="num">${fmt(totals.singleCard + totals.singleCash + totals.singleTransfer)}</td></tr>
${totals.refundAmount > 0 ? `<tr><td>환불</td><td class="num" style="color:#b91c1c">-${fmt(totals.refundAmount)}</td><td></td><td></td><td></td><td class="num" style="color:#b91c1c">-${fmt(totals.refundAmount)}</td></tr>` : ''}
<tr class="total"><td>합계(멤버십제외,환불차감)</td><td class="num">${fmt(totals.totalCard)}</td><td class="num">${fmt(totals.totalCash)}</td><td class="num">${fmt(totals.totalTransfer)}</td><td class="num">${fmt(totals.singleMembership)}</td><td class="num">${fmt(totals.grossTotal)}</td></tr>
</tbody>
</table>

<h3>실제 정산 (환불 차감 후 기준)</h3>
<div class="recon">
  <div class="row">
    <div class="lbl">카드 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalCard)}</span><span>실제 ${fmt(actualCard)}</span></div>
    <div class="vals"><span></span><span class="diff ${cardDiff === 0 ? 'zero' : cardDiff > 0 ? 'pos' : 'neg'}">차이 ${cardDiff > 0 ? '+' : ''}${fmt(cardDiff)}</span></div>
  </div>
  <div class="row">
    <div class="lbl">현금 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalCash)}</span><span>실제 ${fmt(actualCash)}</span></div>
    <div class="vals"><span></span><span class="diff ${cashDiff === 0 ? 'zero' : cashDiff > 0 ? 'pos' : 'neg'}">차이 ${cashDiff > 0 ? '+' : ''}${fmt(cashDiff)}</span></div>
  </div>
  <div class="row">
    <div class="lbl">이체 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalTransfer)}</span><span>실제 ${fmt(actualTransfer)}</span></div>
    <div class="vals"><span></span><span class="diff ${transferDiff === 0 ? 'zero' : transferDiff > 0 ? 'pos' : 'neg'}">차이 ${transferDiff > 0 ? '+' : ''}${fmt(transferDiff)}</span></div>
  </div>
</div>

${totals.refundAmount > 0 ? `<h3>환불 내역</h3><table><tbody><tr><td>단건 환불</td><td class="num">${fmt(totals.refundSingleAmount)}</td></tr><tr><td>패키지 환불</td><td class="num">${fmt(totals.refundPkgAmount)}</td></tr><tr class="total"><td>환불 합계</td><td class="num">${fmt(totals.refundAmount)}</td></tr></tbody></table>` : ''}
${unpaid.length > 0 ? `<h3>미수</h3><div>결제대기 ${unpaid.length}건</div>` : ''}
${memo ? `<h3>메모</h3><div class="memo">${memo.replace(/</g, '&lt;')}</div>` : ''}
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    toast.success('PDF 인쇄 다이얼로그를 열었어요. "PDF로 저장"을 선택하세요.');
  };

  const handlePrint = () => window.print();

  // ── 수기 삭제 ─────────────────────────────────────────────
  const deleteManual = async (id: string) => {
    if (!window.confirm('수기 결제내역을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('closing_manual_payments').delete().eq('id', id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('삭제됨');
    qc.invalidateQueries({ queryKey: ['closing-manual', clinic?.id, date] });
  };

  // ──────────────────────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto space-y-4 p-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label>마감일</Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          {isClosed && (
            <Badge variant="success" className="mb-1">
              <Lock className="mr-1 h-3 w-3" /> 마감됨
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="summary" className="flex-1 sm:flex-none">
            총 합계
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex-1 sm:flex-none">
            결제내역 <Badge variant="secondary" className="ml-1.5">{enrichedRows.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════════ 탭 1: 총 합계 ════════════════════════ */}
        <TabsContent value="summary" className="space-y-4">
          {/* 액션 버튼 */}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={exportCSV} title="CSV 다운로드">
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportSummaryPDF} title="PDF로 저장 — 인쇄 다이얼로그에서 'PDF로 저장' 선택">
              <FileDown className="mr-1 h-4 w-4" /> PDF
            </Button>
            <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
              <Printer className="h-4 w-4" />
            </Button>
            {/* T-20260520-foot-RBAC-MENU-EXPAND: 임시저장·마감 확정·재오픈 = admin/manager 전용 */}
            {isAdminOrManager && (isClosed ? (
              <Button variant="outline" onClick={() => {
                if (!window.confirm('마감을 재오픈하시겠습니까?')) return;
                reopen();
              }}>
                <Unlock className="mr-1 h-4 w-4" /> 재오픈
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => saveDraft(false)} title="수정 가능한 임시저장">
                  <Save className="mr-1 h-4 w-4" /> 임시저장
                </Button>
                <Button onClick={() => saveDraft(true)} title="잠금 처리 — 재오픈 전까지 수정 불가">
                  <Lock className="mr-1 h-4 w-4" /> 마감 확정
                </Button>
              </>
            ))}
          </div>

          {!isClosed && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <span className="font-medium text-foreground">임시저장</span>은 수정 가능한 중간 저장이고,
              <span className="font-medium text-foreground"> 마감 확정</span>은 잠금 처리되어 재오픈 전까지 수정할 수 없습니다.
            </div>
          )}

          {/* 진행 중 / 결제대기(미수) 경고 — 2-col 병치 (md+ 좌우, sm 1-col)
              T-20260617-foot-CLOSING-INPROG-PAYWAIT-BOXLAYOUT:
              뉴트럴 카드 + 얇은 보더로 톤다운. 식별 포인트는 아이콘·배지·카운트 색으로 한정.
              클릭 동선·차트번호 인접 규약(CHARTNO-B2-P2)·시각/전화 포맷 전부 보존. */}
          {(inProgress.length > 0 || unpaid.length > 0) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 진행 중 경고 */}
              {inProgress.length > 0 && (
                <Card className="border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <Clock className="h-4 w-4 text-orange-500" />
                      진행 중
                      <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-orange-300 text-orange-700 font-semibold">
                        {inProgress.length}건
                      </Badge>
                      <span className="ml-auto text-xs font-normal text-muted-foreground">마감 전 확인</span>
                    </CardTitle>
                  </CardHeader>
                  {/* T-20260617-foot-CLOSING-INPROG-PAYWAIT-MAXH-SCROLL:
                      리스트 영역 고정 max-height + 내부 세로 스크롤. 헤더(제목/카운트)는 CardHeader로 스크롤 영역 밖 고정.
                      항목 적으면 자연 높이(스크롤바 미노출), 많아도 박스 외형 일정. 두 박스 동일 max-h로 2-col 균형. */}
                  <CardContent className="space-y-1 text-sm text-foreground max-h-48 overflow-y-auto">
                    {inProgress.map(c => (
                      <button
                        key={c.id}
                        className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-muted transition text-left"
                        onClick={() => navigate('/admin', { state: { openCheckInId: c.id } })}
                      >
                        <span className="flex items-center gap-2">
                          <span>{c.customer_name}</span>
                          {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                          <span className="font-mono text-xs text-muted-foreground">{chartNoBadge(c.customers?.chart_number ?? null)}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700">
                            {STATUS_KO[c.status as CheckInStatus] ?? c.status}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* 미수 경고 */}
              {unpaid.length > 0 && (
                <Card className="border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <CreditCard className="h-4 w-4 text-amber-500" />
                      결제대기
                      <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-300 text-amber-700 font-semibold">
                        {unpaid.length}건
                      </Badge>
                      <span className="ml-auto text-xs font-normal text-muted-foreground">클릭 → 결제 처리</span>
                    </CardTitle>
                  </CardHeader>
                  {/* T-20260617-foot-CLOSING-INPROG-PAYWAIT-MAXH-SCROLL: 진행중 박스와 동일 max-h-48 → 2-col 높이 균형 */}
                  <CardContent className="space-y-1 text-sm text-foreground max-h-48 overflow-y-auto">
                    {unpaid.map(c => (
                      <button
                        key={c.id}
                        className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-muted transition text-left"
                        onClick={async () => {
                          const { data } = await supabase.from('check_ins').select('*, customers(name, chart_number)').eq('id', c.id).maybeSingle();
                          if (data) setPayTarget(data as CheckIn);
                          else toast.error('체크인을 불러올 수 없습니다');
                        }}
                      >
                        {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                        <span>{c.customer_name} <span className="font-mono text-muted-foreground">{chartNoBadge(c.customers?.chart_number ?? null)}</span> <span className="text-muted-foreground">{formatPhone(c.customer_phone)}</span></span>
                        <span className="text-xs text-muted-foreground">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* 요약 카드
              T-20260525-foot-CLOSING-CALC-BUG:
              SummaryCard 행값은 GROSS(환불 미차감)로 표시.
              "합계" 카드에 ['환불', -refundAmount] 행 추가 → 행 합계 = grossTotal(NET) ✓
              (구 코드: NET 행값 + 별도 환불 행 → 이중 차감 = 불일치 원인) */}
          {/* T-20260526-foot-CLOSING-PAYCOUNT: rows 3번째 인자 = 건 수 (0건도 표기) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              title="패키지 결제"
              rows={[
                ['카드', totals.pkgCardGross, totals.pkgCardCount],
                ['현금', totals.pkgCashGross, totals.pkgCashCount],
                ['이체', totals.pkgTransferGross, totals.pkgTransferCount],
                ...(totals.refundPkgAmount > 0
                  ? [['환불', -totals.refundPkgAmount, totals.pkgRefundCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.pkgCard + totals.pkgCash + totals.pkgTransfer}
              totalCount={totals.pkgCardCount + totals.pkgCashCount + totals.pkgTransferCount}
            />
            {/* T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3/AC-5:
                단건 결제 합계에서 singleMembership 제외.
                패키지차감건(method='membership')은 이미 package_payments에서 집계됨 */}
            <SummaryCard
              title="단건 결제"
              rows={[
                ['카드', totals.singleCardGross, totals.singleCardCount],
                ['현금', totals.singleCashGross, totals.singleCashCount],
                ['이체', totals.singleTransferGross, totals.singleTransferCount],
                ...(totals.singleMembership > 0
                  ? [['패키지차감(매출제외)', totals.singleMembership] as [string, number]]
                  : []),
                ...(totals.refundSingleAmount > 0
                  ? [['환불', -totals.refundSingleAmount, totals.singleRefundCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.singleCard + totals.singleCash + totals.singleTransfer}
              totalCount={totals.singleCardCount + totals.singleCashCount + totals.singleTransferCount}
            />
            {/* T-20260525-foot-CLOSING-SUM-ERR: 수기결제가 있을 때 수기 소계 카드 추가 */}
            {/* T-20260527-foot-CLOSE-ITEM-COUNT: 수기결제 카드 건 수 추가 — 빨간 박스 전체 적용 */}
            {/* T-20260527-foot-CLOSE-ITEM-COUNT FIX: manualTotal>0 조건 제거 — 0건 상태에서도 항상 렌더 (supervisor QA 요구) */}
            <SummaryCard
              title="수기결제"
              rows={[
                ['카드', totals.manualCard, totals.manualCardCount],
                ['현금', totals.manualCash, totals.manualCashCount],
                ['이체', totals.manualTransfer, totals.manualTransferCount],
              ]}
              total={totals.manualTotal}
              totalCount={totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount}
            />
            {/* 합계 카드: GROSS행 + 환불 차감 = NET(grossTotal)
                행 합계 = totalCardGross + totalCashGross + totalTransferGross - refundAmount
                        = grossTotal ✓ */}
            <SummaryCard
              title="합계 (결제수단별)"
              rows={[
                ['카드 총합', totals.totalCardGross, totals.totalCardCount],
                ['현금 총합', totals.totalCashGross, totals.totalCashCount],
                ['이체 총합', totals.totalTransferGross, totals.totalTransferCount],
                ...(totals.manualTotal > 0
                  ? [['수기결제 포함', totals.manualTotal, totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount] as [string, number, number]]
                  : []),
                ...(totals.refundAmount > 0
                  ? [['환불', -totals.refundAmount, totals.totalRefundCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.grossTotal}
              totalCount={totals.totalCardCount + totals.totalCashCount + totals.totalTransferCount}
              highlight
            />
            {/* T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL: 합계 박스 옆 동일 박스 형태 일일 미수금 박스.
                §4-A: 패키지 미수 / 진료비 미수 별도 줄, 합산 단일 '총 미수금' 미표기. 소스=footBilling SSOT. */}
            <DailyOutstandingCard
              packageDue={dailyOutstanding.packageDue}
              consultationDue={dailyOutstanding.consultationDue}
              dueCustomerCount={dailyOutstanding.dueCustomerCount}
            />
          </div>

          {/* ── T-20260717-foot-CLOSING-REFUND-STATS-MISSING: 금일 환불 별도 집계 섹션 ──
              [REOPEN] '차감'은 이미 정상 → 여기서는 금일 환불을 '별도 요약(건수+총액)'으로 표시만 추가.
              소스=refundRows(enrichedRows 의 refund 행) / 수치=totals.refundAmount·totalRefundCount(확정 SSOT 재사용).
              배치=매출 요약(SummaryCard 그리드) 바로 아래(인접 default). 항상 렌더(0건도 명시). */}
          <Card data-testid="closing-refund-summary-card" className="border-rose-200 dark:border-rose-900">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <RotateCcw className="h-4 w-4 text-rose-500" />
                금일 환불
                <Badge
                  variant="outline"
                  className="text-[11px] px-1.5 py-0 border-rose-300 text-rose-700 font-semibold"
                  data-testid="closing-refund-count-badge"
                >
                  {totals.totalRefundCount}건
                </Badge>
                <span className="ml-auto text-sm font-semibold tabular-nums text-rose-700" data-testid="closing-refund-total-amount">
                  총 환불액 {formatAmount(totals.refundAmount)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* 유형별 소계 (단건/패키지) — totals SSOT 재사용 */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>단건 환불 <span className="tabular-nums font-medium text-foreground">{formatAmount(totals.refundSingleAmount)}</span> ({totals.singleRefundCount}건)</span>
                <span>패키지 환불 <span className="tabular-nums font-medium text-foreground">{formatAmount(totals.refundPkgAmount)}</span> ({totals.pkgRefundCount}건)</span>
              </div>

              {refundRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="closing-refund-list">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-1.5 pr-2 text-left font-medium">시각</th>
                        <th className="py-1.5 pr-2 text-left font-medium">고객</th>
                        <th className="py-1.5 pr-2 text-left font-medium">차트번호</th>
                        <th className="py-1.5 pr-2 text-left font-medium">유형</th>
                        <th className="py-1.5 pr-2 text-left font-medium">결제수단</th>
                        <th className="py-1.5 pr-2 text-left font-medium">담당자</th>
                        <th className="py-1.5 text-right font-medium">환불액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refundRows.map((r, i) => (
                        <tr key={(r.payment_id ?? r.pkg_payment_id ?? r.sort_key) + ':' + i} className="border-b">
                          <td className="py-1.5 pr-2 text-xs text-muted-foreground tabular-nums">{r.pay_time}</td>
                          <td className="py-1.5 pr-2">{r.customer_name}</td>
                          <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{chartNoBadge(r.chart_number)}</td>
                          <td className="py-1.5 pr-2 text-xs">{r.source === 'package' ? '패키지' : '단건'}</td>
                          <td className="py-1.5 pr-2 text-xs">{METHOD_KO[r.method as Method] ?? r.method}</td>
                          <td className="py-1.5 pr-2 text-xs">{r.staff_name ?? '미지정'}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium text-rose-700">-{formatAmount(r.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5" colSpan={6}>환불 합계 ({totals.totalRefundCount}건)</td>
                        <td className="py-1.5 text-right tabular-nums text-rose-700">-{formatAmount(totals.refundAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="closing-refund-empty">금일 환불 내역이 없습니다.</p>
              )}
            </CardContent>
          </Card>

          {/* 시술별 통계 — T-20260715-foot-DAYCLOSE-STAT-PAYONLY: 실수납/결제 confirmed(net>0) 건만 */}
          {procedureStats.length > 0 && (
            <Card data-testid="procedure-stats-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">시술별 통계 ({procedureStats.reduce((s, p) => s + p.count, 0)}건)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">시술명</th>
                      <th className="py-1.5 text-right font-medium">건수</th>
                      {/* T-20260715-foot-DAYCLOSE-STATCOL-LABEL-TREATAMT: '매출'→'시술금액' (B안, 김주연 총괄 권고). 집계 로직 무변경(STAT-PAYONLY 담당). */}
                      <th className="py-1.5 text-right font-medium">시술금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procedureStats.map(p => (
                      <tr key={p.service_name} className="border-b">
                        <td className="py-1.5">{p.service_name}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.count}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatAmount(p.revenue)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-1.5">합계</td>
                      <td className="py-1.5 text-right tabular-nums">{procedureStats.reduce((s, p) => s + p.count, 0)}</td>
                      <td className="py-1.5 text-right tabular-nums" data-testid="procedure-stats-total-revenue">{formatAmount(procedureStats.reduce((s, p) => s + p.revenue, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* 실제 정산 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">실제 정산</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReconRow label="카드" system={totals.totalCard} actual={actualCard} diff={cardDiff} onChange={setActualCard} disabled={isClosed} />
                <ReconRow label="현금" system={totals.totalCash} actual={actualCash} diff={cashDiff} onChange={setActualCash} disabled={isClosed} />
                <ReconRow label="이체" system={totals.totalTransfer} actual={actualTransfer} diff={transferDiff} onChange={setActualTransfer} disabled={isClosed} />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-4 py-2 text-sm">
                <span className="font-medium">총 차이</span>
                <span className={totalDiff === 0 ? 'font-semibold' : totalDiff > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-destructive'}>
                  {totalDiff > 0 ? '+' : ''}{formatAmount(totalDiff)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 메모 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">메모</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="특이사항"
                disabled={isClosed}
                rows={3}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════ 탭 2: 결제내역 ════════════════════════ */}
        <TabsContent value="payments" className="space-y-4">
          {/* T-20260708-foot-REDPAY-CLOSING-TAB AC-2: 결제 탭 하위 '레드페이' 하위탭 신설.
              기존 CRM 수납 레이아웃·동작 무손상 — 아래 전체를 'CRM 수납' 하위탭으로 감싸고
              '레드페이' 하위탭(카드단말기 자동수집 대조)만 신규 추가. */}
          <Tabs value={paySubTab} onValueChange={(v) => setPaySubTab(v as 'crm' | 'redpay')}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="crm" className="flex-1 sm:flex-none">CRM 수납</TabsTrigger>
              <TabsTrigger value="redpay" className="flex-1 sm:flex-none">레드페이</TabsTrigger>
            </TabsList>

            <TabsContent value="crm" className="space-y-4">
          {/* C2-MANAGER-PAYMENT-MAP: 담당자 필터 + 액션 버튼 */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                {/* T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 건수=표시 행(병합 환불 제외) / 합계=net(병합 환불 포함 → 회귀 0) */}
                총 <span className="font-semibold text-foreground">{filteredEnrichedRows.filter(r => !r.merged_refund).length}건</span> ·
                합계 <span className="font-semibold text-emerald-700">{formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}</span>
              </div>
              {/* 담당자 필터 드롭다운 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">담당자</span>
                <select
                  value={staffFilter}
                  onChange={e => setStaffFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="">전체</option>
                  {/* T-20260522-foot-CLOSING-STAFF-DROP AC-1(5/24 확장): 2번차트 동일 — director(원장)+therapist(치료사) 제외, 상담실장+데스크만 */}
                  {/* T-20260522-foot-STAFF-NAME-UNIFY: display_name(구성명) fallback to name */}
                  {/* T-20260614-foot-STAFF-DROPDOWN-ROLE-SORT: 표시 순서만 role 정렬(상담실장→코디) — 2번차트와 동일 헬퍼 */}
                  {staffList.filter(s => s.role !== 'director' && s.role !== 'therapist').sort((a, b) => staffRoleSortIndex(a.role) - staffRoleSortIndex(b.role)).map(s => (
                    <option key={s.id} value={s.display_name || s.name}>{s.display_name || s.name}</option>
                  ))}
                  {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-3: '미배정' → '미지정' */}
                  <option value="미지정">미지정</option>
                </select>
                {staffFilter && (
                  <button
                    onClick={() => setStaffFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                    title="필터 초기화"
                  >✕</button>
                )}
              </div>
              {/* T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 결제수단 필터 드롭다운 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">결제수단</span>
                <select
                  value={methodFilter}
                  onChange={e => setMethodFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="">전체</option>
                  {(['card', 'cash', 'transfer', 'membership'] as const).map(m => (
                    <option key={m} value={m}>{METHOD_KO[m]}</option>
                  ))}
                </select>
                {methodFilter && (
                  <button
                    onClick={() => setMethodFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                    title="필터 초기화"
                  >✕</button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {/* T-20260520-foot-RBAC-MENU-EXPAND: 수기 추가 = admin/manager 전용 */}
              {isAdminOrManager && (
                <Button variant="outline" size="sm" onClick={() => { setManualEditTarget(null); setShowManualDialog(true); }}>
                  <Plus className="mr-1 h-4 w-4" /> 수기 추가
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportExcel} title="Excel 다운로드">
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPaymentsPDF} title="PDF로 저장 — 인쇄 다이얼로그에서 'PDF로 저장' 선택">
                <FileDown className="mr-1 h-4 w-4" /> PDF
              </Button>
              <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 결제내역 테이블 */}
          <Card>
            <CardContent className="p-0">
              {/* T-20260525-foot-CLOSING-NAV-BUG AC-4: ref + onScroll으로 스크롤 위치 보존 */}
              <div
                ref={paymentsTableRef}
                className="overflow-auto"
                onScroll={(e) => { scrollTopRef.current = e.currentTarget.scrollTop; }}
              >
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 px-3 text-left font-medium w-24">날짜</th>
                      <th className="py-2 px-2 text-left font-medium w-14">시간</th>
                      <th className="py-2 px-2 text-left font-medium w-20">차트번호</th>
                      <th className="py-2 px-2 text-left font-medium w-20">성함</th>
                      <th className="py-2 px-2 text-left font-medium w-20">내원경로</th>
                      <th className="py-2 px-2 text-left font-medium w-16">초진/재진</th>
                      <th className="py-2 px-2 text-left font-medium w-20">결제담당</th>
                      <th className="py-2 px-2 text-right font-medium w-24">결제금액</th>
                      <th className="py-2 px-2 text-right font-medium w-20">과세</th>
                      <th className="py-2 px-2 text-right font-medium w-20">비과세</th>
                      <th className="py-2 px-2 text-center font-medium w-16">현금영수증</th>
                      <th className="py-2 px-2 text-left font-medium w-16">결제수단</th>
                      <th className="py-2 px-2 text-center font-medium w-16">구분</th>
                      <th className="py-2 px-2 w-16 text-center">환불</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEnrichedRows.length === 0 && (
                      <tr>
                        <td colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                          결제내역이 없습니다
                        </td>
                      </tr>
                    )}
                    {/* T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 병합된 환불행은 표시 스킵(원결제행에 annotate). */}
                    {/* T-20260715-foot-DAYCLOSE-LIST-PATIENT-GROUP: 동일 환자(차트+성함) 그룹 묶음 render.
                        groupedDisplayRows = filteredEnrichedRows(merged_refund 스킵)를 환자 그룹으로 재배열. */}
                    {groupedDisplayRows.map(({ row: r, indexInGroup, groupSize }, i) => {
                      const isContinuation = indexInGroup > 0;      // 그룹 2번째 이후 행 → 들여쓰기
                      const isGroupStart = indexInGroup === 0;
                      const isMultiGroup = groupSize > 1;
                      return (
                      <tr
                        key={`row-${i}`}
                        data-testid="closing-pay-row"
                        data-group-index={indexInGroup}
                        data-group-size={groupSize}
                        className={cn(
                          'border-b transition-colors',
                          r.payment_type === 'refund' && 'bg-red-50 text-red-700',
                          // T-20260715 REQ②: 환불된 원결제행 — 옅은 적색 틴트로 환불 표기
                          r.refunded && 'bg-red-50/40',
                          r.source === 'manual' && 'bg-sky-50',
                          // PATIENT-GROUP: 새 다건 그룹 시작 행(첫 행 제외)에 그룹 구분선
                          isMultiGroup && isGroupStart && i > 0 && 'border-t-2 border-t-emerald-100',
                          // PATIENT-GROUP: 그룹 연속 행 — 좌측 emerald 강조선(묶음 시각 표시)
                          isContinuation && 'border-l-2 border-l-emerald-300',
                        )}
                      >
                        <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{r.pay_date}</td>
                        <td className="py-2 px-2 tabular-nums text-xs">
                          {r.pay_time}
                          {/* T-20260715 REQ②: 결제 업로드 시각(위) + 환불 신청 시각(아래) 각각 표기 */}
                          {r.refunded && (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-requested-at">
                              환불 {r.refund_date && r.refund_date !== r.pay_date ? `${r.refund_date} ` : ''}{r.refund_time}
                            </div>
                          )}
                        </td>
                        {/* T-20260715-foot-CLOSING-CHARTNUM-CHARTNAV: 차트번호 셀 클릭 → 고객 2번차트(/chart/:customerId) nav.
                            row_customer_id 있는 행(단건·패키지결제)만 클릭/hover 활성, 수기행(row_customer_id 없음)은 비활성. */}
                        <td
                          className={cn(
                            'py-2 px-2 text-xs text-muted-foreground',
                            r.row_customer_id && 'cursor-pointer hover:text-primary hover:underline',
                          )}
                          onClick={r.row_customer_id ? () => navigate(`/chart/${r.row_customer_id}`) : undefined}
                          data-testid="closing-chartno-cell"
                        >
                          {r.chart_number ?? '-'}
                        </td>
                        {/* PATIENT-GROUP: 연속 행은 들여쓰기 + ↳ 커넥터로 동일 환자 묶음 표시 */}
                        <td className={cn('py-2 px-2 font-medium', isContinuation && 'pl-5')}>
                          {isContinuation ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-emerald-500/70" data-testid="group-connector">↳</span>
                              {r.customer_name}
                            </span>
                          ) : (
                            r.customer_name
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs">{r.lead_source ?? '-'}</td>
                        <td className="py-2 px-2 text-xs">{r.visit_type_label}</td>
                        {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' */}
                        <td className="py-2 px-2 text-xs">{r.staff_name ?? <span className="text-muted-foreground/60">미지정</span>}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">
                          {r.payment_type === 'refund' ? '-' : ''}{formatAmount(r.amount)}
                          {/* T-20260715 REQ②: 원결제행에 병합된 환불액(양수) 병기 */}
                          {/* T-20260713 [FOLD] AC-B2: 같은날 병합액 없을 때도 교차일 누적 환불액을 병기 */}
                          {r.refunded && r.refund_amount ? (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-amount">
                              환불 -{formatAmount(r.refund_amount)}
                            </div>
                          ) : !r.refunded && refundedTotalForRow(r) > 0 ? (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-amount">
                              환불 -{formatAmount(refundedTotalForRow(r))}
                            </div>
                          ) : null}
                        </td>
                        {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */}
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {r.taxable_amount != null && r.taxable_amount > 0 ? formatAmount(r.taxable_amount) : '-'}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {r.tax_exempt_amount != null && r.tax_exempt_amount > 0 ? formatAmount(r.tax_exempt_amount) : '-'}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {r.cash_receipt_issued === true ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 text-xs">
                              <span>✅</span>
                              <span className="text-[10px]">
                                {r.cash_receipt_type === 'income_deduction' ? '소득' : r.cash_receipt_type === 'expense_proof' ? '지출' : ''}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" className="text-xs">
                            {METHOD_KO[r.method] ?? r.method}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Badge
                              variant={r.payment_type === 'refund' ? 'destructive' : r.source === 'manual' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {r.payment_type === 'refund' ? '환불' : r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건'}
                            </Badge>
                            {/* T-20260715 REQ②: 환불된 원결제행 — '환불' 표기(새 빨간 행 대신 기존 행 annotate) */}
                            {/* T-20260713 [FOLD] AC-B2: 교차일 환불(같은날 병합 미발생)도 배지 노출 */}
                            {(r.refunded || refundedTotalForRow(r) > 0) && (
                              <Badge variant="destructive" className="text-xs" data-testid="refunded-badge">환불</Badge>
                            )}
                            {/* AC-B1: 완전환불(잔여 0) 시각 표시 */}
                            {isFullyRefunded(r) && (
                              <Badge variant="outline" className="text-[10px] border-red-300 text-red-500" data-testid="fully-refunded-badge">완료</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* T-20260522-foot-CLOSING-REFUND: 환불 버튼 — admin/manager + 이미 환불 아닌 건 + payment/package 소스만 */}
                            {/* T-20260525-foot-ROLE-PERM-CUSTOM AC-5: canRefund(+consultant/coordinator/therapist)로 확장 */}
                            {/* T-20260713-ITEMSELECT: 클릭 시 같은 고객의 환불 가능 행 묶음을 창으로 전달(유형별 구분+항목 선택) */}
                            {/* [FOLD] AC-B1: 완전환불(잔여 0) 행은 재환불 클릭 차단 → 버튼 숨김 */}
                            {canRefund && r.payment_type !== 'refund' && (r.source === 'payment' || r.source === 'package') && !isFullyRefunded(r) && (
                              <button
                                data-testid="refund-open-btn"
                                onClick={() => setRefundTarget(gatherCustomerRefundRows(r))}
                                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                title="환불"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {/* 수기 수정/삭제 버튼 */}
                            {r.source === 'manual' && r.manual_id && r.manual_raw && isAdminOrManager && (
                              <>
                                <button
                                  onClick={() => { setManualEditTarget(r.manual_raw!); setShowManualDialog(true); }}
                                  className="text-muted-foreground hover:text-primary transition-colors p-1"
                                  title="수정"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteManual(r.manual_id!)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  title="삭제"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  {filteredEnrichedRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 bg-muted/50 font-semibold">
                        <td colSpan={7} className="py-2 px-3 text-sm">합계{staffFilter && ` (${staffFilter})`}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-sm text-emerald-700">
                          {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}
                        </td>
                        {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세 합계 */}
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {(() => {
                            const t = filteredEnrichedRows.reduce((s, r) => s + (r.taxable_amount ?? 0), 0);
                            return t > 0 ? formatAmount(t) : '-';
                          })()}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {(() => {
                            const t = filteredEnrichedRows.reduce((s, r) => s + (r.tax_exempt_amount ?? 0), 0);
                            return t > 0 ? formatAmount(t) : '-';
                          })()}
                        </td>
                        <td className="py-2 px-2 text-center text-xs text-muted-foreground">
                          {(() => {
                            const n = filteredEnrichedRows.filter(r => r.cash_receipt_issued === true).length;
                            return n > 0 ? `${n}건` : '-';
                          })()}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 결제수단별 소계 (결제내역 탭 하단) */}
          {filteredEnrichedRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['card', 'cash', 'transfer', 'membership'] as const).map(method => {
                const subtotal = filteredEnrichedRows
                  .filter(r => r.method === method)
                  .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
                if (subtotal === 0) return null;
                return (
                  <div key={method} className="rounded-lg border bg-card p-3 text-center">
                    <div className="text-xs text-muted-foreground mb-1">{METHOD_KO[method] ?? method}</div>
                    <div className="tabular-nums font-semibold text-sm">{formatAmount(subtotal)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 합계 */}
          {filteredEnrichedRows.some(r => r.taxable_amount != null || r.tax_exempt_amount != null || r.cash_receipt_issued != null) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">과세 합계</div>
                <div className="tabular-nums font-semibold text-sm">
                  {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.taxable_amount ?? 0), 0))}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">비과세 합계</div>
                <div className="tabular-nums font-semibold text-sm">
                  {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.tax_exempt_amount ?? 0), 0))}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">현금영수증 발행</div>
                <div className="tabular-nums font-semibold text-sm">
                  {filteredEnrichedRows.filter(r => r.cash_receipt_issued === true).length}건
                </div>
              </div>
            </div>
          )}

          {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-2: 담당자별 매출 집계 — 카드/현금/이체 소계 (전체 기준 — 필터 무관) */}
          {staffTotals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">담당자별 매출</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 px-3 text-left font-medium">담당자</th>
                      <th className="py-1.5 px-2 text-right font-medium">카드</th>
                      <th className="py-1.5 px-2 text-right font-medium">현금</th>
                      <th className="py-1.5 px-2 text-right font-medium">이체</th>
                      <th className="py-1.5 px-3 text-right font-medium">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffTotals.map(({ name, total, card, cash, transfer }) => (
                      <tr
                        key={name}
                        className={cn(
                          'border-b cursor-pointer hover:bg-muted/40 transition-colors',
                          staffFilter === name && 'bg-teal-50',
                        )}
                        onClick={() => setStaffFilter(staffFilter === name ? '' : name)}
                        title={`클릭하면 ${name} 결제내역만 보기`}
                      >
                        <td className="py-1.5 px-3">
                          {name}
                          {staffFilter === name && (
                            <span className="ml-1.5 text-[10px] bg-teal-100 text-teal-700 rounded px-1">필터 중</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{card !== 0 ? formatAmount(card) : '-'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{cash !== 0 ? formatAmount(cash) : '-'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{transfer !== 0 ? formatAmount(transfer) : '-'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-medium text-emerald-700">{formatAmount(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/50">
                      <td className="py-1.5 px-3 text-sm">합계</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.card, 0))}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.cash, 0))}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.transfer, 0))}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-sm text-emerald-700">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.total, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}
            </TabsContent>

            {/* T-20260708-foot-REDPAY-CLOSING-TAB: 레드페이 하위탭 (카드단말기 자동수집 + 대조) */}
            <TabsContent value="redpay" className="space-y-4">
              {clinic && <RedpayReconcileTab date={date} clinicId={clinic.id} />}
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* 수기 추가/수정 다이얼로그 */}
      {showManualDialog && clinic && (
        <ManualEntryDialog
          clinicId={clinic.id}
          closeDate={date}
          staffList={staffList}
          editTarget={manualEditTarget}
          onClose={() => { setShowManualDialog(false); setManualEditTarget(null); }}
          onSaved={() => {
            setShowManualDialog(false);
            setManualEditTarget(null);
            qc.invalidateQueries({ queryKey: ['closing-manual', clinic.id, date] });
          }}
        />
      )}

      {/* T-20260522-foot-CLOSING-REFUND: 환불 처리 다이얼로그 */}
      {refundTarget && clinic && (
        <ClosingRefundDialog
          open={!!refundTarget}
          rows={refundTarget}
          clinicId={clinic.id}
          onClose={() => setRefundTarget(null)}
          onSuccess={() => {
            setRefundTarget(null);
            refreshPayments();
            qc.invalidateQueries({ queryKey: ['closing-refund-alldates', clinic.id] });
          }}
        />
      )}

      {/* T-20260616-foot-CLOSING-PAYWAIT-PMW-SWAP: 미수 클릭 시 결제 미니창 (레거시 PaymentDialog → PaymentMiniWindow) */}
      <PaymentMiniWindow
        key={`closing-mini-${payTarget?.id ?? 'none'}-${payAttemptCounter}`}
        checkIn={payTarget}
        onClose={() => setPayTarget(null)}
        onComplete={() => {
          setPayTarget(null);
          setPayAttemptCounter((c) => c + 1);
          refreshPayments();
        }}
        onSaved={() => {
          // 시술 저장 후 미수금(결제대기) 즉시 갱신
          refreshPayments();
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 수기 추가 다이얼로그
// ──────────────────────────────────────────────────────────────

interface ManualEntryDialogProps {
  clinicId: string;
  closeDate: string;
  staffList: Staff[];
  /** 수정 모드용 — null이면 신규 추가 모드 */
  editTarget: ManualPaymentRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function ManualEntryDialog({ clinicId, closeDate, staffList, editTarget, onClose, onSaved }: ManualEntryDialogProps) {
  const isEdit = editTarget !== null;
  const [payTime, setPayTime] = useState(editTarget?.pay_time ?? format(new Date(), 'HH:mm'));
  const [chartNumber, setChartNumber] = useState(editTarget?.chart_number ?? '');
  const [customerName, setCustomerName] = useState(editTarget?.customer_name ?? '');
  const [leadSource, setLeadSource] = useState(editTarget?.lead_source ?? '');
  const [visitType, setVisitType] = useState(editTarget?.visit_type ?? '');
  const [staffName, setStaffName] = useState(editTarget?.staff_name ?? '');
  const [amount, setAmount] = useState(editTarget ? String(editTarget.amount) : '');
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>(
    (editTarget?.method as 'card' | 'cash' | 'transfer' | undefined) ?? 'card',
  );
  const [memo, setMemo] = useState(editTarget?.memo ?? '');
  const [saving, setSaving] = useState(false);
  const { profile } = useAuth();

  // ── T-20260714-foot-DAYCLOSE-MANUAL-PAY (옵션A): 차트번호 → 고객 연동 정본 귀속 ──
  //   차트번호가 이 클리닉 내 고객 1인으로 유일 해소되면, 활성 패키지 잔금 / 수납대기 내원으로
  //   정본(package_payments/payments) 귀속 가능. 귀속 시 closing_manual_payments 는 만들지 않아
  //   매출 이중계상 없음(net-zero). 기본값 = '수기(rollup)' — 기존 동선 무회귀.
  const [resolvedCust, setResolvedCust] = useState<{ id: string; name: string } | null>(null);
  const [custPkgs, setCustPkgs] = useState<{ id: string; name: string; totalSessions: number }[]>([]);
  const [custWaitingCIs, setCustWaitingCIs] = useState<(ManualPayCheckIn & { label: string })[]>([]);
  const [attrSel, setAttrSel] = useState<string>('manual'); // 'manual' | 'pkg:<id>' | 'ci:<id>' | 'single'

  useEffect(() => {
    if (isEdit) return; // 수정 모드는 기존 rollup 행만 편집 (귀속 전환 비대상)
    const cn = chartNumber.trim();
    if (!cn) { setResolvedCust(null); setCustPkgs([]); setCustWaitingCIs([]); setAttrSel('manual'); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data: custs } = await supabase
        .from('customers')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .eq('chart_number', cn)
        .limit(2);
      if (cancelled) return;
      if (!custs || custs.length !== 1) { setResolvedCust(null); setCustPkgs([]); setCustWaitingCIs([]); setAttrSel('manual'); return; }
      const cust = custs[0] as { id: string; name: string };
      setResolvedCust(cust);
      const { data: pkgs } = await supabase
        .from('packages')
        .select('id, package_name, total_sessions')
        .eq('customer_id', cust.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      const { data: cis } = await supabase
        .from('check_ins')
        .select('id, clinic_id, status, status_flag_history, customer_id, checked_in_at')
        .eq('customer_id', cust.id)
        .eq('status', 'payment_waiting')
        .order('checked_in_at', { ascending: false });
      if (cancelled) return;
      setCustPkgs((pkgs ?? []).map((p: { id: string; package_name: string; total_sessions: number }) =>
        ({ id: p.id, name: p.package_name, totalSessions: p.total_sessions ?? 0 })));
      setCustWaitingCIs((cis ?? []).map((c: {
        id: string; clinic_id: string; status: string; status_flag_history: unknown[];
        customer_id: string | null; checked_in_at: string | null;
      }) => ({
        id: c.id, clinic_id: c.clinic_id, status: c.status,
        status_flag_history: c.status_flag_history ?? [], customer_id: c.customer_id,
        label: `수납대기 내원${c.checked_in_at ? ` · ${format(new Date(c.checked_in_at), 'MM/dd HH:mm')}` : ''}`,
      })));
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [chartNumber, clinicId, isEdit]);

  /** T-20260512-foot-OCR-RECEIPT: OCR 추출 결과 자동기입 콜백 */
  const handleReceiptExtracted = (data: { amount?: number; method?: 'card' | 'cash' | 'transfer'; storagePath?: string }) => {
    if (data.amount) setAmount(String(data.amount));
    if (data.method) setMethod(data.method);
    if (data.storagePath && !memo) setMemo(`영수증: ${data.storagePath}`);
  };

  const save = async () => {
    if (!customerName.trim()) { toast.error('성함을 입력하세요'); return; }
    const amt = parseInt(amount.replace(/[^\d]/g, ''), 10);
    if (!amt || amt <= 0) { toast.error('결제금액을 입력하세요'); return; }

    // ── T-20260714 옵션A: 정본 귀속 선택 시 canonical write-path 경유(closing_manual_payments 미생성) ──
    if (!isEdit && resolvedCust && attrSel !== 'manual') {
      setSaving(true);
      // 매출은 마감일(closeDate) 기준 반영 — created_at 을 마감일+시간(KST)로 세팅.
      const createdAtOverride = `${closeDate}T${(payTime && payTime.length === 5) ? payTime : '12:00'}:00+09:00`;
      let attribution: ManualPayAttribution | null = null;
      if (attrSel.startsWith('pkg:')) attribution = { kind: 'package', packageId: attrSel.slice(4) };
      else if (attrSel.startsWith('ci:')) {
        const ci = custWaitingCIs.find((c) => c.id === attrSel.slice(3));
        if (ci) attribution = { kind: 'checkin', checkIn: ci };
      } else if (attrSel === 'single') attribution = { kind: 'single' };
      if (!attribution) { setSaving(false); toast.error('귀속 대상을 확인하세요'); return; }
      try {
        const res = await recordManualPayment({
          clinicId, customerId: resolvedCust.id, amount: amt, method,
          attribution, memo: memo || undefined, createdAtOverride,
          actor: { id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null },
        });
        setSaving(false);
        toast.success(
          res.route === 'package' ? '패키지 잔금 결제로 기록 (미수 반영)'
          : res.route === 'checkin' ? (res.kanbanResolved ? '수납 완료 — 대기목록 해소' : '수납 기록됨')
          : '단건 결제로 기록',
        );
        onSaved();
      } catch (e) {
        setSaving(false);
        toast.error(e instanceof Error ? e.message : '정본 결제 기록 실패');
      }
      return;
    }

    setSaving(true);
    const payload = {
      clinic_id: clinicId,
      close_date: closeDate,
      pay_time: payTime || null,
      chart_number: chartNumber || null,
      customer_name: customerName.trim(),
      lead_source: leadSource || null,
      visit_type: visitType || null,
      staff_name: staffName || null,
      amount: amt,
      method,
      memo: memo || null,
    };

    let error;
    if (isEdit && editTarget) {
      ({ error } = await supabase
        .from('closing_manual_payments')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editTarget.id));
    } else {
      ({ error } = await supabase.from('closing_manual_payments').insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(isEdit ? '수기 결제내역 수정됨' : '수기 결제내역 추가됨');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '수기 결제내역 수정' : '수기 결제내역 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* T-20260512-foot-OCR-RECEIPT / T-20260522-foot-RECEIPT-OCR-AUTO: 영수증 업로드 + OCR 자동기입 */}
          {!isEdit && (
            <ReceiptUpload onExtracted={handleReceiptExtracted} clinicId={clinicId} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>시간</Label>
              <Input type="time" value={payTime} onChange={e => setPayTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>차트번호</Label>
              <Input placeholder="F-2026-001" value={chartNumber} onChange={e => setChartNumber(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>성함 <span className="text-destructive">*</span></Label>
            <Input placeholder="홍길동" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          {/* T-20260714-foot-DAYCLOSE-MANUAL-PAY (옵션A): 차트번호 해소 시 고객 정본 귀속 선택 */}
          {!isEdit && resolvedCust && (
            <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50/60 p-2">
              <Label className="text-emerald-800">
                고객 연동 <span className="font-normal text-emerald-700">— {resolvedCust.name} 확인됨</span>
              </Label>
              <select
                data-testid="manual-attribution-select"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={attrSel}
                onChange={e => setAttrSel(e.target.value)}
              >
                <option value="manual">수기 내역만 기록 (고객 미연동)</option>
                {custPkgs.map(p => (
                  <option key={p.id} value={`pkg:${p.id}`}>패키지 잔금 · {p.name} (미수 해소)</option>
                ))}
                {custWaitingCIs.map(c => (
                  <option key={c.id} value={`ci:${c.id}`}>{c.label} (수납·대기해소)</option>
                ))}
                <option value="single">단건 결제 (고객 귀속)</option>
              </select>
              {attrSel !== 'manual' && (
                <p className="text-[11px] leading-relaxed text-emerald-700">
                  고객 수납내역·미수에 반영됩니다. (수기 결제내역에는 중복 기록되지 않음)
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>내원경로</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={leadSource}
                onChange={e => setLeadSource(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {LEAD_SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>초진/재진</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={visitType}
                onChange={e => setVisitType(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {VISIT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>결제담당</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={staffName}
              onChange={e => setStaffName(e.target.value)}
            >
              <option value="">— 선택 —</option>
              {/* T-20260522-foot-STAFF-NAME-UNIFY: 수기결제 담당자도 display_name fallback */}
              {staffList.map(s => <option key={s.id} value={s.display_name || s.name}>{s.display_name || s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>결제금액 <span className="text-destructive">*</span></Label>
              <AmountInput
                placeholder="0"
                value={amount}
                onChange={(raw) => setAmount(raw)}
              />
            </div>
            <div className="space-y-1">
              <Label>결제수단</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={method}
                onChange={e => setMethod(e.target.value as 'card' | 'cash' | 'transfer')}
              >
                <option value="card">카드</option>
                <option value="cash">현금</option>
                <option value="transfer">이체</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>메모</Label>
            <Input placeholder="특이사항" value={memo} onChange={e => setMemo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>취소</Button>
          <Button disabled={saving} onClick={save}>
            {saving ? '저장 중…' : isEdit ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// 요약 카드 (총 합계 탭)
// ──────────────────────────────────────────────────────────────

// T-20260526-foot-CLOSING-PAYCOUNT: rows 3번째 요소(선택)에 건 수, totalCount 합계 행 건 수
function SummaryCard({
  title,
  rows,
  total,
  totalCount,
  highlight,
}: {
  title: string;
  /** [label, amount, count?] — count 전달 시 "N건" 표시 (0건도 표기) */
  rows: [string, number, number?][];
  total: number;
  /** 합계 행 건 수 (선택) */
  totalCount?: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40 bg-primary/5' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className={cn('text-sm', highlight && 'text-primary')}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          {rows.map(([label, val, count]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex items-center gap-1.5 tabular-nums">
                {count !== undefined && (
                  <span className="text-xs text-muted-foreground">{count}건</span>
                )}
                {formatAmount(val)}
              </span>
            </div>
          ))}
        </div>
        <div className={cn(
          'mt-3 flex justify-between border-t pt-2 font-semibold',
          highlight ? 'text-base text-primary' : 'text-sm',
        )}>
          <span>합계</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {totalCount !== undefined && (
              <span className={cn('font-normal text-muted-foreground', highlight ? 'text-sm' : 'text-xs')}>
                {totalCount}건
              </span>
            )}
            {formatAmount(total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL — 일일 미수금 박스.
 * 합계(결제수단별) 박스 옆에 동일한 Card 박스 형태로 병치(reporter 스크린샷 핀, F0BB8UA0RDH).
 * §4-A 준수: 패키지 미수 / 진료비 미수를 **별도 줄**로 표기하고, 둘을 합산한 단일 '총 미수금'은
 * 표기하지 않는다(매출 합계와도 묶지 않음). 금액 소스 = footBilling loadCustomerOutstanding(SSOT) 재사용.
 * 미수 없으면 '미수 없음 ₩0' 1줄(공간 낭비/스크롤 없음).
 */
function DailyOutstandingCard({
  packageDue,
  consultationDue,
  dueCustomerCount,
}: {
  packageDue: number;
  consultationDue: number;
  dueCustomerCount: number;
}) {
  const hasDue = packageDue > 0 || consultationDue > 0;
  return (
    <Card data-testid="closing-daily-outstanding" className="border-rose-300/60 bg-rose-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm text-rose-700">
          일일 미수금
          {hasDue && (
            <span className="text-xs font-normal text-rose-500">{dueCustomerCount}명</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasDue ? (
          <div className="space-y-1.5 text-sm">
            {packageDue > 0 && (
              <div data-testid="closing-outstanding-package" className="flex justify-between">
                <span className="text-muted-foreground">패키지 미수</span>
                <span className="tabular-nums font-semibold text-rose-700">{formatAmount(packageDue)}</span>
              </div>
            )}
            {consultationDue > 0 && (
              <div data-testid="closing-outstanding-consultation" className="flex justify-between">
                <span className="text-muted-foreground">진료비 미수</span>
                <span className="tabular-nums font-semibold text-rose-700">{formatAmount(consultationDue)}</span>
              </div>
            )}
          </div>
        ) : (
          <div data-testid="closing-outstanding-none" className="flex justify-between text-sm">
            <span className="text-muted-foreground">미수 없음</span>
            <span className="tabular-nums text-muted-foreground">{formatAmount(0)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// T-20260522-foot-CLOSING-REFUND: 환불 처리 다이얼로그
// T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT:
//   단일행 → 고객의 환불 가능 결제행 묶음(rows[])을 유형별(패키지/진료비/단건)로 구분 표기 +
//   항목 선택(체크박스) + 선택 합산 표시 후 일괄 환불. money-path 는 기존 RPC 재사용:
//     단건(source='payment'): 금액(잔여 이내 편집 가능)+수단+사유 → refund_single_payment RPC
//     패키지(source='package'): 선택 결제행 amount 바인딩 → refund_package_payment RPC
//   (T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 견적 refund_package_atomic 폐용)
//   [FOLD] AC-B1: 완전환불(잔여 0) 행은 체크박스 비활성(재환불 차단).
// ──────────────────────────────────────────────────────────────

interface ClosingRefundDialogProps {
  open: boolean;
  /** 같은 고객의 환불 가능 결제행 묶음(payment/package, 환불행 제외). */
  rows: EnrichedRow[];
  clinicId: string;
  onClose: () => void;
  onSuccess: () => void;
}

// 유형별 그룹 정의 — AC-1(패키지/진료비/단건 3종 시각 구분).
//   ⚠ 진료비 vs 단건: 확정 카테고리 필드가 스키마에 없어 pay_check_in_id(내원 종속) 유무로 heuristic 분류.
//     label 전용이며 환불 금액 산출(money-path)에는 영향 없음. planner FOLLOWUP(scenario_missing)로 구분키 확인.
const REFUND_GROUP_DEFS: { key: string; label: string; sub: string; match: (r: EnrichedRow) => boolean }[] = [
  { key: 'package', label: '패키지(회차권) 결제', sub: '남은 결제 금액 기준', match: r => r.source === 'package' },
  { key: 'consult', label: '진료비', sub: '수납 금액 기준', match: r => r.source === 'payment' && !!r.pay_check_in_id },
  { key: 'single', label: '단건 결제', sub: '수납 금액 기준', match: r => r.source === 'payment' && !r.pay_check_in_id },
];

function refundRowKey(r: EnrichedRow): string {
  return r.source === 'package' ? `pkg:${r.pkg_payment_id}` : `pay:${r.payment_id}`;
}

function ClosingRefundDialog({ open, rows, clinicId, onClose, onSuccess }: ClosingRefundDialogProps) {
  const customerName = rows[0]?.customer_name ?? '-';

  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>(
    (['card', 'cash', 'transfer'].includes(rows[0]?.method ?? '') ? rows[0]!.method : 'card') as 'card' | 'cash' | 'transfer',
  );
  const [refundMemo, setRefundMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 행별 잔여 환불가능액(원결제 − 기존 환불). null = 로딩 전.
  const [remainingMap, setRemainingMap] = useState<Record<string, number> | null>(null);
  // 선택된 행 키.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 단건(payment) 행별 환불 입력 금액(문자열). 기본값 = 잔여. 패키지는 잔여 고정(편집 불가).
  const [amountMap, setAmountMap] = useState<Record<string, string>>({});

  // 오픈 시 rows 전체의 기존 환불액 조회 → 잔여 산출 + 입력 기본값 세팅.
  //   (T-20260713-SINGLE-PAY-MISSING AC-3 / T-20260714 잔여 산출 로직을 행 묶음으로 확장 — money-path 동일.)
  useEffect(() => {
    if (!open) return;
    (async () => {
      const payIds = rows.filter(r => r.source === 'payment' && r.payment_id).map(r => r.payment_id!) as string[];
      const pkgIds = rows.filter(r => r.source === 'package' && r.pkg_payment_id).map(r => r.pkg_payment_id!) as string[];
      const priorPay: Record<string, number> = {};
      const priorPkg: Record<string, number> = {};
      if (payIds.length > 0) {
        const { data } = await supabase
          .from('payments')
          .select('linked_payment_id, amount')
          .eq('payment_type', 'refund')
          .neq('status', 'deleted')
          .in('linked_payment_id', payIds);
        for (const r of (data ?? []) as { linked_payment_id: string | null; amount: number | null }[]) {
          if (r.linked_payment_id) priorPay[r.linked_payment_id] = (priorPay[r.linked_payment_id] ?? 0) + (r.amount ?? 0);
        }
      }
      if (pkgIds.length > 0) {
        const { data } = await supabase
          .from('package_payments')
          .select('parent_payment_id, amount')
          .eq('payment_type', 'refund')
          .in('parent_payment_id', pkgIds);
        for (const r of (data ?? []) as { parent_payment_id: string | null; amount: number | null }[]) {
          if (r.parent_payment_id) priorPkg[r.parent_payment_id] = (priorPkg[r.parent_payment_id] ?? 0) + (r.amount ?? 0);
        }
      }
      const remMap: Record<string, number> = {};
      const amtMap: Record<string, string> = {};
      for (const r of rows) {
        const key = refundRowKey(r);
        let prior = 0;
        if (r.source === 'payment' && r.payment_id) prior = priorPay[r.payment_id] ?? 0;
        if (r.source === 'package' && r.pkg_payment_id) prior = priorPkg[r.pkg_payment_id] ?? 0;
        const rem = Math.max(0, r.amount - prior);
        remMap[key] = rem;
        amtMap[key] = String(rem);
      }
      setRemainingMap(remMap);
      setAmountMap(amtMap);
    })();
  }, [open, rows]);

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 단건 행 선택 시 금액 검증(1원 ≤ 입력 ≤ 잔여).
  const paymentItemError = (r: EnrichedRow): string | null => {
    const key = refundRowKey(r);
    const rem = remainingMap?.[key];
    if (rem == null) return null;
    if (rem <= 0) return '이미 전액 환불됨';
    const a = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
    if (!a || a <= 0) return '금액 입력 필요';
    if (a > rem) return `잔여 ${formatAmount(rem)} 초과`;
    return null;
  };

  // 선택 항목 환불 금액 합산(AC-3): 단건=입력액, 패키지=잔여.
  //   money-path 가드: 단건 입력이 잔여 초과/0/NaN이면 합산에서 무효(0 처리)
  //   → 선택 합계가 환불 가능 금액을 초과 표기하지 않음(E2E selectedSum helper와 동기화).
  const selectedSum = rows.reduce((s, r) => {
    const key = refundRowKey(r);
    if (!selected.has(key)) return s;
    if (r.source === 'package') return s + (remainingMap?.[key] ?? 0);
    const rem = remainingMap?.[key] ?? 0;
    const a = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
    return s + (!isNaN(a) && a > 0 && a <= rem ? a : 0);
  }, 0);

  // 선택된 단건 중 금액 오류가 하나라도 있으면 확정 불가(money-path 가드).
  const hasSelectedError = rows.some(
    r => selected.has(refundRowKey(r)) && r.source === 'payment' && paymentItemError(r) != null,
  );

  // AC-5: 선택 0건 / 사유 미입력 / 금액 오류 → 확정 비활성.
  const confirmDisabled = submitting || selected.size === 0 || !refundMemo.trim() || hasSelectedError;

  const handleSubmit = async () => {
    if (selected.size === 0) { toast.error('환불할 항목을 선택해 주세요.'); return; }
    if (!refundMemo.trim()) { toast.error('환불 사유를 입력해 주세요.'); return; }
    if (hasSelectedError) { toast.error('선택한 항목의 환불 금액을 확인해 주세요.'); return; }

    const targets = rows.filter(r => selected.has(refundRowKey(r)));
    if (!window.confirm(`선택한 ${targets.length}개 항목 · 합계 ${formatAmount(selectedSum)}을 환불하시겠습니까?`)) return;

    setSubmitting(true);
    let okCount = 0;
    const failMsgs: string[] = [];

    // 선택 항목을 순차 처리(각 건은 기존 단건/패키지 RPC 재사용 — 신규 파라미터/스키마 무접점).
    for (const r of targets) {
      const key = refundRowKey(r);
      const rem = remainingMap?.[key] ?? 0;
      if (rem <= 0) { failMsgs.push(`${r.customer_name}: 이미 전액 환불됨`); continue; }

      if (r.source === 'package') {
        if (!r.pkg_payment_id) { failMsgs.push('패키지 결제행 없음'); continue; }
        const { data, error } = await supabase.rpc('refund_package_payment', {
          p_payment_id: r.pkg_payment_id,
          p_method: method,
        });
        if (error) { failMsgs.push(`패키지 환불 실패: ${error.message}`); continue; }
        const result = data as { ok?: boolean; error?: string };
        if (result?.error) { failMsgs.push(result.error); continue; }
        okCount += 1;
      } else {
        if (!r.payment_id) { failMsgs.push('결제행 없음'); continue; }
        const amt = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
        if (!amt || amt <= 0 || amt > rem) { failMsgs.push(`${r.customer_name}: 환불 금액 오류`); continue; }
        const { data, error } = await supabase.rpc('refund_single_payment', {
          p_payment_id: r.payment_id,
          p_clinic_id: clinicId,
          p_amount: amt,
          p_method: method,
          p_memo: refundMemo.trim(),
        });
        if (error) { failMsgs.push(`환불 실패: ${error.message}`); continue; }
        const result = data as { ok?: boolean; error?: string };
        if (result?.error) { failMsgs.push(result.error); continue; }
        okCount += 1;
      }
    }

    setSubmitting(false);

    if (okCount > 0 && failMsgs.length === 0) {
      toast.success(`환불 처리 완료 (${okCount}건)`);
    } else if (okCount > 0) {
      toast.error(`일부만 처리됨 (성공 ${okCount}건 / 실패 ${failMsgs.length}건): ${failMsgs[0]}`);
    } else {
      toast.error(failMsgs[0] ?? '환불 처리 실패');
    }
    if (okCount > 0) onSuccess();
  };

  const loading = remainingMap == null;
  // 표기 그룹 구성(빈 그룹은 렌더 스킵).
  const groups = REFUND_GROUP_DEFS
    .map(def => ({ ...def, items: rows.filter(def.match) }))
    .filter(g => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="closing-refund-dialog">
        <DialogHeader>
          <DialogTitle>환불 처리 — {customerName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">환불할 항목을 선택하세요. 유형별로 구분되어 표시됩니다.</p>

          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중…</div>
          ) : (
            <div className="space-y-3" data-testid="refund-item-list">
              {/* AC-1/AC-2: 유형별(패키지/진료비/단건) 섹션 구분 + 각 항목 환불 가능 금액 표기 */}
              {groups.map(g => (
                <div key={g.key} className="space-y-1.5" data-testid={`refund-group-${g.key}`}>
                  <div className="flex items-baseline justify-between border-b border-teal-100 pb-0.5">
                    <span className="text-xs font-semibold text-teal-700">{g.label}</span>
                    <span className="text-[10px] text-muted-foreground">{g.sub}</span>
                  </div>
                  {g.items.map(r => {
                    const key = refundRowKey(r);
                    const rem = remainingMap?.[key] ?? 0;
                    const fully = rem <= 0;
                    const checked = selected.has(key);
                    const itemErr = r.source === 'payment' && checked ? paymentItemError(r) : null;
                    return (
                      <div
                        key={key}
                        data-testid="refund-item"
                        className={cn(
                          'rounded-lg border p-2.5 space-y-1.5 transition-colors',
                          checked ? 'border-teal-500 bg-teal-50/60' : 'border-input',
                          fully && 'opacity-60',
                        )}
                      >
                        <label className={cn('flex items-center gap-2.5', fully ? 'cursor-not-allowed' : 'cursor-pointer')}>
                          <input
                            type="checkbox"
                            data-testid="refund-item-checkbox"
                            className="h-5 w-5 accent-teal-600"
                            checked={checked}
                            disabled={fully}
                            onChange={() => toggleSelect(key)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                {r.pay_time} · {METHOD_KO[r.method as keyof typeof METHOD_KO] ?? r.method}
                              </span>
                              <span className="tabular-nums text-sm font-medium">{formatAmount(r.amount)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">
                                {fully ? '환불 가능 잔여 없음' : '환불 가능'}
                              </span>
                              <span className={cn('tabular-nums text-[11px]', fully ? 'text-destructive' : 'text-teal-700 font-medium')} data-testid="refund-item-remaining">
                                {formatAmount(rem)}
                              </span>
                            </div>
                          </div>
                        </label>

                        {/* [FOLD] AC-B1: 완전환불행 → 재환불 불가 표시 */}
                        {fully && (
                          <div className="text-[10px] text-destructive" data-testid="refund-item-fully">이미 전액 환불된 결제입니다 (재환불 불가)</div>
                        )}

                        {/* 단건(진료비/단건) 선택 시 부분 환불 금액 편집 유지(무회귀) — 패키지는 잔여 고정 */}
                        {checked && !fully && r.source === 'payment' && (
                          <div className="pl-7 space-y-1" data-testid="refund-item-amount-field">
                            <AmountInput
                              data-testid="refund-item-amount-input"
                              value={amountMap[key] ?? ''}
                              onChange={raw => setAmountMap(prev => ({ ...prev, [key]: raw }))}
                              placeholder={String(rem)}
                              className={cn('h-9', itemErr && 'border-destructive')}
                            />
                            {itemErr ? (
                              <p className="text-[11px] text-destructive" data-testid="refund-item-amount-error">{itemErr}</p>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">최대 {formatAmount(rem)} · 일부 금액만도 환불 가능</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* AC-3: 선택 항목 환불 금액 합산 */}
              <div className="rounded-lg bg-muted/60 px-3 py-2 flex items-center justify-between" data-testid="refund-selected-sum">
                <span className="text-xs text-muted-foreground">선택 {selected.size}건 환불 합계</span>
                <span className="tabular-nums text-lg font-bold text-teal-700">{formatAmount(selectedSum)}</span>
              </div>
            </div>
          )}

          {/* 환불수단 선택 */}
          <div className="space-y-1">
            <Label>환불수단 <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {(['card', 'cash', 'transfer'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    'min-h-[40px] rounded-md border text-sm transition-colors',
                    method === m
                      ? 'border-teal-600 bg-teal-50 text-teal-700 font-medium'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {METHOD_KO[m]}
                </button>
              ))}
            </div>
          </div>

          {/* 사유 (필수) */}
          <div className="space-y-1">
            <Label>환불 사유 <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              value={refundMemo}
              onChange={e => setRefundMemo(e.target.value)}
              placeholder="예: 고객 요청, 시술 불만족 등"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>취소</Button>
          <Button
            data-testid="refund-submit"
            variant="destructive"
            disabled={confirmDisabled}
            onClick={handleSubmit}
          >
            {submitting ? '처리 중…' : `환불 확정${selected.size > 0 ? ` (${selected.size}건)` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// 정산 행 (총 합계 탭)
// ──────────────────────────────────────────────────────────────

function ReconRow({
  label,
  system,
  actual,
  diff,
  onChange,
  disabled,
}: {
  label: string;
  system: number;
  actual: number;
  diff: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          시스템: <span className="tabular-nums">{formatAmount(system)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AmountInput
          value={actual}
          onChange={(raw) => onChange(Number(raw) || 0)}
          disabled={disabled}
        />
        <div className={
          'w-28 shrink-0 text-right text-sm tabular-nums ' +
          (diff === 0 ? 'text-muted-foreground' : diff > 0 ? 'text-emerald-700' : 'text-destructive')
        }>
          차이 {diff > 0 ? '+' : ''}{formatAmount(diff)}
        </div>
      </div>
    </div>
  );
}
