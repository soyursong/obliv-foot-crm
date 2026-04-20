import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Plus, Search } from 'lucide-react';
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
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import { STATUS_KO, VISIT_TYPE_KO } from '@/lib/status';
import type {
  CheckIn,
  Clinic,
  Customer,
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

export default function Customers() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

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
      setResults((data ?? []) as Customer[]);
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
              <th className="px-4 py-2 text-left font-medium">최초 방문</th>
              <th className="px-4 py-2 text-left font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {results.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelected(c)}
                className="cursor-pointer border-t hover:bg-muted/40"
              >
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{c.phone}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {format(new Date(c.created_at), 'yyyy-MM-dd')}
                </td>
                <td className="max-w-md truncate px-4 py-2 text-muted-foreground">
                  {c.memo ?? ''}
                </td>
              </tr>
            ))}
            {!loading && results.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
  const [packages, setPackages] = useState<PackageWithRemaining[]>([]);
  const [visits, setVisits] = useState<CheckIn[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePayment[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);

  useEffect(() => {
    if (!customer) return;
    setName(customer.name);
    setPhone(customer.phone);
    setMemo(customer.memo ?? '');
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
      setVisits((visitRes.data ?? []) as CheckIn[]);
      setPayments((payRes.data ?? []) as Payment[]);
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

  if (!customer) return null;

  const saveEdit = async () => {
    const { error } = await supabase
      .from('customers')
      .update({ name: name.trim(), phone: phone.trim(), memo: memo.trim() || null })
      .eq('id', customer.id);
    if (error) {
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    toast.success('수정 완료');
    setEditing(false);
    onUpdated();
  };

  return (
    <Sheet open={!!customer} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>고객 상세</SheetTitle>
        </SheetHeader>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>이름</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>전화번호</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>메모</Label>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
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
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-semibold">{customer.name}</div>
              <div className="text-sm text-muted-foreground">{customer.phone}</div>
              {customer.memo && (
                <div className="mt-1 text-sm text-muted-foreground">{customer.memo}</div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
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
