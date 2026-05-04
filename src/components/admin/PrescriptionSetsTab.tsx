// PrescriptionSetsTab — 처방세트 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 3, 포팅: derm → foot)
// 어드민에서 처방세트 CRUD — 의사가 진료 시 처방 목록을 한 번에 불러옴

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Trash2, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PrescriptionItem {
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  days: number;
  notes: string;
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
}

interface SetForm {
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
}

const EMPTY_ITEM: PrescriptionItem = {
  name: '',
  dosage: '',
  route: '경구',
  frequency: '1일 3회',
  days: 3,
  notes: '',
};

const EMPTY_FORM: SetForm = {
  name: '',
  items: [{ ...EMPTY_ITEM }],
  is_active: true,
  sort_order: 0,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function usePrescriptionSets() {
  return useQuery({
    queryKey: ['prescription_sets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PrescriptionSet[];
    },
  });
}

function useUpsertSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: SetForm }) => {
      const payload = {
        name: form.name,
        items: form.items as unknown as Record<string, unknown>[],
        is_active: form.is_active,
        sort_order: form.sort_order,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('prescription_sets').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('prescription_sets').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('prescription_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub-component: 처방 항목 편집 행
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: PrescriptionItem;
  idx: number;
  onChange: (idx: number, field: keyof PrescriptionItem, val: string | number) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}

function ItemRow({ item, idx, onChange, onRemove, canRemove }: ItemRowProps) {
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end border rounded-lg p-2.5 bg-muted/30">
      <div className="col-span-3">
        <Label className="text-[10px]">약품/시술명 *</Label>
        <Input
          value={item.name}
          onChange={(e) => onChange(idx, 'name', e.target.value)}
          placeholder="항진균제 연고"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">용량</Label>
        <Input
          value={item.dosage}
          onChange={(e) => onChange(idx, 'dosage', e.target.value)}
          placeholder="적정량"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">투여경로</Label>
        <Input
          value={item.route}
          onChange={(e) => onChange(idx, 'route', e.target.value)}
          placeholder="외용"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">횟수</Label>
        <Input
          value={item.frequency}
          onChange={(e) => onChange(idx, 'frequency', e.target.value)}
          placeholder="1일 2회"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-1">
        <Label className="text-[10px]">일수</Label>
        <Input
          type="number"
          value={item.days}
          onChange={(e) => onChange(idx, 'days', Number(e.target.value))}
          className="h-7 text-xs mt-0.5"
          min={1}
        />
      </div>
      <div className="col-span-1">
        <Label className="text-[10px]">비고</Label>
        <Input
          value={item.notes}
          onChange={(e) => onChange(idx, 'notes', e.target.value)}
          placeholder=""
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-1 flex items-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onRemove(idx)}
          disabled={!canRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PrescriptionSetsTab() {
  const { data: sets = [], isLoading } = usePrescriptionSets();
  const upsert = useUpsertSet();
  const del = useDeleteSet();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrescriptionSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setOpen(true);
  }

  function openEdit(s: PrescriptionSet) {
    setEditing(s);
    setForm({
      name: s.name,
      items: s.items.length > 0 ? s.items : [{ ...EMPTY_ITEM }],
      is_active: s.is_active,
      sort_order: s.sort_order,
    });
    setOpen(true);
  }

  function handleItemChange(idx: number, field: keyof PrescriptionItem, val: string | number) {
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('처방세트 이름을 입력해주세요.');
    if (form.items.some((i) => !i.name.trim())) return toast.error('각 처방 항목에 이름을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 처방세트를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{sets.length}개 처방세트</span>
        <Button size="sm" variant="outline" onClick={openAdd} data-testid="rx-set-add-btn">
          <Plus className="h-3.5 w-3.5 mr-1" />
          처방세트 추가
        </Button>
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 처방세트가 없습니다.
        </div>
      ) : (
        <div className="space-y-2" data-testid="rx-set-list">
          {sets.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border bg-card px-4 py-3"
              data-testid="rx-set-item"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {s.name}
                  </span>
                  {!s.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {s.items.length}개 항목
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(s.id, s.name)}
                    disabled={del.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {s.items.length > 0 && (
                <div className="space-y-1">
                  {s.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.dosage && <span>{item.dosage}</span>}
                      <span>{item.route}</span>
                      <span>{item.frequency}</span>
                      <span>{item.days}일</span>
                    </div>
                  ))}
                  {s.items.length > 3 && (
                    <p className="text-[11px] text-muted-foreground">+{s.items.length - 3}개 항목 더</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '처방세트 수정' : '처방세트 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">처방세트 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 발톱무좀 기본 처방"
                  className="mt-1"
                  data-testid="rx-set-name-input"
                />
              </div>
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1"
                  min={0}
                />
              </div>
            </div>

            {/* 처방 항목 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">처방 항목 ({form.items.length}개)</Label>
                <Button size="sm" variant="ghost" onClick={addItem} className="h-6 text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  항목 추가
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <ItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    onChange={handleItemChange}
                    onRemove={removeItem}
                    canRemove={form.items.length > 1}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="rx-set-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
