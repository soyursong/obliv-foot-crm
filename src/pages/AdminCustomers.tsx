import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/i18n';
import { STATUS_KO, getStatusBadgeClass } from '@/lib/status-colors';
import { getSelectedClinic } from '@/lib/clinic';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';

interface Customer { id: string; name: string; phone: string; memo: string | null; created_at: string; updated_at?: string | null; resident_id?: string | null; created_by?: string | null; }
interface VisitRecord { id: string; checked_in_at: string; status: string; queue_number: number; referral_source?: string; treatment_memo?: string | null; notes?: string | null; }
interface PaymentRecord { id: string; amount: number; method: string; installment: number; memo: string | null; created_at: string; check_in_id: string | null; }
interface ReservationRecord { id: string; reservation_date: string; reservation_time: string; status: string; memo: string | null; reservation_type?: string | null; reservation_type_etc?: string | null; }
interface ServiceRecord { service_name: string; price: number; check_in_id: string; }

export default function AdminCustomers() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [totalPayments, setTotalPayments] = useState<Record<string, number>>({});
  const [lastVisits, setLastVisits] = useState<Record<string, string>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCountryCode, setNewCountryCode] = useState('+82');
  const [newMemo, setNewMemo] = useState('');

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [upcomingRes, setUpcomingRes] = useState<ReservationRecord[]>([]);
  // 취소·노쇼 이력 (박민지 #1)
  const [cancelHistory, setCancelHistory] = useState<ReservationRecord[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editMemo, setEditMemo] = useState('');
  // 김태영 #3+#22 + pgcrypto: 주민번호 암호화 저장/복호화 조회
  const [editResidentId, setEditResidentId] = useState('');
  const [decryptedRrn, setDecryptedRrn] = useState<string | null>(null);
  // 박민지 Wave3 #7 Q4: TM 상담사(최초 등록자) 수정 UI — admin/manager 전용
  const [editCreatedBy, setEditCreatedBy] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<{ email: string; name: string }[]>([]);
  const canEditTm = currentUserRole === 'admin' || currentUserRole === 'manager';
  const [tmMemo, setTmMemo] = useState('');
  // KTY-RESV-WITH-MEMO: 인라인 예약+메모 등록
  const [quickResOpen, setQuickResOpen] = useState(false);
  const [quickResDate, setQuickResDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [quickResTime, setQuickResTime] = useState('10:00');
  const [quickResMemo, setQuickResMemo] = useState('');
  // MEMO-SYNC-RETOUCH: 상담메모 이력 표시
  const [consultNotes, setConsultNotes] = useState<{ note_date: string; content: string }[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recallOnly, setRecallOnly] = useState(false);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      setCurrentUserEmail(session.user.email || null);
      const { data: profile } = await (supabase.from('user_profiles') as any)
        .select('role').eq('email', session.user.email).maybeSingle();
      setCurrentUserRole((profile as any)?.role || null);
      const { data: staff } = await (supabase.from('user_profiles') as any)
        .select('email, name').eq('active', true);
      setStaffList(((staff as any[]) || []).filter(s => s.email && s.name));
      const clinic = await getSelectedClinic();
      if (clinic) { setClinicId(clinic.id); setClinicName(clinic.name); }
    };
    init();
  }, [navigate]);

  // URL customer_id 파라미터로 고객 자동 선택 (박민지 추가요청 2)
  useEffect(() => {
    if (!clinicId) return;
    const cid = searchParams.get('customer_id');
    if (!cid) return;
    (async () => {
      const { data } = await supabase.from('customers').select('*').eq('id', cid).maybeSingle();
      if (data) openDetail(data as Customer);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, searchParams]);

  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!clinicId) return;
    setInitialLoading(false);
    const fetchCustomers = async () => {
      let query = supabase.from('customers').select('*').eq('clinic_id', clinicId).order('updated_at', { ascending: false }).limit(100);
      if (debouncedSearch.length >= 2) {
        const sanitized = debouncedSearch.replace(/[%_(),.]/g, '');
        if (sanitized) query = query.or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`);
      }
      const { data } = await query;
      if (data) {
        setCustomers(data as Customer[]);
        const ids = data.map((c: Customer) => c.id);
        if (ids.length > 0) {
          const { data: ciData } = await supabase.from('check_ins').select('customer_id, checked_in_at').in('customer_id', ids);
          const counts: Record<string, number> = {};
          const latests: Record<string, string> = {};
          (ciData || []).forEach((ci: any) => {
            if (!ci.customer_id) return;
            counts[ci.customer_id] = (counts[ci.customer_id] || 0) + 1;
            if (!latests[ci.customer_id] || (ci.checked_in_at && ci.checked_in_at > latests[ci.customer_id])) latests[ci.customer_id] = ci.checked_in_at || '';
          });
          setVisitCounts(counts);
          setLastVisits(latests);

          const { data: payData } = await supabase.from('payments').select('customer_id, amount').in('customer_id', ids);
          const totals: Record<string, number> = {};
          (payData || []).forEach((p: any) => { if (p.customer_id) totals[p.customer_id] = (totals[p.customer_id] || 0) + p.amount; });
          setTotalPayments(totals);
        }
      }
    };
    fetchCustomers();
  }, [clinicId, debouncedSearch]);

  const handleCreateCustomer = async () => {
    if (!newName.trim() || !clinicId) return;
    // KTY-PHONE-CONSTRAINT: phone nullable — 빈값이면 null 저장
    const fullPhone = newPhone.trim()
      ? (newCountryCode === '+82' ? newPhone.trim() : `${newCountryCode}${newPhone.replace(/^0/, '')}`)
      : null;
    const { error } = await supabase.from('customers').insert({ clinic_id: clinicId, name: newName.trim(), phone: fullPhone, memo: newMemo || null, created_by: currentUserEmail } as any);
    if (error) { toast({ title: '등록 실패', description: error.message, variant: 'destructive' }); return; }
    setCreateOpen(false); setNewName(''); setNewPhone(''); setNewMemo('');
    toast({ title: '고객 등록 완료' });
    setSearchQuery(prev => prev + ' ');
    setTimeout(() => setSearchQuery(prev => prev.trim()), 100);
  };

  const openDetail = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditMode(false); setEditName(customer.name); setEditPhone(customer.phone || ''); setEditMemo(customer.memo || ''); setEditCreatedBy(customer.created_by || '');
    setDecryptedRrn(null); setEditResidentId('');
    setVisits([]); setPayments([]); setServices([]); setUpcomingRes([]); setCancelHistory([]); setConsultNotes([]); setTmMemo('');
    try {
      const [rrnRes, tmRes, vRes, pRes, rRes, hRes, cnRes] = await Promise.all([
        (supabase.rpc('rrn_decrypt', { customer_uuid: customer.id }) as unknown as Promise<any>).catch(() => ({ data: null })),
        (supabase.from('customers').select('tm_memo').eq('id', customer.id).maybeSingle() as unknown as Promise<any>).catch(() => ({ data: null })),
        (supabase.from('check_ins').select('id, checked_in_at, status, queue_number, referral_source, treatment_memo, notes').eq('customer_id', customer.id).order('checked_in_at', { ascending: false }).limit(50) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        (supabase.from('payments').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(50) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        (supabase.from('reservations').select('*').eq('customer_id', customer.id).neq('status', 'cancelled').order('reservation_date', { ascending: false }).limit(30) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        (supabase.from('reservations').select('*').eq('customer_id', customer.id).in('status', ['cancelled', 'no_show']).order('reservation_date', { ascending: false }).limit(20) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        (supabase.from('consultation_notes').select('note_date, content').eq('customer_id', customer.id).order('note_date', { ascending: false }).limit(30) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      ]);
      const rrn = typeof rrnRes?.data === 'string' ? rrnRes.data : null;
      setDecryptedRrn(rrn); setEditResidentId(rrn || '');
      setTmMemo((tmRes?.data as any)?.tm_memo || '');
      const vData = vRes?.data || [];
      setVisits(vData as VisitRecord[]);
      setPayments((pRes?.data || []) as PaymentRecord[]);
      setUpcomingRes((rRes?.data || []) as ReservationRecord[]);
      setCancelHistory((hRes?.data || []) as ReservationRecord[]);
      setConsultNotes((cnRes?.data || []) as { note_date: string; content: string }[]);
      if (vData.length > 0) {
        const ciIds = vData.map((v: any) => v.id);
        const { data: sData } = await supabase.from('check_in_services').select('service_name, price, check_in_id').in('check_in_id', ciIds);
        setServices((sData || []) as ServiceRecord[]);
      }
    } catch (err) {
      console.error('openDetail error:', err);
      toast({ title: '고객 정보 로드 실패', description: '일부 데이터를 불러오지 못했습니다.', variant: 'destructive' });
    }
  };

  const handleUpdate = async () => {
    if (!selectedCustomer) return;
    const createdByVal = canEditTm ? (editCreatedBy || null) : selectedCustomer.created_by ?? null;
    const { error } = await supabase.from('customers').update({ name: editName.trim(), phone: editPhone?.trim() || null, memo: editMemo || null, created_by: createdByVal } as any).eq('id', selectedCustomer.id);
    if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
    // pgcrypto: 주민번호 암호화 저장 (변경됐을 때만)
    const rrnTrim = editResidentId.trim();
    if (rrnTrim && rrnTrim !== decryptedRrn) {
      await supabase.rpc('rrn_encrypt', { customer_uuid: selectedCustomer.id, plain_rrn: rrnTrim });
      setDecryptedRrn(rrnTrim);
    }
    setSelectedCustomer({ ...selectedCustomer, name: editName.trim(), phone: editPhone?.trim() || '', memo: editMemo || null, created_by: createdByVal });
    setEditMode(false);
    toast({ title: '수정 완료' });
  };

  const totalVisitCount = useMemo(() => visits.length, [visits]);
  const totalPaymentAmount = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);

  // Memoize filtered customer list to avoid re-filtering on every render
  const filteredCustomers = useMemo(
    () => customers.filter(c => !recallOnly || (lastVisits[c.id] && (Date.now() - new Date(lastVisits[c.id]).getTime() > 60 * 86400000))),
    [customers, recallOnly, lastVisits]
  );

  if (initialLoading) {
    return (
      <AdminLayout clinicName={clinicName} activeTab="customers">
        <div className="flex items-center justify-center h-[50vh]">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout clinicName={clinicName} activeTab="customers">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} placeholder="이름 또는 전화번호 검색" className="pl-9" />
          </div>
          <Button variant={recallOnly ? 'default' : 'outline'} className={recallOnly ? 'bg-orange-500 text-white hover:bg-orange-600' : 'text-orange-600 border-orange-200 hover:bg-orange-50'} onClick={() => setRecallOnly(!recallOnly)}>리콜 대상만</Button>
          <Button className="bg-accent text-accent-foreground" onClick={() => setCreateOpen(true)}>+ 신규 고객</Button>
        </div>

        <div className="bg-card rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>전화번호</TableHead>
                <TableHead className="text-center">방문</TableHead>
                <TableHead>최근방문</TableHead>
                <TableHead className="text-right">총결제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(c)}>
                  <TableCell className="font-medium">
                    {c.name}
                    {lastVisits[c.id] && (Date.now() - new Date(lastVisits[c.id]).getTime() > 60 * 86400000) && (
                      <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">리콜</span>
                    )}
                  </TableCell>
                  <TableCell>{maskPhone(c.phone)}</TableCell>
                  <TableCell className="text-center">{visitCounts[c.id] || 0}회</TableCell>
                  <TableCell>{lastVisits[c.id] ? format(new Date(lastVisits[c.id]), 'yyyy-MM-dd') : '-'}</TableCell>
                  <TableCell className="text-right">{(totalPayments[c.id] || 0).toLocaleString()}원</TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <p className="text-muted-foreground mb-3">{searchQuery ? '검색 결과가 없습니다' : '등록된 고객이 없습니다'}</p>
                    {!searchQuery && (
                      <Button variant="outline" onClick={() => setCreateOpen(true)}>+ 첫 고객 등록하기</Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>신규 고객</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" />
            <div className="flex gap-2">
              <select value={newCountryCode} onChange={(e) => setNewCountryCode(e.target.value)} className="h-10 rounded-md border px-2 text-sm">
                <option value="+82">🇰🇷 +82</option><option value="+1">🇺🇸 +1</option>
              </select>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} type="tel" className="flex-1" placeholder="01012345678" />
            </div>
            <Textarea value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="메모" rows={2} />
            <Button className="w-full bg-accent text-accent-foreground" onClick={handleCreateCustomer} disabled={!newName.trim()}>등록</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Sheet open={!!selectedCustomer} onOpenChange={(v) => { if (!v) setSelectedCustomer(null); }}>
        <SheetContent className="w-[440px] sm:w-[440px] overflow-y-auto">
          <SheetHeader><SheetTitle>고객 이력</SheetTitle></SheetHeader>
          {selectedCustomer && (
            <div className="mt-4 space-y-6">
              {editMode ? (
                <div className="space-y-3">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="이름" />
                  <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="전화번호" />
                  {/* 김태영 #3+#22: 주민번호 입력 */}
                  <Input value={editResidentId} onChange={(e) => setEditResidentId(e.target.value)} placeholder="주민등록번호 (예: 901231-1234567)" />
                  {/* W3-07 정정 (2026-04-14): TM은 예약 단위 관리 → 고객 수준 수정 UI 제거 */}
                  <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} placeholder="메모" rows={2} />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEditMode(false)} className="flex-1">취소</Button>
                    <Button onClick={handleUpdate} className="flex-1 bg-accent text-accent-foreground">저장</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{selectedCustomer.name}</h3>
                      {visits.length > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500 text-white font-medium">리터치</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500 text-white font-medium">신규</span>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>수정</Button>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                  {/* 김태영 #3+#22 + pgcrypto: 주민번호 복호화 표시 */}
                  {decryptedRrn && (
                    <p className="text-sm text-muted-foreground mt-0.5">주민번호: {decryptedRrn.replace(/(\d{6}-)\d+/, '$1******')}</p>
                  )}
                  {selectedCustomer.memo && <p className="text-sm text-muted-foreground mt-1">{selectedCustomer.memo}</p>}
                  {/* 박민지 Wave2 #7: 최초등록일·수정일 (TM 표시는 W3-07 정정으로 제거 — TM은 예약 단위로 표시됨) */}
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    최초등록 {format(new Date(selectedCustomer.created_at), 'yyyy-MM-dd')}
                    {selectedCustomer.updated_at && selectedCustomer.updated_at !== selectedCustomer.created_at && (
                      <> · 수정 {format(new Date(selectedCustomer.updated_at), 'yyyy-MM-dd')}</>
                    )}
                  </p>
                </div>
              )}

              <div className="flex gap-4">
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1 text-center">
                  <p className="text-xs text-muted-foreground">방문</p>
                  <p className="text-lg font-bold">{totalVisitCount}회</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1 text-center">
                  <p className="text-xs text-muted-foreground">총결제</p>
                  <p className="text-lg font-bold">{totalPaymentAmount.toLocaleString()}원</p>
                </div>
              </div>

              {/* TM 메모 */}
              <div>
                <h4 className="text-sm font-semibold mb-2 text-orange-600">TM 메모</h4>
                <Textarea value={tmMemo} onChange={(e) => setTmMemo(e.target.value)} rows={3} className="text-sm border-orange-200 focus:border-orange-400" placeholder="TM팀 전용 메모 (통화 내용, 특이사항...)" />
                <Button size="sm" variant="outline" className="mt-1 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={async () => {
                  const { error } = await supabase.from('customers').update({ tm_memo: tmMemo } as any).eq('id', selectedCustomer!.id);
                  if (error) { toast({ title: 'TM 메모 저장 실패', description: error.message, variant: 'destructive' }); return; }
                  toast({ title: 'TM 메모 저장' });
                }}>TM 메모 저장</Button>
              </div>

              {/* KTY-RESV-WITH-MEMO: 고객 상세에서 예약+메모 인라인 등록 */}
              {!quickResOpen ? (
                <Button variant="outline" size="sm" className="w-full" onClick={() => { setQuickResOpen(true); setQuickResDate(format(new Date(), 'yyyy-MM-dd')); setQuickResTime('10:00'); setQuickResMemo(''); }}>+ 예약 등록</Button>
              ) : (
                <div className="border rounded-lg p-3 space-y-2 bg-blue-50/30">
                  <h4 className="text-xs font-semibold text-blue-700">빠른 예약 등록</h4>
                  <div className="flex gap-2">
                    <Input type="date" value={quickResDate} onChange={(e) => setQuickResDate(e.target.value)} className="h-8 text-xs flex-1" />
                    <select value={quickResTime} onChange={(e) => setQuickResTime(e.target.value)} className="h-8 rounded border border-input bg-background px-2 text-xs w-24">
                      {Array.from({ length: 25 }, (_, i) => { const h = 9 + Math.floor(i / 2); const m = i % 2 === 0 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${m}`; }).filter(t => t <= '21:00').map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <Textarea value={quickResMemo} onChange={(e) => setQuickResMemo(e.target.value)} placeholder="메모 (시술 내용 등)" className="text-xs min-h-[50px]" />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-7 text-xs" onClick={async () => {
                      if (!selectedCustomer || !clinicId) return;
                      const { error } = await supabase.from('reservations').insert({
                        clinic_id: clinicId, customer_id: selectedCustomer.id,
                        reservation_date: quickResDate, reservation_time: quickResTime + ':00',
                        memo: quickResMemo || null, status: 'reserved', created_by: currentUserEmail,
                      } as any);
                      if (error) { toast({ title: '예약 등록 실패', variant: 'destructive' }); return; }
                      toast({ title: '예약 등록 완료' }); setQuickResOpen(false);
                      // refresh reservations
                      const { data: resData } = await supabase.from('reservations').select('id, reservation_date, reservation_time, status, memo').eq('customer_id', selectedCustomer.id).order('reservation_date', { ascending: false }).limit(30);
                      if (resData) setUpcomingRes(resData as ReservationRecord[]);
                    }}>등록</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickResOpen(false)}>취소</Button>
                  </div>
                </div>
              )}

              {upcomingRes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">예약 이력</h4>
                  {upcomingRes.map((r) => (
                    /* RESV-EDIT-FROM-HIST 방법B: 클릭 → 예약관리 페이지 이동 + highlight + scrollIntoView */
                    <button key={r.id} type="button" onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedCustomer(null);
                      setTimeout(() => navigate(`/admin/reservations?date=${r.reservation_date}&highlight=${r.id}&edit=1`), 50);
                    }} className="w-full text-left bg-muted/30 hover:bg-muted/60 rounded-lg px-3 py-2 text-sm mb-1 transition-colors cursor-pointer">
                      <span>{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                      {r.reservation_type && (
                        <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          r.reservation_type === '리터치' ? 'bg-cyan-500 text-white' :
                          r.reservation_type === '신규' ? 'bg-violet-500 text-white' :
                          r.reservation_type === '시술예약' ? 'bg-green-500 text-white' :
                          'bg-muted-foreground text-white'
                        }`}>{r.reservation_type === '기타' && r.reservation_type_etc ? `기타(${r.reservation_type_etc})` : r.reservation_type}</span>
                      )}
                      {r.memo && <span className="ml-1 text-muted-foreground">| {r.memo}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* 취소·노쇼 이력 (박민지 #1) */}
              {cancelHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    취소·노쇼 내역
                    <span className="text-xs font-normal text-muted-foreground">({cancelHistory.length}건)</span>
                  </h4>
                  <div className="space-y-1">
                    {cancelHistory.map((r) => (
                      <div key={r.id} className={`rounded-lg px-3 py-2 text-sm flex items-center justify-between ${r.status === 'no_show' ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'}`}>
                        <span className={r.status === 'cancelled' ? 'line-through text-gray-500' : 'text-red-700'}>
                          {r.reservation_date} {r.reservation_time.slice(0, 5)}
                          {r.reservation_type && (
                            <span className={`ml-1 text-[10px] px-1 py-0.5 rounded-full font-medium ${
                              r.reservation_type === '리터치' ? 'bg-cyan-200 text-cyan-800' :
                              r.reservation_type === '신규' ? 'bg-violet-200 text-violet-800' :
                              r.reservation_type === '시술예약' ? 'bg-green-200 text-green-800' :
                              'bg-gray-300 text-gray-700'
                            }`}>{r.reservation_type}</span>
                          )}
                          {r.memo && <span className="ml-1 text-xs opacity-70">| {r.memo}</span>}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.status === 'no_show' ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-600'}`}>
                          {r.status === 'no_show' ? '노쇼' : '취소'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MEMO-SYNC-RETOUCH: 상담메모 이력 (리터치 시 이전 상담 내용 참조) */}
              {consultNotes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 text-blue-600">상담 메모 이력 ({consultNotes.length}건)</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {consultNotes.map((n, i) => (
                      <div key={i} className="bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2 text-sm">
                        <div className="text-[11px] text-blue-500 font-medium mb-0.5">{n.note_date}</div>
                        <div className="text-xs whitespace-pre-wrap">{n.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-2">방문 이력</h4>
                {visits.length === 0 ? <p className="text-sm text-muted-foreground">없음</p> : (
                  <div className="space-y-2">
                    {visits.map((v) => {
                      const payment = payments.find(p => p.check_in_id === v.id);
                      const visitServices = services.filter(s => s.check_in_id === v.id);
                      return (
                        <div key={v.id} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span>{v.checked_in_at ? format(new Date(v.checked_in_at), 'yyyy-MM-dd HH:mm') : '-'}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(v.status)}`}>{STATUS_KO[v.status] || v.status}</span>
                          </div>
                          {visitServices.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {visitServices.map(s => s.service_name).join(', ')}
                            </div>
                          )}
                          {payment && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {payment.amount.toLocaleString()}원 · {payment.method === 'card' ? '카드' : payment.method === 'transfer' ? '이체' : '현금'}
                              {payment.installment > 0 && ` · ${payment.installment}개월`}
                            </div>
                          )}
                          {v.referral_source && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">유입: {v.referral_source}</div>
                          )}
                          {/* 김태영 #21: 시술/접수 메모 동기화 표시 */}
                          {v.treatment_memo && (
                            <div className="text-[11px] text-muted-foreground mt-1 bg-amber-50 border border-amber-100 rounded px-2 py-1 whitespace-pre-wrap">
                              <span className="font-semibold text-amber-700">시술 메모</span>: {v.treatment_memo}
                            </div>
                          )}
                          {v.notes && (
                            <div className="text-[11px] text-muted-foreground/80 mt-1 whitespace-pre-wrap">
                              <span className="font-semibold">접수 메모</span>: {v.notes}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminLayout>
  );
}
