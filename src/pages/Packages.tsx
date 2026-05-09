import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Layers, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Customer, Package, PackageRemaining, PackageTemplate } from '@/lib/types';

type PackageListItem = Package & { customer: { name: string; phone: string } | null };

interface RefundQuote {
  total_amount: number;
  total_sessions: number;
  used_sessions: number;
  remaining_sessions: number;
  unit_price: number;
  refund_amount: number;
}

type FilterStatus = 'active' | 'completed' | 'refunded' | 'all';

export default function Packages() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [filter, setFilter] = useState<FilterStatus>('active');
  const [rows, setRows] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [openTemplates, setOpenTemplates] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const fetchPackages = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    let req = supabase
      .from('packages')
      .select('*, customer:customers!customer_id(name, phone)')
      .eq('clinic_id', clinic.id)
      .order('contract_date', { ascending: false })
      .limit(200);
    if (filter !== 'all') req = req.eq('status', filter);
    const { data, error } = await req;
    setLoading(false);
    if (error) {
      toast.error(`패키지 로딩 실패: ${error.message}`);
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
          {isAdmin && (
            <Button variant="outline" onClick={() => setOpenTemplates(true)} className="gap-1">
              <Layers className="h-4 w-4" /> 템플릿 관리
            </Button>
          )}
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
              {isAdmin && <th className="px-3 py-2 text-center font-medium">관리</th>}
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
                {isAdmin && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); }}
                        className="rounded p-1.5 hover:bg-muted transition"
                        title="상세/편집"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!window.confirm(`「${p.package_name}」 패키지를 삭제하시겠습니까?\n사용/결제 이력이 있으면 삭제되지 않습니다.`)) return;
                          const { data, error } = await supabase.rpc('delete_package_safe', { p_package_id: p.id });
                          if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
                          const result = data as { ok?: boolean; error?: string };
                          if (!result?.ok) { toast.error(result?.error ?? '삭제 실패'); return; }
                          toast.success('패키지 삭제됨');
                          fetchPackages();
                        }}
                        className="rounded p-1.5 hover:bg-red-50 transition"
                        title="삭제 (이력 없는 경우만)"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">
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

      <TemplateManageSheet
        open={openTemplates}
        clinicId={clinic?.id}
        onOpenChange={setOpenTemplates}
      />

      <PackageDetailSheet
        packageId={selectedId}
        isAdmin={isAdmin}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          setSelectedId(null);
          fetchPackages();
        }}
      />
    </div>
  );
}

// ============================================================
// 템플릿 관리 Sheet
// ============================================================
function TemplateManageSheet({
  open,
  clinicId,
  onOpenChange,
}: {
  open: boolean;
  clinicId: string | undefined;
  onOpenChange: (o: boolean) => void;
}) {
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<PackageTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('package_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) { toast.error(`템플릿 로딩 실패: ${error.message}`); return; }
    setTemplates((data ?? []) as PackageTemplate[]);
  }, [clinicId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const remove = async (t: PackageTemplate) => {
    if (!window.confirm(`「${t.name}」 템플릿을 삭제하시겠습니까?`)) return;
    const { error } = await supabase
      .from('package_templates')
      .update({ is_active: false })
      .eq('id', t.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('템플릿 삭제됨');
    load();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>패키지 템플릿 관리</SheetTitle>
            <Button size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> 새 템플릿
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {loading && (
            <div className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</div>
          )}
          {!loading && templates.length === 0 && (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              템플릿 없음 — [새 템플릿]을 눌러 추가하세요
            </div>
          )}
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border bg-white p-3 text-xs">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-semibold text-sm text-teal-800">{t.name}</span>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditTarget(t)}
                    className="rounded p-1 hover:bg-muted transition"
                    title="편집"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => remove(t)}
                    className="rounded p-1 hover:bg-red-50 transition"
                    title="삭제"
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                {t.heated_sessions > 0 && (
                  <div>가열 {t.heated_sessions}회 · {formatAmount(t.heated_unit_price)}{t.heated_upgrade_available && ' (+샷업)' }</div>
                )}
                {t.unheated_sessions > 0 && (
                  <div>비가열 {t.unheated_sessions}회 · {formatAmount(t.unheated_unit_price)}{t.unheated_upgrade_available && ' (+AF업)' }</div>
                )}
                {t.podologe_sessions > 0 && (
                  <div>포돌로게 {t.podologe_sessions}회 · {formatAmount(t.podologe_unit_price)}</div>
                )}
                {t.iv_sessions > 0 && (
                  <div>수액 {t.iv_sessions}회 · {formatAmount(t.iv_unit_price)}{t.iv_company ? ` (${t.iv_company})` : ''}</div>
                )}
              </div>
              <div className="mt-1.5 font-medium text-teal-700">
                총 {formatAmount(t.total_price)}
                {t.price_override && <span className="ml-1 text-[10px] text-muted-foreground">(수기)</span>}
              </div>
              {t.memo && (
                <div className="mt-1 text-muted-foreground/80 italic">{t.memo}</div>
              )}
            </div>
          ))}
        </div>

        <PackageTemplateDialog
          open={createOpen || !!editTarget}
          clinicId={clinicId}
          template={editTarget}
          onOpenChange={(o) => {
            if (!o) { setCreateOpen(false); setEditTarget(null); }
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditTarget(null);
            load();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// 패키지 템플릿 생성/편집 다이얼로그
// ============================================================
function PackageTemplateDialog({
  open,
  clinicId,
  template,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  clinicId: string | undefined;
  template: PackageTemplate | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!template;

  const [name, setName] = useState('');
  // 가열
  const [heatedSessions, setHeatedSessions] = useState(0);
  const [heatedUnitPrice, setHeatedUnitPrice] = useState(0);
  const [heatedUpgrade, setHeatedUpgrade] = useState(false);
  // 비가열
  const [unheatedSessions, setUnheatedSessions] = useState(0);
  const [unheatedUnitPrice, setUnheatedUnitPrice] = useState(0);
  const [unheatedUpgrade, setUnheatedUpgrade] = useState(false);
  // 포돌로게
  const [podologeSessions, setPodologeSessions] = useState(0);
  const [podologeUnitPrice, setPodologeUnitPrice] = useState(0);
  // 수액
  const [ivCompany, setIvCompany] = useState('');
  const [ivSessions, setIvSessions] = useState(0);
  const [ivUnitPrice, setIvUnitPrice] = useState(0);
  // 총금액
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualPrice, setManualPrice] = useState(0);
  // 메모
  const [memo, setMemo] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const computedTotal = useMemo(
    () =>
      heatedSessions * heatedUnitPrice +
      unheatedSessions * unheatedUnitPrice +
      podologeSessions * podologeUnitPrice +
      ivSessions * ivUnitPrice,
    [heatedSessions, heatedUnitPrice, unheatedSessions, unheatedUnitPrice, podologeSessions, podologeUnitPrice, ivSessions, ivUnitPrice],
  );

  const finalPrice = priceOverride ? manualPrice : computedTotal;

  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setHeatedSessions(template.heated_sessions);
      setHeatedUnitPrice(template.heated_unit_price);
      setHeatedUpgrade(template.heated_upgrade_available);
      setUnheatedSessions(template.unheated_sessions);
      setUnheatedUnitPrice(template.unheated_unit_price);
      setUnheatedUpgrade(template.unheated_upgrade_available);
      setPodologeSessions(template.podologe_sessions);
      setPodologeUnitPrice(template.podologe_unit_price);
      setIvCompany(template.iv_company ?? '');
      setIvSessions(template.iv_sessions);
      setIvUnitPrice(template.iv_unit_price);
      setPriceOverride(template.price_override);
      setManualPrice(template.total_price);
      setMemo(template.memo ?? '');
      setSortOrder(template.sort_order);
    } else {
      setName('');
      setHeatedSessions(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
      setUnheatedSessions(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
      setPodologeSessions(0); setPodologeUnitPrice(0);
      setIvCompany(''); setIvSessions(0); setIvUnitPrice(0);
      setPriceOverride(false); setManualPrice(0);
      setMemo(''); setSortOrder(0);
    }
  }, [open, template]);

  // 자동합산 시 manualPrice 동기화
  useEffect(() => {
    if (!priceOverride) setManualPrice(computedTotal);
  }, [computedTotal, priceOverride]);

  const save = async () => {
    if (!clinicId || !name.trim()) { toast.error('패키지명을 입력하세요'); return; }
    setSubmitting(true);
    const payload = {
      clinic_id: clinicId,
      name: name.trim(),
      heated_sessions: heatedSessions,
      heated_unit_price: heatedUnitPrice,
      heated_upgrade_available: heatedUpgrade,
      unheated_sessions: unheatedSessions,
      unheated_unit_price: unheatedUnitPrice,
      unheated_upgrade_available: unheatedUpgrade,
      podologe_sessions: podologeSessions,
      podologe_unit_price: podologeUnitPrice,
      iv_company: ivCompany.trim() || null,
      iv_sessions: ivSessions,
      iv_unit_price: ivUnitPrice,
      total_price: finalPrice,
      price_override: priceOverride,
      memo: memo.trim() || null,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (isEdit && template) {
      ({ error } = await supabase.from('package_templates').update(payload).eq('id', template.id));
    } else {
      ({ error } = await supabase.from('package_templates').insert(payload));
    }
    setSubmitting(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(isEdit ? '템플릿 수정됨' : '템플릿 생성됨');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '템플릿 편집' : '새 패키지 템플릿'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>패키지명 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="패키지명" />
          </div>

          {/* 가열 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={heatedSessions}
                  onChange={(e) => setHeatedSessions(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(heatedUnitPrice)}
                  onChange={(e) => setHeatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={() => setHeatedUpgrade(!heatedUpgrade)}
                  className={cn('h-9 w-full rounded-md border text-xs font-medium px-2',
                    heatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}
                >
                  {heatedUpgrade ? '✓ ' : ''}6000샷 업그레이드
                </button>
              </div>
            </div>
            {heatedSessions > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(heatedSessions * heatedUnitPrice)}
              </div>
            )}
          </div>

          {/* 비가열 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">비가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={unheatedSessions}
                  onChange={(e) => setUnheatedSessions(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(unheatedUnitPrice)}
                  onChange={(e) => setUnheatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={() => setUnheatedUpgrade(!unheatedUpgrade)}
                  className={cn('h-9 w-full rounded-md border text-xs font-medium px-2',
                    unheatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}
                >
                  {unheatedUpgrade ? '✓ ' : ''}AF 업그레이드
                </button>
              </div>
            </div>
            {unheatedSessions > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(unheatedSessions * unheatedUnitPrice)}
              </div>
            )}
          </div>

          {/* 포돌로게 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">포돌로게</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={podologeSessions}
                  onChange={(e) => setPodologeSessions(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(podologeUnitPrice)}
                  onChange={(e) => setPodologeUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
            </div>
            {podologeSessions > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(podologeSessions * podologeUnitPrice)}
              </div>
            )}
          </div>

          {/* 수액 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">수액</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">수액명</Label>
                <Input value={ivCompany} onChange={(e) => setIvCompany(e.target.value)}
                  placeholder="수액명" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={ivSessions}
                  onChange={(e) => setIvSessions(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(ivUnitPrice)}
                  onChange={(e) => setIvUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
            </div>
            {ivSessions > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(ivSessions * ivUnitPrice)}
              </div>
            )}
          </div>

          {/* 총금액 */}
          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-teal-800">패키지 총 금액</div>
              <button
                onClick={() => { setPriceOverride(!priceOverride); if (!priceOverride) setManualPrice(computedTotal); }}
                className={cn('text-xs rounded border px-2 py-0.5',
                  priceOverride ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-input hover:bg-muted')}
              >
                {priceOverride ? '✓ 수기수정' : '수기수정'}
              </button>
            </div>
            {priceOverride ? (
              <Input
                value={formatAmount(manualPrice)}
                onChange={(e) => setManualPrice(parseAmount(e.target.value))}
                inputMode="numeric"
                className="text-lg font-bold"
              />
            ) : (
              <div className="text-xl font-bold text-teal-700">
                {formatAmount(computedTotal)}
                <span className="ml-2 text-xs text-muted-foreground font-normal">(항목 자동합산)</span>
              </div>
            )}
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
              placeholder="메모" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">정렬 순서 (낮을수록 앞)</Label>
            <Input type="number" value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              className="w-24" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>
            {submitting ? '저장 중…' : isEdit ? '수정' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 패키지 생성 다이얼로그 (순수 템플릿 정의)
// T-20260508-foot-PKG-TEMPLATE-UX: 고객 선택 제거, package_templates 생성
// 고객별 적용은 CustomerChartPage PackagePurchaseFromTemplateDialog에서 수행
// ============================================================
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
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | 'custom'>('custom');

  const [packageName, setPackageName] = useState('');
  // 가열
  const [heated, setHeated] = useState(0);
  const [heatedUnitPrice, setHeatedUnitPrice] = useState(0);
  const [heatedUpgrade, setHeatedUpgrade] = useState(false);
  // 비가열
  const [unheated, setUnheated] = useState(0);
  const [unheatedUnitPrice, setUnheatedUnitPrice] = useState(0);
  const [unheatedUpgrade, setUnheatedUpgrade] = useState(false);
  // 포돌로게
  const [podologe, setPodologe] = useState(0);
  const [podologeUnitPrice, setPodologeUnitPrice] = useState(0);
  // 수액
  const [iv, setIv] = useState(0);
  const [ivUnitPrice, setIvUnitPrice] = useState(0);
  const [ivCompany, setIvCompany] = useState('');

  // 총금액
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualTotal, setManualTotal] = useState(0);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 항목별 자동합산 (upgrade 포함 없이 순수 수가 합산)
  const computedTotal = useMemo(
    () =>
      heated * heatedUnitPrice +
      unheated * unheatedUnitPrice +
      podologe * podologeUnitPrice +
      iv * ivUnitPrice,
    [heated, heatedUnitPrice, unheated, unheatedUnitPrice, podologe, podologeUnitPrice, iv, ivUnitPrice],
  );
  const finalTotal = priceOverride ? manualTotal : computedTotal;

  // 템플릿 로드 — T-20260509-foot-PKG-LIST-DEFAULT: 로드 후 첫 번째 템플릿 자동 선택
  useEffect(() => {
    if (!open || !clinicId) return;
    supabase
      .from('package_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        const tmplList = (data ?? []) as PackageTemplate[];
        setTemplates(tmplList);
        // 템플릿이 있으면 첫 번째 자동 선택 (현장: "기본 목록 먼저 보이게")
        if (tmplList.length > 0) {
          const first = tmplList[0];
          setSelectedTemplateId(first.id);
          setPackageName(first.name);
          setHeated(first.heated_sessions); setHeatedUnitPrice(first.heated_unit_price);
          setHeatedUpgrade(first.heated_upgrade_available);
          setUnheated(first.unheated_sessions); setUnheatedUnitPrice(first.unheated_unit_price);
          setUnheatedUpgrade(first.unheated_upgrade_available);
          setPodologe(first.podologe_sessions); setPodologeUnitPrice(first.podologe_unit_price);
          setIv(first.iv_sessions); setIvUnitPrice(first.iv_unit_price);
          setIvCompany(first.iv_company ?? '');
          setPriceOverride(false);
          setMemo(first.memo ?? '');
        }
      });
  }, [open, clinicId]);

  // 초기화 (다이얼로그 닫힐 때 리셋)
  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId('custom');
    setPackageName('');
    setHeated(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
    setUnheated(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
    setPodologe(0); setPodologeUnitPrice(0);
    setIv(0); setIvUnitPrice(0); setIvCompany('');
    setPriceOverride(false); setManualTotal(0); setMemo('');
  }, [open]);

  // 자동합산 변경 시 manualTotal 동기화
  useEffect(() => {
    if (!priceOverride) setManualTotal(computedTotal);
  }, [computedTotal, priceOverride]);

  const applyTemplate = (tmpl: PackageTemplate) => {
    setSelectedTemplateId(tmpl.id);
    setPackageName(tmpl.name);
    setHeated(tmpl.heated_sessions);
    setHeatedUnitPrice(tmpl.heated_unit_price);
    setHeatedUpgrade(tmpl.heated_upgrade_available);
    setUnheated(tmpl.unheated_sessions);
    setUnheatedUnitPrice(tmpl.unheated_unit_price);
    setUnheatedUpgrade(tmpl.unheated_upgrade_available);
    setPodologe(tmpl.podologe_sessions);
    setPodologeUnitPrice(tmpl.podologe_unit_price);
    setIv(tmpl.iv_sessions);
    setIvUnitPrice(tmpl.iv_unit_price);
    setIvCompany(tmpl.iv_company ?? '');
    setPriceOverride(false);
    setMemo(tmpl.memo ?? '');
  };

  const applyCustom = () => {
    setSelectedTemplateId('custom');
    setPackageName('');
    setHeated(0); setHeatedUnitPrice(0); setHeatedUpgrade(false);
    setUnheated(0); setUnheatedUnitPrice(0); setUnheatedUpgrade(false);
    setPodologe(0); setPodologeUnitPrice(0);
    setIv(0); setIvUnitPrice(0); setIvCompany('');
    setPriceOverride(false); setManualTotal(0); setMemo('');
  };

  const submit = async () => {
    if (!clinicId) return;
    if (!packageName.trim()) { toast.error('패키지명을 입력하세요'); return; }
    if (heated + unheated + podologe + iv === 0) { toast.error('최소 1회 이상 구성하세요'); return; }
    setSubmitting(true);
    const { error } = await supabase.from('package_templates').insert({
      clinic_id: clinicId,
      name: packageName.trim(),
      heated_sessions: heated,
      heated_unit_price: heatedUnitPrice,
      heated_upgrade_available: heatedUpgrade,
      unheated_sessions: unheated,
      unheated_unit_price: unheatedUnitPrice,
      unheated_upgrade_available: unheatedUpgrade,
      podologe_sessions: podologe,
      podologe_unit_price: podologeUnitPrice,
      iv_company: ivCompany.trim() || null,
      iv_sessions: iv,
      iv_unit_price: ivUnitPrice,
      total_price: finalTotal,
      price_override: priceOverride,
      memo: memo.trim() || null,
      sort_order: 0,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (error) { toast.error(`템플릿 생성 실패: ${error.message}`); return; }
    toast.success('패키지 템플릿 생성 완료 — 고객 차트에서 불러올 수 있습니다');
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>새 패키지 템플릿</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 기존 템플릿 기반 자동채움 */}
          <div className="space-y-1.5">
            <Label>기존 템플릿 불러오기 (선택)</Label>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className={cn(
                    'h-9 rounded-md border px-3 text-sm font-medium transition',
                    selectedTemplateId === t.id
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {t.name}
                </button>
              ))}
              <button
                onClick={applyCustom}
                className={cn(
                  'h-9 rounded-md border px-3 text-sm font-medium transition',
                  selectedTemplateId === 'custom'
                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                    : 'border-input hover:bg-muted',
                )}
              >
                직접 입력
              </button>
            </div>
            {templates.length === 0 && (
              <div className="text-xs text-muted-foreground">
                등록된 템플릿 없음 — 직접 입력으로 첫 템플릿을 만들어보세요
              </div>
            )}
          </div>

          {/* 패키지명 */}
          <div className="space-y-1.5">
            <Label>패키지명 *</Label>
            <Input value={packageName} onChange={(e) => setPackageName(e.target.value)}
              placeholder="패키지명" />
          </div>

          {/* 가열 레이저 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={heated}
                  onChange={(e) => setHeated(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(heatedUnitPrice)}
                  onChange={(e) => setHeatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={() => setHeatedUpgrade(!heatedUpgrade)}
                  className={cn('h-9 w-full rounded-md border text-xs font-medium px-2',
                    heatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}
                >
                  {heatedUpgrade ? '✓ ' : ''}6000샷 업그레이드
                </button>
              </div>
            </div>
            {heated > 0 && heatedUnitPrice > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(heated * heatedUnitPrice)}
              </div>
            )}
          </div>

          {/* 비가열 레이저 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">비가열 레이저</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={unheated}
                  onChange={(e) => setUnheated(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(unheatedUnitPrice)}
                  onChange={(e) => setUnheatedUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={() => setUnheatedUpgrade(!unheatedUpgrade)}
                  className={cn('h-9 w-full rounded-md border text-xs font-medium px-2',
                    unheatedUpgrade ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}
                >
                  {unheatedUpgrade ? '✓ ' : ''}AF 업그레이드
                </button>
              </div>
            </div>
            {unheated > 0 && unheatedUnitPrice > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(unheated * unheatedUnitPrice)}
              </div>
            )}
          </div>

          {/* 포돌로게 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">포돌로게</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={podologe}
                  onChange={(e) => setPodologe(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(podologeUnitPrice)}
                  onChange={(e) => setPodologeUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
            </div>
            {podologe > 0 && podologeUnitPrice > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(podologe * podologeUnitPrice)}
              </div>
            )}
          </div>

          {/* 수액 */}
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">수액</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">수액명</Label>
                <Input value={ivCompany} onChange={(e) => setIvCompany(e.target.value)}
                  placeholder="수액명" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">회수</Label>
                <Input type="number" min={0} value={iv}
                  onChange={(e) => setIv(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">수가 (회당)</Label>
                <Input value={formatAmount(ivUnitPrice)}
                  onChange={(e) => setIvUnitPrice(parseAmount(e.target.value))}
                  inputMode="numeric" />
              </div>
            </div>
            {iv > 0 && ivUnitPrice > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                소계: {formatAmount(iv * ivUnitPrice)}
              </div>
            )}
          </div>

          {/* 패키지 총 금액 (자동합산 + 수기수정) */}
          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-teal-800">패키지 총 금액</div>
              <button
                onClick={() => { setPriceOverride(!priceOverride); if (!priceOverride) setManualTotal(computedTotal); }}
                className={cn('text-xs rounded border px-2 py-0.5',
                  priceOverride ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-input hover:bg-muted')}
              >
                {priceOverride ? '✓ 수기수정' : '수기수정'}
              </button>
            </div>
            {priceOverride ? (
              <Input
                value={formatAmount(manualTotal)}
                onChange={(e) => setManualTotal(parseAmount(e.target.value))}
                inputMode="numeric"
                className="text-lg font-bold"
              />
            ) : (
              <div className="text-xl font-bold text-teal-700">
                {formatAmount(computedTotal)}
                <span className="ml-2 text-xs text-muted-foreground font-normal">(항목 자동합산)</span>
              </div>
            )}
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
              placeholder="메모" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button
            disabled={submitting || !packageName.trim() || (heated + unheated + podologe + iv === 0)}
            onClick={submit}
          >
            {submitting ? '저장 중…' : '템플릿 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackageDetailSheet({
  packageId, isAdmin, onClose, onChanged,
}: {
  packageId: string | null;
  isAdmin?: boolean;
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
  const [editOpen, setEditOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!packageId) return;
    const [pkgRes, remainRes, sessRes, payRes] = await Promise.all([
      supabase.from('packages').select('*, customer:customers!customer_id(name, phone)').eq('id', packageId).single(),
      supabase.rpc('get_package_remaining', { p_package_id: packageId }),
      supabase.from('package_sessions').select('id, session_number, session_type, session_date, status')
        .eq('package_id', packageId).order('session_number', { ascending: true }),
      supabase.from('package_payments').select('id, amount, method, payment_type, created_at')
        .eq('package_id', packageId).order('created_at', { ascending: false }),
    ]);
    setPkg(pkgRes.data as unknown as PackageListItem);
    setRemaining(remainRes.data as PackageRemaining | null);
    setSessions((sessRes.data ?? []) as typeof sessions);
    setPkgPayments((payRes.data ?? []) as typeof pkgPayments);
  }, [packageId]);

  useEffect(() => {
    if (packageId) reload();
    else { setPkg(null); setRemaining(null); setSessions([]); setPkgPayments([]); }
  }, [packageId, reload]);

  if (!packageId || !pkg) return null;

  const totalPaid = pkgPayments.filter((p) => p.payment_type === 'payment').reduce((s, p) => s + p.amount, 0);
  const totalRefunded = pkgPayments.filter((p) => p.payment_type === 'refund').reduce((s, p) => s + p.amount, 0);

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex-1">{pkg.package_name}</SheetTitle>
            {isAdmin && (
              <button onClick={() => setEditOpen(true)} className="rounded p-1.5 hover:bg-muted transition" title="패키지 편집">
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
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
            <Stat label="사전처치" used={pkg.preconditioning_sessions - (remaining?.preconditioning ?? pkg.preconditioning_sessions)} total={pkg.preconditioning_sessions} />
          </div>
          {(pkg.podologe_sessions ?? 0) > 0 && (
            <div className="rounded bg-muted/40 px-2.5 py-1.5 text-xs">
              포돌로게 {pkg.podologe_sessions}회 (별도 관리)
              {pkg.iv_company && <span className="ml-2 text-muted-foreground">· 수액: {pkg.iv_company}</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">총 계약금</div>
              <div className="text-base font-bold">{formatAmount(pkg.total_amount)}</div>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">납부 / 환불</div>
              <div className="text-sm font-bold">
                {formatAmount(totalPaid)}{' '}
                {totalRefunded > 0 && <span className="text-red-600">-{formatAmount(totalRefunded)}</span>}
              </div>
            </div>
          </div>

          {pkg.status === 'active' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setUseSessionOpen(true)}>회차 소진</Button>
              <PackagePaymentAdd packageId={pkg.id} customerId={pkg.customer_id} clinicId={pkg.clinic_id} onAdded={reload} />
              <Button variant="outline" size="sm" onClick={() => setRefundOpen(true)} disabled={(pkg.status as string) === 'refunded'}>환불</Button>
              <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>양도</Button>
              {isAdmin && sessions.length === 0 && pkgPayments.length === 0 && (
                <Button variant="destructive" size="sm" className="gap-1"
                  onClick={async () => {
                    if (!window.confirm(`「${pkg.package_name}」 패키지를 삭제하시겠습니까?`)) return;
                    const { data, error } = await supabase.rpc('delete_package_safe', { p_package_id: pkg.id });
                    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
                    const result = data as { ok?: boolean; error?: string };
                    if (!result?.ok) { toast.error(result?.error ?? '삭제 실패'); return; }
                    toast.success('패키지 삭제됨');
                    onChanged();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />삭제
                </Button>
              )}
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">소진 이력 ({sessions.length})</div>
            <div className="space-y-1">
              {sessions.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">이력 없음</div>}
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded bg-muted/30 px-2.5 py-1.5 text-xs">
                  <span>#{s.session_number} · {sessionTypeLabel(s.session_type)}</span>
                  <span className="text-muted-foreground">{s.session_date} · {s.status === 'used' ? '사용' : s.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">결제 이력</div>
            <div className="space-y-1">
              {pkgPayments.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">결제 없음</div>}
              {pkgPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded bg-muted/30 px-2.5 py-1.5 text-xs">
                  <span>{format(new Date(p.created_at), 'yyyy-MM-dd HH:mm')}</span>
                  <span className={p.payment_type === 'refund' ? 'text-red-600' : ''}>
                    {p.payment_type === 'refund' ? '-' : ''}{formatAmount(p.amount)} · {methodLabel(p.method)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isAdmin && pkg && (
          <EditPackageDialog open={editOpen} pkg={pkg} onOpenChange={setEditOpen}
            onDone={() => { setEditOpen(false); reload(); onChanged(); }} />
        )}
        <UseSessionDialog open={useSessionOpen} pkg={pkg} remaining={remaining} onOpenChange={setUseSessionOpen}
          onDone={() => { setUseSessionOpen(false); reload(); onChanged(); }} />
        <RefundDialog open={refundOpen} packageId={pkg.id} customerId={pkg.customer_id} clinicId={pkg.clinic_id}
          pkgStatus={pkg.status} onOpenChange={setRefundOpen}
          onDone={() => { setRefundOpen(false); reload(); onChanged(); }} />
        <TransferDialog open={transferOpen} pkg={pkg} onOpenChange={setTransferOpen}
          onDone={() => { setTransferOpen(false); onChanged(); }} />
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, used, total }: { label: string; used: number; total: number }) {
  const remaining = Math.max(0, total - used);
  return (
    <div className="rounded bg-muted/40 px-1.5 py-1 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xs font-medium">{remaining}/{total}</div>
    </div>
  );
}

function sessionTypeLabel(t: string) {
  switch (t) {
    case 'heated_laser': return '가열레이저';
    case 'unheated_laser': return '비가열레이저';
    case 'iv': return '수액';
    case 'preconditioning': return '사전처치';
    default: return t;
  }
}

function methodLabel(m: string) {
  return m === 'card' ? '카드' : m === 'cash' ? '현금' : m === 'transfer' ? '계좌이체' : m;
}

function PackagePaymentAdd({ packageId, customerId, clinicId, onAdded }: {
  packageId: string; customerId: string; clinicId: string; onAdded: () => void;
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
      clinic_id: clinicId, package_id: packageId, customer_id: customerId,
      amount, method, installment: method === 'card' ? installment : 0, payment_type: 'payment',
    });
    setSubmitting(false);
    if (error) { toast.error(`결제 기록 실패: ${error.message}`); return; }
    const { data: sum } = await supabase.from('package_payments').select('amount, payment_type').eq('package_id', packageId);
    const total = (sum ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    await supabase.from('packages').update({ paid_amount: total }).eq('id', packageId);
    toast.success('결제 기록');
    setOpen(false); setAmount(0); onAdded();
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>결제 추가</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>패키지 결제 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>금액</Label>
              <Input value={formatAmount(amount)} onChange={(e) => setAmount(parseAmount(e.target.value))} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>결제 수단</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['card', 'cash', 'transfer'] as const).map((m) => (
                  <button key={m} onClick={() => setMethod(m)}
                    className={cn('h-9 rounded-md border text-sm', method === m ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}>
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
                    <button key={n} onClick={() => setInstallment(n)}
                      className={cn('h-8 rounded-md border px-2.5 text-xs', installment === n ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}>
                      {n === 0 ? '일시불' : `${n}개월`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button disabled={submitting || amount <= 0} onClick={save}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UseSessionDialog({ open, pkg, remaining, onOpenChange, onDone }: {
  open: boolean; pkg: PackageListItem; remaining: PackageRemaining | null;
  onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [sessionType, setSessionType] = useState<'heated_laser' | 'unheated_laser' | 'iv' | 'preconditioning'>('unheated_laser');
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
    if ((available[sessionType] ?? 0) <= 0) { toast.error('남은 회차가 없습니다'); return; }
    setSubmitting(true);
    const { count } = await supabase.from('package_sessions').select('*', { count: 'exact', head: true }).eq('package_id', pkg.id);
    const nextNumber = (count ?? 0) + 1;
    const { error } = await supabase.from('package_sessions').insert({
      package_id: pkg.id, session_number: nextNumber, session_type: sessionType,
      surcharge, surcharge_memo: surchargeMemo.trim() || null, status: 'used',
    });
    setSubmitting(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('회차 소진 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>회차 소진</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>진료 종류</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const).map((t) => (
                <button key={t} onClick={() => setSessionType(t)} disabled={available[t] <= 0}
                  className={cn('h-10 rounded-md border text-sm', available[t] <= 0 && 'opacity-40',
                    sessionType === t ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}>
                  {sessionTypeLabel(t)}<span className="ml-1 text-xs text-muted-foreground">({available[t]})</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>당일 추가금 (옵션)</Label>
            <Input value={formatAmount(surcharge)} onChange={(e) => setSurcharge(parseAmount(e.target.value))} inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label>추가금 메모</Label>
            <Input value={surchargeMemo} onChange={(e) => setSurchargeMemo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting} onClick={save}>소진 기록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ open, packageId, customerId, clinicId, pkgStatus: _pkgStatus, onOpenChange, onDone }: {
  open: boolean; packageId: string; customerId: string; clinicId: string; pkgStatus: string;
  onOpenChange: (o: boolean) => void; onDone: () => void;
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
    if (!window.confirm(`환불 금액 ${formatAmount(quote.refund_amount)}을 환불하시겠습니까?`)) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc('refund_package_atomic', {
      p_package_id: packageId, p_clinic_id: clinicId, p_customer_id: customerId, p_method: method,
    });
    if (error) { toast.error(`환불 실패: ${error.message}`); setSubmitting(false); return; }
    const result = data as { ok?: boolean; error?: string };
    if (result.error) { toast.error(result.error); setSubmitting(false); return; }
    setSubmitting(false);
    toast.success('환불 처리 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>환불</DialogTitle></DialogHeader>
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
                  <button key={m} onClick={() => setMethod(m)}
                    className={cn('h-9 rounded-md border text-sm', method === m ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted')}>
                    {methodLabel(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : <div className="py-6 text-center text-sm text-muted-foreground">계산 중…</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button variant="destructive" disabled={submitting || !quote} onClick={process}>환불 실행</Button>
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

function TransferDialog({ open, pkg, onOpenChange, onDone }: {
  open: boolean; pkg: PackageListItem; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Customer[]>([]);
  const [target, setTarget] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (!open) { setQuery(''); setMatches([]); setTarget(null); } }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) { setMatches([]); return; }
    const safe = query.trim().replace(/[%_(),.]/g, '');
    if (!safe) return;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('customers').select('*').eq('clinic_id', pkg.clinic_id)
        .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`).limit(8);
      setMatches(((data ?? []) as Customer[]).filter((c) => c.id !== pkg.customer_id));
    }, 200);
    return () => clearTimeout(t);
  }, [query, pkg]);

  const process = async () => {
    if (!target) return;
    if (!window.confirm(`${target.name}님에게 패키지를 양도하시겠습니까?`)) return;
    setSubmitting(true);
    const { error } = await supabase.from('packages').update({
      status: 'transferred', transferred_from: pkg.customer_id, transferred_to: target.id,
      memo: `${pkg.customer?.name ?? '?'} → ${target.name} 양도 (${new Date().toISOString().slice(0, 10)})`,
    }).eq('id', pkg.id);
    if (error) { toast.error(`양도 실패: ${error.message}`); setSubmitting(false); return; }
    const { error: createErr } = await supabase.from('packages').insert({
      clinic_id: pkg.clinic_id, customer_id: target.id,
      package_name: pkg.package_name, package_type: pkg.package_type,
      total_sessions: pkg.total_sessions, heated_sessions: pkg.heated_sessions ?? 0,
      unheated_sessions: pkg.unheated_sessions ?? 0, iv_sessions: pkg.iv_sessions ?? 0,
      preconditioning_sessions: pkg.preconditioning_sessions ?? 0,
      podologe_sessions: pkg.podologe_sessions ?? 0,
      iv_company: pkg.iv_company ?? null,
      shot_upgrade: pkg.shot_upgrade ?? false, af_upgrade: pkg.af_upgrade ?? false,
      upgrade_surcharge: pkg.upgrade_surcharge ?? 0, total_amount: pkg.total_amount,
      paid_amount: pkg.paid_amount, status: 'active', transferred_from: pkg.customer_id,
      contract_date: new Date().toISOString().slice(0, 10),
      memo: `${pkg.customer?.name ?? '?'}로부터 양도받음`,
    });
    setSubmitting(false);
    if (createErr) { toast.error(`수령 패키지 생성 실패: ${createErr.message}`); return; }
    toast.success(`${target.name}님에게 양도 완료`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>패키지 양도</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded bg-muted/30 px-3 py-2 text-xs">{pkg.customer?.name} → 새로운 고객 검색</div>
          {target ? (
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <span><span className="font-medium">{target.name}</span><span className="ml-2 text-muted-foreground">{target.phone}</span></span>
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>변경</Button>
            </div>
          ) : (
            <div className="relative">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 또는 전화번호" />
              {matches.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-background shadow-md">
                  {matches.map((c) => (
                    <button key={c.id} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setTarget(c)}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting || !target} onClick={process}>양도</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPackageDialog({ open, pkg, onOpenChange, onDone }: {
  open: boolean; pkg: PackageListItem; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [name, setName] = useState(pkg.package_name);
  const [amount, setAmount] = useState(pkg.total_amount);
  const [memo, setMemo] = useState(pkg.memo ?? '');
  const [status, setStatus] = useState(pkg.status);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setName(pkg.package_name); setAmount(pkg.total_amount); setMemo(pkg.memo ?? ''); setStatus(pkg.status); }
  }, [open, pkg]);

  const save = async () => {
    setSubmitting(true);
    const { error } = await supabase.from('packages').update({
      package_name: name.trim(), total_amount: amount, memo: memo.trim() || null, status,
    }).eq('id', pkg.id);
    setSubmitting(false);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    toast.success('패키지 수정됨');
    onDone();
  };

  const remove = async () => {
    if (!window.confirm(`「${pkg.package_name}」 패키지를 삭제하시겠습니까?\n\n사용/결제/양도 이력이 있으면 삭제되지 않습니다.`)) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc('delete_package_safe', { p_package_id: pkg.id });
    setSubmitting(false);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    const result = data as { ok?: boolean; error?: string };
    if (!result?.ok) { toast.error(result?.error ?? '삭제 실패'); return; }
    toast.success('패키지 삭제됨');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>패키지 편집 (관리자)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>패키지명</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>총 계약금</Label>
            <Input value={formatAmount(amount)} onChange={(e) => setAmount(parseAmount(e.target.value))} inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label>상태</Label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Package['status'])}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="active">활성</option>
              <option value="completed">완료</option>
              <option value="cancelled">취소</option>
              <option value="refunded">환불</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="rounded-md border border-red-200 bg-red-50/40 px-3 py-2.5">
            <div className="text-xs font-medium text-red-700 mb-1.5">위험 영역</div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">사용/결제/양도 이력이 없는 패키지를 영구 삭제합니다.</div>
              <Button variant="destructive" size="sm" disabled={submitting} onClick={remove} className="gap-1 shrink-0">
                <Trash2 className="h-3.5 w-3.5" />삭제
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>{submitting ? '저장 중…' : '저장'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
