import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Check, X, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Service } from '@/lib/types';

const VAT_LABEL: Record<Service['vat_type'], string> = {
  none: '비과세',
  exclusive: '별도',
  inclusive: '포함',
};

const SERVICE_TYPE_LABEL: Record<Service['service_type'], string> = {
  single: '단일',
  package_component: '패키지',
  addon: '추가',
};

const CATEGORY_OPTIONS = ['레이저', '수액', '사전처치', '풋케어', '상담', '검사', '풋화장품', '기타'];

export default function Services() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);

  // 엑셀 내보내기 (T-20260507-foot-SERVICE-CATALOG-SEED Phase 2)
  const exportExcel = () => {
    const data = rows.map((s) => ({
      상품코드: s.service_code ?? '',
      상품명: s.name,
      대분류: s.category,
      단가: s.price,
      할인가: s.discount_price ?? '',
      수가코드: s.hira_code ?? '',
      실비여부: s.is_insurance_covered ? 'Y' : 'N',
      유형: SERVICE_TYPE_LABEL[s.service_type],
      VAT: VAT_LABEL[s.vat_type],
      상태: s.active ? '활성' : '비활성',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '판매상품');
    XLSX.writeFile(wb, `풋센터_판매상품_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('엑셀 내보내기 완료');
  };

  const fetchServices = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('sort_order', { ascending: true });
    setLoading(false);
    if (error) { toast.error('서비스 목록 로딩 실패'); return; }
    setRows((data ?? []) as Service[]);
  }, [clinic]);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const toggleActive = async (svc: Service) => {
    if (!isAdmin) return;
    const { error } = await supabase
      .from('services')
      .update({ active: !svc.active })
      .eq('id', svc.id);
    if (error) { toast.error(`상태 변경 실패: ${error.message}`); return; }
    toast.success(svc.active ? '비활성화됨' : '활성화됨');
    fetchServices();
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold">서비스 관리</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="gap-1 text-sm">
            <Download className="h-4 w-4" /> 엑셀 내보내기
          </Button>
          {isAdmin && (
            <Button onClick={() => setOpenCreate(true)} className="gap-1">
              <Plus className="h-4 w-4" /> 서비스 추가
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">상품코드</th>
                <th className="px-4 py-2 text-left font-medium">서비스명</th>
                <th className="px-4 py-2 text-left font-medium">카테고리</th>
                <th className="px-4 py-2 text-right font-medium">가격</th>
                <th className="px-4 py-2 text-right font-medium">할인가</th>
                <th className="px-4 py-2 text-right font-medium">시간(분)</th>
                <th className="px-4 py-2 text-left font-medium">VAT</th>
                <th className="px-4 py-2 text-left font-medium">유형</th>
                <th className="px-4 py-2 text-center font-medium">상태</th>
                {isAdmin && <th className="px-4 py-2 text-center font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((svc) => (
                <tr key={svc.id} className={cn('border-t', !svc.active && 'opacity-50')}>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{svc.service_code ?? '—'}</td>
                  <td className="px-4 py-2 font-medium">{svc.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{svc.category}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatAmount(svc.price)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {svc.discount_price != null ? formatAmount(svc.discount_price) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{svc.duration_min}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{VAT_LABEL[svc.vat_type]}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{SERVICE_TYPE_LABEL[svc.service_type]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-center">
                    {svc.active ? (
                      <Check className="mx-auto h-4 w-4 text-teal-600" />
                    ) : (
                      <X className="mx-auto h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setEditTarget(svc)}
                          className="rounded p-1.5 hover:bg-muted transition"
                          title="수정"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <Button
                          size="xs"
                          variant={svc.active ? 'outline' : 'default'}
                          onClick={() => toggleActive(svc)}
                        >
                          {svc.active ? '비활성' : '활성화'}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : 9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    등록된 서비스가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin && (
        <>
          <ServiceDialog
            open={openCreate}
            clinicId={clinic?.id}
            service={null}
            onOpenChange={setOpenCreate}
            onSaved={() => { setOpenCreate(false); fetchServices(); }}
          />
          <ServiceDialog
            open={!!editTarget}
            clinicId={clinic?.id}
            service={editTarget}
            onOpenChange={(o) => { if (!o) setEditTarget(null); }}
            onSaved={() => { setEditTarget(null); fetchServices(); }}
          />
        </>
      )}
    </div>
  );
}

function ServiceDialog({
  open,
  clinicId,
  service,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  clinicId: string | undefined;
  service: Service | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('기타');
  const [price, setPrice] = useState(0);
  const [discountPrice, setDiscountPrice] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState(30);
  const [vatType, setVatType] = useState<Service['vat_type']>('none');
  const [serviceType, setServiceType] = useState<Service['service_type']>('single');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(service?.name ?? '');
      setCategory(service?.category ?? '기타');
      setPrice(service?.price ?? 0);
      setDiscountPrice(service?.discount_price ?? null);
      setDurationMin(service?.duration_min ?? 30);
      setVatType(service?.vat_type ?? 'none');
      setServiceType(service?.service_type ?? 'single');
      setActive(service?.active ?? true);
    }
  }, [open, service]);

  const save = async () => {
    if (!clinicId || !name.trim()) return;
    setSubmitting(true);

    const payload = {
      clinic_id: clinicId,
      name: name.trim(),
      category,
      price,
      discount_price: discountPrice,
      duration_min: durationMin,
      vat_type: vatType,
      service_type: serviceType,
      active,
    };

    const { error } = service
      ? await supabase.from('services').update(payload).eq('id', service.id)
      : await supabase.from('services').insert({ ...payload, sort_order: 999 });

    setSubmitting(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(service ? '수정됨' : '서비스 추가됨');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? '서비스 수정' : '서비스 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>서비스명</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>카테고리</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs font-medium',
                    category === c ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {c}
                </button>
              ))}
              {!CATEGORY_OPTIONS.includes(category) && (
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="직접 입력"
                  className="h-8 w-28 text-xs"
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>가격</Label>
              <Input
                value={formatAmount(price)}
                onChange={(e) => setPrice(parseAmount(e.target.value))}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label>할인가 (옵션)</Label>
              <Input
                value={discountPrice != null ? formatAmount(discountPrice) : ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setDiscountPrice(v ? parseAmount(v) : null);
                }}
                inputMode="numeric"
                placeholder="없음"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>시간 (분)</Label>
            <Input
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>VAT</Label>
            <div className="flex gap-2">
              {(['none', 'exclusive', 'inclusive'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVatType(v)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs',
                    vatType === v ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {VAT_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="flex gap-2">
              {(['single', 'package_component', 'addon'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setServiceType(v)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs',
                    serviceType === v ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {SERVICE_TYPE_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="svc-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="svc-active">활성</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
