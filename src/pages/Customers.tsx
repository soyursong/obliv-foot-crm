import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { ChevronDown, ExternalLink, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { InsuranceGradeSelect } from '@/components/insurance/InsuranceGradeSelect';
import { supabase } from '@/lib/supabase';

import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { VISIT_TYPE_KO } from '@/lib/status';
import { cn } from '@/lib/utils';
import type {
  CheckIn,
  Customer,
  LeadSource,
  Package,
  PackageRemaining,
  PrescriptionRow,
  Reservation,
} from '@/lib/types';

interface Payment {
  id: string;
  check_in_id: string | null;
  amount: number;
  method: string;
  installment: number;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
}

interface PackagePayment {
  id: string;
  package_id: string;
  amount: number;
  method: string;
  installment: number;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
}

type PackageWithRemaining = Package & { remaining: PackageRemaining | null };

const PKG_STATUS_KO: Record<string, string> = {
  active: '진행중',
  completed: '완료',
  cancelled: '취소',
  refunded: '환불',
  transferred: '양도',
};

const FORM_TITLES: Record<string, string> = {
  treatment: '시술 동의서',
  non_covered: '비급여 동의서',
  privacy: '개인정보 동의서',
  refund: '환불 동의서',
};

function ChartSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/30 transition"
      >
        {icon && <span className="text-teal-600">{icon}</span>}
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t px-3 py-2 text-sm">{children}</div>}
    </div>
  );
}

interface CustomerStats {
  visit_count: number;
  last_visit: string | null;
  total_revenue: number;
  has_package: boolean;
}

export default function Customers() {
  const location = useLocation();
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [statsMap, setStatsMap] = useState<Map<string, CustomerStats>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStateConsumed = useRef(false);

  const runSearch = useCallback(
    async (q: string) => {
      if (!clinic) return;
      const trimmed = q.trim();
      setLoading(true);
      let req = supabase
        .from('customers')
        .select('*')
        .eq('clinic_id', clinic.id)
        .order('updated_at', { ascending: false })
        .limit(30);
      if (trimmed) {
        const safe = trimmed.replace(/[%_(),.]/g, '');
        if (safe) req = req.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,birth_date.ilike.%${safe}%,chart_number.ilike.%${safe}%`);
      }
      const { data, error } = await req;
      setLoading(false);
      if (error) {
        toast.error('검색 실패');
        return;
      }
      const customers = (data ?? []) as Customer[];
      setResults(customers);

      if (customers.length > 0) {
        const ids = customers.map((c) => c.id);
        const [checkInsRes, paymentsRes, pkgPaymentsRes, pkgsRes] = await Promise.all([
          supabase
            .from('check_ins')
            .select('customer_id, checked_in_at')
            .in('customer_id', ids)
            .neq('status', 'cancelled'),
          supabase
            .from('payments')
            .select('customer_id, amount, payment_type')
            .in('customer_id', ids),
          supabase
            .from('package_payments')
            .select('customer_id, amount, payment_type')
            .in('customer_id', ids),
          supabase
            .from('packages')
            .select('customer_id')
            .in('customer_id', ids)
            .eq('status', 'active'),
        ]);

        const map = new Map<string, CustomerStats>();
        for (const id of ids) map.set(id, { visit_count: 0, last_visit: null, total_revenue: 0, has_package: false });

        for (const row of (checkInsRes.data ?? []) as { customer_id: string; checked_in_at: string }[]) {
          const s = map.get(row.customer_id);
          if (!s) continue;
          s.visit_count++;
          if (!s.last_visit || row.checked_in_at > s.last_visit) s.last_visit = row.checked_in_at;
        }
        for (const row of (paymentsRes.data ?? []) as { customer_id: string | null; amount: number; payment_type: string }[]) {
          if (!row.customer_id) continue;
          const s = map.get(row.customer_id);
          if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
        }
        for (const row of (pkgPaymentsRes.data ?? []) as { customer_id: string; amount: number; payment_type: string }[]) {
          const s = map.get(row.customer_id);
          if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
        }
        for (const row of (pkgsRes.data ?? []) as { customer_id: string }[]) {
          const s = map.get(row.customer_id);
          if (s) s.has_package = true;
        }
        setStatsMap(map);
      } else {
        setStatsMap(new Map());
      }
    },
    [clinic],
  );

  useEffect(() => {
    if (!clinic) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clinic, runSearch]);

  // 대시보드 고객차트 바로가기 → location.state.openCustomerId 처리
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (!clinic) return;
    const state = location.state as { openCustomerId?: string } | null;
    if (!state?.openCustomerId) return;
    navStateConsumed.current = true;
    window.history.replaceState({}, '');
    supabase
      .from('customers')
      .select('*')
      .eq('id', state.openCustomerId)
      .single()
      .then(({ data }) => {
        if (data) setSelected(data as Customer);
      });
  }, [clinic, location.state]);

  const deleteCustomer = async (c: Customer) => {
    if (!window.confirm(`${c.name}님을 삭제하시겠습니까?\n체크인·패키지 이력이 없을 때만 삭제됩니다.`)) return;
    const [{ count: ciCount }, { count: pkgCount }] = await Promise.all([
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
      supabase.from('packages').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
    ]);
    if ((ciCount ?? 0) > 0 || (pkgCount ?? 0) > 0) {
      toast.error(`삭제 불가: 체크인 ${ciCount ?? 0}건·패키지 ${pkgCount ?? 0}건이 연결되어 있습니다`);
      return;
    }
    const { error } = await supabase.from('customers').delete().eq('id', c.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success(`${c.name}님 삭제됨`);
    runSearch(query);
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 전화번호 · 생년월일(YYMMDD) · 차트번호"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setOpenCreate(true)} className="gap-1">
          <Plus className="h-4 w-4" /> 신규 고객
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">이름</th>
              <th className="px-4 py-2 text-left font-medium">전화번호</th>
              <th className="px-4 py-2 text-left font-medium">생년월일</th>
              <th className="px-4 py-2 text-left font-medium">차트번호</th>
              <th className="px-4 py-2 text-right font-medium">방문</th>
              <th className="px-4 py-2 text-left font-medium">최종 방문</th>
              <th className="px-4 py-2 text-right font-medium">결제액</th>
              <th className="px-4 py-2 text-left font-medium">메모</th>
              {isAdmin && <th className="px-4 py-2 text-center font-medium">관리</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((c) => {
              const stats = statsMap.get(c.id);
              return (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="cursor-pointer border-t hover:bg-muted/40"
                >
                  <td className="px-4 py-2 font-medium">
                    <span
                      className="flex items-center gap-1.5 cursor-pointer hover:underline decoration-dotted underline-offset-2"
                      title="더블클릭으로 차트 열기"
                      onDoubleClick={(e) => { e.stopPropagation(); setSelected(c); }}
                    >
                      {c.name}
                      {stats?.has_package && <Badge variant="teal" className="text-[10px] px-1 py-0">PKG</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-2 text-muted-foreground tabular-nums">{c.birth_date ?? '-'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.chart_number ?? '-'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{stats?.visit_count ?? 0}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {stats?.last_visit ? format(new Date(stats.last_visit), 'yyyy-MM-dd') : '-'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {stats?.total_revenue ? formatAmount(stats.total_revenue) : '-'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-muted-foreground">
                    {c.memo ?? ''}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelected(c); }}
                          className="rounded p-1.5 hover:bg-muted transition"
                          title="수정"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteCustomer(c); }}
                          className="rounded p-1.5 hover:bg-red-50 transition"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!loading && results.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query ? '검색 결과 없음' : '고객이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CustomerDetailSheet
        customer={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => {
          runSearch(query);
        }}
      />

      <CreateCustomerDialog
        open={openCreate}
        clinicId={clinic?.id}
        onOpenChange={setOpenCreate}
        onCreated={() => {
          setOpenCreate(false);
          runSearch(query);
        }}
      />
    </div>
  );
}

function CreateCustomerDialog({
  open,
  clinicId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  clinicId: string | undefined;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [chartNumber, setChartNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  // 추천인 자동완성 — 기존 고객 검색
  const [referrerQuery, setReferrerQuery] = useState('');
  const [referrerSuggestions, setReferrerSuggestions] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 인라인 자동검색으로 선택된 기존 고객 (중복 등록 방지)
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setBirthDate('');
      setChartNumber('');
      setMemo('');
      setReferrerName('');
      setReferrerQuery('');
      setReferrerSuggestions([]);
      setReferrerId(null);
      setSelectedExistingId(null);
    }
  }, [open]);

  // 기존 고객 선택 시 폼 자동 채움
  const handleExistingSelect = useCallback((p: PatientMatch) => {
    setName(p.name);
    setPhone(p.phone);
    if (p.birth_date) setBirthDate(p.birth_date);
    setSelectedExistingId(p.id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedExistingId(null);
  }, []);

  // 추천인 검색 — 300ms 디바운스
  useEffect(() => {
    if (!clinicId || referrerQuery.trim().length < 1) {
      setReferrerSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinicId)
        .ilike('name', `%${referrerQuery.trim()}%`)
        .limit(5);
      setReferrerSuggestions((data ?? []) as { id: string; name: string; phone: string }[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [referrerQuery, clinicId]);

  const save = async () => {
    if (!clinicId) return;
    // 기존 고객 선택 상태에서는 신규 등록 차단 (중복 등록 방지)
    if (selectedExistingId) {
      toast.info('이미 등록된 고객입니다. 목록에서 해당 고객을 선택해 주세요.');
      onCreated();
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('customers').insert({
      clinic_id: clinicId,
      name: name.trim(),
      phone: phone.trim(),
      birth_date: birthDate.trim() || null,
      chart_number: chartNumber.trim() || null,
      memo: memo.trim() || null,
      referrer_id: referrerId || null,
      referrer_name: !referrerId && referrerName.trim() ? referrerName.trim() : null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.code === '23505' ? '이미 등록된 전화번호입니다' : `등록 실패: ${error.message}`);
      return;
    }
    toast.success('고객 등록 완료');
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>신규 고객 등록</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>이름</Label>
            <InlinePatientSearch
              value={name}
              onChange={(v) => {
                setName(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              autoFocus
              placeholder="이름 (2글자 이상 입력 시 기존 고객 자동 검색)"
            />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <InlinePatientSearch
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              inputMode="tel"
              placeholder="전화번호 (4자리 이상 입력 시 자동 검색)"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>생년월일 <span className="text-xs text-muted-foreground font-normal">(YYMMDD)</span></Label>
              <Input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="예: 900515"
                maxLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <Label>차트번호 <span className="text-xs text-muted-foreground font-normal">(선택)</span></Label>
              <Input value={chartNumber} onChange={(e) => setChartNumber(e.target.value)} placeholder="예: F-0001" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
          </div>
          {/* 추천인 */}
          <div className="space-y-1.5">
            <Label>추천인 <span className="text-xs text-muted-foreground font-normal">(선택)</span></Label>
            {referrerId ? (
              <div className="flex items-center gap-2 rounded-md border bg-teal-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-teal-800">
                  {referrerSuggestions.find((s) => s.id === referrerId)?.name ?? referrerName}
                </span>
                <button
                  type="button"
                  onClick={() => { setReferrerId(null); setReferrerName(''); setReferrerQuery(''); }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="추천인 이름 검색 또는 직접 입력"
                  value={referrerQuery || referrerName}
                  onChange={(e) => {
                    setReferrerQuery(e.target.value);
                    setReferrerName(e.target.value);
                    setReferrerId(null);
                  }}
                />
                {referrerSuggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-md text-sm">
                    {referrerSuggestions.map((s) => (
                      <li
                        key={s.id}
                        className="cursor-pointer px-3 py-2 hover:bg-teal-50"
                        onMouseDown={() => {
                          setReferrerId(s.id);
                          setReferrerName(s.name);
                          setReferrerQuery('');
                          setReferrerSuggestions([]);
                        }}
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-muted-foreground">{s.phone}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !name.trim() || !phone.trim()} onClick={save}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailSheet({
  customer,
  onClose,
  onUpdated,
}: {
  customer: Customer | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [chartNumber, setChartNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [leadSource, setLeadSource] = useState<string>('');
  const [tmMemo, setTmMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  const [packages, setPackages] = useState<PackageWithRemaining[]>([]);
  const [visits, setVisits] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [checkInHistory, setCheckInHistory] = useState<CheckIn[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [consentEntries, setConsentEntries] = useState<{form_type: string; signed_at: string}[]>([]);
  const [submissionEntries, setSubmissionEntries] = useState<{template_key?: string; printed_at: string}[]>([]);

  useEffect(() => {
    if (!customer) return;
    setName(customer.name);
    setPhone(customer.phone);
    setBirthDate(customer.birth_date ?? '');
    setChartNumber(customer.chart_number ?? '');
    setMemo(customer.memo ?? '');
    setLeadSource(customer.lead_source ?? '');
    setTmMemo(customer.tm_memo ?? '');
    setReferrerName(customer.referrer_name ?? '');
    setEditing(false);
    setCheckInHistory([]);
    setLatestCheckIn(null);
    setPrescriptions([]);
    setConsentEntries([]);
    setSubmissionEntries([]);
    (async () => {
      const [pkgRes, visitRes, payRes, pkgPayRes, resvRes, ciHistRes] = await Promise.all([
        supabase.from('packages').select('*').eq('customer_id', customer.id).order('contract_date', {
          ascending: false,
        }),
        supabase
          .from('check_ins')
          .select('*')
          .eq('customer_id', customer.id)
          .order('checked_in_at', { ascending: false })
          .limit(50),
        supabase
          .from('payments')
          .select('*')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('package_payments')
          .select('*')
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('reservations')
          .select('*')
          .eq('customer_id', customer.id)
          .order('reservation_date', { ascending: false })
          .limit(30),
        supabase
          .from('check_ins')
          .select('*')
          .eq('customer_id', customer.id)
          .neq('status', 'cancelled')
          .order('checked_in_at', { ascending: false })
          .limit(100),
      ]);

      const pkgs = (pkgRes.data ?? []) as Package[];
      // 각 패키지 잔여회차 조회
      const remaining = await Promise.all(
        pkgs.map(async (p) => {
          const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
          return data as PackageRemaining | null;
        }),
      );
      setPackages(pkgs.map((p, i) => ({ ...p, remaining: remaining[i] })));
      setVisits((visitRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as Payment[]);
      setPkgPayments((pkgPayRes.data ?? []) as PackagePayment[]);
      setReservations((resvRes.data ?? []) as Reservation[]);

      const ciHistory = (ciHistRes.data ?? []) as CheckIn[];
      setCheckInHistory(ciHistory);
      setLatestCheckIn(ciHistory[0] ?? null);

      const checkInIds = ciHistory.map((ci: CheckIn) => ci.id);
      if (checkInIds.length > 0) {
        const [rxRes, consentRes, subRes] = await Promise.all([
          supabase
            .from('prescriptions')
            .select('id, prescribed_by_name, diagnosis, prescribed_at, prescription_items(medication_name, dosage, duration_days)')
            .in('check_in_id', checkInIds)
            .order('prescribed_at', { ascending: false })
            .limit(20),
          supabase
            .from('consent_forms')
            .select('form_type, signed_at')
            .in('check_in_id', checkInIds)
            .order('signed_at', { ascending: false }),
          supabase
            .from('form_submissions')
            .select('template_key, printed_at')
            .in('check_in_id', checkInIds)
            .order('printed_at', { ascending: false })
            .limit(30),
        ]);
        setPrescriptions((rxRes.data ?? []) as PrescriptionRow[]);
        setConsentEntries((consentRes.data ?? []) as {form_type: string; signed_at: string}[]);
        setSubmissionEntries((subRes.data ?? []) as {template_key?: string; printed_at: string}[]);
      }
    })();
  }, [customer]);

  const totalPaid = useMemo(() => {
    const s =
      payments
        .filter((p) => p.payment_type === 'payment')
        .reduce((x, p) => x + p.amount, 0) +
      pkgPayments.filter((p) => p.payment_type === 'payment').reduce((x, p) => x + p.amount, 0);
    const r =
      payments.filter((p) => p.payment_type === 'refund').reduce((x, p) => x + p.amount, 0) +
      pkgPayments.filter((p) => p.payment_type === 'refund').reduce((x, p) => x + p.amount, 0);
    return s - r;
  }, [payments, pkgPayments]);

  if (!customer) return null;

  const saveEdit = async () => {
    const { error } = await supabase
      .from('customers')
      .update({
        name: name.trim(),
        phone: phone.trim(),
        birth_date: birthDate.trim() || null,
        chart_number: chartNumber.trim() || null,
        memo: memo.trim() || null,
        lead_source: leadSource.trim() || null,
        tm_memo: tmMemo.trim() || null,
        referrer_name: referrerName.trim() || null,
      })
      .eq('id', customer.id);
    if (error) {
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    toast.success('수정 완료');
    setEditing(false);
    onUpdated();
  };

  const LEAD_SOURCE_OPTIONS: LeadSource[] = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];

  return (
    <Sheet open={!!customer} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="w-[720px] max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="flex-1">고객 차트</SheetTitle>
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                수정
              </Button>
            )}
            <button
              type="button"
              onClick={() => window.open(`/chart/${customer.id}`, `chart-${customer.id}`, 'width=820,height=960,scrollbars=yes,resizable=yes')}
              className="rounded p-1.5 hover:bg-muted transition"
              title="새 창으로 열기"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </SheetHeader>

        {/* 통계 row */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 방문</div>
            <div className="text-base font-bold">{visits.length}회</div>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 결제</div>
            <div className="text-base font-bold">{formatAmount(totalPaid)}</div>
          </div>
        </div>

        {/* 15개 섹션 */}
        <div className="mt-3 space-y-2">

          {/* 섹션 1 — 성함/접수시간 */}
          <ChartSection title="성함 / 접수시간" defaultOpen>
            {editing ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">이름</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">생년월일 (YYMMDD)</Label>
                    <Input
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      placeholder="예: 900515"
                      maxLength={6}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">차트번호</Label>
                    <Input value={chartNumber} onChange={(e) => setChartNumber(e.target.value)} placeholder="예: F-0001" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold">{customer.name}</span>
                    {customer.chart_number && (
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{customer.chart_number}</span>
                    )}
                    <Badge variant={customer.visit_type === 'new' ? 'teal' : 'secondary'} className="text-[10px]">
                      {VISIT_TYPE_KO[customer.visit_type as keyof typeof VISIT_TYPE_KO] ?? customer.visit_type}
                    </Badge>
                  </div>
                  {customer.birth_date && (
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{customer.birth_date}</div>
                  )}
                  {latestCheckIn && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      최근 방문: {format(new Date(latestCheckIn.checked_in_at), 'MM-dd HH:mm')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </ChartSection>

          {/* 섹션 2 — 내원경로 */}
          <ChartSection title="내원경로" defaultOpen>
            {editing ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_SOURCE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setLeadSource(leadSource === opt ? '' : opt)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        leadSource === opt
                          ? 'bg-teal-600 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">추천인</Label>
                  <Input value={referrerName} onChange={(e) => setReferrerName(e.target.value)} placeholder="추천인 이름" />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {customer.lead_source ? (
                  <span className="inline-block rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                    {customer.lead_source}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">경로 미입력</span>
                )}
                {(customer.referrer_name || customer.referrer_id) && (
                  <div className="text-xs text-muted-foreground">
                    추천인: {customer.referrer_name ?? '(고객 연결됨)'}
                  </div>
                )}
              </div>
            )}
          </ChartSection>

          {/* 섹션 3 — 연락처 */}
          <ChartSection title="연락처" defaultOpen>
            {editing ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">전화번호</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-0.5 text-xs">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16">전화번호</span>
                  <span className="font-medium">{customer.phone}</span>
                </div>
                {customer.birth_date && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16">생년월일</span>
                    <span className="tabular-nums">{customer.birth_date}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-16">외국인</span>
                  <span>{customer.is_foreign ? '예' : '아니오'}</span>
                </div>
              </div>
            )}
          </ChartSection>

          {/* 섹션 3.5 — 건강보험 자격 (T-20260504-foot-INSURANCE-COPAYMENT) */}
          <ChartSection title="건강보험 자격" defaultOpen>
            <div className="space-y-2">
              <InsuranceGradeSelect customerId={customer.id} onChanged={onUpdated} />
              {/*
                TODO(rrn-vault): 주민번호 입력 → Supabase Vault Edge Function 경유 저장.
                현재는 입력 UI만 표시 + rrn_vault_id 컬럼 준비. 평문 저장 절대 금지.
              */}
              <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/40 p-2 text-[11px] text-amber-800">
                ※ 주민번호는 Supabase Vault 연동(Edge Function) 후 활성화 — 현재는 등급만 수동 입력
              </div>
            </div>
          </ChartSection>

          {/* 섹션 4 — 치료플랜 (패키지) */}
          <ChartSection title="치료플랜 (패키지)" defaultOpen>
            {packages.length === 0 ? (
              <div className="py-2 text-xs text-muted-foreground">패키지 없음</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/40 text-muted-foreground">
                      <th className="text-left px-2 py-1.5 font-medium border-b">패키지명</th>
                      <th className="text-center px-2 py-1.5 font-medium border-b">총</th>
                      <th className="text-center px-2 py-1.5 font-medium border-b">사용</th>
                      <th className="text-center px-2 py-1.5 font-medium border-b text-teal-700">잔여</th>
                      <th className="text-right px-2 py-1.5 font-medium border-b">금액</th>
                      <th className="text-left px-2 py-1.5 font-medium border-b">시작일</th>
                      <th className="text-center px-2 py-1.5 font-medium border-b">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((p) => {
                      const used = p.remaining ? p.total_sessions - p.remaining.total_remaining : null;
                      return (
                        <tr key={p.id} className="border-b border-muted/20 hover:bg-muted/10">
                          <td className="px-2 py-1.5 font-medium max-w-[120px] truncate">{p.package_name}</td>
                          <td className="px-2 py-1.5 text-center">{p.total_sessions}</td>
                          <td className="px-2 py-1.5 text-center">{used ?? '-'}</td>
                          <td className="px-2 py-1.5 text-center font-semibold text-teal-700">
                            {p.remaining?.total_remaining ?? '-'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatAmount(p.total_amount)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{p.contract_date}</td>
                          <td className="px-2 py-1.5 text-center">
                            <Badge
                              variant={p.status === 'active' ? 'teal' : p.status === 'refunded' ? 'destructive' : 'secondary'}
                              className="text-[10px] px-1.5"
                            >
                              {PKG_STATUS_KO[p.status] ?? p.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartSection>

          {/* 섹션 5 — 공간배정 */}
          <ChartSection title="공간배정">
            {latestCheckIn ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14">진료실</span>
                  <span>{latestCheckIn.examination_room ?? '-'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14">상담실</span>
                  <span>{latestCheckIn.consultation_room ?? '-'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14">치료실</span>
                  <span>{latestCheckIn.treatment_room ?? '-'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14">레이저</span>
                  <span>{latestCheckIn.laser_room ?? '-'}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">방문 이력 없음</div>
            )}
          </ChartSection>

          {/* 섹션 6 — 예약내역 */}
          <ChartSection title="예약내역">
            {reservations.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">예약 없음</div>
            ) : (
              <div className="space-y-1">
                {reservations.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-xs">
                    <span>{r.reservation_date} {r.reservation_time.slice(0, 5)}</span>
                    <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 7 — 예약메모 */}
          <ChartSection title="예약메모">
            {reservations.filter((r) => r.memo).length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">메모 없음</div>
            ) : (
              <div className="space-y-1.5">
                {reservations.filter((r) => r.memo).map((r) => (
                  <div key={r.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                    <div className="text-muted-foreground mb-0.5">{r.reservation_date} {r.reservation_time.slice(0, 5)}</div>
                    <div>{r.memo}</div>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 8 — 고객메모 */}
          <ChartSection title="고객메모" defaultOpen>
            {editing ? (
              <div className="space-y-1">
                <Textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={2}
                  placeholder="진단서 발급 필요, 보험 청구 등..."
                  className="text-xs"
                />
              </div>
            ) : (
              <div className="text-xs">
                {customer.memo ? (
                  <div className="whitespace-pre-wrap text-muted-foreground">{customer.memo}</div>
                ) : (
                  <span className="text-muted-foreground">메모 없음</span>
                )}
              </div>
            )}
          </ChartSection>

          {/* 섹션 9 — 상담메모 / 담당실장 */}
          <ChartSection title="상담메모 / 담당실장" defaultOpen>
            {editing ? (
              <div className="space-y-1">
                <Textarea
                  value={tmMemo}
                  onChange={(e) => setTmMemo(e.target.value)}
                  rows={3}
                  placeholder="실비 보험사, 상한액, 고객 성향 등..."
                  className="text-xs"
                />
              </div>
            ) : (
              <div className="space-y-1.5 text-xs">
                {customer.tm_memo ? (
                  <div className="whitespace-pre-wrap text-muted-foreground">{customer.tm_memo}</div>
                ) : (
                  <span className="text-muted-foreground">상담메모 없음</span>
                )}
                <div className="flex gap-2 text-muted-foreground">
                  <span className="w-16">담당실장</span>
                  <span>{latestCheckIn?.consultant_id ?? '-'}</span>
                </div>
              </div>
            )}
          </ChartSection>

          {/* 섹션 9 저장/취소 버튼 (editing 모드) */}
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
                취소
              </Button>
              <Button className="flex-1" onClick={saveEdit}>
                저장
              </Button>
            </div>
          )}

          {/* 섹션 10 — 원장소견 */}
          <ChartSection title="원장소견">
            {checkInHistory.filter((ci) => ci.doctor_note).length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">소견 없음</div>
            ) : (
              <div className="space-y-2">
                {checkInHistory.filter((ci) => ci.doctor_note).map((ci) => (
                  <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                    <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                    <div className="whitespace-pre-wrap">{ci.doctor_note}</div>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 11 — 시술메모 */}
          <ChartSection title="시술메모">
            {checkInHistory.filter((ci) => ci.treatment_memo).length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">시술메모 없음</div>
            ) : (
              <div className="space-y-2">
                {checkInHistory.filter((ci) => ci.treatment_memo).map((ci) => (
                  <div key={ci.id} className="rounded bg-muted/30 px-2 py-1.5 text-xs">
                    <div className="text-muted-foreground mb-0.5">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                    <div className="whitespace-pre-wrap">
                      {ci.treatment_memo?.details ?? JSON.stringify(ci.treatment_memo)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 12 — 비포/에프터 */}
          <ChartSection title="비포/에프터">
            {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">사진 없음</div>
            ) : (
              <div className="space-y-3">
                {checkInHistory.filter((ci) => ci.treatment_photos && ci.treatment_photos.length > 0).map((ci) => (
                  <div key={ci.id}>
                    <div className="text-xs text-muted-foreground mb-1">{format(new Date(ci.checked_in_at), 'yyyy-MM-dd HH:mm')}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {(ci.treatment_photos ?? []).map((url, idx) => (
                        <img
                          key={idx}
                          src={url}
                          alt={`사진 ${idx + 1}`}
                          className="rounded w-full object-cover aspect-square bg-muted"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 13 — 체크리스트 / 동의서 */}
          <ChartSection title="체크리스트 / 동의서">
            <div className="space-y-2 text-xs">
              {latestCheckIn?.notes?.checklist && Object.keys(latestCheckIn.notes.checklist).length > 0 && (
                <div>
                  <div className="font-medium text-muted-foreground mb-1">체크리스트</div>
                  <Badge variant="secondary" className="text-[10px]">작성완료</Badge>
                </div>
              )}
              {consentEntries.length === 0 ? (
                <div className="text-muted-foreground">동의서 없음</div>
              ) : (
                <div>
                  <div className="font-medium text-muted-foreground mb-1">동의서</div>
                  <div className="space-y-1">
                    {consentEntries.map((c, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                        <span>{FORM_TITLES[c.form_type] ?? c.form_type}</span>
                        <span className="flex items-center gap-1.5">
                          <Badge variant="teal" className="text-[10px]">서명완료</Badge>
                          <span className="text-muted-foreground">{format(new Date(c.signed_at), 'MM-dd')}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ChartSection>

          {/* 섹션 14 — 처방전 */}
          <ChartSection title="처방전">
            {prescriptions.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">처방전 없음</div>
            ) : (
              <div className="space-y-2 text-xs">
                {prescriptions.map((rx) => (
                  <div key={rx.id} className="rounded bg-muted/30 px-2 py-1.5">
                    <div className="flex items-center justify-between text-muted-foreground mb-0.5">
                      <span>{format(new Date(rx.prescribed_at), 'yyyy-MM-dd')}</span>
                      {rx.prescribed_by_name && <span>{rx.prescribed_by_name}</span>}
                    </div>
                    {rx.diagnosis && <div className="font-medium mb-0.5">진단: {rx.diagnosis}</div>}
                    {rx.prescription_items && rx.prescription_items.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        {rx.prescription_items.map((item, idx) => (
                          <div key={idx} className="text-muted-foreground">
                            {item.medication_name}
                            {item.dosage && ` · ${item.dosage}`}
                            {item.duration_days && ` · ${item.duration_days}일`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

          {/* 섹션 15 — 서류발행 */}
          <ChartSection title="서류발행">
            {submissionEntries.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">발행 이력 없음</div>
            ) : (
              <div className="space-y-1 text-xs">
                {submissionEntries.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                    <span>{s.template_key ?? '-'}</span>
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Printer className="h-3 w-3" />
                      {format(new Date(s.printed_at), 'MM-dd HH:mm')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ChartSection>

        </div>
      </SheetContent>
    </Sheet>
  );
}

