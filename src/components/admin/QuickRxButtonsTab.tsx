// QuickRxButtonsTab — 빠른처방 단축 버튼 어드민 CRUD
// T-20260512-foot-QUICK-RX-BUTTON
// 어드민에서 자주 쓰는 처방세트를 버튼으로 등록 (아이콘 + 이름 + 처방세트 연결)

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { toast } from '@/lib/toast';
import {
  Loader2, Plus, Pencil, Trash2, GripVertical,
  Pill, Activity, Zap, Heart, Stethoscope, Thermometer, Bandage, Syringe,
  Tablets, FlaskConical, FlaskRound, Droplet, Droplets, Beaker, BriefcaseMedical, TestTube,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// 아이콘 옵션
//   ICON_OPTIONS = 렌더용 전체 레지스트리(IconRenderer가 저장값 → 컴포넌트 해석).
//     기존 저장값(비-약 아이콘 포함)이 깨지지 않도록 절대 항목을 제거하지 않는다(AC-2 회귀 금지).
//   T-20260607-foot-RXQUICK-ICON-DRUGFILTER:
//     `drug: true`로 약·처방 관련만 큐레이션 → 추가/편집 picker는 DRUG_ICON_OPTIONS 서브셋만 노출(AC-1).
//     약 서브셋 10종(AC-3, 8개+ 확보): 알약/정제/캡슐대용 주사·물약·시럽·점안·수액·조제·약상자·검체.
// ---------------------------------------------------------------------------
export const ICON_OPTIONS = [
  // ── 약·처방 관련(picker 노출 서브셋) ──────────────────────────────
  { value: 'pill',              label: '알약',    Icon: Pill,             drug: true },
  { value: 'tablets',           label: '정제',    Icon: Tablets,          drug: true },
  { value: 'syringe',           label: '주사',    Icon: Syringe,          drug: true },
  { value: 'flask-conical',     label: '물약',    Icon: FlaskConical,     drug: true },
  { value: 'flask-round',       label: '시럽',    Icon: FlaskRound,       drug: true },
  { value: 'droplet',           label: '점안액',  Icon: Droplet,          drug: true },
  { value: 'droplets',          label: '수액',    Icon: Droplets,         drug: true },
  { value: 'beaker',            label: '조제',    Icon: Beaker,           drug: true },
  { value: 'briefcase-medical', label: '약상자',  Icon: BriefcaseMedical, drug: true },
  { value: 'test-tube',         label: '검체',    Icon: TestTube,         drug: true },
  // ── 레거시 비-약 아이콘 — picker 비노출, 기존 저장값 렌더 호환 유지(제거 금지) ──
  { value: 'activity',    label: '활동',    Icon: Activity,    drug: false },
  { value: 'zap',         label: '번개',    Icon: Zap,         drug: false },
  { value: 'heart',       label: '하트',    Icon: Heart,       drug: false },
  { value: 'stethoscope', label: '청진기',  Icon: Stethoscope, drug: false },
  { value: 'thermometer', label: '체온계',  Icon: Thermometer, drug: false },
  { value: 'bandage',     label: '붕대',    Icon: Bandage,     drug: false },
] as const;

// 추가/편집 picker 노출 후보 — 약 관련 서브셋만(AC-1). 저장 식별자·컬럼은 불변.
export const DRUG_ICON_OPTIONS = ICON_OPTIONS.filter((o) => o.drug);

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
// T-20260607-foot-RXQUICK-SORT-DND: 정렬 가능한 버튼 행
//   숫자입력 정렬 → :: 드래그핸들 DnD로 교체. useSortable hook 규칙상 별도 컴포넌트.
//   DiagnosisNamesTab SortableDxItem 패턴 미러(flat 목록 버전).
// ---------------------------------------------------------------------------
interface SortableQuickRxRowProps {
  btn: QuickRxButton;
  canEdit: boolean;
  delPending: boolean;
  onEdit: (btn: QuickRxButton) => void;
  onDelete: (id: string, name: string) => void;
}

function SortableQuickRxRow({ btn, canEdit, delPending, onEdit, onDelete }: SortableQuickRxRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: btn.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 ${isDragging ? 'shadow-md' : ''}`}
      data-testid="quick-rx-btn-item"
    >
      {/* 드래그 핸들 — admin/manager 전용, touch-none(태블릿 탭 오인식 방지) */}
      {canEdit && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          tabIndex={-1}
          className="flex items-center justify-center min-w-[28px] min-h-[28px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
          title="드래그하여 순서 변경"
          onClick={(e) => e.stopPropagation()}
          data-testid="quick-rx-btn-handle"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

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
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(btn)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(btn.id, btn.name)}
            disabled={delPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function QuickRxButtonsTab() {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원은 읽기 전용, CRUD는 admin/manager 전용.
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';
  const qc = useQueryClient();
  const { data: buttons = [], isLoading } = useQuickRxButtons();
  const { data: sets = [] } = useActivePrescriptionSets();
  const upsert = useUpsertQuickRxButton();
  const del = useDeleteQuickRxButton();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QuickRxButton | null>(null);
  const [form, setForm] = useState<QuickRxForm>(EMPTY_FORM);

  // T-20260607-foot-RXQUICK-SORT-DND: DnD 정렬용 로컬 미러(낙관적 반영). 쿼리 데이터로 동기화.
  const [items, setItems] = useState<QuickRxButton[]>([]);
  const savingRef = useRef(false);
  useEffect(() => {
    // 저장 진행 중(낙관적 반영 직후)엔 서버 캐시로 덮어쓰지 않음 — 깜빡임/되돌림 방지.
    if (savingRef.current) return;
    setItems(buttons);
  }, [buttons]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  // 드롭 시점 순번 일괄 저장 — 변경분만 DB UPDATE + 실패 시 롤백. (DiagnosisNamesTab applyReorder 패턴)
  async function handleDragEnd(e: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const oldIdx = items.findIndex((x) => x.id === String(active.id));
    const newIdx = items.findIndex((x) => x.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;

    const snapshot = items; // 실패 롤백용
    const reordered = arrayMove(items, oldIdx, newIdx).map((b, i) => ({ ...b, sort_order: i * 10 }));
    // 변경된 행만 추출
    const prevById = new Map(snapshot.map((b) => [b.id, b.sort_order]));
    const updates = reordered
      .filter((b) => prevById.get(b.id) !== b.sort_order)
      .map(({ id, sort_order }) => ({ id, sort_order }));
    if (updates.length === 0) return;

    setItems(reordered); // 낙관적 반영
    savingRef.current = true;
    try {
      await Promise.all(
        updates.map(({ id, sort_order }) =>
          supabase.from('quick_rx_buttons').update({ sort_order }).eq('id', id),
        ),
      );
      toast.success('순서가 저장됐어요.', { duration: 1500 });
      qc.invalidateQueries({ queryKey: ['quick_rx_buttons'] });
    } catch (err) {
      setItems(snapshot); // 저장 실패 시 직전 순서로 롤백
      toast.error(`순서 저장 실패 — 되돌렸어요. ${(err as Error)?.message ?? ''}`.trim());
    } finally {
      savingRef.current = false;
    }
  }

  function openAdd() {
    setEditing(null);
    // 신규 버튼은 목록 말미로 — 기존 최대 sort_order + 10. (정렬은 DnD로 조정)
    const maxOrder = items.reduce((m, b) => Math.max(m, b.sort_order ?? 0), -10);
    setForm({ ...EMPTY_FORM, sort_order: maxOrder + 10 });
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
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="quick-rx-btn-add">
            <Plus className="h-3.5 w-3.5 mr-1" />
            버튼 추가
          </Button>
        )}
      </div>

      {/* 미리보기 (현재 등록된 버튼들 시각적 프리뷰) — 실제 정렬순서 반영 */}
      {items.filter((b) => b.is_active).length > 0 && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
          <p className="text-[11px] font-medium text-teal-700 mb-2">미리보기 (활성 버튼)</p>
          <div className="flex flex-wrap gap-2">
            {items
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

      {/* 목록 — :: 드래그핸들로 순서 변경(드롭 시 일괄 저장) */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 빠른처방 버튼이 없습니다.
          <br />
          <span className="text-xs">자주 쓰는 처방세트를 버튼으로 등록해 두세요.</span>
        </div>
      ) : (
        <>
          {canEdit && (
            <p className="text-[11px] text-muted-foreground -mb-1">
              <GripVertical className="inline h-3 w-3 align-text-bottom" /> 핸들을 끌어 순서를 바꾸면 자동 저장됩니다.
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2" data-testid="quick-rx-btn-list">
                {items.map((btn) => (
                  <SortableQuickRxRow
                    key={btn.id}
                    btn={btn}
                    canEdit={canEdit}
                    delPending={del.isPending}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
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
              <Label className="text-xs">아이콘 <span className="text-muted-foreground">(약·처방 관련)</span></Label>
              <div className="grid grid-cols-4 gap-2 mt-1" data-testid="quick-rx-icon-picker">
                {DRUG_ICON_OPTIONS.map(({ value, label, Icon }) => (
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

            {/* 정렬 순서 — T-20260607-foot-RXQUICK-SORT-DND: 숫자입력 제거. 목록에서 :: 드래그로 변경.
                신규 버튼은 자동으로 목록 말미에 추가됩니다. */}

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
