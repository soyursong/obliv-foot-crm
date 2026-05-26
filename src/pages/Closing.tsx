import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
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
import { getClinic } from '@/lib/clinic';
import { formatAmount, formatPhone } from '@/lib/format';
import { METHOD_KO, STATUS_KO, VISIT_TYPE_KO } from '@/lib/status';
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
import { PaymentDialog } from '@/components/PaymentDialog';
import { ReceiptUpload } from '@/components/ReceiptUpload';
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
}

interface UnpaidCheckIn {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  status: string;
  checked_in_at: string;
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
  package_id?: string;       // source === 'package' 시 packages.id (refund_package_atomic용)
  row_customer_id?: string;  // refund_package_atomic p_customer_id용
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
  // 임시저장·마감 확정·재오픈·수기수정 버튼은 admin/manager만 표시
  const { profile } = useAuth();
  const isAdminOrManager = profile?.role === 'admin' || profile?.role === 'manager';
  // T-20260525-foot-ROLE-PERM-CUSTOM AC-4: 환불 처리 — admin/manager + consultant/coordinator/therapist
  const canRefund = isAdminOrManager
    || profile?.role === 'consultant'
    || profile?.role === 'coordinator'
    || profile?.role === 'therapist';

  // T-20260525-foot-CLOSING-CALC-BUG AC-1: 탭 상태를 URL hash로 persist
  // 브라우저 새로고침(F5) 시 현재 탭(summary/payments) 유지
  // hash: #payments → "payments" 탭, 그 외 → "summary" 탭 (기본값)
  const tabFromHash = (): 'summary' | 'payments' =>
    location.hash === '#payments' ? 'payments' : 'summary';
  const [tab, setTab] = useState<'summary' | 'payments'>(tabFromHash);

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
  const [memo, setMemo] = useState('');
  const [payTarget, setPayTarget] = useState<CheckIn | null>(null);
  const [showManualDialog, setShowManualDialog] = useState(false);
  /** 수기 수정 대상 (null이면 신규 추가 모드) */
  const [manualEditTarget, setManualEditTarget] = useState<ManualPaymentRow | null>(null);
  /** C2-MANAGER-PAYMENT-MAP: 결제내역 담당자 필터 */
  const [staffFilter, setStaffFilter] = useState('');
  /** T-20260522-foot-CLOSING-REFUND: 환불 처리 대상 결제 행 */
  const [refundTarget, setRefundTarget] = useState<EnrichedRow | null>(null);

  /** T-20260525-foot-CLOSING-NAV-BUG AC-4: 결제내역 테이블 스크롤 위치 보존 */
  const paymentsTableRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);

  const { data: clinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: getClinic,
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
        .select('id, amount, method, payment_type, created_at, customer_id, installment, memo, check_in_id, status, cash_receipt_issued, cash_receipt_type, taxable_amount, tax_exempt_amount')
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
        .select('id, package_id, amount, method, payment_type, created_at, customer_id, installment, memo')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackagePaymentRow[];
    },
  });

  // ── 미수 ────────────────────────────────────────────────────
  const { data: unpaid = [] } = useQuery<UnpaidCheckIn[]>({
    queryKey: ['closing-unpaid', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at')
        .eq('clinic_id', clinic!.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as UnpaidCheckIn[];
    },
  });

  // ── 시술별 통계 ────────────────────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3:
  //   is_package_session=true 항목 제외 — 패키지 차감 세션은 이미 결제된 건
  const { data: procedureStats = [] } = useQuery<{ service_name: string; count: number; revenue: number }[]>({
    queryKey: ['closing-procedures', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_in_services')
        // is_package_session 포함해 JS에서 필터링 (null 안전성)
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
      const byName: Record<string, { count: number; revenue: number }> = {};
      for (const row of (data ?? []) as { service_name: string; price: number; is_package_session?: boolean | null }[]) {
        // T-20260519-foot-PKG-REVENUE-SPLIT: 패키지 세션 항목 제외
        if (row.is_package_session === true) continue;
        const entry = byName[row.service_name] ??= { count: 0, revenue: 0 };
        entry.count++;
        entry.revenue += row.price;
      }
      return Object.entries(byName)
        .map(([service_name, { count, revenue }]) => ({ service_name, count, revenue }))
        .sort((a, b) => b.count - a.count);
    },
  });

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
      const { data, error } = await supabase
        .from('closing_manual_payments')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
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
        .select('id, customer_name, customer_phone, status, checked_in_at')
        .eq('clinic_id', clinic!.id)
        .not('status', 'in', '("done","cancelled","payment_waiting")')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as UnpaidCheckIn[];
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
      setMemo(existing.memo ?? '');
    } else {
      setActualCard(0);
      setActualCash(0);
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
  const totalDiff = cardDiff + cashDiff;
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
        row_customer_id: p.customer_id ?? undefined,
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
        row_customer_id: p.customer_id,
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

    rows.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    return rows;
  }, [payments, pkgPayments, manualEntries, checkInDetailMap, customerMap, staffMap]);

  // C2-MANAGER-PAYMENT-MAP: 담당자 필터 적용
  // T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' 통일
  const filteredEnrichedRows = useMemo<EnrichedRow[]>(() => {
    if (!staffFilter) return enrichedRows;
    return enrichedRows.filter(r => (r.staff_name ?? '미지정') === staffFilter);
  }, [enrichedRows, staffFilter]);

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
    <div className="h-full overflow-auto space-y-4 p-4 md:p-6">
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

          {/* 진행 중 경고 */}
          {inProgress.length > 0 && (
            <Card className="border-orange-300 bg-orange-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-orange-900">
                  <AlertTriangle className="h-4 w-4" />
                  진행 중 {inProgress.length}건 — 마감 전 확인 필요
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-orange-900">
                {inProgress.map(c => (
                  <button
                    key={c.id}
                    className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-orange-100 transition text-left"
                    onClick={() => navigate('/admin', { state: { openCheckInId: c.id } })}
                  >
                    <span className="flex items-center gap-2">
                      <span>{c.customer_name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400 text-orange-800">
                        {STATUS_KO[c.status as CheckInStatus] ?? c.status}
                      </Badge>
                    </span>
                    <span className="text-xs text-orange-700">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 미수 경고 */}
          {unpaid.length > 0 && (
            <Card className="border-amber-300 bg-amber-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  미수 경고 — 결제대기 {unpaid.length}건
                  <span className="ml-1 text-xs font-normal text-amber-700">(클릭 → 결제 처리)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-amber-900">
                {unpaid.map(c => (
                  <button
                    key={c.id}
                    className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-amber-100 transition text-left"
                    onClick={async () => {
                      const { data } = await supabase.from('check_ins').select('*').eq('id', c.id).maybeSingle();
                      if (data) setPayTarget(data as CheckIn);
                      else toast.error('체크인을 불러올 수 없습니다');
                    }}
                  >
                    <span>{c.customer_name} <span className="text-amber-700">{formatPhone(c.customer_phone)}</span></span>
                    <span className="text-xs text-amber-700">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
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
            {totals.manualTotal > 0 && (
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
            )}
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
          </div>

          {/* 시술별 통계 */}
          {procedureStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">시술별 통계 ({procedureStats.reduce((s, p) => s + p.count, 0)}건)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">시술명</th>
                      <th className="py-1.5 text-right font-medium">건수</th>
                      <th className="py-1.5 text-right font-medium">매출</th>
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
                      <td className="py-1.5 text-right tabular-nums">{formatAmount(procedureStats.reduce((s, p) => s + p.revenue, 0))}</td>
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
                placeholder="특이사항을 입력하세요"
                disabled={isClosed}
                rows={3}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════════ 탭 2: 결제내역 ════════════════════════ */}
        <TabsContent value="payments" className="space-y-4">
          {/* C2-MANAGER-PAYMENT-MAP: 담당자 필터 + 액션 버튼 */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                총 <span className="font-semibold text-foreground">{filteredEnrichedRows.length}건</span> ·
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
                  {staffList.filter(s => s.role !== 'director' && s.role !== 'therapist').map(s => (
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
                    {filteredEnrichedRows.map((r, i) => (
                      <tr
                        key={`row-${i}`}
                        className={cn(
                          'border-b transition-colors',
                          r.payment_type === 'refund' && 'bg-red-50 text-red-700',
                          r.source === 'manual' && 'bg-sky-50',
                        )}
                      >
                        <td className="py-2 px-3 tabular-nums text-xs text-muted-foreground">{r.pay_date}</td>
                        <td className="py-2 px-2 tabular-nums text-xs">{r.pay_time}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">{r.chart_number ?? '-'}</td>
                        <td className="py-2 px-2 font-medium">{r.customer_name}</td>
                        <td className="py-2 px-2 text-xs">{r.lead_source ?? '-'}</td>
                        <td className="py-2 px-2 text-xs">{r.visit_type_label}</td>
                        {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' */}
                        <td className="py-2 px-2 text-xs">{r.staff_name ?? <span className="text-muted-foreground/60">미지정</span>}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">
                          {r.payment_type === 'refund' ? '-' : ''}{formatAmount(r.amount)}
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
                          <Badge
                            variant={r.payment_type === 'refund' ? 'destructive' : r.source === 'manual' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {r.payment_type === 'refund' ? '환불' : r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건'}
                          </Badge>
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* T-20260522-foot-CLOSING-REFUND: 환불 버튼 — admin/manager + 이미 환불 아닌 건 + payment/package 소스만 */}
                            {/* T-20260525-foot-ROLE-PERM-CUSTOM AC-5: canRefund(+consultant/coordinator/therapist)로 확장 */}
                            {canRefund && r.payment_type !== 'refund' && (r.source === 'payment' || r.source === 'package') && (
                              <button
                                onClick={() => setRefundTarget(r)}
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
                    ))}
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
          row={refundTarget}
          clinicId={clinic.id}
          onClose={() => setRefundTarget(null)}
          onSuccess={() => {
            setRefundTarget(null);
            refreshPayments();
          }}
        />
      )}

      {/* 결제 처리 다이얼로그 (미수 클릭 시) */}
      <PaymentDialog
        checkIn={payTarget}
        onClose={() => setPayTarget(null)}
        onPaid={() => {
          setPayTarget(null);
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

// ──────────────────────────────────────────────────────────────
// T-20260522-foot-CLOSING-REFUND: 환불 처리 다이얼로그
// 단건(source='payment'): 금액+수단+사유 → refund_single_payment RPC
// 패키지(source='package'): calc_refund_amount 견적+수단+사유 → refund_package_atomic
// ──────────────────────────────────────────────────────────────

interface RefundQuote {
  refund_amount: number;
  total_sessions: number;
  used_sessions: number;
  remaining_sessions: number;
  unit_price: number;
}

interface ClosingRefundDialogProps {
  open: boolean;
  row: EnrichedRow;
  clinicId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ClosingRefundDialog({ open, row, clinicId, onClose, onSuccess }: ClosingRefundDialogProps) {
  const isPackage = row.source === 'package';

  const [pkgQuote, setPkgQuote] = useState<RefundQuote | null>(null);
  const [refundAmountStr, setRefundAmountStr] = useState(String(row.amount));
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>(
    (['card', 'cash', 'transfer'].includes(row.method) ? row.method : 'card') as 'card' | 'cash' | 'transfer',
  );
  const [refundMemo, setRefundMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 다이얼로그 오픈 시 초기화 + 패키지 견적 조회
  useEffect(() => {
    if (!open) {
      setPkgQuote(null);
      setRefundAmountStr(String(row.amount));
      setMethod((['card', 'cash', 'transfer'].includes(row.method) ? row.method : 'card') as 'card' | 'cash' | 'transfer');
      setRefundMemo('');
      return;
    }
    if (isPackage && row.package_id) {
      (async () => {
        const { data } = await supabase.rpc('calc_refund_amount', { p_package_id: row.package_id });
        setPkgQuote(data as RefundQuote | null);
      })();
    }
  }, [open, isPackage, row.package_id, row.method, row.amount]);

  const handleSubmit = async () => {
    if (!refundMemo.trim()) {
      toast.error('환불 사유를 입력해 주세요.');
      return;
    }
    setSubmitting(true);

    if (isPackage) {
      // 패키지 환불: refund_package_atomic 호출
      if (!pkgQuote) {
        toast.error('환불 금액 계산 중입니다. 잠시 후 다시 시도해 주세요.');
        setSubmitting(false);
        return;
      }
      if (!window.confirm(`패키지 환불 금액 ${formatAmount(pkgQuote.refund_amount)}을 환불하시겠습니까?`)) {
        setSubmitting(false);
        return;
      }
      const { data, error } = await supabase.rpc('refund_package_atomic', {
        p_package_id: row.package_id!,
        p_clinic_id: clinicId,
        p_customer_id: row.row_customer_id!,
        p_method: method,
      });
      if (error) { toast.error(`환불 실패: ${error.message}`); setSubmitting(false); return; }
      const result = data as { ok?: boolean; error?: string };
      if (result?.error) { toast.error(result.error); setSubmitting(false); return; }
    } else {
      // 단건 환불: refund_single_payment RPC 호출
      const amt = parseInt(refundAmountStr.replace(/[^\d]/g, ''), 10);
      if (!amt || amt <= 0) { toast.error('환불금액을 입력하세요.'); setSubmitting(false); return; }
      if (amt > row.amount) {
        toast.error(`환불금액이 원결제 금액(${formatAmount(row.amount)})을 초과할 수 없습니다.`);
        setSubmitting(false);
        return;
      }
      const { data, error } = await supabase.rpc('refund_single_payment', {
        p_payment_id: row.payment_id!,
        p_clinic_id: clinicId,
        p_amount: amt,
        p_method: method,
        p_memo: refundMemo.trim(),
      });
      if (error) { toast.error(`환불 실패: ${error.message}`); setSubmitting(false); return; }
      const result = data as { ok?: boolean; error?: string };
      if (result?.error) { toast.error(result.error); setSubmitting(false); return; }
    }

    setSubmitting(false);
    toast.success('환불 처리 완료');
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>환불 처리 — {row.customer_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* 원결제 요약 */}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">원결제금액</span>
              <span className="font-medium tabular-nums">{formatAmount(row.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">결제수단</span>
              <span>{METHOD_KO[row.method as keyof typeof METHOD_KO] ?? row.method}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">구분</span>
              <span>{isPackage ? '패키지' : '단건'}</span>
            </div>
          </div>

          {/* 패키지 환불: 견적 표시 */}
          {isPackage && (
            pkgQuote ? (
              <div className="rounded-lg border bg-teal-50 p-3 space-y-1.5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>총 회차</span>
                  <span className="text-foreground">{pkgQuote.total_sessions}회</span>
                  <span>사용</span>
                  <span className="text-foreground">{pkgQuote.used_sessions}회</span>
                  <span>잔여</span>
                  <span className="text-foreground">{pkgQuote.remaining_sessions}회</span>
                  <span>회당 단가</span>
                  <span className="text-foreground tabular-nums">{formatAmount(pkgQuote.unit_price)}</span>
                </div>
                <div className="mt-1 border-t pt-1.5">
                  <div className="text-xs text-muted-foreground">환불 금액 (할인가 기준)</div>
                  <div className="text-xl font-bold text-teal-700 tabular-nums">{formatAmount(pkgQuote.refund_amount)}</div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-muted-foreground">환불 금액 계산 중…</div>
            )
          )}

          {/* 단건 환불: 금액 입력 */}
          {!isPackage && (
            <div className="space-y-1">
              <Label>환불금액 <span className="text-destructive">*</span></Label>
              <AmountInput
                value={refundAmountStr}
                onChange={(raw) => setRefundAmountStr(raw)}
                placeholder={String(row.amount)}
              />
              <p className="text-[11px] text-muted-foreground">최대 {formatAmount(row.amount)}</p>
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
            variant="destructive"
            disabled={submitting || (isPackage && !pkgQuote)}
            onClick={handleSubmit}
          >
            {submitting ? '처리 중…' : '환불 확인'}
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
