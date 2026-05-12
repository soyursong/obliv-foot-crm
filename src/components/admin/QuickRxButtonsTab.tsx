// QuickRxButtonsTab — 빠른처방 단축 버튼 어드민 CRUD
// T-20260512-foot-QUICK-RX-BUTTON
// 어드민에서 자주 쓰는 처방세트를 버튼으로 등록 (아이콘 + 이름 + 처방세트 연결)

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Loader2, Plus, Pencil, Trash2,
  Pill, Activity, Zap, Heart, Stethoscope, Thermometer, Bandage, Syringe,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// 아이콘 옵션
// ---------------------------------------------------------------------------
export const ICON_OPTIONS = [
  { value: 'pill',        label: '알약',    Icon: Pill },
  { value: 'activity',    label: '활동',    Icon: Activity },
  { value: 'zap',         label: '번개',    Icon: Zap },
  { value: 'heart',       label: '하트',    Icon: Heart },
  { value: 'stethoscope', label: '청진기',  Icon: Stethoscope },
  { value: 'thermometer', label: '체온계',  Icon: Thermometer },
  { value: 'bandage',     label: '붕대',    Icon: Bandage },
  { value: 'syringe',     label: '주사',    Icon: Syringe },
] as const;

export type QuickRxIcon = typeof ICON_OPTIONS[number]['value'];

export function IconRenderer({ icon, className }: { icon: string; className?: string }) {
  const found = ICON_OPTIONS.find((o) => o.value === icon);
  const Icon = found?.Icon ?? Pill;
  return <Icon className={className ?? 'h-4 w-4'} />;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PrescriptionSet {
  id: number;
  name: string;
  is_active: boolean;
}

interface QuickRxButton {
  id: string;
  name: string;
  icon: string;
  prescription_set_id: number;
  sort_order: number;
  is_active: boolean;
  prescription_sets?: { name: string } | null;
}

interface QuickRxForm {
  name: string;
  icon: string;
  prescription_set_id: number | null;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_FORM: QuickRxForm = {
  name: '',
  icon: 'pill',
  prescription_set_id: null,
  sort_order: 0,
  is_active: true,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useQuickRxButtons() {
  return useQuery({
    queryKey: ['quick_rx_buttons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quick_rx_buttons')
        .select('id, name, icon, prescription_set_id, sort_order, is_active, prescription_sets(name)')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QuickRxButton[];
    },
  });
}

function useActivePrescriptionSets() {
  return useQuery({
    queryKey: ['prescription_sets', 'for_quick_rx'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as PrescriptionSet[];
    },
  });
}

function useUpsertQuickRxButton() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: QuickRxForm }) => {
      if (!form.prescription_set_id) throw new Error('처방세트를 선택하세요.');
      const payload = {
        name: form.name,
        icon: form.icon,
        prescription_set_id: form.prescription_set_id,
        sort_order: form.sort_order,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('quick_rx_buttons').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('quick_rx_buttons').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick_rx_buttons'] });
      toast.success('빠른처방 버튼이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteQuickRxButton() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('quick_rx_buttons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick_rx_buttons'] });
      toast.success('빠른처방 버튼이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function QuickRxButtonsTab() {
  const { data: buttons = [], isLoading } = useQuickRxButtons();
  const { data: sets = [] } = useActivePrescriptionSets();
  const upsert = useUpsertQuickRxButton();
  const del = useDeleteQuickRxButton();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QuickRxButton | null>(null);
  const [form, setForm] = useState<QuickRxForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(btn: QuickRxButton) {
    setEditing(btn);
    setForm({
      name: btn.name,
      icon: btn.icon,
      prescription_set_id: btn.prescription_set_id,
      sort_order: btn.sort_order,
      is_active: btn.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('버튼 이름을 입력해주세요.');
    if (!form.prescription_set_id) return toast.error('처방세트를 선택해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 버튼을 삭제하시겠어요?`)) return;
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
        <div>
          <p className="text-xs text-muted-foreground">{buttons.length}개 버튼 등록됨</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            치료사가 환자 차트나 리스트에서 한 번에 처방을 입력할 수 있는 버튼입니다.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd} data-testid="quick-rx-btn-add">
          <Plus className="h-3.5 w-3.5 mr-1" />
          버튼 추가
        </Button>
      </div>

      {/* 미리보기 (현재 등록된 버튼들 시각적 프리뷰) */}
      {buttons.filter((b) => b.is_active).length > 0 && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
          <p className="text-[11px] font-medium text-teal-700 mb-2">미리보기 (활성 버튼)</p>
          <div className="flex flex-wrap gap-2">
            {buttons
              .filter((b) => b.is_active)
              .map((btn) => (
                <div
                  key={btn.id}
                  className="flex items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-teal-800 shadow-sm"
                >
                  <IconRenderer icon={btn.icon} className="h-3.5 w-3.5 text-teal-600" />
                  {btn.name}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 목록 */}
      {buttons.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 빠른처방 버튼이 없습니다.
          <br />
          <span className="text-xs">자주 쓰는 처방세트를 버튼으로 등록해 두세요.</span>
        </div>
      ) : (
        <div className="space-y-2" data-testid="quick-rx-btn-list">
          {buttons.map((btn) => (
            <div
              key={btn.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              data-testid="quick-rx-btn-item"
            >
              {/* 아이콘 */}
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 border border-teal-200 shrink-0">
                <IconRenderer icon={btn.icon} className="h-4.5 w-4.5 text-teal-700" />
              </div>

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${!btn.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {btn.name}
                  </span>
                  {!btn.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  처방세트:{' '}
                  <span className="font-medium">
                    {btn.prescription_sets?.name ?? `ID ${btn.prescription_set_id}`}
                  </span>
                </p>
              </div>

              {/* 액션 */}
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(btn)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(btn.id, btn.name)}
                  disabled={del.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '빠른처방 버튼 수정' : '빠른처방 버튼 추가'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 버튼 이름 */}
            <div>
              <Label className="text-xs">버튼 이름 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예) 진통소염 세트"
                className="mt-1"
                data-testid="quick-rx-btn-name-input"
              />
            </div>

            {/* 아이콘 선택 */}
            <div>
              <Label className="text-xs">아이콘</Label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {ICON_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon: value }))}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[10px] transition
                      ${form.icon === value
                        ? 'border-teal-500 bg-teal-50 text-teal-800 ring-1 ring-teal-400'
                        : 'border-border text-muted-foreground hover:bg-accent/50'
                      }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 처방세트 선택 */}
            <div>
              <Label className="text-xs">연결할 처방세트 *</Label>
              <Select
                value={form.prescription_set_id?.toString() ?? ''}
                onValueChange={(v) => setForm((f) => ({ ...f, prescription_set_id: Number(v) }))}
              >
                <SelectTrigger className="mt-1" data-testid="quick-rx-set-select">
                  <SelectValue placeholder="처방세트 선택..." />
                </SelectTrigger>
                <SelectContent>
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sets.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  ⚠ 처방세트를 먼저 등록하세요 (처방세트 탭)
                </p>
              )}
            </div>

            {/* 정렬 순서 */}
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
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button
              onClick={handleSave}
              disabled={upsert.isPending}
              className="bg-teal-600 hover:bg-teal-700"
              data-testid="quick-rx-btn-save"
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
