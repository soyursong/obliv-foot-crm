import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Lock,
  Plus,
  Printer,
  Save,
  Trash2,
  Unlock,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import { METHOD_KO, STATUS_KO, VISIT_TYPE_KO } from '@/lib/status';
import type { CheckIn, CheckInStatus, Clinic, Staff, VisitType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────

type Method = 'card' | 'cash' | 'transfer' | 'membership';
type PaymentType = 'payment' | 'refund';

interface PaymentRow {
  amount: number;
  method: Method;
  payment_type: PaymentType;
  created_at: string;
  customer_id: string | null;
  installment: number | null;
  memo: string | null;
  check_in_id: string | null;
}

interface PackagePaymentRow {
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
  consultant_id: string | null;
  customer_id: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  chart_number: string | null;
  lead_source: string | null;
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
}

const LEAD_SOURCE_OPTIONS = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];
const VISIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: '초진' },
  { value: 'returning', label: '재진' },
  { value: 'experience', label: '체험' },
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
  const qc = useQueryClient();

  const [tab, setTab] = useState<'summary' | 'payments'>('summary');
  const [date, setDate] = useState(todayStr());
  const [actualCard, setActualCard] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [memo, setMemo] = useState('');
  const [payTarget, setPayTarget] = useState<CheckIn | null>(null);
  const [showManualDialog, setShowManualDialog] = useState(false);

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
        .select('amount, method, payment_type, created_at, customer_id, installment, memo, check_in_id')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
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
        .select('amount, method, payment_type, created_at, customer_id, installment, memo')
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
  const { data: procedureStats = [] } = useQuery<{ service_name: string; count: number; revenue: number }[]>({
    queryKey: ['closing-procedures', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_in_services')
        .select('service_name, price, check_in_id')
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
      for (const row of (data ?? []) as { service_name: string; price: number }[]) {
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
        .select('id, customer_name, visit_type, consultant_id, customer_id')
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
        .select('id, name, chart_number, lead_source')
        .in('id', customerIds);
      if (error) throw error;
      return (data ?? []) as CustomerBasic[];
    },
  });

  // ── 직원 목록 (결제담당 조회) ──────────────────────────────
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff', clinic?.id, 'closing'],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name, role, clinic_id, active, created_at')
        .eq('clinic_id', clinic!.id)
        .eq('active', true)
        .order('name');
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

  // ── 합계 계산 ───────────────────────────────────────────────
  const totals = useMemo(() => {
    const sum = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter(r => r.method === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    const pkgCard = sum(pkgPayments, 'card');
    const pkgCash = sum(pkgPayments, 'cash');
    const pkgTransfer = sum(pkgPayments, 'transfer');
    const singleCard = sum(payments, 'card');
    const singleCash = sum(payments, 'cash');
    const singleTransfer = sum(payments, 'transfer');
    const singleMembership = sum(payments, 'membership');

    const totalCard = pkgCard + singleCard;
    const totalCash = pkgCash + singleCash;
    const totalTransfer = pkgTransfer + singleTransfer;

    const refundAmount =
      payments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0) +
      pkgPayments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);

    const grossTotal = totalCard + totalCash + totalTransfer + singleMembership;

    return {
      pkgCard, pkgCash, pkgTransfer,
      singleCard, singleCash, singleTransfer, singleMembership,
      totalCard, totalCash, totalTransfer,
      refundAmount, grossTotal,
    };
  }, [payments, pkgPayments]);

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

  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffList) map.set(s.id, s.name);
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
      const consultantName = ci?.consultant_id ? (staffMap.get(ci.consultant_id) ?? null) : null;
      const customerName = ci?.customer_name ?? cust?.name ?? '-';

      rows.push({
        sort_key: p.created_at,
        pay_time: format(new Date(p.created_at), 'HH:mm'),
        chart_number: cust?.chart_number ?? null,
        customer_name: customerName,
        lead_source: cust?.lead_source ?? null,
        visit_type_label: visitTypeLabel(ci?.visit_type ?? null),
        staff_name: consultantName,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'payment',
      });
    }

    // 패키지 결제
    for (const p of pkgPayments) {
      const cust = p.customer_id ? customerMap.get(p.customer_id) : null;
      rows.push({
        sort_key: p.created_at,
        pay_time: format(new Date(p.created_at), 'HH:mm'),
        chart_number: cust?.chart_number ?? null,
        customer_name: cust?.name ?? '-',
        lead_source: cust?.lead_source ?? null,
        visit_type_label: '-',
        staff_name: null,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'package',
      });
    }

    // 수기 추가
    for (const m of manualEntries) {
      rows.push({
        sort_key: m.close_date + 'T' + (m.pay_time ?? '00:00') + ':00+09:00',
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
      });
    }

    rows.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    return rows;
  }, [payments, pkgPayments, manualEntries, checkInDetailMap, customerMap, staffMap]);

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
  const exportCSV = () => {
    const rows = [
      ['구분', '카드', '현금', '이체', '멤버십', '합계'],
      ['패키지', totals.pkgCard, totals.pkgCash, totals.pkgTransfer, 0, totals.pkgCard + totals.pkgCash + totals.pkgTransfer],
      ['단건', totals.singleCard, totals.singleCash, totals.singleTransfer, totals.singleMembership, totals.singleCard + totals.singleCash + totals.singleTransfer + totals.singleMembership],
      ['합계', totals.totalCard, totals.totalCash, totals.totalTransfer, totals.singleMembership, totals.grossTotal],
      [],
      ['정산', '시스템', '실제', '차이'],
      ['카드', totals.totalCard, actualCard, cardDiff],
      ['현금', totals.totalCash, actualCash, cashDiff],
      ['총 차이', '', '', totalDiff],
      [],
      ['환불', totals.refundAmount],
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
    const header = ['시간', '차트번호', '성함', '내원경로', '초진/재진', '결제담당', '결제금액', '결제수단', '구분'];
    const dataRows = enrichedRows.map(r => [
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
    const totalRow = ['합계', '', '', '', '', '', enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0), '', ''];

    const wsData = [header, ...dataRows, [], totalRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 컬럼 너비 조정
    ws['!cols'] = [
      { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '결제내역');
    XLSX.writeFile(wb, `결제내역_${date}.xlsx`);
    toast.success('Excel 다운로드 완료');
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
    <div className="space-y-4">
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

      <Tabs value={tab} onValueChange={v => setTab(v as 'summary' | 'payments')}>
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
            <Button variant="ghost" size="icon" onClick={exportCSV} title="CSV 다운로드">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
              <Printer className="h-4 w-4" />
            </Button>
            {isClosed ? (
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
            )}
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
                    <span>{c.customer_name} <span className="text-amber-700">{c.customer_phone ?? ''}</span></span>
                    <span className="text-xs text-amber-700">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 요약 카드 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              title="패키지 결제"
              rows={[
                ['카드', totals.pkgCard],
                ['현금', totals.pkgCash],
                ['이체', totals.pkgTransfer],
              ]}
              total={totals.pkgCard + totals.pkgCash + totals.pkgTransfer}
            />
            <SummaryCard
              title="단건 결제"
              rows={[
                ['카드', totals.singleCard],
                ['현금', totals.singleCash],
                ['이체', totals.singleTransfer],
                ['멤버십', totals.singleMembership],
              ]}
              total={totals.singleCard + totals.singleCash + totals.singleTransfer + totals.singleMembership}
            />
            <SummaryCard
              title="합계 (결제수단별)"
              rows={[
                ['카드 총합', totals.totalCard],
                ['현금 총합', totals.totalCash],
                ['이체 총합', totals.totalTransfer],
                ['환불(차감 포함)', -totals.refundAmount],
              ]}
              total={totals.grossTotal}
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
          {/* 액션 버튼 */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="text-sm text-muted-foreground">
              총 <span className="font-semibold text-foreground">{enrichedRows.length}건</span> ·
              합계 <span className="font-semibold text-emerald-700">{formatAmount(enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowManualDialog(true)}>
                <Plus className="mr-1 h-4 w-4" /> 수기 추가
              </Button>
              <Button variant="outline" size="sm" onClick={exportExcel} title="Excel 다운로드">
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
              </Button>
              <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄/PDF">
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 결제내역 테이블 */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 px-3 text-left font-medium w-14">시간</th>
                      <th className="py-2 px-2 text-left font-medium w-20">차트번호</th>
                      <th className="py-2 px-2 text-left font-medium w-20">성함</th>
                      <th className="py-2 px-2 text-left font-medium w-20">내원경로</th>
                      <th className="py-2 px-2 text-left font-medium w-16">초진/재진</th>
                      <th className="py-2 px-2 text-left font-medium w-20">결제담당</th>
                      <th className="py-2 px-2 text-right font-medium w-24">결제금액</th>
                      <th className="py-2 px-2 text-left font-medium w-16">결제수단</th>
                      <th className="py-2 px-2 text-center font-medium w-16">구분</th>
                      <th className="py-2 px-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                          결제내역이 없습니다
                        </td>
                      </tr>
                    )}
                    {enrichedRows.map((r, i) => (
                      <tr
                        key={`row-${i}`}
                        className={cn(
                          'border-b transition-colors',
                          r.payment_type === 'refund' && 'bg-red-50 text-red-700',
                          r.source === 'manual' && 'bg-sky-50',
                        )}
                      >
                        <td className="py-2 px-3 tabular-nums text-xs">{r.pay_time}</td>
                        <td className="py-2 px-2 text-xs text-muted-foreground">{r.chart_number ?? '-'}</td>
                        <td className="py-2 px-2 font-medium">{r.customer_name}</td>
                        <td className="py-2 px-2 text-xs">{r.lead_source ?? '-'}</td>
                        <td className="py-2 px-2 text-xs">{r.visit_type_label}</td>
                        <td className="py-2 px-2 text-xs">{r.staff_name ?? '-'}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">
                          {r.payment_type === 'refund' ? '-' : ''}{formatAmount(r.amount)}
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
                          {r.source === 'manual' && r.manual_id && (
                            <button
                              onClick={() => deleteManual(r.manual_id!)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {enrichedRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 bg-muted/50 font-semibold">
                        <td colSpan={6} className="py-2 px-3 text-sm">합계</td>
                        <td className="py-2 px-2 text-right tabular-nums text-sm text-emerald-700">
                          {formatAmount(enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}
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
          {enrichedRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['card', 'cash', 'transfer', 'membership'] as const).map(method => {
                const subtotal = enrichedRows
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
        </TabsContent>
      </Tabs>

      {/* 수기 추가 다이얼로그 */}
      {showManualDialog && clinic && (
        <ManualEntryDialog
          clinicId={clinic.id}
          closeDate={date}
          staffList={staffList}
          onClose={() => setShowManualDialog(false)}
          onSaved={() => {
            setShowManualDialog(false);
            qc.invalidateQueries({ queryKey: ['closing-manual', clinic.id, date] });
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
  onClose: () => void;
  onSaved: () => void;
}

function ManualEntryDialog({ clinicId, closeDate, staffList, onClose, onSaved }: ManualEntryDialogProps) {
  const [payTime, setPayTime] = useState(format(new Date(), 'HH:mm'));
  const [chartNumber, setChartNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [visitType, setVisitType] = useState('');
  const [staffName, setStaffName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>('card');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!customerName.trim()) { toast.error('성함을 입력하세요'); return; }
    const amt = parseInt(amount.replace(/[^\d]/g, ''), 10);
    if (!amt || amt <= 0) { toast.error('결제금액을 입력하세요'); return; }

    setSaving(true);
    const { error } = await supabase.from('closing_manual_payments').insert({
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
    });
    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('수기 결제내역 추가됨');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>수기 결제내역 추가</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
              {staffList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>결제금액 <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="text-right tabular-nums"
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
            {saving ? '저장 중…' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// 요약 카드 (총 합계 탭)
// ──────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  rows,
  total,
  highlight,
}: {
  title: string;
  rows: [string, number][];
  total: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40 bg-primary/5' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className={cn('text-sm', highlight && 'text-primary')}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          {rows.map(([label, val]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{formatAmount(val)}</span>
            </div>
          ))}
        </div>
        <div className={cn(
          'mt-3 flex justify-between border-t pt-2 font-semibold',
          highlight ? 'text-base text-primary' : 'text-sm',
        )}>
          <span>합계</span>
          <span className="tabular-nums">{formatAmount(total)}</span>
        </div>
      </CardContent>
    </Card>
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
        <Input
          type="number"
          value={actual}
          onChange={e => onChange(Number(e.target.value) || 0)}
          disabled={disabled}
          className="text-right tabular-nums"
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
