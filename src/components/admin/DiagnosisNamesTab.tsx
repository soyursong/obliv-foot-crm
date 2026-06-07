// DiagnosisNamesTab — 상병명(진단명) 관리
// Ticket: T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-1 [A], 문지은 대표원장 C0ATE5P6JTH)
//   처방세트(PrescriptionSetsTab) 동일 구조 — 원내 사용 상병명을 등록·폴더 분류.
//   상병 정본 = services.category_label='상병' 단일 SSOT (두번째 마스터 신설 금지, AC-0 RESOLVED).
//   폴더 = services.diagnosis_folder (additive, supervisor SQL게이트). 진료차트는 이 마스터만 선택.
// Ticket: T-20260607-foot-DX-MGMT-DND-SORT (정렬 입력 UX 교체)
//   순서 정렬 = 숫자 입력 폐지(AC-5) → grab handle 드래그앤드롭(AC-1/2). admin 전용(AC-3).
//   기존 sort_order 컬럼 UPDATE only — 신규 스키마 없음(AC-4). DnD = @dnd-kit 기존 패턴 재사용(Services.tsx 미러).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
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
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, Folder, GripVertical } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Types — 상병 = services 행 (category_label='상병')
// ---------------------------------------------------------------------------
interface Diagnosis {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder: string | null;
  active: boolean;
  sort_order: number;
}

interface DxForm {
  name: string;
  service_code: string;
  diagnosis_folder: string; // '' = 미분류
  active: boolean;
  sort_order: number; // T-20260607: 폼 UI에선 비노출 — 신규=말미, 수정=기존값 보존(AC-5)
}

const EMPTY_FORM: DxForm = {
  name: '',
  service_code: '',
  diagnosis_folder: '',
  active: true,
  sort_order: 0,
};

const NO_FOLDER = '미분류';

// 상병 관리(CRUD) 권한 = 처방세트와 동일 (의사/총괄/관리자)
const DX_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;
// T-20260607-foot-DX-MGMT-DND-SORT (AC-3): 순서 드래그는 admin 전용 (CRUD보다 좁게 가드)
const DX_REORDER_ROLE = 'admin' as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useDiagnoses(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_master', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // deploy-tolerant: diagnosis_folder 컬럼은 supervisor SQL게이트로 적용 →
      //   미적용 환경(42703)에서도 깨지지 않게 폴백.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      let rows: Diagnosis[] | null = null;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder, active, sort_order')
        .eq('clinic_id', clinicId)
        .eq('category_label', '상병')
        .order('sort_order', { ascending: true });
      if (withFolder.error) {
        const fallback = await sb
          .from('services')
          .select('id, name, service_code, active, sort_order')
          .eq('clinic_id', clinicId)
          .eq('category_label', '상병')
          .order('sort_order', { ascending: true });
        if (fallback.error) throw fallback.error;
        rows = ((fallback.data ?? []) as Diagnosis[]).map((r) => ({ ...r, diagnosis_folder: null }));
      } else {
        rows = (withFolder.data ?? []) as Diagnosis[];
      }
      return rows;
    },
  });
}

function useUpsertDx(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: DxForm }) => {
      const payload = {
        name: form.name.trim(),
        service_code: form.service_code.trim() || null,
        diagnosis_folder: form.diagnosis_folder.trim() === '' ? null : form.diagnosis_folder.trim(),
        active: form.active,
        sort_order: form.sort_order,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      if (id) {
        const { error } = await sb.from('services').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        // 신규 상병 = services 행. category/category_label='상병', 단가 0 (진단코드, 비매출).
        const { error } = await sb.from('services').insert({
          ...payload,
          clinic_id: clinicId,
          category: '상병',
          category_label: '상병',
          price: 0,
          vat_type: 'none',
          service_type: 'single',
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
      toast.success('상병명이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteDx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('services').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
      toast.success('상병명이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// T-20260607-foot-DX-MGMT-DND-SORT: 정렬 가능한 항목 행 / 폴더 블록
//   useSortable hook 규칙상 별도 컴포넌트 필요. Services.tsx SortableServiceRow 패턴 미러.
// ---------------------------------------------------------------------------
interface SortableDxItemProps {
  d: Diagnosis;
  canReorder: boolean;
  canEdit: boolean;
  delPending: boolean;
  onEdit: (d: Diagnosis) => void;
  onDelete: (id: string, name: string) => void;
}

function SortableDxItem({ d, canReorder, canEdit, delPending, onEdit, onDelete }: SortableDxItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    disabled: !canReorder,
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
      className={`rounded-lg border bg-card px-4 py-2.5 flex items-center justify-between ${isDragging ? 'shadow-md' : ''}`}
      data-testid="dx-item"
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 드래그 핸들 — admin 전용, touch-none(태블릿 탭 오인식 방지) */}
        {canReorder && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            tabIndex={-1}
            className="flex items-center justify-center min-w-[28px] min-h-[28px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="드래그하여 순서 변경"
            onClick={(e) => e.stopPropagation()}
            data-testid="dx-item-handle"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span className={`text-sm font-medium truncate ${!d.active ? 'text-muted-foreground line-through' : ''}`}>
          {d.name}
        </span>
        {d.service_code && (
          <Badge variant="outline" className="text-[10px] py-0 font-mono">{d.service_code}</Badge>
        )}
        {!d.active && (
          <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(d)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(d.id, d.name)}
            disabled={delPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX (AC-1/3): 좌측 폴더트리 노드.
//   2패널 전환 — 세로 스택 폴더 헤더 → 좌측 패널의 클릭 가능한 폴더 노드(선택 시 우측에 상병 목록).
//   폴더 순서 DnD(admin) 보존(AC-4): 기존 handleFolderDragEnd/applyReorder 그대로 재사용.
interface SortableFolderNodeProps {
  folder: string;
  count: number;
  selected: boolean;
  canReorder: boolean;
  onSelect: (folder: string) => void;
}

function SortableFolderNode({ folder, count, selected, canReorder, onSelect }: SortableFolderNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder:${folder}`,
    disabled: !canReorder,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`flex items-center gap-1.5 rounded-md px-2 py-2 cursor-pointer select-none ${
        selected ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-200' : 'hover:bg-muted/60'
      } ${isDragging ? 'shadow-md bg-background' : ''}`}
      data-testid="dx-folder-node"
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(folder)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(folder);
        }
      }}
    >
      {/* 폴더 드래그 핸들 — admin 전용 */}
      {canReorder && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          tabIndex={-1}
          className="flex items-center justify-center min-w-[24px] min-h-[24px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
          title="드래그하여 폴더 순서 변경"
          onClick={(e) => e.stopPropagation()}
          data-testid="dx-folder-handle"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <Folder className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-teal-600' : 'text-teal-600/70'}`} />
      <span className="text-xs font-semibold truncate flex-1" data-testid="dx-folder-name">
        {folder}
      </span>
      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{count}</Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosisNamesTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const canEdit = !!profile?.role && (DX_MANAGE_ROLES as readonly string[]).includes(profile.role);
  // AC-3: 순서 드래그는 admin 전용
  const canReorder = profile?.role === DX_REORDER_ROLE;
  const { data: queryItems = [], isLoading } = useDiagnoses(clinicId);
  const upsert = useUpsertDx(clinicId);
  const del = useDeleteDx();

  // T-20260607: 로컬 정렬 상태 (낙관적 reorder). query 데이터(CRUD invalidate) 시 재동기화.
  const [items, setItems] = useState<Diagnosis[]>([]);
  useEffect(() => {
    setItems(queryItems);
  }, [queryItems]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Diagnosis | null>(null);
  const [form, setForm] = useState<DxForm>(EMPTY_FORM);

  // T-20260607-foot-DXMGMT-LEFT-FOLDER-FIX (AC-1): 좌측 폴더트리에서 선택된 폴더.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // T-20260607: DnD sensors (태블릿 터치 호환) — Services.tsx 동일 설정
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  function nextSortOrder() {
    return items.length === 0 ? 0 : Math.max(...items.map((d) => d.sort_order ?? 0)) + 10;
  }

  function openAdd() {
    setEditing(null);
    // AC-5: 정렬 숫자입력 폐지 → 신규 항목은 말미(sort_order = max+10)로 자동 배치
    setForm({ ...EMPTY_FORM, sort_order: nextSortOrder() });
    setOpen(true);
  }

  function openEdit(d: Diagnosis) {
    setEditing(d);
    setForm({
      name: d.name,
      service_code: d.service_code ?? '',
      diagnosis_folder: d.diagnosis_folder ?? '',
      active: d.active,
      sort_order: d.sort_order, // 기존값 보존 (수정 시 순서 변동 없음)
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('상병명을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 상병명을 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // 폴더별 그룹핑 — folder 순서는 sort_order 블록 순(드래그 반영), 동률 시 미분류 말미.
  const { folderOrder, itemsByFolder } = useMemo(() => {
    const map = new Map<string, Diagnosis[]>();
    for (const d of items) {
      const key = d.diagnosis_folder?.trim() ? d.diagnosis_folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    // items는 sort_order asc 정렬 — 폴더 내 항목 순서는 삽입 순서로 유지.
    const folderMin = new Map<string, number>();
    for (const [k, arr] of map) {
      folderMin.set(k, Math.min(...arr.map((x) => x.sort_order ?? 999)));
    }
    const order = Array.from(map.keys()).sort((a, b) => {
      const ma = folderMin.get(a)!;
      const mb = folderMin.get(b)!;
      if (ma !== mb) return ma - mb;
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return { folderOrder: order, itemsByFolder: map };
  }, [items]);

  // AC-1: 선택 폴더를 항상 유효하게 유지 — 미선택/삭제된 폴더면 첫 폴더로 자동 선택.
  useEffect(() => {
    if (folderOrder.length === 0) {
      if (selectedFolder !== null) setSelectedFolder(null);
      return;
    }
    if (selectedFolder === null || !folderOrder.includes(selectedFolder)) {
      setSelectedFolder(folderOrder[0]);
    }
  }, [folderOrder, selectedFolder]);

  const folderNames = useMemo(
    () =>
      Array.from(
        new Set(items.map((d) => d.diagnosis_folder?.trim()).filter((x): x is string => !!x)),
      ).sort((a, b) => a.localeCompare(b, 'ko')),
    [items],
  );

  // T-20260607 (AC-4): 전역 sort_order 재계산 → 낙관적 반영 + 변경분만 DB UPDATE.
  //   폴더는 연속 블록으로 인코딩(블록 순=폴더 순). 신규 스키마 없이 기존 컬럼만 갱신.
  const savingRef = useRef(false);
  async function applyReorder(fOrder: string[], byFolder: Map<string, Diagnosis[]>) {
    const snapshot = items; // 실패 시 롤백용
    const flat: Diagnosis[] = [];
    let g = 0;
    for (const f of fOrder) {
      for (const it of byFolder.get(f) ?? []) {
        flat.push({ ...it, sort_order: g * 10 });
        g += 1;
      }
    }
    // 변경된 행만 추출
    const prevById = new Map(snapshot.map((d) => [d.id, d.sort_order]));
    const updates = flat
      .filter((d) => prevById.get(d.id) !== d.sort_order)
      .map(({ id, sort_order }) => ({ id, sort_order }));
    if (updates.length === 0) return;

    setItems(flat); // 낙관적 반영
    savingRef.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      await Promise.all(
        updates.map(({ id, sort_order }) => sb.from('services').update({ sort_order }).eq('id', id)),
      );
      toast.success('순서가 저장됐어요.', { duration: 1500 });
    } catch (e) {
      setItems(snapshot); // AC-4: 저장 실패 시 직전 순서로 롤백
      toast.error(`순서 저장 실패 — 되돌렸어요. ${(e as Error)?.message ?? ''}`.trim());
    } finally {
      savingRef.current = false;
    }
  }

  // 항목 드래그 (폴더 내 순서 변경, AC-2a)
  function handleItemDragEnd(folder: string, e: DragEndEvent) {
    if (!canReorder) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const arr = itemsByFolder.get(folder) ?? [];
    const oldIdx = arr.findIndex((x) => x.id === String(active.id));
    const newIdx = arr.findIndex((x) => x.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const newArr = arrayMove(arr, oldIdx, newIdx);
    const byFolder = new Map(itemsByFolder);
    byFolder.set(folder, newArr);
    applyReorder(folderOrder, byFolder);
  }

  // 폴더 드래그 (폴더 자체 순서 변경, AC-2b)
  function handleFolderDragEnd(e: DragEndEvent) {
    if (!canReorder) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const activeFolder = String(active.id).replace(/^folder:/, '');
    const overFolder = String(over.id).replace(/^folder:/, '');
    const oldIdx = folderOrder.indexOf(activeFolder);
    const newIdx = folderOrder.indexOf(overFolder);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(folderOrder, oldIdx, newIdx);
    applyReorder(newOrder, itemsByFolder);
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
        <span className="text-xs text-muted-foreground">{items.length}개 상병명</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="dx-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            상병명 추가
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        진료차트 진단명은 여기 등록된 상병명만 선택할 수 있습니다. 폴더로 그룹화해 관리하세요.
        {canReorder && ' 왼쪽 손잡이를 끌어 순서를 바꿀 수 있어요.'}
      </p>

      {/* 2패널 (AC-3): 좌 = 폴더트리 / 우 = 선택 폴더의 상병 목록.
          AC-2: 폴더 0건이어도 좌측 패널 컨테이너는 항상 표시(빈 상태 안내). */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        {/* ── 좌측: 폴더트리 (AC-1) ── */}
        <aside
          className="rounded-lg border bg-muted/20 p-2 md:max-h-[70vh] md:overflow-y-auto"
          data-testid="dx-folder-tree"
        >
          <div className="px-1 pb-1.5 text-[11px] font-semibold text-muted-foreground">폴더</div>
          {folderOrder.length === 0 ? (
            // AC-2: 빈 상태에서도 패널은 유지, "폴더 없음" 안내
            <div
              className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
              data-testid="dx-folder-empty"
            >
              폴더 없음
            </div>
          ) : (
            // 폴더 레벨 DnD (AC-4 회귀 보존) — 좌측 패널 안에서 폴더 순서 변경
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFolderDragEnd}>
              <SortableContext
                items={canReorder ? folderOrder.map((f) => `folder:${f}`) : []}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5" data-testid="dx-folder-list">
                  {folderOrder.map((folder) => (
                    <SortableFolderNode
                      key={folder}
                      folder={folder}
                      count={(itemsByFolder.get(folder) ?? []).length}
                      selected={selectedFolder === folder}
                      canReorder={canReorder}
                      onSelect={setSelectedFolder}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </aside>

        {/* ── 우측: 선택 폴더의 상병 목록 ── */}
        <div className="min-w-0" data-testid="dx-list">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              등록된 상병명이 없습니다.
            </div>
          ) : selectedFolder === null ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              왼쪽에서 폴더를 선택하세요.
            </div>
          ) : (
            (() => {
              const fItems = itemsByFolder.get(selectedFolder) ?? [];
              return (
                <div className="space-y-2" data-testid="dx-folder-items">
                  <div className="flex items-center gap-1.5 px-1">
                    <Folder className="h-3.5 w-3.5 text-teal-600" />
                    <span className="text-xs font-semibold text-foreground">{selectedFolder}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{fItems.length}</Badge>
                  </div>
                  {fItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                      이 폴더에 등록된 상병명이 없습니다.
                    </div>
                  ) : (
                    // 항목 레벨 DnD (AC-4 회귀 보존) — 폴더 내 순서 변경
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(e) => handleItemDragEnd(selectedFolder, e)}
                    >
                      <SortableContext
                        items={canReorder ? fItems.map((d) => d.id) : []}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-1.5">
                          {fItems.map((d) => (
                            <SortableDxItem
                              key={d.id}
                              d={d}
                              canReorder={canReorder}
                              canEdit={canEdit}
                              delPending={del.isPending}
                              onEdit={openEdit}
                              onDelete={handleDelete}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              );
            })()
          )}
        </div>
      </div>

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '상병명 수정' : '상병명 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* AC-5: sort_order 숫자입력 폐지 — 순서는 목록에서 드래그로 변경 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">상병명 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 족저근막염"
                  className="mt-1"
                  data-testid="dx-name-input"
                />
              </div>
              <div>
                <Label className="text-xs">상병코드</Label>
                <Input
                  value={form.service_code}
                  onChange={(e) => setForm((f) => ({ ...f, service_code: e.target.value }))}
                  placeholder="예) M79.3"
                  className="mt-1 font-mono"
                  data-testid="dx-code-input"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">폴더 (분류)</Label>
              <Input
                value={form.diagnosis_folder}
                onChange={(e) => setForm((f) => ({ ...f, diagnosis_folder: e.target.value }))}
                placeholder="예) 족부질환 · 비우면 미분류"
                className="mt-1"
                list="dx-folder-suggestions"
                data-testid="dx-folder-input"
              />
              <datalist id="dx-folder-suggestions">
                {folderNames.map((fn) => (
                  <option key={fn} value={fn} />
                ))}
              </datalist>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="dx-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
