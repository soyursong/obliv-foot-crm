/**
 * TreatmentSetsTab — 진료세트 CRUD 관리 탭
 * T-20260512-foot-TREATMENT-SET
 *
 * - 진료세트 생성/수정/삭제/복제
 * - 세트별 삽입코드 + 상병코드 항목 관리
 * - DB: treatment_sets + treatment_set_items
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Trash2, Copy, X, Hash, Syringe } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TreatmentSetCategory = '초진' | '재진' | '기타';

export interface TreatmentSetItem {
  id?: string;
  item_type: 'insertion_code' | 'disease_code';
  code: string;
  description: string;
  sort_order: number;
}

export interface TreatmentSet {
  id: string;
  clinic_id: string;
  name: string;
  category: TreatmentSetCategory;
  memo: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  items: TreatmentSetItem[];
}

interface SetForm {
  name: string;
  category: TreatmentSetCategory;
  memo: string;
  is_active: boolean;
  sort_order: number;
  insertion_codes: Array<{ code: string; description: string }>;
  disease_codes: Array<{ code: string; description: string }>;
}

const EMPTY_CODE_ITEM = { code: '', description: '' };

const EMPTY_FORM: SetForm = {
  name: '',
  category: '초진',
  memo: '',
  is_active: true,
  sort_order: 0,
  insertion_codes: [{ ...EMPTY_CODE_ITEM }],
  disease_codes: [{ ...EMPTY_CODE_ITEM }],
};

const CATEGORY_COLORS: Record<TreatmentSetCategory, string> = {
  초진: 'bg-teal-100 text-teal-800',
  재진: 'bg-emerald-100 text-emerald-800',
  기타: 'bg-gray-100 text-gray-700',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useTreatmentSets() {
  return useQuery({
    queryKey: ['treatment_sets'],
    queryFn: async () => {
      const { data: sets, error: setsError } = await supabase
        .from('treatment_sets')
        .select('id, clinic_id, name, category, memo, is_active, sort_order, created_at, updated_at')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (setsError) throw setsError;

      if (!sets || sets.length === 0) return [] as TreatmentSet[];

      const setIds = sets.map((s) => s.id);
      const { data: items, error: itemsError } = await supabase
        .from('treatment_set_items')
        .select('id, set_id, item_type, code, description, sort_order')
        .in('set_id', setIds)
        .order('sort_order', { ascending: true });
      if (itemsError) throw itemsError;

      return sets.map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.set_id === s.id) as TreatmentSetItem[],
      })) as TreatmentSet[];
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers: form ↔ DB
// ---------------------------------------------------------------------------

function formToItems(form: SetForm): Array<Omit<TreatmentSetItem, 'id'>> {
  const insertions = form.insertion_codes
    .filter((c) => c.code.trim())
    .map((c, i) => ({
      item_type: 'insertion_code' as const,
      code: c.code.trim().toUpperCase(),
      description: c.description.trim(),
      sort_order: i + 1,
    }));

  const diseases = form.disease_codes
    .filter((c) => c.code.trim())
    .map((c, i) => ({
      item_type: 'disease_code' as const,
      code: c.code.trim().toUpperCase(),
      description: c.description.trim(),
      sort_order: i + 10,
    }));

  return [...insertions, ...diseases];
}

function setToForm(s: TreatmentSet): SetForm {
  const insertions = s.items
    .filter((i) => i.item_type === 'insertion_code')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ code: i.code, description: i.description ?? '' }));

  const diseases = s.items
    .filter((i) => i.item_type === 'disease_code')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ code: i.code, description: i.description ?? '' }));

  return {
    name: s.name,
    category: s.category,
    memo: s.memo ?? '',
    is_active: s.is_active,
    sort_order: s.sort_order,
    insertion_codes: insertions.length > 0 ? insertions : [{ ...EMPTY_CODE_ITEM }],
    disease_codes: diseases.length > 0 ? diseases : [{ ...EMPTY_CODE_ITEM }],
  };
}

async function upsertTreatmentSet(params: {
  id?: string;
  clinicId: string;
  form: SetForm;
}) {
  const { id, clinicId, form } = params;
  const setPayload = {
    clinic_id: clinicId,
    name: form.name.trim(),
    category: form.category,
    memo: form.memo.trim() || null,
    is_active: form.is_active,
    sort_order: form.sort_order,
    updated_at: new Date().toISOString(),
  };

  let setId = id;

  if (id) {
    const { error } = await supabase.from('treatment_sets').update(setPayload).eq('id', id);
    if (error) throw error;
    // 기존 items 삭제 후 재삽입
    const { error: delErr } = await supabase
      .from('treatment_set_items')
      .delete()
      .eq('set_id', id);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await supabase
      .from('treatment_sets')
      .insert(setPayload)
      .select('id')
      .single();
    if (error) throw error;
    setId = data.id;
  }

  const items = formToItems(form).map((item) => ({ ...item, set_id: setId! }));
  if (items.length > 0) {
    const { error: itemErr } = await supabase.from('treatment_set_items').insert(items);
    if (itemErr) throw itemErr;
  }
}

// ---------------------------------------------------------------------------
// Hooks: mutations
// ---------------------------------------------------------------------------

function useUpsertTreatmentSet(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id?: string; form: SetForm }) =>
      upsertTreatmentSet({ ...params, clinicId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treatment_sets'] });
      toast.success('진료세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteTreatmentSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('treatment_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treatment_sets'] });
      toast.success('진료세트가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CodeRowProps {
  value: { code: string; description: string };
  index: number;
  placeholder: string;
  onChange: (idx: number, field: 'code' | 'description', val: string) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}

function CodeRow({ value, index, placeholder, onChange, onRemove, canRemove }: CodeRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value.code}
        onChange={(e) => onChange(index, 'code', e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs w-28 font-mono uppercase"
      />
      <Input
        value={value.description}
        onChange={(e) => onChange(index, 'description', e.target.value)}
        placeholder="설명 (선택)"
        className="h-7 text-xs flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TreatmentSetsTab() {
  const { data: sets = [], isLoading } = useTreatmentSets();
  // clinicId는 첫 번째 세트에서 가져오거나 상수 사용
  const clinicId = sets[0]?.clinic_id ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  const upsert = useUpsertTreatmentSet(clinicId);
  const del = useDeleteTreatmentSet();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TreatmentSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(s: TreatmentSet) {
    setEditing(s);
    setForm(setToForm(s));
    setOpen(true);
  }

  async function openClone(s: TreatmentSet) {
    const cloneForm = setToForm(s);
    cloneForm.name = `${s.name} (복사본)`;
    await upsert.mutateAsync({ form: cloneForm });
  }

  // ── 코드 항목 변경 헬퍼 ──────────────────────────────────────

  function handleInsertionChange(idx: number, field: 'code' | 'description', val: string) {
    setForm((f) => {
      const arr = [...f.insertion_codes];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...f, insertion_codes: arr };
    });
  }

  function addInsertion() {
    setForm((f) => ({ ...f, insertion_codes: [...f.insertion_codes, { ...EMPTY_CODE_ITEM }] }));
  }

  function removeInsertion(idx: number) {
    setForm((f) => ({ ...f, insertion_codes: f.insertion_codes.filter((_, i) => i !== idx) }));
  }

  function handleDiseaseChange(idx: number, field: 'code' | 'description', val: string) {
    setForm((f) => {
      const arr = [...f.disease_codes];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...f, disease_codes: arr };
    });
  }

  function addDisease() {
    setForm((f) => ({ ...f, disease_codes: [...f.disease_codes, { ...EMPTY_CODE_ITEM }] }));
  }

  function removeDisease(idx: number) {
    setForm((f) => ({ ...f, disease_codes: f.disease_codes.filter((_, i) => i !== idx) }));
  }

  // ── 저장 ─────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('진료세트 이름을 입력해주세요.');
      return;
    }
    const hasInsertion = form.insertion_codes.some((c) => c.code.trim());
    if (!hasInsertion) {
      toast.error('삽입코드를 하나 이상 입력해주세요.');
      return;
    }
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 진료세트를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // ── 렌더 ─────────────────────────────────────────────────────

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
        <div>
          <p className="text-xs text-muted-foreground">
            {sets.length}개 세트 · 진료비 산정 시 [세트 불러오기]로 코드 자동 입력
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={openAdd}
          data-testid="treatment-set-add-btn"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          진료세트 추가
        </Button>
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 진료세트가 없습니다. [진료세트 추가]로 첫 세트를 만들어보세요.
        </div>
      ) : (
        <div className="space-y-2" data-testid="treatment-set-list">
          {sets.map((s) => {
            const insertions = s.items.filter((i) => i.item_type === 'insertion_code');
            const diseases = s.items.filter((i) => i.item_type === 'disease_code');
            return (
              <div
                key={s.id}
                className={`rounded-lg border bg-card px-4 py-3 ${!s.is_active ? 'opacity-60' : ''}`}
                data-testid="treatment-set-item"
              >
                {/* 헤더 행 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[s.category]}`}
                    >
                      {s.category}
                    </span>
                    <span
                      className={`text-sm font-medium ${!s.is_active ? 'line-through text-muted-foreground' : ''}`}
                    >
                      {s.name}
                    </span>
                    {!s.is_active && (
                      <Badge variant="outline" className="text-[10px] py-0 h-4">
                        비활성
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="복제"
                      onClick={() => openClone(s)}
                      disabled={upsert.isPending}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
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

                {/* 코드 요약 */}
                <div className="flex items-start gap-4 text-xs">
                  {insertions.length > 0 && (
                    <div className="flex items-start gap-1">
                      <Syringe className="h-3 w-3 text-teal-600 mt-0.5 shrink-0" />
                      <span className="font-mono text-teal-800">
                        {insertions.map((i) => i.code).join(' · ')}
                      </span>
                    </div>
                  )}
                  {diseases.length > 0 && (
                    <div className="flex items-start gap-1">
                      <Hash className="h-3 w-3 text-purple-500 mt-0.5 shrink-0" />
                      <span className="font-mono text-purple-800">
                        {diseases.map((i) => i.code).join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
                {s.memo && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{s.memo}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '진료세트 수정' : '진료세트 추가'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* 이름 + 구분 + 정렬 */}
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-3">
                <Label className="text-xs">세트 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="초진-발톱무좀(대면/균검사/레이저)"
                  className="mt-1"
                  data-testid="treatment-set-name-input"
                />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">구분 *</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, category: v as TreatmentSetCategory }))
                  }
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="초진">초진</SelectItem>
                    <SelectItem value="재진">재진</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1">
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

            {/* 삽입코드 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Syringe className="h-3.5 w-3.5 text-teal-600" />
                  <Label className="text-xs font-semibold text-teal-800">
                    삽입코드 ({form.insertion_codes.filter((c) => c.code.trim()).length}개)
                  </Label>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={addInsertion}
                >
                  <Plus className="h-3 w-3 mr-0.5" />
                  추가
                </Button>
              </div>
              <div className="space-y-1.5">
                {form.insertion_codes.map((item, idx) => (
                  <CodeRow
                    key={idx}
                    value={item}
                    index={idx}
                    placeholder="AA154"
                    onChange={handleInsertionChange}
                    onRemove={removeInsertion}
                    canRemove={form.insertion_codes.length > 1}
                  />
                ))}
              </div>
            </div>

            {/* 상병코드 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-purple-500" />
                  <Label className="text-xs font-semibold text-purple-800">
                    상병코드 ({form.disease_codes.filter((c) => c.code.trim()).length}개)
                  </Label>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={addDisease}
                >
                  <Plus className="h-3 w-3 mr-0.5" />
                  추가
                </Button>
              </div>
              <div className="space-y-1.5">
                {form.disease_codes.map((item, idx) => (
                  <CodeRow
                    key={idx}
                    value={item}
                    index={idx}
                    placeholder="B351"
                    onChange={handleDiseaseChange}
                    onRemove={removeDisease}
                    canRemove={form.disease_codes.length > 1}
                  />
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div>
              <Label className="text-xs">메모 (선택)</Label>
              <Textarea
                value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="세트 설명 또는 사용 시 주의사항"
                className="mt-1 text-xs resize-none"
                rows={2}
              />
            </div>

            {/* 활성화 */}
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={upsert.isPending}
              data-testid="treatment-set-save-btn"
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
