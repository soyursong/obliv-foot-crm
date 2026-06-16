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
// T-20260607-foot-RXQUICK-SET-FOLDER-NAV: 처방세트 선택을 진료차트와 동일한 folder→set 트리로 통일.
import PrescriptionSetTreePicker from '@/components/prescription/PrescriptionSetTreePicker';
import { toast } from '@/lib/toast';
// T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX (AC-4): 이모지/아이콘 제거 → 차분한 모노톤 색상 태그.
//   영속화는 신규 컬럼 없이 기존 icon 컬럼 재활용(색상 토큰 저장). 자세한 근거 = quickRxColors.ts.
import {
  QUICK_RX_COLORS,
  DEFAULT_QUICK_RX_COLOR,
  quickRxChipClass,
  quickRxDotClass,
  normalizeQuickRxColor,
} from '@/lib/quickRxColors';
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
  folder?: string | null; // T-20260607-foot-RXQUICK-SET-FOLDER-NAV: folder→set 트리 picker 그룹핑
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
  // AC-4 (REFINE-5FIX): icon 컬럼을 색상 토큰 저장에 재활용. 기본 = 하늘색(sky).
  icon: DEFAULT_QUICK_RX_COLOR,
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
        .select('id, name, is_active, folder')
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

      {/* AC-4 (REFINE-5FIX): 아이콘 박스 제거 → 선택 색상 닷. 색상은 icon 컬럼 재활용 토큰. */}
      <span
        className={`h-3 w-3 rounded-full shrink-0 ${quickRxDotClass(btn.icon)}`}
        data-testid="quick-rx-btn-color-dot"
        aria-hidden
      />

      {/* 정보 — 처방세트명을 선택 색상 태그(pill) 안에 표시 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium ${quickRxChipClass(btn.icon)} ${!btn.is_active ? 'line-through opacity-60' : ''}`}
            data-testid="quick-rx-btn-name-chip"
          >
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
      // AC-4: 레거시 아이콘 식별자(pill 등)는 색상 토큰으로 정규화(기본 sky) → 색상 팔레트 하이라이트 정상.
      icon: normalizeQuickRxColor(btn.icon),
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
                /* AC-4 (REFINE-5FIX): 아이콘 프리뷰 → 선택 색상 태그(pill) 안에 처방세트명 표시. */
                <span
                  key={btn.id}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${quickRxChipClass(btn.icon)}`}
                  data-testid="quick-rx-preview-chip"
                >
                  {btn.name}
                </span>
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

            {/* AC-4 (REFINE-5FIX): 이모지/아이콘 picker 제거 → 차분한 모노톤 색상 팔레트.
                선택 색상은 icon 컬럼에 토큰으로 저장(db_change=false). 처방세트명은 아래 미리보기처럼
                선택 색상 태그(pill) 안에 표시된다. (형광·고채도 없음 — quickRxColors SSOT) */}
            <div>
              <Label className="text-xs">태그 색상 <span className="text-muted-foreground">(차분한 모노톤)</span></Label>
              <div className="mt-1.5 flex flex-wrap gap-2" data-testid="quick-rx-color-palette">
                {QUICK_RX_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon: c.value }))}
                    title={c.label}
                    aria-label={`색상 ${c.label}`}
                    aria-pressed={form.icon === c.value}
                    data-testid={`quick-rx-color-${c.value}`}
                    className={`h-7 w-7 rounded-full ${c.dot} transition ${
                      form.icon === c.value
                        ? 'ring-2 ring-offset-2 ring-foreground'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
              {/* 미리보기 칩 — 입력한 이름이 선택 색상 태그 안에 표시 */}
              <div className="mt-2.5">
                <span className="text-[10px] text-muted-foreground">미리보기: </span>
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${quickRxChipClass(form.icon)}`}
                  data-testid="quick-rx-color-preview-chip"
                >
                  {form.name.trim() || '처방세트명'}
                </span>
              </div>
            </div>

            {/* 처방세트 선택 — T-20260607-foot-RXQUICK-SET-FOLDER-NAV:
                  flat <Select> → 진료차트와 동일한 folder→set 2단 트리 picker(+검색)로 통일.
                  AC-1 폴더 펼침/접기, AC-2 세트명 부분일치 검색, AC-3 기존 연결값 하이라이트 유지.
                T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX (AC-5): 연결 `<` 대상을 처방세트 "폴더 구조"
                  로 통일 표기. picker 는 처방세트를 폴더(folder)별로 묶은 트리 — 폴더를 펼쳐 안의 세트를
                  선택한다. (BUNDLE-MERGE 로 단독약이 folder='약' 폴더로 그룹핑된 구조 그대로 재사용) */}
            <div>
              <Label className="text-xs">연결할 처방세트 <span className="text-muted-foreground">(폴더 구조)</span> *</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                처방세트 폴더를 펼쳐 안의 세트를 선택하세요.
              </p>
              {sets.length === 0 ? (
                <p className="text-[11px] text-amber-600 mt-1">
                  ⚠ 처방세트를 먼저 등록하세요 (처방세트 탭)
                </p>
              ) : (
                <div
                  className="mt-1 max-h-72 overflow-y-auto rounded-lg border p-2"
                  data-testid="quick-rx-set-tree"
                >
                  <PrescriptionSetTreePicker
                    sets={sets}
                    selectedId={form.prescription_set_id}
                    onSelect={(s) => setForm((f) => ({ ...f, prescription_set_id: s.id }))}
                    searchable
                    searchPlaceholder="처방세트 이름 검색..."
                    emptyMessage={
                      <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center">
                        등록된 처방세트가 없습니다.
                      </div>
                    }
                    testIdPrefix="quick-rx-set"
                  />
                </div>
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
