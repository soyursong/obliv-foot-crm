import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Download, Eye, EyeOff } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

// T-20260510-foot-SVCMENU-REVAMP: 항목분류 옵션
const CATEGORY_LABEL_OPTIONS = ['기본', '검사', '상병', '풋케어', '수액', '풋화장품'];

export default function Services() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  // T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 표시 토글 (기본 숨김)
  const [showInactive, setShowInactive] = useState(false);

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

  // T-20260510-foot-SVCMENU-REVAMP: 삭제 (soft delete = active=false)
  // toggleActive 제거됨 — 신구조에서는 [관리]에 수정/삭제만 노출
  const softDelete = async (svc: Service) => {
    if (!isAdmin) return;
    if (!confirm(`"${svc.name}" 항목을 삭제하시겠습니까? (비활성 처리되며 과거 기록은 보존됩니다)`)) return;
    const { error } = await supabase
      .from('services')
      .update({ active: false })
      .eq('id', svc.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('삭제됨 (비활성 처리)');
    fetchServices();
  };

  // T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 완전 삭제
  // 참조 체크 → 참조 없으면 hard delete, 있으면 안내
  const hardDelete = async (svc: Service) => {
    if (!isAdmin || svc.active) return;

    // 3테이블 참조 체크 (service_charges, check_in_services, reservations)
    const [chargesRes, cisRes, resvRes] = await Promise.all([
      supabase.from('service_charges').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
      supabase.from('check_in_services').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
      supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
    ]);

    const refCount = (chargesRes.count ?? 0) + (cisRes.count ?? 0) + (resvRes.count ?? 0);

    if (refCount > 0) {
      toast.error(
        `"${svc.name}"은 과거 기록에서 참조 중입니다 (${refCount}건). 완전 삭제 불가 — 비활성 상태로 유지됩니다.`,
        { duration: 5000 },
      );
      return;
    }

    if (!confirm(`"${svc.name}" 항목을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', svc.id)
      .eq('active', false);   // 안전 가드: 활성 항목은 절대 삭제 안 됨

    if (error) { toast.error(`완전 삭제 실패: ${error.message}`); return; }
    toast.success(`"${svc.name}" 완전 삭제됨`);
    fetchServices();
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold">서비스 관리</h1>
        <div className="flex items-center gap-2">
          {/* T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 토글 */}
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setShowInactive((v) => !v)}
              className={cn('gap-1 text-sm', showInactive && 'border-amber-400 bg-amber-50 text-amber-700')}
              title={showInactive ? '비활성 항목 숨기기' : '비활성 항목 보기'}
            >
              {showInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showInactive ? '비활성 숨기기' : '비활성 보기'}
            </Button>
          )}
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

      {/* T-20260510-foot-SVCMENU-REVAMP: 항목분류/상품코드/시술명/단가/VAT/관리 6컬럼 구조 */}
      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">항목분류</th>
                <th className="px-3 py-2 text-left font-medium">상품코드</th>
                <th className="px-4 py-2 text-left font-medium">시술명</th>
                <th className="px-4 py-2 text-right font-medium">단가</th>
                <th className="px-4 py-2 text-left font-medium">VAT</th>
                {isAdmin && <th className="px-4 py-2 text-center font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {/* T-20260511-foot-SVCMENU-HARDDELETE: showInactive 토글에 따라 비활성 항목 필터 */}
              {rows.filter((svc) => svc.active || showInactive).map((svc) => (
                <tr key={svc.id} className={cn('border-t', !svc.active && 'opacity-50 bg-muted/30')}>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{svc.category_label ?? svc.category ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{svc.service_code ?? '—'}</td>
                  <td className="px-4 py-2 font-medium">
                    {svc.name}
                    {!svc.active && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">[비활성]</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatAmount(svc.price)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{VAT_LABEL[svc.vat_type]}</td>
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
                        {svc.active ? (
                          /* 활성 항목: 기존 soft delete */
                          <button
                            onClick={() => softDelete(svc)}
                            className="rounded p-1.5 hover:bg-red-50 transition"
                            title="비활성 처리"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        ) : (
                          /* 비활성 항목: hard delete (참조 체크 후) */
                          <button
                            onClick={() => hardDelete(svc)}
                            className="rounded p-1.5 hover:bg-red-100 transition"
                            title="완전 삭제 (참조 없는 경우만 가능)"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-700" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && rows.filter((svc) => svc.active || showInactive).length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
  // T-20260510-foot-SVCMENU-REVAMP: 항목분류
  const [categoryLabel, setCategoryLabel] = useState('풋케어');
  const [serviceCode, setServiceCode] = useState('');
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
      setCategoryLabel(service?.category_label ?? '풋케어');
      setServiceCode(service?.service_code ?? '');
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
      category_label: categoryLabel,
      service_code: serviceCode.trim() || null,
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
            <Label>시술명</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {/* T-20260510-foot-SVCMENU-REVAMP: 항목분류 + 상품코드 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>항목분류</Label>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_LABEL_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryLabel(c)}
                    className={cn(
                      'h-7 rounded-md border px-2 text-xs font-medium',
                      categoryLabel === c ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>상품코드</Label>
              <Input value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} placeholder="예: FC001" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>카테고리 (레거시)</Label>
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
