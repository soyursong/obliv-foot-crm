/**
 * FeeSetTemplatesTab — 수가항목 세트코드(템플릿) CRUD 관리 탭
 * T-20260525-foot-FEE-SET-TEMPLATE AC-2
 *
 * - 세트코드 추가/수정/삭제 (관리자)
 * - 세트 = set_name + items[] (수가항목 배열) + clinic_id
 * - DB: fee_set_templates (JSONB items: [{service_id, sort_order}])
 * - clinic_id 기준 격리
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, Layers, X, ChevronDown, ChevronUp } from 'lucide-react';
import { formatAmount } from '@/lib/format';
import type { Service } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeeSetTemplateItem {
  service_id: string;
  sort_order: number;
}

export interface FeeSetTemplate {
  id: string;
  clinic_id: string;
  set_name: string;
  items: FeeSetTemplateItem[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const CLINIC_ID_FALLBACK = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function useClinicId(): string {
  const { profile } = useAuth();
  return (profile as unknown as { clinic_id?: string })?.clinic_id ?? CLINIC_ID_FALLBACK;
}

function useFeeSetTemplates(clinicId: string) {
  return useQuery<FeeSetTemplate[]>({
    queryKey: ['fee_set_templates', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fee_set_templates')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as FeeSetTemplate[];
    },
  });
}

function useServices(clinicId: string) {
  return useQuery<Service[]>({
    queryKey: ['services_active', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Service[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useUpsertFeeSetTemplate(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id?: string;
      set_name: string;
      items: FeeSetTemplateItem[];
      sort_order: number;
      is_active: boolean;
    }) => {
      const payload = {
        clinic_id: clinicId,
        set_name: params.set_name.trim(),
        items: params.items,
        sort_order: params.sort_order,
        is_active: params.is_active,
        updated_at: new Date().toISOString(),
      };
      if (params.id) {
        const { error } = await supabase
          .from('fee_set_templates')
          .update(payload)
          .eq('id', params.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fee_set_templates').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee_set_templates', clinicId] });
      toast.success('수가세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteFeeSetTemplate(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fee_set_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee_set_templates', clinicId] });
      toast.success('수가세트가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** 수가항목 선택 멀티셀렉터 */
interface ServiceMultiSelectProps {
  services: Service[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function ServiceMultiSelect({ services, selectedIds, onChange }: ServiceMultiSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const query = search.toLowerCase();
  const filtered = query
    ? services.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          (s.service_code ?? '').toLowerCase().includes(query),
      )
    : services;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function removeItem(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  const selectedServices = selectedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is Service => !!s);

  return (
    <div className="space-y-2">
      {/* 선택된 항목 칩 */}
      {selectedServices.length > 0 && (
        <div className="flex flex-wrap gap-1 p-2 border rounded-md bg-muted/30 min-h-[36px]">
          {selectedServices.map((s) => (
            <Badge
              key={s.id}
              variant="secondary"
              className="text-xs gap-1 pr-1"
            >
              {s.name}
              <button
                type="button"
                onClick={() => removeItem(s.id)}
                className="hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* 드롭다운 토글 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
        >
          <span className="text-muted-foreground">
            {selectedIds.length === 0 ? '수가항목 선택...' : `${selectedIds.length}개 선택됨`}
          </span>
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 border rounded-md bg-white shadow-lg">
            {/* 검색창 */}
            <div className="p-2 border-b">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="항목명/코드 검색..."
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            {/* 목록 */}
            <div className="max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground text-center">
                  일치하는 항목이 없습니다
                </p>
              ) : (
                filtered.map((s) => {
                  const checked = selectedIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-gray-50 last:border-0 transition-colors
                        ${checked ? 'bg-teal-50' : 'hover:bg-muted'}`}
                    >
                      {/* 체크박스 대체 */}
                      <span
                        className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center
                          ${checked ? 'bg-teal-600 border-teal-600' : 'border-gray-300'}`}
                      >
                        {checked && (
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {s.service_code && (
                        <span className="text-[10px] text-muted-foreground font-mono w-16 shrink-0 truncate">
                          {s.service_code}
                        </span>
                      )}
                      <span className="flex-1 font-medium truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-teal-700">
                        {formatAmount(s.price)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {/* 닫기 */}
            <div className="p-2 border-t flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface FormState {
  set_name: string;
  selectedIds: string[];
  sort_order: number;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  set_name: '',
  selectedIds: [],
  sort_order: 0,
  is_active: true,
};

export default function FeeSetTemplatesTab() {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원은 읽기 전용, CRUD는 admin/manager 전용.
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';
  const clinicId = useClinicId();
  const { data: templates = [], isLoading } = useFeeSetTemplates(clinicId);
  const { data: services = [] } = useServices(clinicId);
  const upsert = useUpsertFeeSetTemplate(clinicId);
  const del = useDeleteFeeSetTemplate(clinicId);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeeSetTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(t: FeeSetTemplate) {
    setEditing(t);
    setForm({
      set_name: t.set_name,
      selectedIds: t.items
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => i.service_id),
      sort_order: t.sort_order,
      is_active: t.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.set_name.trim()) {
      toast.error('세트명을 입력해주세요.');
      return;
    }
    if (form.selectedIds.length === 0) {
      toast.error('수가항목을 하나 이상 선택해주세요.');
      return;
    }
    const items: FeeSetTemplateItem[] = form.selectedIds.map((id, idx) => ({
      service_id: id,
      sort_order: idx + 1,
    }));
    await upsert.mutateAsync({
      id: editing?.id,
      set_name: form.set_name,
      items,
      sort_order: form.sort_order,
      is_active: form.is_active,
    });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 수가세트를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {templates.length}개 세트 · 결제 미니창에서 [세트코드]로 수가항목 일괄 추가
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={openAdd}
            data-testid="fee-set-add-btn"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            수가세트 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 수가세트가 없습니다. [수가세트 추가]로 첫 세트를 만들어보세요.
          <div className="mt-3 text-xs space-y-0.5">
            <p>예시: 초진/무좀 → 초진진찰료, 프리컨디셔닝, 진균증레이저, 균검사</p>
            <p>예시: 재진/내성 → 재진, 단순처치1일, 원인제거, 포돌로게</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid="fee-set-template-list">
          {templates.map((t) => {
            const resolvedItems = t.items
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((i) => services.find((s) => s.id === i.service_id))
              .filter((s): s is Service => !!s);

            const totalPrice = resolvedItems.reduce((sum, s) => sum + s.price, 0);

            return (
              <div
                key={t.id}
                className={`rounded-lg border bg-card px-4 py-3 ${!t.is_active ? 'opacity-60' : ''}`}
                data-testid="fee-set-template-item"
              >
                {/* 헤더 행 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Layers className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                    <span
                      className={`text-sm font-semibold ${!t.is_active ? 'line-through text-muted-foreground' : ''}`}
                    >
                      {t.set_name}
                    </span>
                    {!t.is_active && (
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        비활성
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ({resolvedItems.length}개 · {formatAmount(totalPrice)})
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(t)}
                        data-testid="fee-set-edit-btn"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(t.id, t.set_name)}
                        disabled={del.isPending}
                        data-testid="fee-set-delete-btn"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* 수가항목 목록 */}
                <div className="flex flex-wrap gap-1">
                  {resolvedItems.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 text-[11px] bg-teal-50 text-teal-800 border border-teal-200 rounded px-1.5 py-0.5"
                    >
                      {s.name}
                      <span className="text-teal-600 tabular-nums">
                        {formatAmount(s.price)}
                      </span>
                    </span>
                  ))}
                  {resolvedItems.length === 0 && (
                    <span className="text-xs text-muted-foreground">수가항목 미매핑</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? '수가세트 수정' : '수가세트 추가'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 세트명 */}
            <div>
              <Label className="text-xs">세트명 *</Label>
              <Input
                value={form.set_name}
                onChange={(e) => setForm((f) => ({ ...f, set_name: e.target.value }))}
                placeholder="초진/무좀"
                className="mt-1"
                data-testid="fee-set-name-input"
              />
            </div>

            {/* 수가항목 선택 */}
            <div>
              <Label className="text-xs mb-1 block">
                수가항목 * ({form.selectedIds.length}개 선택)
              </Label>
              <ServiceMultiSelect
                services={services}
                selectedIds={form.selectedIds}
                onChange={(ids) => setForm((f) => ({ ...f, selectedIds: ids }))}
              />
            </div>

            {/* 정렬 순서 + 활성화 */}
            <div className="flex items-center gap-4">
              <div className="w-28">
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))
                  }
                  className="mt-1"
                  min={0}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="fee-set-active"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="rounded"
                />
                <Label htmlFor="fee-set-active" className="text-xs cursor-pointer">
                  활성화
                </Label>
              </div>
            </div>

            {/* 선택 항목 금액 미리보기 */}
            {form.selectedIds.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  세트 합계 미리보기
                </p>
                {form.selectedIds.map((id) => {
                  const s = services.find((sv) => sv.id === id);
                  if (!s) return null;
                  return (
                    <div key={id} className="flex justify-between text-xs">
                      <span>{s.name}</span>
                      <span className="tabular-nums text-teal-700">{formatAmount(s.price)}</span>
                    </div>
                  );
                })}
                <div className="flex justify-between text-sm font-bold pt-1 border-t">
                  <span>합계</span>
                  <span className="tabular-nums text-purple-700">
                    {formatAmount(
                      form.selectedIds.reduce((sum, id) => {
                        const s = services.find((sv) => sv.id === id);
                        return sum + (s?.price ?? 0);
                      }, 0),
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={upsert.isPending}
              data-testid="fee-set-save-btn"
            >
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
