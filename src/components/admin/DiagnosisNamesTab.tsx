// DiagnosisNamesTab — 상병명(진단명) 관리 · 2패널 (좌=폴더관리 / 우=상병항목)
// Ticket: T-20260607-foot-DXRX-MGMT-2PANEL (갈래① 상병명, 문지은 대표원장 C0ATE5P6JTH)
//   AC-1 좌(폴더)·우(항목) 2패널 레이아웃.
//   AC-2 항목 등록 폼에서 "폴더" 필드 제거 → 우측 항목을 좌측 폴더로 **드래그앤드롭** 배치(확정·관리권한).
//        "이동 버튼" 대안 제거(MSG-...-mw61). 배치 = services.diagnosis_folder_id FK 갱신(이동 시맨틱).
//   AC-3 좌측 폴더 CRUD(생성·수정·삭제)+위계(하위폴더)+순서(▲▼)+인라인 rename(빈이름·형제중복 차단).
//   AC-4 폴더 미지정 항목 → "미분류" 버킷(좌측 상단, drop 가능 → 미분류로 환원).
//   AC-5 좌측 폴더 선택 → 우측이 해당 폴더 소속 항목으로 필터링.
//   AC-6 관리권한(director/manager/admin) 외 role 은 폴더 관리·배치 조작 불가(읽기 전용).
//   AC-7 기존 상병 무손실 — folder_id NULL 분은 "미분류"로 정상 노출.
//
// 데이터 모델 (20260607200000_diagnosis_folders_fk, D3 supervisor 게이트 GO 후 적용):
//   상병 정본 = services (category_label='상병') 단일 SSOT.
//   폴더      = diagnosis_folders (자기참조 트리, clinic 격리).
//   배치      = services.diagnosis_folder_id uuid NULL FK (NULL=미분류).
//   ※ 레거시 TEXT services.diagnosis_folder 는 안전망 공존(본 화면은 더 이상 쓰지 않음).
//   폴더 CRUD/배치 훅은 @/lib/diagnosisFolders (drugFolders.ts 미러)에서 재사용.

import { useEffect, useMemo, useState } from 'react';
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
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Check,
  X,
  Inbox,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  useDiagnosisFolders,
  buildDiagnosisFolderTree,
  useCreateDiagnosisFolder,
  useUpdateDiagnosisFolder,
  useDeleteDiagnosisFolder,
  useAssignDiagnosisToFolder,
  type DiagnosisFolderNode,
} from '@/lib/diagnosisFolders';

// ---------------------------------------------------------------------------
// Types — 상병 = services 행 (category_label='상병')
// ---------------------------------------------------------------------------
interface Diagnosis {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder_id: string | null; // NULL = 미분류
  active: boolean;
  sort_order: number;
}

interface DxForm {
  name: string;
  service_code: string;
  active: boolean;
  sort_order: number; // 폼 UI 비노출 — 신규=말미 자동, 수정=기존값 보존
}

const EMPTY_FORM: DxForm = { name: '', service_code: '', active: true, sort_order: 0 };

const NO_FOLDER = '미분류';
// 좌측 "미분류" 버킷의 droppable/select 키 (uuid 와 충돌 없는 sentinel)
const UNASSIGNED = '__unassigned__';

// 상병 관리(CRUD)·폴더 관리·배치 권한 = 관리권한 role.
//   현장 "어드민만 관리"의 코드 매핑 — 피드백 출처 대표원장(director)을 잠그지 않도록
//   DrugFoldersTab(FOLDER_MANAGE_ROLES)·기존 탭과 동일하게 director 포함.
const DX_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;

// ---------------------------------------------------------------------------
// Hooks — 상병 마스터(services)
// ---------------------------------------------------------------------------
function useDiagnoses(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_master', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // deploy-tolerant: diagnosis_folder_id 컬럼 미적용(42703) 환경에서도 깨지지 않게 폴백.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder_id, active, sort_order')
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
        return ((fallback.data ?? []) as Diagnosis[]).map((r) => ({ ...r, diagnosis_folder_id: null }));
      }
      return (withFolder.data ?? []) as Diagnosis[];
    },
  });
}

// 상병 항목 upsert — 폴더는 건드리지 않음(배치는 DnD/useAssignDiagnosisToFolder 전담, AC-2).
//   신규는 미분류(diagnosis_folder_id 미지정=NULL)로 생성 → 우측에서 좌측 폴더로 드래그 배치.
function useUpsertDx(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: DxForm }) => {
      const payload = {
        name: form.name.trim(),
        service_code: form.service_code.trim() || null,
        active: form.active,
        sort_order: form.sort_order,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = id
        ? await sb.from('services').update(payload).eq('id', id)
        : await sb.from('services').insert({
            // 신규 상병 = services 행. category/category_label='상병', 단가 0(진단코드, 비매출).
            ...payload,
            clinic_id: clinicId,
            category: '상병',
            category_label: '상병',
            price: 0,
            vat_type: 'none',
            service_type: 'single',
          });
      if (error) throw error;
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
// 우측: 드래그 가능한 상병 항목 행 (AC-2 — 좌측 폴더로 끌어 배치)
// ---------------------------------------------------------------------------
interface DraggableDxItemProps {
  d: Diagnosis;
  canManage: boolean;
  delPending: boolean;
  onEdit: (d: Diagnosis) => void;
  onDelete: (id: string, name: string) => void;
}

function DraggableDxItem({ d, canManage, delPending, onEdit, onDelete }: DraggableDxItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: d.id,
    disabled: !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 30 : undefined,
      }}
      className={`rounded-lg border bg-card px-4 py-2.5 flex items-center justify-between ${isDragging ? 'shadow-md' : ''}`}
      data-testid="dx-item"
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 드래그 핸들 — 관리권한 전용, touch-none(태블릿 탭 오인식 방지) */}
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            tabIndex={-1}
            className="flex items-center justify-center min-w-[28px] min-h-[28px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="드래그하여 왼쪽 폴더로 옮기기"
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
        {!d.active && <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>}
      </div>
      {canManage && (
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

// ---------------------------------------------------------------------------
// 좌측: "미분류" 버킷 — drop 가능(폴더 배정 해제) + 선택(미분류 항목 필터)
// ---------------------------------------------------------------------------
function UnassignedBucket({
  count,
  selected,
  onSelect,
}: {
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED });
  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-1.5 rounded-md px-2 py-2 cursor-pointer select-none border ${
        selected ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-200 border-teal-200' : 'border-transparent hover:bg-muted/60'
      } ${isOver ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
      data-testid="dx-folder-node"
      data-folder-id={UNASSIGNED}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-semibold truncate flex-1" data-testid="dx-folder-name">{NO_FOLDER}</span>
      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{count}</Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 좌측: 폴더 노드 (droppable + 선택 + 인라인 rename + 위계/순서 조작). 재귀.
// ---------------------------------------------------------------------------
interface FolderNodeProps {
  node: DiagnosisFolderNode;
  count: number;
  selectedKey: string;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  editingId: string | null;
  editValue: string;
  renamePending: boolean;
  movePending: boolean;
  onSelect: (id: string) => void;
  onStartRename: (node: DiagnosisFolderNode) => void;
  onEditChange: (v: string) => void;
  onRenameSubmit: (node: DiagnosisFolderNode) => void;
  onRenameCancel: () => void;
  onAddChild: (parentId: string) => void;
  onDelete: (node: DiagnosisFolderNode) => void;
  onMove: (node: DiagnosisFolderNode, dir: -1 | 1) => void;
  countOf: (folderId: string) => number;
}

function FolderNode(props: FolderNodeProps) {
  const {
    node, count, selectedKey, canManage, isFirst, isLast,
    editingId, editValue, renamePending, movePending,
    onSelect, onStartRename, onEditChange, onRenameSubmit, onRenameCancel,
    onAddChild, onDelete, onMove, countOf,
  } = props;

  const { setNodeRef, isOver } = useDroppable({ id: node.id });
  const isSelected = selectedKey === node.id;
  const isEditing = editingId === node.id;
  const indent = { marginLeft: `${node.depth * 14}px` };

  if (isEditing) {
    return (
      <div data-testid="dx-folder-node" data-renaming="true">
        <div
          className="flex items-center gap-1 rounded-md px-2 py-1.5 bg-teal-50 ring-1 ring-teal-300"
          style={indent}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <Input
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameSubmit(node);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            className="h-7 text-xs px-1.5 flex-1 min-w-0"
            data-testid="dx-folder-rename-input"
          />
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-teal-600 hover:text-teal-700 shrink-0"
            onClick={() => onRenameSubmit(node)} disabled={renamePending}
            title="저장" data-testid="dx-folder-rename-save"
          >
            {renamePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-muted-foreground shrink-0"
            onClick={onRenameCancel} disabled={renamePending}
            title="취소" data-testid="dx-folder-rename-cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {node.children.length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map((child, i) => (
              <FolderNode
                key={child.id}
                {...props}
                node={child}
                count={countOf(child.id)}
                isFirst={i === 0}
                isLast={i === node.children.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="dx-folder-node" data-folder-id={node.id} data-selected={isSelected ? 'true' : 'false'}>
      <div
        ref={setNodeRef}
        style={indent}
        className={`group flex items-center gap-1 rounded-md px-2 py-2 cursor-pointer select-none border ${
          isSelected ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-200 border-teal-200' : 'border-transparent hover:bg-muted/60'
        } ${isOver ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => canManage && onStartRename(node)}
        onContextMenu={(e) => {
          if (!canManage) return;
          e.preventDefault();
          onStartRename(node);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(node.id);
          } else if (e.key === 'F2' && canManage) {
            e.preventDefault();
            onStartRename(node);
          }
        }}
      >
        {isSelected ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-teal-600" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-teal-600/70" />
        )}
        <span className="text-xs font-semibold truncate flex-1" data-testid="dx-folder-name">{node.name}</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{count}</Badge>
        {canManage && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            {/* 순서 ▲▼ — 형제 내 sort_order 교체 (AC-3) */}
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-teal-600 disabled:opacity-20"
              title="위로" disabled={isFirst || movePending}
              onClick={(e) => { e.stopPropagation(); onMove(node, -1); }}
              data-testid="dx-folder-move-up"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-teal-600 disabled:opacity-20"
              title="아래로" disabled={isLast || movePending}
              onClick={(e) => { e.stopPropagation(); onMove(node, 1); }}
              data-testid="dx-folder-move-down"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-teal-600"
              title="하위 폴더 추가"
              onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
              data-testid="dx-folder-add-child"
            >
              <FolderPlus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground/60 hover:text-teal-600"
              title="이름 바꾸기"
              onClick={(e) => { e.stopPropagation(); onStartRename(node); }}
              data-testid="dx-folder-rename-btn"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              title="삭제"
              onClick={(e) => { e.stopPropagation(); onDelete(node); }}
              data-testid="dx-folder-delete-btn"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((child, i) => (
            <FolderNode
              key={child.id}
              {...props}
              node={child}
              count={countOf(child.id)}
              isFirst={i === 0}
              isLast={i === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosisNamesTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const canManage = !!profile?.role && (DX_MANAGE_ROLES as readonly string[]).includes(profile.role);

  const { data: items = [], isLoading } = useDiagnoses(clinicId);
  const { data: folders = [], isLoading: foldersLoading } = useDiagnosisFolders(clinicId);
  const upsert = useUpsertDx(clinicId);
  const del = useDeleteDx();
  const createFolder = useCreateDiagnosisFolder(clinicId);
  const updateFolder = useUpdateDiagnosisFolder();
  const deleteFolder = useDeleteDiagnosisFolder();
  const assign = useAssignDiagnosisToFolder();

  // 항목 등록/수정 다이얼로그
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Diagnosis | null>(null);
  const [form, setForm] = useState<DxForm>(EMPTY_FORM);

  // 좌측 선택(폴더 id 또는 UNASSIGNED). 기본 = 미분류.
  const [selectedKey, setSelectedKey] = useState<string>(UNASSIGNED);
  // 폴더 인라인 rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // 새 루트 폴더
  const [newRootName, setNewRootName] = useState('');
  // DnD overlay 라벨
  const [activeDx, setActiveDx] = useState<Diagnosis | null>(null);

  // DnD sensors (태블릿 터치 호환)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const tree = useMemo(() => buildDiagnosisFolderTree(folders), [folders]);

  // 폴더별 항목 수 + 미분류 수
  const { countByFolder, unassignedCount } = useMemo(() => {
    const map = new Map<string, number>();
    let un = 0;
    for (const d of items) {
      if (d.diagnosis_folder_id) map.set(d.diagnosis_folder_id, (map.get(d.diagnosis_folder_id) ?? 0) + 1);
      else un += 1;
    }
    return { countByFolder: map, unassignedCount: un };
  }, [items]);

  const countOf = (folderId: string) => countByFolder.get(folderId) ?? 0;

  // 선택 폴더 키가 유효한지 보정(삭제된 폴더 → 미분류로 환원)
  useEffect(() => {
    if (selectedKey === UNASSIGNED) return;
    if (!folders.some((f) => f.id === selectedKey)) setSelectedKey(UNASSIGNED);
  }, [folders, selectedKey]);

  // 우측 목록 — 선택된 폴더 소속 항목 (AC-5)
  const visibleItems = useMemo(() => {
    if (selectedKey === UNASSIGNED) return items.filter((d) => !d.diagnosis_folder_id);
    return items.filter((d) => d.diagnosis_folder_id === selectedKey);
  }, [items, selectedKey]);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedKey) ?? null,
    [folders, selectedKey],
  );

  function nextSortOrder() {
    return items.length === 0 ? 0 : Math.max(...items.map((d) => d.sort_order ?? 0)) + 10;
  }

  // ── 항목 CRUD ──
  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sort_order: nextSortOrder() });
    setOpen(true);
  }
  function openEdit(d: Diagnosis) {
    setEditing(d);
    setForm({ name: d.name, service_code: d.service_code ?? '', active: d.active, sort_order: d.sort_order });
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

  // ── 폴더 CRUD (AC-3) ──
  async function handleCreateRoot() {
    if (!newRootName.trim()) return toast.error('폴더 이름을 입력해주세요.');
    if (folders.some((f) => f.parent_id === null && f.name.trim() === newRootName.trim())) {
      return toast.error('이미 있는 폴더 이름이에요.');
    }
    try {
      const max = Math.max(0, ...folders.filter((f) => f.parent_id === null).map((f) => f.sort_order ?? 0));
      await createFolder.mutateAsync({ name: newRootName.trim(), parent_id: null, sort_order: max + 10 });
      setNewRootName('');
      toast.success('폴더가 추가됐어요.');
    } catch (e) {
      toast.error(`폴더 추가 실패: ${(e as Error).message}`);
    }
  }

  async function handleAddChild(parentId: string) {
    const name = window.prompt('하위 폴더 이름');
    if (!name?.trim()) return;
    const siblings = folders.filter((f) => f.parent_id === parentId);
    if (siblings.some((f) => f.name.trim() === name.trim())) {
      return toast.error('같은 위치에 같은 이름의 폴더가 이미 있어요.');
    }
    try {
      const max = Math.max(0, ...siblings.map((f) => f.sort_order ?? 0));
      await createFolder.mutateAsync({ name: name.trim(), parent_id: parentId, sort_order: max + 10 });
      toast.success('하위 폴더가 추가됐어요.');
    } catch (e) {
      toast.error(`하위 폴더 추가 실패: ${(e as Error).message}`);
    }
  }

  function startRename(node: DiagnosisFolderNode) {
    if (!canManage) return;
    setEditingId(node.id);
    setEditValue(node.name);
  }
  function cancelRename() {
    setEditingId(null);
    setEditValue('');
  }
  async function submitRename(node: DiagnosisFolderNode) {
    const next = editValue.trim();
    if (!next) return toast.error('폴더 이름을 입력해주세요.'); // 빈이름 차단
    if (next === node.name) return cancelRename(); // 변경 없음
    // 형제 중복 차단 (소속 항목 FK 는 그대로, name 만 변경)
    if (folders.some((f) => f.id !== node.id && f.parent_id === node.parent_id && f.name.trim() === next)) {
      return toast.error('같은 위치에 같은 이름의 폴더가 이미 있어요.');
    }
    try {
      await updateFolder.mutateAsync({ id: node.id, name: next });
      toast.success('폴더 이름을 바꿨어요.');
      cancelRename();
    } catch (e) {
      toast.error(`폴더 이름 변경 실패: ${(e as Error).message}`);
    }
  }

  async function handleDeleteFolder(node: DiagnosisFolderNode) {
    const itemCount = countOf(node.id);
    const childCount = node.children.length;
    const warn =
      childCount > 0 || itemCount > 0
        ? `\n하위 폴더 ${childCount}개 · 소속 상병 ${itemCount}개의 분류가 함께 해제됩니다(상병 자체는 보존 → 미분류).`
        : '';
    if (!window.confirm(`"${node.name}" 폴더를 삭제할까요?${warn}`)) return;
    try {
      await deleteFolder.mutateAsync(node.id);
      if (selectedKey === node.id) setSelectedKey(UNASSIGNED);
      toast.success('폴더가 삭제됐어요.');
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    }
  }

  // 형제 폴더 sort_order 순(트리 빌더와 동일 규칙)
  const siblingsAt = (parentId: string | null): DiagnosisFolderNode[] => {
    const flat = folders
      .filter((f) => (f.parent_id ?? null) === parentId)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'));
    // FolderNode 형태로 감싸지 않고 DiagnosisFolder 만 필요 — 여기선 순서 계산용.
    return flat.map((f) => ({ ...f, children: [], depth: 0 }));
  };

  // 순서 ▲▼ — 형제 내 인접 폴더와 sort_order 교체 (AC-3)
  async function handleMoveFolder(node: DiagnosisFolderNode, dir: -1 | 1) {
    if (!canManage) return;
    const sibs = siblingsAt(node.parent_id ?? null);
    const idx = sibs.findIndex((s) => s.id === node.id);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sibs.length) return;
    const a = sibs[idx];
    const b = sibs[swapIdx];
    try {
      await Promise.all([
        updateFolder.mutateAsync({ id: a.id, sort_order: b.sort_order }),
        updateFolder.mutateAsync({ id: b.id, sort_order: a.sort_order }),
      ]);
    } catch (e) {
      toast.error(`순서 변경 실패: ${(e as Error).message}`);
    }
  }

  // ── DnD: 우측 항목 → 좌측 폴더 배치 (AC-2) ──
  function handleDragStart(e: DragStartEvent) {
    setActiveDx(items.find((d) => d.id === String(e.active.id)) ?? null);
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveDx(null);
    const { active, over } = e;
    if (!over || !canManage) return;
    const serviceId = String(active.id);
    const overKey = String(over.id);
    const targetFolderId = overKey === UNASSIGNED ? null : overKey;
    const item = items.find((d) => d.id === serviceId);
    if (!item) return;
    if ((item.diagnosis_folder_id ?? null) === targetFolderId) return; // 변화 없음
    const targetName = targetFolderId ? folders.find((f) => f.id === targetFolderId)?.name ?? '폴더' : NO_FOLDER;
    assign.mutate(
      { service_id: serviceId, folder_id: targetFolderId },
      {
        onSuccess: () => toast.success(`"${item.name}" → ${targetName}`, { duration: 1500 }),
        onError: (err: Error) => toast.error(`이동 실패: ${err.message}`),
      },
    );
  }

  if (isLoading || foldersLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  const rootNodes = tree;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{items.length}개 상병명 · {folders.length}개 폴더</span>
          {canManage && (
            <Button size="sm" variant="outline" onClick={openAdd} data-testid="dx-add-btn">
              <Plus className="h-3.5 w-3.5 mr-1" />
              상병명 추가
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          왼쪽에서 폴더를 만들고, 오른쪽 상병명을 왼쪽 폴더로 끌어다 놓아 분류하세요.
          {!canManage && ' (읽기 전용 — 폴더 관리 권한이 없습니다.)'}
        </p>

        {/* 2패널 (AC-1): 좌 = 폴더관리 / 우 = 상병항목 */}
        <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start">
          {/* ── 좌측: 폴더관리 ── */}
          <aside
            className="rounded-lg border bg-muted/20 p-2 md:max-h-[72vh] md:overflow-y-auto space-y-2"
            data-testid="dx-folder-tree"
          >
            <div className="px-1 pt-0.5 text-[11px] font-semibold text-muted-foreground">폴더</div>

            {/* 새 루트 폴더 (AC-3 생성) */}
            {canManage && (
              <div className="flex items-center gap-1.5 px-0.5">
                <Input
                  value={newRootName}
                  onChange={(e) => setNewRootName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateRoot()}
                  placeholder="새 폴더 이름"
                  className="h-8 text-xs"
                  data-testid="dx-folder-new-root-input"
                />
                <Button
                  size="sm" variant="outline"
                  className="h-8 shrink-0 gap-1"
                  onClick={handleCreateRoot} disabled={createFolder.isPending}
                  data-testid="dx-folder-add-btn"
                >
                  <Plus className="h-3.5 w-3.5" /> 폴더
                </Button>
              </div>
            )}

            {/* 미분류 버킷 (AC-4) — 항상 표시, drop 가능 */}
            <UnassignedBucket
              count={unassignedCount}
              selected={selectedKey === UNASSIGNED}
              onSelect={() => setSelectedKey(UNASSIGNED)}
            />

            {/* 폴더 트리 */}
            {rootNodes.length === 0 ? (
              <div
                className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
                data-testid="dx-folder-empty"
              >
                폴더 없음{canManage ? ' — 위에서 첫 폴더를 만드세요.' : ''}
              </div>
            ) : (
              <div className="space-y-0.5" data-testid="dx-folder-list">
                {rootNodes.map((node, i) => (
                  <FolderNode
                    key={node.id}
                    node={node}
                    count={countOf(node.id)}
                    selectedKey={selectedKey}
                    canManage={canManage}
                    isFirst={i === 0}
                    isLast={i === rootNodes.length - 1}
                    editingId={editingId}
                    editValue={editValue}
                    renamePending={updateFolder.isPending}
                    movePending={updateFolder.isPending}
                    onSelect={setSelectedKey}
                    onStartRename={startRename}
                    onEditChange={setEditValue}
                    onRenameSubmit={submitRename}
                    onRenameCancel={cancelRename}
                    onAddChild={handleAddChild}
                    onDelete={handleDeleteFolder}
                    onMove={handleMoveFolder}
                    countOf={countOf}
                  />
                ))}
              </div>
            )}
          </aside>

          {/* ── 우측: 선택 폴더의 상병 목록 (AC-5) ── */}
          <div className="min-w-0" data-testid="dx-list">
            <div className="flex items-center gap-1.5 px-1 mb-2">
              {selectedKey === UNASSIGNED ? (
                <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
              )}
              <span className="text-xs font-semibold text-foreground">
                {selectedKey === UNASSIGNED ? NO_FOLDER : selectedFolder?.name ?? '폴더'}
              </span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{visibleItems.length}</Badge>
            </div>

            {visibleItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? '등록된 상병명이 없습니다.'
                  : selectedKey === UNASSIGNED
                    ? '미분류 상병명이 없습니다.'
                    : '이 폴더에 분류된 상병명이 없습니다. 오른쪽 상병을 끌어다 놓으세요.'}
              </div>
            ) : (
              <div className="space-y-1.5" data-testid="dx-folder-items">
                {visibleItems.map((d) => (
                  <DraggableDxItem
                    key={d.id}
                    d={d}
                    canManage={canManage}
                    delPending={del.isPending}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 추가/편집 다이얼로그 — 폴더 필드 제거(AC-2). 배치는 드래그앤드롭. */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? '상병명 수정' : '상병명 추가'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
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
              {/* AC-2: 폴더(분류) 입력 필드 제거 — 등록 후 좌측 폴더로 드래그앤드롭 배치. */}
              <p className="text-[11px] text-muted-foreground">
                {editing
                  ? '폴더 분류는 목록에서 왼쪽 폴더로 끌어다 옮기세요.'
                  : '등록하면 "미분류"에 추가됩니다. 왼쪽 폴더로 끌어다 분류하세요.'}
              </p>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
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

      {/* 드래그 중 시각 피드백 */}
      <DragOverlay>
        {activeDx ? (
          <div className="rounded-lg border bg-card px-4 py-2.5 shadow-lg flex items-center gap-2 opacity-90">
            <GripVertical className="h-4 w-4 text-muted-foreground/60" />
            <span className="text-sm font-medium">{activeDx.name}</span>
            {activeDx.service_code && (
              <Badge variant="outline" className="text-[10px] py-0 font-mono">{activeDx.service_code}</Badge>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
