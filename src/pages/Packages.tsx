import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PACKAGE_PRESETS } from '@/lib/packagePresets';
import type { Clinic, Customer, Package, PackageRemaining } from '@/lib/types';

type PackageListItem = Package & { customer: { name: string; phone: string } | null };

interface RefundQuote {
  total_amount: number;
  total_sessions: number;
  used_sessions: number;
  remaining_sessions: number;
  unit_price: number;
  refund_amount: number;
}

const PRESETS = PACKAGE_PRESETS;

type FilterStatus = 'active' | 'completed' | 'refunded' | 'all';

export default function Packages() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('active');
  const [rows, setRows] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  const fetchPackages = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    let req = supabase
      .from('packages')
      .select('*, customer:customers(name, phone)')
      .eq('clinic_id', clinic.id)
      .order('contract_date', { ascending: false })
      .limit(200);
    if (filter !== 'all') req = req.eq('status', filter);
    const { data, error } = await req;
    setLoading(false);
    if (error) {
      console.warn('패키지 로딩 실패:', error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as PackageListItem[]);
  }, [clinic, filter]);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.package_name.toLowerCase().includes(q) ||
        r.customer?.name.toLowerCase().includes(q) ||
        r.customer?.phone.includes(q),
    );
  }, [rows, query]);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
          <TabsList>
            <TabsTrigger value="active">활성</TabsTrigger>
            <TabsTrigger value="completed">완료</TabsTrigger>
            <TabsTrigger value="refunded">환불</TabsTrigger>
            <TabsTrigger value="all">전체</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름/전화/패키지명"
              className="pl-9"
            />
          </div>
          <Button onClick={() => setOpenCreate(true)} className="gap-1">
            <Plus className="h-4 w-4" /> 패키지 생성
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">고객</th>
              <th className="px-3 py-2 text-left font-medium">패키지</th>
              <th className="px-3 py-2 text-right font-medium">총회차</th>
              <th className="px-3 py-2 text-right font-medium">금액</th>
              <th className="px-3 py-2 text-left font-medium">계약일</th>
              <th className="px-3 py-2 text-left font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="cursor-pointer border-t hover:bg-muted/40"
              >
                <td className="px-3 py-2 font-medium">
                  {p.customer?.name}
                  <span className="ml-1 text-xs text-muted-foreground">{p.customer?.phone}</span>
                </td>
                <td className="px-3 py-2">{p.package_name}</td>
                <td className="px-3 py-2 text-right">{p.total_sessions}</td>
                <td className="px-3 py-2 text-right">{formatAmount(p.total_amount)}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.contract_date}</td>
                <td className="px-3 py-2">
                  <Badge
                    variant={
                      p.status === 'active'
                        ? 'teal'
                        : p.status === 'refunded'
                          ? 'destructive'
                          : p.status === 'transferred'
                            ? 'outline'
                            : 'secondary'
                    }
                  >
                    {{ active: '활성', completed: '완료', cancelled: '취소', refunded: '환불', transferred: '양도' }[p.status] ?? p.status}
                  </Badge>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query ? '검색 결과 없음' : '패키지 없음'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PackageCreateDialog
        open={openCreate}
        clinicId={clinic?.id}
        onOpenChange={setOpenCreate}
        onCreated={() => {
          setOpenCreate(false);
          fetchPackages();
        }}
      />

      <PackageDetailSheet
        packageId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          setSelectedId(null);
          fetchPackages();
        }}
      />
    </div>
  );
}

function PackageCreateDialog({
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
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerMatches, setCustomerMatches] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const [presetKey, setPresetKey] = useState<string>('package1');
  const [heated, setHeated] = useState(1);
  const [unheated, setUnheated] = useState(8);
  const [iv, setIv] = useState(0);
  const [precon, setPrecon] = useState(12);
  const [shotUpgrade, setShotUpgrade] = useState(false);
  const [afUpgrade, setAfUpgrade] = useState(false);
  const [price, setPrice] = useState(1200000);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerQuery('');
    setCustomer(null);
    applyPreset('package1');
    setShotUpgrade(false);
    setAfUpgrade(false);
    setMemo('');
  }, [open]);

  const applyPreset = (key: string) => {
    setPresetKey(key);
    if (key === 'custom') return;
    const p = PRESETS[key];
    if (!p) return;
    setHeated(p.heated);
    setUnheated(p.unheated);
    setIv(p.iv);
    setPrecon(p.preconditioning);
    setPrice(p.suggestedPrice);
  };

  useEffect(() => {
    if (!clinicId || customerQuery.trim().length < 2) {
      setCustomerMatches([]);
      return;
    }
    const safe = customerQuery.trim().replace(/[%_(),.]/g, '');
    if (!safe) return;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('clinic_id', clinicId)
        .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .limit(8);
      setCustomerMatches((data ?? []) as Customer[]);
    }, 200);
    return () => clearTimeout(t);
  }, [customerQuery, clinicId]);

  const totalSessions = useMemo(() => heated + unheated + iv + precon, [heated, unheated, iv, precon]);
  const upgradeSurcharge = (shotUpgrade ? 50000 : 0) + (afUpgrade ? 40000 : 0);
  const grandTotal = price + upgradeSurcharge;

  const submit = async () => {
    if (!clinicId || !customer) {
      toast.error('고객을 선택하세요');
      return;
    }
    if (totalSessions === 0) {
      toast.error('최소 1회 이상 구성하세요');
      return;
    }
    setSubmitting(true);
    const packageName =
      presetKey === 'custom'
        ? `커스텀 ${totalSessions}회`
        : PRESETS[presetKey].label;

    const { error } = await supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: customer.id,
      package_name: packageName,
      package_type: presetKey,
      total_sessions: totalSessions,
      heated_sessions: heated,
      unheated_sessions: unheated,
      iv_sessions: iv,
      preconditioning_sessions: precon,
      shot_upgrade: shotUpgrade,
      af_upgrade: afUpgrade,
      upgrade_surcharge: upgradeSurcharge,
      total_amount: grandTotal,
      paid_amount: 0,
      status: 'active',
      memo: memo.trim() || null,
    });

    setSubmitting(false);
    if (error) {
      toast.error(`생성 실패: ${error.message}`);
      return;
    }
    toast.success('패키지 생성 완료');
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>패키지 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>고객 선택</Label>
            {customer ? (
              <div className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{customer.name}</span>
                  <span className="ml-2 text-muted-foreground">{customer.phone}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  변경
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="이름 또는 전화번호"
                />
                {customerMatches.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-background shadow-md">
                    {customerMatches.map((c) => (
                      <button
                        key={c.id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setCustomer(c);
                          setCustomerMatches([]);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>프리셋</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PRESETS).map(([k, p]) => (
                <button
                  key={k}
                  onClick={() => applyPreset(k)}
                  className={cn(
                    'h-9 rounded-md border px-3 text-sm font-medium',
                    presetKey === k
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setPresetKey('custom')}
                className={cn(
                  'h-9 rounded-md border px-3 text-sm font-medium',
                  presetKey === 'custom'
                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                    : 'border-input hover:bg-muted',
                )}
              >
                커스텀
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <NumberField label="가열" value={heated} onChange={setHeated} />
            <NumberField label="비가열" value={unheated} onChange={setUnheated} />
            <NumberField label="수액" value={iv} onChange={setIv} />
            <NumberField label="사전처치" value={precon} onChange={setPrecon} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Toggle label="6000샷 업그레이드 (+50,000)" value={shotUpgrade} onChange={setShotUpgrade} />
            <Toggle label="AF 업그레이드 (+40,000)" value={afUpgrade} onChange={setAfUpgrade} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>패키지 금액</Label>
              <Input
                value={formatAmount(price)}
                onChange={(e) => setPrice(parseAmount(e.target.value))}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label>총 계약금</Label>
              <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm font-semibold">
                {formatAmount(grandTotal)}
                <span className="ml-2 text-xs text-muted-foreground">({totalSessions}회)</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !customer || totalSessions === 0} onClick={submit}>
            {submitting ? '저장 중…' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'h-9 rounded-md border px-3 text-sm font-medium',
        value ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
      )}
    >
      {value ? '✓ ' : ''}
      {label}
    </button>
  );
}

function PackageDetailSheet({
  packageId,
  onClose,
  onChanged,
}: {
  packageId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pkg, setPkg] = useState<PackageListItem | null>(null);
  const [remaining, setRemaining] = useState<PackageRemaining | null>(null);
  const [sessions, setSessions] = useState<
    { id: string; session_number: number; session_type: string; session_date: string; status: string }[]
  >([]);
  const [pkgPayments, setPkgPayments] = useState<
    { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; created_at: string }[]
  >([]);
  const [refundOpen, setRefundOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [useSessionOpen, setUseSessionOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!packageId) return;
    const [pkgRes, remainRes, sessRes, payRes] = await Promise.all([
      supabase.from('packages').select('*, customer:customers(name, phone)').eq('id', packageId).single(),
      supabase.rpc('get_package_remaining', { p_package_id: packageId }),
      supabase
        .from('package_sessions')
        .select('id, session_number, session_type, session_date, status')
        .eq('package_id', packageId)
        .order('session_number', { ascending: true }),
      supabase
        .from('package_payments')
        .select('id, amount, method, payment_type, created_at')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false }),
    ]);
    setPkg(pkgRes.data as unknown as PackageListItem);
    setRemaining(remainRes.data as PackageRemaining | null);
    setSessions((sessRes.data ?? []) as typeof sessions);
    setPkgPayments((payRes.data ?? []) as typeof pkgPayments);
  }, [packageId]);

  useEffect(() => {
    if (packageId) reload();
    else {
      setPkg(null);
      setRemaining(null);
      setSessions([]);
      setPkgPayments([]);
    }
  }, [packageId, reload]);

  if (!packageId || !pkg) return null;

  const totalPaid = pkgPayments
    .filter((p) => p.payment_type === 'payment')
    .reduce((s, p) => s + p.amount, 0);
  const totalRefunded = pkgPayments
    .filter((p) => p.payment_type === 'refund')
    .reduce((s, p) => s + p.amount, 0);

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>{pkg.package_name}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-medium">{pkg.customer?.name}</div>
            <div className="text-xs text-muted-foreground">{pkg.customer?.phone}</div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="가열" used={pkg.heated_sessions - (remaining?.heated ?? pkg.heated_sessions)} total={pkg.heated_sessions} />
            <Stat label="비가열" used={pkg.unheated_sessions - (remaining?.unheated ?? pkg.unheated_sessions)} total={pkg.unheated_sessions} />
            <Stat label="수액" used={pkg.iv_sessions - (remaining?.iv ?? pkg.iv_sessions)} total={pkg.iv_sessions} />
            <Stat
              label="사전처치"
              used={pkg.preconditioning_sessions - (remaining?.preconditioning ?? pkg.preconditioning_sessions)}
              total={pkg.preconditioning_sessions}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">총 계약금</div>
              <div className="text-base font-bold">{formatAmount(pkg.total_amount)}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">납부 / 환불</div>
              <div className="text-sm font-bold">
                {formatAmount(totalPaid)}{' '}
                {totalRefunded > 0 && (
                  <span className="text-red-600">-{formatAmount(totalRefunded)}</span>
                )}
              </div>
            </div>
          </div>

          {pkg.status === 'active' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setUseSessionOpen(true)}>
                회차 소진
              </Button>
              <PackagePaymentAdd packageId={pkg.id} customerId={pkg.customer_id} clinicId={pkg.clinic_id} onAdded={reload} />
              <Button variant="outline" size="sm" onClick={() => setRefundOpen(true)} disabled={(pkg.status as string) === 'refunded'}>
                환불
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
                양도
              </Button>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">소진 이력 ({sessions.length})</div>
            <div className="space-y-1">
              {sessions.length === 0 && (
                <div className="py-3 text-center text-xs text-muted-foreground">이력 없음</div>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded bg-muted/30 px-2.5 py-1.5 text-xs"
                >
                  <span>#{s.session_number} · {sessionTypeLabel(s.session_type)}</span>
                  <span className="text-muted-foreground">
                    {s.session_date} · {s.status === 'used' ? '사용' : s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">결제 이력</div>
            <div className="space-y-1">
              {pkgPayments.length === 0 && (
                <div className="py-3 text-center text-xs text-muted-foreground">결제 없음</div>
              )}
              {pkgPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded bg-muted/30 px-2.5 py-1.5 text-xs"
                >
                  <span>{format(new Date(p.created_at), 'yyyy-MM-dd HH:mm')}</span>
                  <span className={p.payment_type === 'refund' ? 'text-red-600' : ''}>
                    {p.payment_type === 'refund' ? '-' : ''}
                    {formatAmount(p.amount)} · {methodLabel(p.method)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <UseSessionDialog
          open={useSessionOpen}
          pkg={pkg}
          remaining={remaining}
          onOpenChange={setUseSessionOpen}
          onDone={() => {
            setUseSessionOpen(false);
            reload();
            onChanged();
          }}
        />
        <RefundDialog
          open={refundOpen}
          packageId={pkg.id}
          customerId={pkg.customer_id}
          clinicId={pkg.clinic_id}
          pkgStatus={pkg.status}
          onOpenChange={setRefundOpen}
          onDone={() => {
            setRefundOpen(false);
            reload();
            onChanged();
          }}
        />
        <TransferDialog
          open={transferOpen}
          pkg={pkg}
          onOpenChange={setTransferOpen}
          onDone={() => {
            setTransferOpen(false);
            onChanged();
          }}
        />
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

function sessionTypeLabel(t: string) {
  switch (t) {
    case 'heated_laser':
      return '가열레이저';
    case 'unheated_laser':
      return '비가열레이저';
    case 'iv':
      return '수액';
    case 'preconditioning':
      return '사전처치';
    default:
      return t;
  }
}

function methodLabel(m: string) {
  return m === 'card' ? '카드' : m === 'cash' ? '현금' : m === 'transfer' ? '계좌이체' : m;
}

function PackagePaymentAdd({
  packageId,
  customerId,
  clinicId,
  onAdded,
}: {
  packageId: string;
  customerId: string;
  clinicId: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>('card');
  const [installment, setInstallment] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (amount <= 0) return;
    setSubmitting(true);
    const { error } = await supabase.from('package_payments').insert({
      clinic_id: clinicId,
      package_id: packageId,
      customer_id: customerId,
      amount,
      method,
      installment: method === 'card' ? installment : 0,
      payment_type: 'payment',
    });
    setSubmitting(false);
    if (error) {
      toast.error(`결제 기록 실패: ${error.message}`);
      return;
    }
    // 누적 납부액 갱신
    const { data: sum } = await supabase
      .from('package_payments')
      .select('amount, payment_type')
      .eq('package_id', packageId);
    const total = (sum ?? []).reduce(
      (s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount),
      0,
    );
    await supabase.from('packages').update({ paid_amount: total }).eq('id', packageId);
    toast.success('결제 기록');
    setOpen(false);
    setAmount(0);
    onAdded();
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        결제 추가
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>패키지 결제 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>금액</Label>
              <Input
                value={formatAmount(amount)}
                onChange={(e) => setAmount(parseAmount(e.target.value))}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label>결제 수단</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['card', 'cash', 'transfer'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      'h-9 rounded-md border text-sm',
                      method === m
                        ? 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    {methodLabel(m)}
                  </button>
                ))}
              </div>
            </div>
            {method === 'card' && (
              <div className="space-y-1.5">
                <Label>할부</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 2, 3, 6, 12].map((n) => (
                    <button
                      key={n}
                      onClick={() => setInstallment(n)}
                      className={cn(
                        'h-8 rounded-md border px-2.5 text-xs',
                        installment === n
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      {n === 0 ? '일시불' : `${n}개월`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button disabled={submitting || amount <= 0} onClick={save}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UseSessionDialog({
  open,
  pkg,
  remaining,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  pkg: PackageListItem;
  remaining: PackageRemaining | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [sessionType, setSessionType] = useState<'heated_laser' | 'unheated_laser' | 'iv' | 'preconditioning'>(
    'unheated_laser',
  );
  const [surcharge, setSurcharge] = useState(0);
  const [surchargeMemo, setSurchargeMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const available: Record<typeof sessionType, number> = {
    heated_laser: remaining?.heated ?? 0,
    unheated_laser: remaining?.unheated ?? 0,
    iv: remaining?.iv ?? 0,
    preconditioning: remaining?.preconditioning ?? 0,
  };

  const save = async () => {
    if ((available[sessionType] ?? 0) <= 0) {
      toast.error('남은 회차가 없습니다');
      return;
    }
    setSubmitting(true);
    const { count } = await supabase
      .from('package_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', pkg.id);
    const nextNumber = (count ?? 0) + 1;
    const { error } = await supabase.from('package_sessions').insert({
      package_id: pkg.id,
      session_number: nextNumber,
      session_type: sessionType,
      surcharge,
      surcharge_memo: surchargeMemo.trim() || null,
      status: 'used',
    });
    setSubmitting(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    toast.success('회차 소진 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>회차 소진</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>시술 종류</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSessionType(t)}
                  disabled={available[t] <= 0}
                  className={cn(
                    'h-10 rounded-md border text-sm',
                    available[t] <= 0 && 'opacity-40',
                    sessionType === t
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {sessionTypeLabel(t)}
                  <span className="ml-1 text-xs text-muted-foreground">({available[t]})</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>당일 추가금 (옵션)</Label>
            <Input
              value={formatAmount(surcharge)}
              onChange={(e) => setSurcharge(parseAmount(e.target.value))}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label>추가금 메모</Label>
            <Input value={surchargeMemo} onChange={(e) => setSurchargeMemo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting} onClick={save}>
            소진 기록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  packageId,
  customerId,
  clinicId,
  pkgStatus: _pkgStatus,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  packageId: string;
  customerId: string;
  clinicId: string;
  pkgStatus: string;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>('card');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.rpc('calc_refund_amount', { p_package_id: packageId });
      setQuote(data as RefundQuote | null);
    })();
  }, [open, packageId]);

  const process = async () => {
    if (!quote) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc('refund_package_atomic', {
      p_package_id: packageId,
      p_clinic_id: clinicId,
      p_customer_id: customerId,
      p_method: method,
    });
    if (error) {
      toast.error(`환불 실패: ${error.message}`);
      setSubmitting(false);
      return;
    }
    const result = data as { ok?: boolean; error?: string };
    if (result.error) {
      toast.error(result.error);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    toast.success('환불 처리 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>환불</DialogTitle>
        </DialogHeader>
        {quote ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Meta label="총 회차" value={`${quote.total_sessions}회`} />
              <Meta label="사용" value={`${quote.used_sessions}회`} />
              <Meta label="잔여" value={`${quote.remaining_sessions}회`} />
              <Meta label="회당 단가" value={formatAmount(quote.unit_price)} />
            </div>
            <div className="rounded-lg border bg-teal-50 p-3">
              <div className="text-xs text-muted-foreground">환불 금액 (할인가 기준)</div>
              <div className="text-xl font-bold text-teal-700">{formatAmount(quote.refund_amount)}</div>
            </div>
            <div className="space-y-1.5">
              <Label>환불 수단</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['card', 'cash', 'transfer'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      'h-9 rounded-md border text-sm',
                      method === m
                        ? 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    {methodLabel(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">계산 중…</div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button variant="destructive" disabled={submitting || !quote} onClick={process}>
            환불 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 px-2.5 py-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function TransferDialog({
  open,
  pkg,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  pkg: PackageListItem;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Customer[]>([]);
  const [target, setTarget] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setMatches([]);
      setTarget(null);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const safe = query.trim().replace(/[%_(),.]/g, '');
    if (!safe) return;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('clinic_id', pkg.clinic_id)
        .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .limit(8);
      setMatches(((data ?? []) as Customer[]).filter((c) => c.id !== pkg.customer_id));
    }, 200);
    return () => clearTimeout(t);
  }, [query, pkg]);

  const process = async () => {
    if (!target) return;
    setSubmitting(true);
    const { error } = await supabase
      .from('packages')
      .update({
        status: 'transferred',
        transferred_from: pkg.customer_id,
        transferred_to: target.id,
        memo: `${pkg.customer?.name ?? '?'} → ${target.name} 양도 (${new Date().toISOString().slice(0, 10)})`,
      })
      .eq('id', pkg.id);
    if (error) {
      toast.error(`양도 실패: ${error.message}`);
      setSubmitting(false);
      return;
    }
    const { error: createErr } = await supabase.from('packages').insert({
      clinic_id: pkg.clinic_id,
      customer_id: target.id,
      package_name: pkg.package_name,
      package_type: pkg.package_type,
      total_sessions: pkg.total_sessions,
      heated_sessions: pkg.heated_sessions ?? 0,
      unheated_sessions: pkg.unheated_sessions ?? 0,
      iv_sessions: pkg.iv_sessions ?? 0,
      preconditioning_sessions: pkg.preconditioning_sessions ?? 0,
      shot_upgrade: pkg.shot_upgrade ?? false,
      af_upgrade: pkg.af_upgrade ?? false,
      upgrade_surcharge: pkg.upgrade_surcharge ?? 0,
      total_amount: pkg.total_amount,
      paid_amount: pkg.paid_amount,
      status: 'active',
      transferred_from: pkg.customer_id,
      contract_date: new Date().toISOString().slice(0, 10),
      memo: `${pkg.customer?.name ?? '?'}로부터 양도받음`,
    });
    setSubmitting(false);
    if (createErr) {
      toast.error(`수령 패키지 생성 실패: ${createErr.message}`);
      return;
    }
    toast.success(`${target.name}님에게 양도 완료`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>패키지 양도</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded bg-muted/30 px-3 py-2 text-xs">
            {pkg.customer?.name} → 새로운 고객 검색
          </div>
          {target ? (
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                <span className="font-medium">{target.name}</span>
                <span className="ml-2 text-muted-foreground">{target.phone}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                변경
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 또는 전화번호"
              />
              {matches.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-background shadow-md">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => setTarget(c)}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !target} onClick={process}>
            양도
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
