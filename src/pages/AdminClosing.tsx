import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/i18n';
import { getSelectedClinic } from '@/lib/clinic';
import { format, subDays, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdminLayout from '@/components/AdminLayout';

interface PaymentDetail {
  id: string;
  amount: number;
  method: string;
  installment: number;
  memo: string | null;
  check_in_id: string;
  customer_name?: string;
  payment_type?: string;
}

interface DailyClosing {
  id: string;
  close_date: string;
  system_card_total: number;
  system_cash_total: number;
  actual_card_total: number;
  actual_cash_total: number;
  difference: number;
  memo: string | null;
  status: string;
  closed_at: string | null;
}

export default function AdminClosing() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [payments, setPayments] = useState<PaymentDetail[]>([]);
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [actualCard, setActualCard] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [closingMemo, setClosingMemo] = useState('');
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState<'card' | 'cash'>('card');
  const [refundMemo, setRefundMemo] = useState('');
  const [refundCustomer, setRefundCustomer] = useState('');
  const [todayCheckIns, setTodayCheckIns] = useState<{ id: string; customer_name: string; customer_id: string | null }[]>([]);
  const [unpaidCustomers, setUnpaidCustomers] = useState<{ id: string; customer_name: string }[]>([]);
  // 김태영 #12(a): 시술별 집계
  const [serviceStats, setServiceStats] = useState<{ service_name: string; count: number; total: number }[]>([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      const clinic = await getSelectedClinic();
      if (clinic) { setClinicId(clinic.id); setClinicName(clinic.name); }
    };
    init();
  }, [navigate]);

  const fetchData = useCallback(async (cId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');

    // Get check_ins for the day
    const { data: ciData } = await supabase.from('check_ins')
      .select('id, customer_name, status')
      .eq('clinic_id', cId).eq('created_date', dateStr);

    if (ciData && ciData.length > 0) {
      const ciIds = ciData.map((c: any) => c.id);

      // Payments
      const { data: payData } = await supabase.from('payments')
        .select('id, amount, method, installment, memo, check_in_id, payment_type')
        .in('check_in_id', ciIds);

      const enriched = (payData || []).map((p: any) => {
        const ci = ciData.find((c: any) => c.id === p.check_in_id);
        return { ...p, customer_name: ci?.customer_name || '-' };
      });
      setPayments(enriched as PaymentDetail[]);

      // Unpaid count
      const doneCIs = ciData.filter((c: any) => c.status === 'done');
      const paidIds = new Set((payData || []).map((p: any) => p.check_in_id));
      const unpaid = doneCIs.filter((c: any) => !paidIds.has(c.id));
      setUnpaidCount(unpaid.length);
      setUnpaidCustomers(unpaid.map((c: any) => ({ id: c.id, customer_name: c.customer_name })));
      setTodayCheckIns(ciData.map((c: any) => ({ id: c.id, customer_name: c.customer_name, customer_id: null })));

      // 김태영 #12(a): 시술별 집계 (건수·합계)
      const { data: svcData } = await supabase.from('check_in_services')
        .select('service_name, price').in('check_in_id', ciIds);
      const sMap = new Map<string, { count: number; total: number }>();
      (svcData || []).forEach((s: any) => {
        const key = s.service_name || '(미지정)';
        const cur = sMap.get(key) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(s.price) || 0;
        sMap.set(key, cur);
      });
      setServiceStats(Array.from(sMap.entries()).map(([service_name, v]) => ({ service_name, ...v })).sort((a, b) => b.total - a.total));
    } else {
      setPayments([]);
      setUnpaidCount(0);
      setTodayCheckIns([]);
      setServiceStats([]);
    }

    // Existing closing
    const { data: closingData } = await supabase.from('daily_closings')
      .select('*').eq('clinic_id', cId).eq('close_date', dateStr).maybeSingle();

    if (closingData) {
      setClosing(closingData as DailyClosing);
      setActualCard((closingData as DailyClosing).actual_card_total.toLocaleString());
      setActualCash((closingData as DailyClosing).actual_cash_total.toLocaleString());
      setClosingMemo((closingData as DailyClosing).memo || '');
    } else {
      setClosing(null);
      setActualCard('');
      setActualCash('');
      setClosingMemo('');
    }
  }, []);

  useEffect(() => {
    if (clinicId) fetchData(clinicId, selectedDate);
  }, [clinicId, selectedDate, fetchData]);

  const paymentOnly = useMemo(() => payments.filter(p => p.payment_type !== 'refund'), [payments]);
  const refundOnly = useMemo(() => payments.filter(p => p.payment_type === 'refund'), [payments]);
  const { systemCardTotal, systemCashTotal, systemTransferTotal, systemMembershipTotal, systemTotal, totalRefund } = useMemo(() => {
    const sumByMethod = (list: PaymentDetail[], method: string) => list.filter(p => p.method === method).reduce((s, p) => s + p.amount, 0);
    const card = sumByMethod(paymentOnly, 'card') - sumByMethod(refundOnly, 'card');
    const cash = sumByMethod(paymentOnly, 'cash') - sumByMethod(refundOnly, 'cash');
    const transfer = sumByMethod(paymentOnly, 'transfer') - sumByMethod(refundOnly, 'transfer');
    const membership = sumByMethod(paymentOnly, 'membership') - sumByMethod(refundOnly, 'membership');
    return {
      systemCardTotal: card,
      systemCashTotal: cash,
      systemTransferTotal: transfer,
      systemMembershipTotal: membership,
      systemTotal: card + cash + transfer + membership,
      totalRefund: refundOnly.reduce((s, p) => s + p.amount, 0),
    };
  }, [paymentOnly, refundOnly]);

  const parseNum = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0;
  const actualCardNum = parseNum(actualCard);
  const actualCashNum = parseNum(actualCash);
  const actualTotal = actualCardNum + actualCashNum;
  const difference = actualTotal - systemTotal;

  const formatInput = (v: string) => {
    const num = v.replace(/\D/g, '');
    return num ? parseInt(num, 10).toLocaleString() : '';
  };

  const handleSave = async (confirm: boolean) => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const data = {
      clinic_id: clinicId,
      close_date: dateStr,
      system_card_total: systemCardTotal,
      system_cash_total: systemCashTotal,
      actual_card_total: actualCardNum,
      actual_cash_total: actualCashNum,
      difference,
      memo: closingMemo || null,
      status: confirm ? 'confirmed' : 'draft',
      closed_at: confirm ? new Date().toISOString() : null,
    };

    if (closing) {
      const { error } = await supabase.from('daily_closings').update(data).eq('id', closing.id);
      if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    } else {
      const { error } = await supabase.from('daily_closings').insert(data);
      if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    }

    toast({ title: confirm ? '마감 확정 완료' : '임시 저장 완료' });
    fetchData(clinicId, selectedDate);
  };

  const isConfirmed = closing?.status === 'confirmed';
  const dateStr = format(selectedDate, 'yyyy년 M월 d일 (EEE)', { locale: ko });

  return (
    <AdminLayout clinicName={clinicName} activeTab="closing">
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold">일마감 · 매출 대사</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(subDays(selectedDate, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 h-8"><CalendarIcon className="h-4 w-4" />{dateStr}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(addDays(selectedDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Status Banner */}
        {isConfirmed && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">마감 확정됨 · {closing?.closed_at ? format(new Date(closing.closed_at), 'HH:mm') : ''}</span>
          </div>
        )}
        {unpaidCount > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <span className="text-sm text-orange-700">미결제 {unpaidCount}건이 있습니다</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {unpaidCustomers.map((c) => (
                <button key={c.id} className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded hover:bg-orange-200 transition-colors" onClick={() => navigate('/admin/dashboard')}>
                  {c.customer_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* System Totals */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">시스템 카드 합계</p>
            <p className="text-2xl font-bold text-blue-600">{systemCardTotal.toLocaleString()}원</p>
          </div>
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">시스템 현금 합계</p>
            <p className="text-2xl font-bold text-green-600">{systemCashTotal.toLocaleString()}원</p>
          </div>
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">시스템 이체 합계</p>
            <p className="text-2xl font-bold text-purple-600">{systemTransferTotal.toLocaleString()}원</p>
          </div>
          <div className="bg-card rounded-xl border px-4 py-3">
            <p className="text-xs text-muted-foreground">시스템 합계</p>
            <p className="text-2xl font-bold">{systemTotal.toLocaleString()}원</p>
          </div>
        </div>

        {/* Actual Input */}
        <div className="bg-card rounded-xl border p-4 mb-6">
          <h3 className="text-sm font-semibold mb-4">실제 수납액 입력</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">카드 영수증 합계</label>
              <div className="relative">
                <Input
                  value={actualCard}
                  onChange={(e) => setActualCard(formatInput(e.target.value))}
                  disabled={isConfirmed}
                  className="pr-8"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">현금 수납 합계</label>
              <div className="relative">
                <Input
                  value={actualCash}
                  onChange={(e) => setActualCash(formatInput(e.target.value))}
                  disabled={isConfirmed}
                  className="pr-8"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
          </div>

          {/* Comparison */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-muted/50 rounded-lg px-3 py-2">
              <p className="text-xs text-muted-foreground">카드 차이</p>
              <p className={`text-lg font-bold ${actualCardNum - systemCardTotal === 0 ? 'text-green-600' : 'text-red-500'}`}>
                {(actualCardNum - systemCardTotal).toLocaleString()}원
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg px-3 py-2">
              <p className="text-xs text-muted-foreground">현금 차이</p>
              <p className={`text-lg font-bold ${actualCashNum - systemCashTotal === 0 ? 'text-green-600' : 'text-red-500'}`}>
                {(actualCashNum - systemCashTotal).toLocaleString()}원
              </p>
            </div>
            <div className={`rounded-lg px-3 py-2 ${difference === 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="text-xs text-muted-foreground">총 차이</p>
              <p className={`text-lg font-bold ${difference === 0 ? 'text-green-600' : 'text-red-500'}`}>
                {actualTotal > 0 && (difference === 0 ? ' \u2705' : ' \u274C')}
                {difference > 0 ? '+' : ''}{difference.toLocaleString()}원
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">메모 (차이 사유 등)</label>
            <Textarea value={closingMemo} onChange={(e) => setClosingMemo(e.target.value)} disabled={isConfirmed} rows={2} placeholder="차이가 있는 경우 사유를 기록해 주세요" />
          </div>

          {!isConfirmed ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleSave(false)} className="flex-1">임시 저장</Button>
              <Button onClick={() => handleSave(true)} className="flex-1 bg-accent text-accent-foreground">마감 확정</Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full text-orange-600 border-orange-300" onClick={async () => {
              if (!window.confirm('마감 확정을 해제하시겠습니까?')) return;
              if (closing) {
                const { error } = await supabase.from('daily_closings').update({ status: 'draft', closed_at: null }).eq('id', closing.id);
                if (error) { toast({ title: '마감 해제 실패', description: error.message, variant: 'destructive' }); return; }
                fetchData(clinicId, selectedDate);
                toast({ title: '마감 해제 완료' });
              }
            }}>마감 해제</Button>
          )}
        </div>

        {/* Refund summary */}
        {totalRefund > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
            <span className="text-sm text-red-700">환불 {refundOnly.length}건 · {totalRefund.toLocaleString()}원</span>
          </div>
        )}

        {/* 김태영 #12(a): 시술별 집계 */}
        {serviceStats.length > 0 && (
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">시술별 집계 ({serviceStats.length}종)</h3>
              <span className="text-xs text-muted-foreground">
                총 {serviceStats.reduce((s, r) => s + r.count, 0)}건 · {serviceStats.reduce((s, r) => s + r.total, 0).toLocaleString()}원
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>시술</TableHead>
                  <TableHead className="text-center">건수</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceStats.map((s) => (
                  <TableRow key={s.service_name}>
                    <TableCell className="font-medium">{s.service_name}</TableCell>
                    <TableCell className="text-center">{s.count}건</TableCell>
                    <TableCell className="text-right font-medium">{s.total.toLocaleString()}원</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Payment Details */}
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">결제 내역 ({paymentOnly.length}건)</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200" onClick={() => setRefundOpen(true)}>환불 등록</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>고객</TableHead>
                <TableHead className="text-center">수단</TableHead>
                <TableHead className="text-center">할부</TableHead>
                <TableHead className="text-right">금액</TableHead>
                <TableHead>메모</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">결제 내역 없음</TableCell></TableRow>
              ) : (
                <>
                  {paymentOnly.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.customer_name}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.method === 'card' ? 'bg-blue-100 text-blue-700' : p.method === 'transfer' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                          {p.method === 'card' ? '카드' : p.method === 'transfer' ? '이체' : p.method === 'membership' ? '멤버십' : '현금'}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {p.method === 'card' ? (p.installment > 0 ? `${p.installment}개월` : '일시불') : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">{p.amount.toLocaleString()}원</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{p.memo || '-'}</span>
                          {!isConfirmed && (
                            <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 border-red-200 hover:bg-red-50 shrink-0" onClick={async () => {
                              const amt = parseInt(prompt(`환불 금액 (최대 ${p.amount.toLocaleString()}원):`) || '0', 10);
                              if (!amt || amt <= 0 || amt > p.amount) return;
                              const { error: refundErr } = await supabase.from('payments').insert({
                                check_in_id: p.check_in_id, customer_id: (p as any).customer_id || null,
                                amount: amt, method: p.method, payment_type: 'refund',
                                memo: `환불(${p.customer_name}) ${p.amount.toLocaleString()}→${(p.amount - amt).toLocaleString()}`,
                              } as any);
                              if (refundErr) { toast({ title: '환불 등록 실패', description: refundErr.message, variant: 'destructive' }); return; }
                              toast({ title: '환불 등록', description: `${p.customer_name} ${amt.toLocaleString()}원` });
                              fetchData(clinicId, selectedDate);
                            }}>환불</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {refundOnly.map((p) => (
                    <TableRow key={p.id} className="bg-red-50/50">
                      <TableCell className="font-medium text-red-600">{p.customer_name} (환불)</TableCell>
                      <TableCell className="text-center">
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">{p.method === 'card' ? '카드' : p.method === 'transfer' ? '이체' : p.method === 'membership' ? '멤버십' : '현금'}</span>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-right font-medium text-red-600">-{p.amount.toLocaleString()}원</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{p.memo || '-'}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 bg-muted/30">
                    <TableCell className="font-bold">합계</TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      카드 {paymentOnly.filter(p => p.method === 'card').length} / 현금 {paymentOnly.filter(p => p.method === 'cash').length} / 이체 {paymentOnly.filter(p => p.method === 'transfer').length} / 멤버십 {paymentOnly.filter(p => p.method === 'membership').length}
                      {refundOnly.length > 0 && ` / 환불 ${refundOnly.length}`}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold">{systemTotal.toLocaleString()}원</TableCell>
                    <TableCell />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {/* Refund Modal */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>환불 등록</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">고객 선택</label>
              {todayCheckIns.length > 0 ? (
                <select value={refundCustomer} onChange={(e) => setRefundCustomer(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">선택해주세요</option>
                  {todayCheckIns.map((ci) => (
                    <option key={ci.id} value={ci.customer_name}>{ci.customer_name}</option>
                  ))}
                </select>
              ) : (
                <Input value={refundCustomer} onChange={(e) => setRefundCustomer(e.target.value)} placeholder="환불 대상 고객" />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">환불 금액</label>
              <div className="relative">
                <Input value={refundAmount} onChange={(e) => setRefundAmount(formatInput(e.target.value))} placeholder="0" className="pr-8" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">환불 수단</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={refundMethod === 'card'} onChange={() => setRefundMethod('card')} className="accent-red-500" />
                  <span className="text-sm">카드</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={refundMethod === 'cash'} onChange={() => setRefundMethod('cash')} className="accent-red-500" />
                  <span className="text-sm">현금</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">사유</label>
              <Input value={refundMemo} onChange={(e) => setRefundMemo(e.target.value)} placeholder="환불 사유" />
            </div>
            <Button className="w-full bg-red-500 text-white hover:bg-red-600" disabled={!refundCustomer.trim() || !refundAmount}
              onClick={async () => {
                const amt = parseNum(refundAmount);
                if (amt <= 0) return;
                // Find a done check-in for this customer today (or create a dummy reference)
                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                const { data: ci } = await supabase.from('check_ins')
                  .select('id, customer_id').eq('clinic_id', clinicId).eq('created_date', dateStr)
                  .ilike('customer_name', `%${refundCustomer.trim()}%`).eq('status', 'done').limit(1).maybeSingle();
                const { error: refErr } = await supabase.from('payments').insert({
                  check_in_id: ci?.id || null,
                  customer_id: ci?.customer_id || null,
                  amount: amt, method: refundMethod, payment_type: 'refund',
                  memo: `환불: ${refundMemo || refundCustomer}`,
                });
                if (refErr) { toast({ title: '환불 등록 실패', description: refErr.message, variant: 'destructive' }); return; }
                setRefundOpen(false); setRefundAmount(''); setRefundMemo(''); setRefundCustomer('');
                fetchData(clinicId, selectedDate);
                toast({ title: '환불 등록 완료' });
              }}>환불 등록</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
