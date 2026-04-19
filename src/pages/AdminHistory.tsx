import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatQueueNumber, maskPhone } from '@/lib/i18n';
import { getSelectedClinic } from '@/lib/clinic';
import { format, addDays, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdminLayout from '@/components/AdminLayout';

interface HistoryRecord {
  id: string;
  queue_number: number;
  customer_name: string;
  customer_phone: string;
  status: string;
  checked_in_at: string | null;
  completed_at: string | null;
  customer_id: string | null;
  notes: string | null;
  reservation_id: string | null;
}

interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  installment: number;
  memo: string | null;
  check_in_id: string;
}

interface CheckInService {
  id: string;
  service_name: string;
  price: number;
}

interface ReservationRecord {
  id: string;
  reservation_time: string;
  status: string;
  memo: string | null;
  customers?: { name: string; phone: string } | null;
}

import { STATUS_KO, getStatusBadgeClass } from '@/lib/status-colors';

const STATUS_BADGE: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.entries(STATUS_KO).map(([k, v]) => [k, { label: k === 'done' ? '시술완료' : v, color: getStatusBadgeClass(k) }])
);

export default function AdminHistory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);

  // Detail sheet
  const [detailRecord, setDetailRecord] = useState<HistoryRecord | null>(null);
  const [detailServices, setDetailServices] = useState<CheckInService[]>([]);
  const [detailPayment, setDetailPayment] = useState<PaymentRecord | null>(null);

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

    // Check-ins for the date
    const { data: ciData } = await supabase.from('check_ins')
      .select('id, queue_number, customer_name, customer_phone, status, checked_in_at, completed_at, customer_id, notes, reservation_id')
      .eq('clinic_id', cId)
      .eq('created_date', dateStr)
      .order('queue_number', { ascending: true });
    setRecords((ciData || []) as HistoryRecord[]);

    // Payments for these check-ins
    if (ciData && ciData.length > 0) {
      const ids = ciData.map((c: any) => c.id);
      const { data: payData } = await supabase.from('payments')
        .select('*')
        .in('check_in_id', ids);
      setPayments((payData || []) as PaymentRecord[]);
    } else {
      setPayments([]);
    }

    // Reservations for the date
    const { data: resData } = await supabase.from('reservations')
      .select('id, reservation_time, status, memo, customers(name, phone)')
      .eq('clinic_id', cId)
      .eq('reservation_date', dateStr)
      .order('reservation_time', { ascending: true });
    setReservations((resData || []) as unknown as ReservationRecord[]);
  }, []);

  useEffect(() => {
    if (clinicId) fetchData(clinicId, selectedDate);
  }, [clinicId, selectedDate, fetchData]);

  const getRecordStatus = (rec: HistoryRecord): string => {
    if (rec.status === 'no_show') return 'no_show';
    if (rec.status === 'done') {
      const payment = payments.find((p) => p.check_in_id === rec.id);
      return payment ? 'done' : 'unpaid';
    }
    return rec.status;
  };

  const openDetail = async (rec: HistoryRecord) => {
    setDetailRecord(rec);
    const { data: svcData } = await supabase.from('check_in_services')
      .select('id, service_name, price').eq('check_in_id', rec.id);
    setDetailServices((svcData || []) as CheckInService[]);
    const p = payments.find((p) => p.check_in_id === rec.id);
    setDetailPayment(p || null);
  };

  const dateStr = format(selectedDate, 'yyyy년 M월 d일 (EEE)', { locale: ko });
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  // Summary stats
  const totalVisits = records.length;
  const totalDone = records.filter((r) => r.status === 'done').length;
  const totalNoShow = records.filter((r) => r.status === 'no_show').length;
  const totalUnpaid = records.filter((r) => r.status === 'done' && !payments.find((p) => p.check_in_id === r.id)).length;
  const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);

  // Reservations not checked in
  const uncheckedRes = reservations.filter((r) => r.status === 'reserved');

  return (
    <AdminLayout clinicName={clinicName} activeTab="queue">
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/dashboard')}>
              <ArrowLeft className="h-4 w-4 mr-1" />대시보드
            </Button>
            <h2 className="text-lg font-bold">이력조회</h2>
          </div>

          {/* Date Navigator */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(subDays(selectedDate, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 h-8">
                  <CalendarIcon className="h-4 w-4" />
                  {dateStr}
                  {isToday && <span className="text-xs text-accent">(오늘)</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedDate(new Date())}>오늘</Button>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <div className="bg-card rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">총 방문</p>
            <p className="text-2xl font-bold">{totalVisits}명</p>
          </div>
          <div className="bg-card rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">시술완료</p>
            <p className="text-2xl font-bold text-green-600">{totalDone}명</p>
          </div>
          <div className="bg-card rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">노쇼</p>
            <p className="text-2xl font-bold text-red-500">{totalNoShow}명</p>
          </div>
          <div className="bg-card rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">미결제</p>
            <p className="text-2xl font-bold text-orange-500">{totalUnpaid}명</p>
          </div>
          <div className="bg-card rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">매출</p>
            <p className="text-2xl font-bold">{totalRevenue.toLocaleString()}원</p>
          </div>
        </div>

        {/* Visits Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">방문 내역</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">번호</TableHead>
                <TableHead>고객</TableHead>
                <TableHead>전화번호</TableHead>
                <TableHead className="text-center">상태</TableHead>
                <TableHead>체크인</TableHead>
                <TableHead>완료</TableHead>
                <TableHead className="text-right">결제액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">방문 내역 없음</TableCell>
                </TableRow>
              ) : (
                records.map((rec) => {
                  const displayStatus = getRecordStatus(rec);
                  const badge = STATUS_BADGE[displayStatus] || STATUS_BADGE.waiting;
                  const payment = payments.find((p) => p.check_in_id === rec.id);
                  return (
                    <TableRow key={rec.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(rec)}>
                      <TableCell className="font-medium">{formatQueueNumber(rec.queue_number)}</TableCell>
                      <TableCell className="font-medium">{rec.customer_name}</TableCell>
                      <TableCell className="text-muted-foreground">{maskPhone(rec.customer_phone)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rec.checked_in_at ? format(new Date(rec.checked_in_at), 'HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rec.completed_at ? format(new Date(rec.completed_at), 'HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {payment ? `${payment.amount.toLocaleString()}원` : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Reservations for this date */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">예약 현황</h3>
            <span className="text-xs text-muted-foreground">{reservations.length}건</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">시간</TableHead>
                <TableHead>고객</TableHead>
                <TableHead>전화번호</TableHead>
                <TableHead className="text-center">상태</TableHead>
                <TableHead>메모</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">예약 없음</TableCell>
                </TableRow>
              ) : (
                reservations.map((res) => {
                  const resStatus = res.status === 'reserved'
                    ? (isToday ? { label: '예약', color: 'bg-blue-100 text-blue-700' } : { label: '노쇼', color: 'bg-red-100 text-red-700' })
                    : res.status === 'checked_in'
                    ? { label: '체크인', color: 'bg-green-100 text-green-700' }
                    : res.status === 'cancelled'
                    ? { label: '취소', color: 'bg-gray-100 text-gray-500' }
                    : { label: res.status, color: 'bg-gray-100 text-gray-500' };
                  return (
                    <TableRow key={res.id}>
                      <TableCell className="font-medium">{res.reservation_time.slice(0, 5)}</TableCell>
                      <TableCell className="font-medium">{res.customers?.name || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{maskPhone(res.customers?.phone || '')}</TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${resStatus.color}`}>{resStatus.label}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{res.memo || '-'}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!detailRecord} onOpenChange={(v) => { if (!v) setDetailRecord(null); }}>
        <SheetContent className="w-[420px] sm:w-[420px] overflow-y-auto">
          <SheetHeader><SheetTitle>방문 상세</SheetTitle></SheetHeader>
          {detailRecord && (
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-lg font-semibold">{detailRecord.customer_name}</h3>
                <p className="text-sm text-muted-foreground">{detailRecord.customer_phone}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatQueueNumber(detailRecord.queue_number)} ·
                  체크인 {detailRecord.checked_in_at ? format(new Date(detailRecord.checked_in_at), 'HH:mm') : '-'} ·
                  완료 {detailRecord.completed_at ? format(new Date(detailRecord.completed_at), 'HH:mm') : '-'}
                </p>
              </div>

              {/* Services */}
              <div>
                <h4 className="text-sm font-semibold mb-2">시술 항목</h4>
                {detailServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">기록 없음</p>
                ) : (
                  <div className="space-y-1">
                    {detailServices.map((s) => (
                      <div key={s.id} className="flex justify-between bg-muted/30 rounded-lg px-3 py-2 text-sm">
                        <span>{s.service_name}</span>
                        <span className="font-medium">{s.price.toLocaleString()}원</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 font-semibold text-sm border-t border-border mt-2">
                      <span>합계</span>
                      <span>{detailServices.reduce((s, sv) => s + sv.price, 0).toLocaleString()}원</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment */}
              <div>
                <h4 className="text-sm font-semibold mb-2">결제 정보</h4>
                {detailPayment ? (
                  <div className="bg-muted/30 rounded-lg px-3 py-2 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>결제액</span>
                      <span className="font-medium">{detailPayment.amount.toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>수단</span>
                      <span>{detailPayment.method === 'card' ? '카드' : detailPayment.method === 'transfer' ? '이체' : '현금'}{detailPayment.installment > 0 ? ` ${detailPayment.installment}개월` : ''}</span>
                    </div>
                    {detailPayment.memo && <p className="text-muted-foreground">{detailPayment.memo}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-orange-500 font-medium">미결제</p>
                )}
              </div>

              {/* Notes */}
              {detailRecord.notes && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">메모 / 이동 이력</h4>
                  <pre className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap font-mono">{detailRecord.notes}</pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}
