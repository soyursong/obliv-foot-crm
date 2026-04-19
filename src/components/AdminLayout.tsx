import { ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchClinics, setSelectedClinicId, getSelectedClinicId, type Clinic } from '@/lib/clinic';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { maskPhone } from '@/lib/i18n';
import { STATUS_KO, getStatusBadgeClass } from '@/lib/status-colors';
import { format } from 'date-fns';
import { Search } from 'lucide-react';

interface AdminLayoutProps {
  clinicName: string;
  activeTab: 'queue' | 'reservations' | 'customers' | 'closing' | 'staff' | 'stats' | 'tm';
  children: ReactNode;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  memo: string | null;
}

interface VisitRecord {
  id: string;
  checked_in_at: string;
  status: string;
  queue_number: number;
  check_in_id?: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  installment: number;
  memo: string | null;
  created_at: string;
  check_in_id: string | null;
}

interface ReservationRecord {
  id: string;
  reservation_date: string;
  reservation_time: string;
  status: string;
  memo: string | null;
}

const TABS: { key: string; label: string; path: string }[] = [];

export default function AdminLayout({ clinicName, activeTab, children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [upcomingRes, setUpcomingRes] = useState<ReservationRecord[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editMemo, setEditMemo] = useState('');
  // MEMO-SYNC-RETOUCH: 상담메모 이력
  const [consultNotes, setConsultNotes] = useState<{ note_date: string; content: string }[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedId] = useState(getSelectedClinicId() || '');
  const [userRole, setUserRole] = useState<string>('');

  useEffect(() => {
    fetchClinics().then(c => {
      setClinics(c);
      if (!selectedClinicId && c.length > 0) setSelectedId(c[0].id);
    });
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: profile } = await (supabase.from('user_profiles') as any)
        .select('role').eq('id', session.user.id).single();
      if (profile?.role) setUserRole(profile.role);
    })();
  }, []);

  const canSeeStats = userRole === 'admin' || userRole === 'manager';
  const canSeeTm = userRole === 'admin' || userRole === 'tm' || userRole === 'manager';

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executeSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const sanitized = q.replace(/[%_(),.]/g, '');
    if (!sanitized) return;
    const currentClinicId = getSelectedClinicId();
    let query = supabase
      .from('customers')
      .select('id, name, phone, memo')
      .or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
      .limit(8);
    if (currentClinicId) query = query.eq('clinic_id', currentClinicId);
    const { data } = await query;
    if (data) {
      setSearchResults(data as Customer[]);
      setShowDropdown(true);
    }
  }, []);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => executeSearch(q), 300);
  };

  const openCustomerDetail = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setShowDropdown(false);
    setSearchQuery('');
    setEditMode(false);
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditMemo(customer.memo || '');

    // Fetch visits
    const { data: visitData } = await supabase
      .from('check_ins')
      .select('id, checked_in_at, status, queue_number')
      .eq('customer_id', customer.id)
      .order('checked_in_at', { ascending: false })
      .limit(50);
    setVisits((visitData || []) as VisitRecord[]);

    // Fetch payments
    const { data: payData } = await supabase
      .from('payments')
      .select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setPayments((payData || []) as PaymentRecord[]);

    // Fetch all reservations (past + future) — CUST-DETAIL-RESV-MISSING fix
    const { data: resData } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customer.id)
      .neq('status', 'cancelled')
      .order('reservation_date', { ascending: false })
      .limit(30);
    setUpcomingRes((resData || []) as ReservationRecord[]);

    // MEMO-SYNC-RETOUCH: 상담메모 이력
    const { data: cnData } = await supabase.from('consultation_notes')
      .select('note_date, content').eq('customer_id', customer.id)
      .order('note_date', { ascending: false }).limit(30);
    setConsultNotes((cnData || []) as { note_date: string; content: string }[]);
  };

  const handleUpdateCustomer = async () => {
    if (!selectedCustomer) return;
    const { error } = await supabase.from('customers').update({
      name: editName.trim(),
      phone: editPhone.trim(),
      memo: editMemo || null,
    }).eq('id', selectedCustomer.id);
    if (error) { toast({ title: '수정 실패', description: error.message, variant: 'destructive' }); return; }
    setSelectedCustomer({ ...selectedCustomer, name: editName.trim(), phone: editPhone.trim(), memo: editMemo || null });
    setEditMode(false);
    toast({ title: '고객 정보가 수정되었습니다' });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin');
  };

  const totalVisitCount = visits.length;
  const totalPaymentAmount = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="min-h-screen bg-muted/50">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-bold text-foreground">오블리브 Ose</h1>
          {clinics.length > 1 ? (
            <select
              value={selectedClinicId}
              onChange={(e) => { setSelectedClinicId(e.target.value); setSelectedId(e.target.value); window.location.reload(); }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm font-medium"
            >
              {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <span className="text-sm text-muted-foreground">{clinicName}</span>
          )}
          <span className="text-sm text-muted-foreground">{today}</span>
        </div>

        {/* Search Bar */}
        <div ref={searchRef} className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
            placeholder="고객 검색 (이름/전화번호)"
            className="pl-9 h-9"
          />
          {/* Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted text-sm flex justify-between border-b border-border/50 last:border-b-0"
                  onClick={() => openCustomerDetail(c)}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{maskPhone(c.phone)}</span>
                </button>
              ))}
            </div>
          )}
          {showDropdown && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 px-3 py-3 text-sm text-muted-foreground text-center">
              검색 결과 없음
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant={activeTab === 'queue' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/dashboard')}
            className={activeTab === 'queue' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
            대시보드
          </Button>
          <Button variant={activeTab === 'reservations' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/reservations')}
            className={activeTab === 'reservations' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
            예약관리
          </Button>
          <Button variant={activeTab === 'customers' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/customers')}
            className={activeTab === 'customers' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
            고객이력
          </Button>
          {canSeeStats && (
            <Button variant={activeTab === 'stats' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/stats')}
              className={activeTab === 'stats' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
              통계
            </Button>
          )}
          {canSeeTm && (
            <Button variant={activeTab === 'tm' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/tm')}
              className={activeTab === 'tm' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
              TM
            </Button>
          )}
          <Button variant={activeTab === 'staff' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/staff')}
            className={activeTab === 'staff' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
            직원관리
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/register')} className="text-xs">
            계정관리
          </Button>
          <Button variant={activeTab === 'closing' ? 'default' : 'outline'} size="sm" onClick={() => navigate('/admin/closing')}
            className={activeTab === 'closing' ? 'bg-accent text-accent-foreground hover:bg-accent/90' : ''}>
            일마감
          </Button>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            로그아웃
          </Button>
        </div>
      </header>

      {/* Tab Bar - hidden when no tabs */}
      {TABS.length > 0 && (
        <div className="bg-card border-b border-border px-6 flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => navigate(tab.path)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>
      )}

      {children}

      {/* Customer Detail Sheet */}
      <Sheet open={!!selectedCustomer} onOpenChange={(v) => { if (!v) setSelectedCustomer(null); }}>
        <SheetContent className="w-[400px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>고객 상세</SheetTitle>
          </SheetHeader>
          {selectedCustomer && (
            <div className="mt-4 space-y-6">
              {/* Basic Info */}
              <div className="space-y-2">
                {editMode ? (
                  <div className="space-y-3">
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                    <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} placeholder="메모" rows={2} />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setEditMode(false)} className="flex-1">취소</Button>
                      <Button onClick={handleUpdateCustomer} className="flex-1 bg-accent text-accent-foreground">저장</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{selectedCustomer.name}</h3>
                      <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>수정</Button>
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                    {selectedCustomer.memo && <p className="text-sm text-muted-foreground mt-1">{selectedCustomer.memo}</p>}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="flex gap-4">
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1">
                  <p className="text-xs text-muted-foreground">총 방문</p>
                  <p className="text-lg font-bold">{totalVisitCount}회</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-4 py-2 flex-1">
                  <p className="text-xs text-muted-foreground">총 결제</p>
                  <p className="text-lg font-bold">{totalPaymentAmount.toLocaleString()}원</p>
                </div>
              </div>

              {/* Book appointment */}
              <Button
                variant="outline" size="sm" className="w-full border-accent text-accent hover:bg-accent/10"
                onClick={() => { setSelectedCustomer(null); navigate(`/admin/reservations?customer_id=${selectedCustomer.id}`); }}
              >
                + 예약 잡기
              </Button>

              {/* Upcoming Reservations */}
              {upcomingRes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">예약 이력</h4>
                  <div className="space-y-2">
                    {upcomingRes.map((r) => (
                      <div key={r.id} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium">{r.reservation_date}</span>
                        <span className="text-muted-foreground ml-2">{r.reservation_time.slice(0, 5)}</span>
                        {r.memo && <span className="text-muted-foreground ml-2">| {r.memo}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MEMO-SYNC-RETOUCH: 상담메모 이력 */}
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

              {/* Visit History */}
              <div>
                <h4 className="text-sm font-semibold mb-2">방문 이력</h4>
                {visits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">방문 이력이 없습니다</p>
                ) : (
                  <div className="space-y-2">
                    {visits.map((v) => {
                      const payment = payments.find(p => p.check_in_id === v.id);
                      return (
                        <div key={v.id} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span>{v.checked_in_at ? format(new Date(v.checked_in_at), 'yyyy-MM-dd HH:mm') : '-'}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(v.status)}`}>{STATUS_KO[v.status] || v.status}</span>
                          </div>
                          {payment && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {payment.amount.toLocaleString()}원 · {payment.method === 'card' ? '카드' : payment.method === 'transfer' ? '이체' : '현금'}
                              {payment.installment > 0 && ` · ${payment.installment}개월`}
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
    </div>
  );
}
