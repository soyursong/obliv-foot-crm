import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Download, Lock, Printer, Save, Unlock } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import { STATUS_KO } from '@/lib/status';
import type { CheckIn, CheckInStatus, Clinic } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { PaymentDialog } from '@/components/PaymentDialog';
import { cn } from '@/lib/utils';

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

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayBoundsISO(date: string): { start: string; end: string } {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

export default function Closing() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [actualCard, setActualCard] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [memo, setMemo] = useState('');
  const [payTarget, setPayTarget] = useState<CheckIn | null>(null);

  const { data: clinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: getClinic,
  });

  const { start, end } = useMemo(() => dayBoundsISO(date), [date]);

  // 단건 결제
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

  // 패키지 결제
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

  // 미수 — 결제대기 상태 체크인
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

  // 시술별 통계
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
          .then(r => (r.data ?? []).map((d: any) => d.id))
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

  // 체크인 고객명 매핑
  const { data: checkInNames = [] } = useQuery<{ id: string; customer_name: string }[]>({
    queryKey: ['closing-checkin-names', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name')
        .eq('clinic_id', clinic!.id)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (error) throw error;
      return (data ?? []) as { id: string; customer_name: string }[];
    },
  });

  const checkInNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of checkInNames) map.set(row.id, row.customer_name);
    return map;
  }, [checkInNames]);

  // 진행 중 — 완료/취소 아닌 체크인
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

  // 기존 마감
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

  // 기존 마감 데이터로 폼 초기화
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

  // 합계 계산
  const totals = useMemo(() => {
    const sum = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter((r) => r.method === method)
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
      payments
        .filter((r) => r.payment_type === 'refund')
        .reduce((s, r) => s + r.amount, 0) +
      pkgPayments
        .filter((r) => r.payment_type === 'refund')
        .reduce((s, r) => s + r.amount, 0);

    const grossTotal = totalCard + totalCash + totalTransfer + singleMembership;

    return {
      pkgCard,
      pkgCash,
      pkgTransfer,
      singleCard,
      singleCash,
      singleTransfer,
      singleMembership,
      totalCard,
      totalCash,
      totalTransfer,
      refundAmount,
      grossTotal,
    };
  }, [payments, pkgPayments]);

  const cardDiff = actualCard - totals.totalCard;
  const cashDiff = actualCash - totals.totalCash;
  const totalDiff = cardDiff + cashDiff;

  const isClosed = existing?.status === 'closed';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['closing', clinic?.id, date] });
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
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    toast.success(close ? '마감 완료' : '저장 완료');
    refresh();
  };

  const reopen = async () => {
    if (!existing) return;
    const { error } = await supabase
      .from('daily_closings')
      .update({ status: 'open', closed_at: null })
      .eq('id', existing.id);
    if (error) {
      toast.error(`재오픈 실패: ${error.message}`);
      return;
    }
    toast.success('재오픈');
    refresh();
  };

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

    const bom = '\uFEFF';
    const escapeCell = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = bom + rows.map((r) => r.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `마감_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV 다운로드 완료');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label>마감일</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          {isClosed && (
            <Badge variant="success" className="mb-1">
              <Lock className="mr-1 h-3 w-3" /> 마감됨
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={exportCSV} title="CSV 다운로드">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
            <Printer className="h-4 w-4" />
          </Button>
          {isClosed ? (
            <Button variant="outline" onClick={() => {
              if (!window.confirm('마감을 재오픈하시겠습니까? 수정이 가능해집니다.')) return;
              reopen();
            }}>
              <Unlock className="mr-1 h-4 w-4" /> 재오픈
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => saveDraft(false)}>
                <Save className="mr-1 h-4 w-4" /> 임시저장 (수정 가능)
              </Button>
              <Button onClick={() => saveDraft(true)}>
                <Lock className="mr-1 h-4 w-4" /> 마감 확정
              </Button>
            </>
          )}
        </div>
      </div>

      {inProgress.length > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-orange-900">
              <AlertTriangle className="h-4 w-4" />
              진행 중 {inProgress.length}건 — 마감 전 확인 필요
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-orange-900">
            {inProgress.map((c) => (
              <button
                key={c.id}
                className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-orange-100 transition text-left"
                onClick={() => navigate('/')}
              >
                <span className="flex items-center gap-2">
                  <span>{c.customer_name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400 text-orange-800">
                    {STATUS_KO[c.status as CheckInStatus] ?? c.status}
                  </Badge>
                </span>
                <span className="text-xs text-orange-700">
                  {format(new Date(c.checked_in_at), 'HH:mm')}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {unpaid.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              미수 경고 — 결제대기 {unpaid.length}건
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-amber-900">
            {unpaid.map((c) => (
              <button
                key={c.id}
                className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-amber-100 transition text-left"
                onClick={async () => {
                  const { data } = await supabase
                    .from('check_ins')
                    .select('*')
                    .eq('id', c.id)
                    .maybeSingle();
                  if (data) setPayTarget(data as CheckIn);
                  else toast.error('체크인을 불러올 수 없습니다');
                }}
                title="클릭하면 결제 처리"
              >
                <span>
                  {c.customer_name}{' '}
                  <span className="text-amber-700">{c.customer_phone ?? ''}</span>
                </span>
                <span className="text-xs text-amber-700">
                  {format(new Date(c.checked_in_at), 'HH:mm')}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

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
          total={
            totals.singleCard + totals.singleCash + totals.singleTransfer + totals.singleMembership
          }
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
                {procedureStats.map((p) => (
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

      {(payments.length > 0 || pkgPayments.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">결제 상세 ({payments.length + pkgPayments.length}건)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">고객</th>
                    <th className="py-1.5 text-left font-medium">구분</th>
                    <th className="py-1.5 text-left font-medium">수단</th>
                    <th className="py-1.5 text-left font-medium">할부</th>
                    <th className="py-1.5 text-right font-medium">금액</th>
                    <th className="py-1.5 text-left font-medium">메모</th>
                    <th className="py-1.5 text-left font-medium">시간</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={`p-${i}`} className={cn('border-b', p.payment_type === 'refund' && 'bg-red-50 text-red-700')}>
                      <td className="py-1.5">{p.check_in_id ? checkInNameMap.get(p.check_in_id) ?? '-' : '-'}</td>
                      <td className="py-1.5">
                        <Badge variant={p.payment_type === 'refund' ? 'destructive' : 'secondary'} className="text-xs">
                          {p.payment_type === 'refund' ? '환불' : '단건'}
                        </Badge>
                      </td>
                      <td className="py-1.5">
                        <Badge variant="outline" className="text-xs">
                          {p.method === 'card' ? '카드' : p.method === 'cash' ? '현금' : p.method === 'transfer' ? '이체' : '멤버십'}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-xs">{p.installment ? `${p.installment}개월` : '-'}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground max-w-[120px] truncate">{p.memo ?? ''}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{format(new Date(p.created_at), 'HH:mm')}</td>
                    </tr>
                  ))}
                  {pkgPayments.map((p, i) => (
                    <tr key={`pkg-${i}`} className={cn('border-b', p.payment_type === 'refund' && 'bg-red-50 text-red-700')}>
                      <td className="py-1.5">-</td>
                      <td className="py-1.5">
                        <Badge variant={p.payment_type === 'refund' ? 'destructive' : 'default'} className="text-xs">
                          {p.payment_type === 'refund' ? '환불' : '패키지'}
                        </Badge>
                      </td>
                      <td className="py-1.5">
                        <Badge variant="outline" className="text-xs">
                          {p.method === 'card' ? '카드' : p.method === 'cash' ? '현금' : '이체'}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-xs">{p.installment ? `${p.installment}개월` : '-'}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground max-w-[120px] truncate">{p.memo ?? ''}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{format(new Date(p.created_at), 'HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">실제 정산</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ReconRow
              label="카드"
              system={totals.totalCard}
              actual={actualCard}
              diff={cardDiff}
              onChange={setActualCard}
              disabled={isClosed}
            />
            <ReconRow
              label="현금"
              system={totals.totalCash}
              actual={actualCash}
              diff={cashDiff}
              onChange={setActualCash}
              disabled={isClosed}
            />
          </div>
          <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-4 py-2 text-sm">
            <span className="font-medium">총 차이</span>
            <span
              className={
                totalDiff === 0
                  ? 'font-semibold'
                  : totalDiff > 0
                    ? 'font-semibold text-emerald-700'
                    : 'font-semibold text-destructive'
              }
            >
              {totalDiff > 0 ? '+' : ''}
              {formatAmount(totalDiff)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">메모</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="특이사항을 입력하세요"
            disabled={isClosed}
            rows={3}
          />
        </CardContent>
      </Card>

      <PaymentDialog
        checkIn={payTarget}
        onClose={() => setPayTarget(null)}
        onPaid={() => {
          setPayTarget(null);
          qc.invalidateQueries({ queryKey: ['closing-unpaid'] });
          qc.invalidateQueries({ queryKey: ['closing-payments'] });
        }}
      />
    </div>
  );
}

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
    <Card className={highlight ? 'border-primary/40' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
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
        <div className="mt-3 flex justify-between border-t pt-2 text-sm font-semibold">
          <span>합계</span>
          <span className="tabular-nums">{formatAmount(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

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
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          disabled={disabled}
          className="text-right tabular-nums"
        />
        <div
          className={
            'w-28 shrink-0 text-right text-sm tabular-nums ' +
            (diff === 0
              ? 'text-muted-foreground'
              : diff > 0
                ? 'text-emerald-700'
                : 'text-destructive')
          }
        >
          차이 {diff > 0 ? '+' : ''}
          {formatAmount(diff)}
        </div>
      </div>
    </div>
  );
}
