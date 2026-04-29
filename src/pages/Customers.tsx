import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { STATUS_KO, VISIT_TYPE_KO } from '@/lib/status';
import type {
  CheckIn,
  Customer,
  LeadSource,
  Package,
  PackageRemaining,
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

interface CustomerStats {
  visit_count: number;
  last_visit: string | null;
  total_revenue: number;
  has_package: boolean;
}

export default function Customers() {
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
        if (safe) req = req.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
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
            placeholder="이름 또는 전화번호 검색"
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
                <td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setMemo('');
    }
  }, [open]);

  const save = async () => {
    if (!clinicId) return;
    setSubmitting(true);
    const { error } = await supabase.from('customers').insert({
      clinic_id: clinicId,
      name: name.trim(),
      phone: phone.trim(),
      memo: memo.trim() || null,
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
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
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
  const [memo, setMemo] = useState('');
  const [leadSource, setLeadSource] = useState<string>('');
  const [tmMemo, setTmMemo] = useState('');
  const [packages, setPackages] = useState<PackageWithRemaining[]>([]);
  const [visits, setVisits] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [hasMoreVisits, setHasMoreVisits] = useState(false);
  const [hasMorePayments, setHasMorePayments] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!customer) return;
    setName(customer.name);
    setPhone(customer.phone);
    setMemo(customer.memo ?? '');
    setLeadSource(customer.lead_source ?? '');
    setTmMemo(customer.tm_memo ?? '');
    setEditing(false);
    (async () => {
      const [pkgRes, visitRes, payRes, pkgPayRes, resvRes] = await Promise.all([
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
      const visitData = (visitRes.data ?? []) as CheckIn[];
      const payData = (payRes.data ?? []) as Payment[];
      setVisits(visitData);
      setHasMoreVisits(visitData.length >= 50);
      setPayments(payData);
      setHasMorePayments(payData.length >= 50);
      setPkgPayments((pkgPayRes.data ?? []) as PackagePayment[]);
      setReservations((resvRes.data ?? []) as Reservation[]);
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

  const loadMoreVisits = async () => {
    if (!customer) return;
    const { data } = await supabase
      .from('check_ins')
      .select('*')
      .eq('customer_id', customer.id)
      .order('checked_in_at', { ascending: false })
      .range(visits.length, visits.length + PAGE_SIZE - 1);
    const more = (data ?? []) as CheckIn[];
    setVisits((prev) => [...prev, ...more]);
    setHasMoreVisits(more.length >= PAGE_SIZE);
  };

  const loadMorePayments = async () => {
    if (!customer) return;
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .range(payments.length, payments.length + PAGE_SIZE - 1);
    const more = (data ?? []) as Payment[];
    setPayments((prev) => [...prev, ...more]);
    setHasMorePayments(more.length >= PAGE_SIZE);
  };

  if (!customer) return null;

  const saveEdit = async () => {
    const { error } = await supabase
      .from('customers')
      .update({
        name: name.trim(),
        phone: phone.trim(),
        memo: memo.trim() || null,
        lead_source: leadSource.trim() || null,
        tm_memo: tmMemo.trim() || null,
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
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>고객 상세</SheetTitle>
        </SheetHeader>

        {editing ? (
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label>이름</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>전화번호</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>유입 경로</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label>고객 메모 (특이사항)</Label>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="진단서 발급 필요, 보험 청구 등..." />
            </div>
            <div className="space-y-1.5">
              <Label>상담 메모 (보험·성향·상담내용)</Label>
              <Textarea value={tmMemo} onChange={(e) => setTmMemo(e.target.value)} rows={3} placeholder="실비 보험사, 상한액, 고객 성향 등..." />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
                취소
              </Button>
              <Button className="flex-1" onClick={saveEdit}>
                저장
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold">{customer.name}</div>
              <div className="text-sm text-muted-foreground">{customer.phone}</div>
              {customer.lead_source && (
                <div className="mt-1">
                  <span className="inline-block rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                    {customer.lead_source}
                  </span>
                </div>
              )}
              {customer.memo && (
                <div className="mt-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground">
                  <span className="text-xs font-medium text-muted-foreground/70 mr-1">메모</span>
                  {customer.memo}
                </div>
              )}
              {customer.tm_memo && (
                <div className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900 border border-amber-100">
                  <span className="text-xs font-medium text-amber-700 mr-1">상담</span>
                  {customer.tm_memo}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" className="ml-3 shrink-0" onClick={() => setEditing(true)}>
              수정
            </Button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 방문</div>
            <div className="text-base font-bold">{visits.length}회</div>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">총 결제</div>
            <div className="text-base font-bold">{formatAmount(totalPaid)}</div>
          </div>
        </div>

        <Tabs defaultValue="packages" className="mt-4">
          <TabsList>
            <TabsTrigger value="packages">패키지</TabsTrigger>
            <TabsTrigger value="visits">방문</TabsTrigger>
            <TabsTrigger value="payments">결제</TabsTrigger>
            <TabsTrigger value="reservations">예약</TabsTrigger>
          </TabsList>

          <TabsContent value="packages" className="space-y-2">
            {packages.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">패키지 없음</div>
            )}
            {packages.map((p) => (
              <div key={p.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{p.package_name}</div>
                  <Badge
                    variant={
                      p.status === 'active'
                        ? 'teal'
                        : p.status === 'refunded'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  계약 {p.contract_date} · 금액 {formatAmount(p.total_amount)}
                </div>
                {p.remaining && (
                  <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
                    <Stat label="가열" used={p.heated_sessions - p.remaining.heated} total={p.heated_sessions} />
                    <Stat
                      label="비가열"
                      used={p.unheated_sessions - p.remaining.unheated}
                      total={p.unheated_sessions}
                    />
                    <Stat label="수액" used={p.iv_sessions - p.remaining.iv} total={p.iv_sessions} />
                    <Stat
                      label="사전처치"
                      used={p.preconditioning_sessions - p.remaining.preconditioning}
                      total={p.preconditioning_sessions}
                    />
                  </div>
                )}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="visits" className="space-y-1.5">
            {visits.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">방문 이력 없음</div>
            )}
            {visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded bg-muted/30 px-3 py-1.5 text-sm">
                <span>{format(new Date(v.checked_in_at), 'yyyy-MM-dd HH:mm')}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary">{VISIT_TYPE_KO[v.visit_type]}</Badge>
                  {STATUS_KO[v.status]}
                </span>
              </div>
            ))}
            {hasMoreVisits && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={loadMoreVisits}>
                더보기
              </Button>
            )}
          </TabsContent>

          <TabsContent value="payments" className="space-y-1.5">
            {payments.length === 0 && pkgPayments.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">결제 내역 없음</div>
            )}
            {[...pkgPayments.map((p) => ({ ...p, kind: '패키지' as const })), ...payments.map((p) => ({ ...p, kind: '단건' as const }))]
              .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
              .map((p) => (
                <div
                  key={`${p.kind}-${p.id}`}
                  className="flex items-center justify-between rounded bg-muted/30 px-3 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant={p.kind === '패키지' ? 'teal' : 'secondary'}>{p.kind}</Badge>
                    <span>{format(new Date(p.created_at), 'yyyy-MM-dd')}</span>
                  </span>
                  <span className={p.payment_type === 'refund' ? 'text-red-600' : ''}>
                    {p.payment_type === 'refund' ? '-' : ''}
                    {formatAmount(p.amount)} · {methodLabel(p.method)}
                    {p.installment > 0 ? ` · ${p.installment}개월` : ''}
                  </span>
                </div>
              ))}
            {hasMorePayments && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={loadMorePayments}>
                더보기
              </Button>
            )}
          </TabsContent>

          <TabsContent value="reservations" className="space-y-1.5">
            {reservations.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">예약 없음</div>
            )}
            {reservations.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded bg-muted/30 px-3 py-1.5 text-sm">
                <span>
                  {r.reservation_date} {r.reservation_time.slice(0, 5)}
                </span>
                <Badge variant="secondary">{r.status}</Badge>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, used, total }: { label: string; used: number; total: number }) {
  const remaining = Math.max(0, total - used);
  return (
    <div className="rounded bg-muted/40 px-1.5 py-1 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xs font-medium">
        {remaining}/{total}
      </div>
    </div>
  );
}

function methodLabel(m: string) {
  switch (m) {
    case 'card':
      return '카드';
    case 'cash':
      return '현금';
    case 'transfer':
      return '계좌이체';
    default:
      return m;
  }
}
