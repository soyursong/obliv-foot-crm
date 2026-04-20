import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Download, Lock, Printer, Save, Unlock } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import type { Clinic } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

type Method = 'card' | 'cash' | 'transfer' | 'membership';
type PaymentType = 'payment' | 'refund';

interface PaymentRow {
  amount: number;
  method: Method;
  payment_type: PaymentType;
  created_at: string;
  customer_id: string | null;
}

interface PackagePaymentRow {
  amount: number;
  method: 'card' | 'cash' | 'transfer';
  payment_type: PaymentType;
  created_at: string;
  customer_id: string;
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
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [actualCard, setActualCard] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [memo, setMemo] = useState('');

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
        .select('amount, method, payment_type, created_at, customer_id')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end);
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
        .select('amount, method, payment_type, created_at, customer_id')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end);
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
              <div key={c.id} className="flex justify-between">
                <span>
                  {c.customer_name}{' '}
                  <span className="text-amber-700">{c.customer_phone ?? ''}</span>
                </span>
                <span className="text-xs text-amber-700">
                  {format(new Date(c.checked_in_at), 'HH:mm')}
                </span>
              </div>
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
