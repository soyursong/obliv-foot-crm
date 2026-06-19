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

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { canEditClinicMgmt } from '@/lib/permissions';
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
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
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useDiagnosisFolders,
  buildDiagnosisFolderTree,
  useCreateDiagnosisFolder,
  useUpdateDiagnosisFolder,
  useDeleteDiagnosisFolder,
  useAssignDiagnosisToFolder,
  useReorderDiagnoses,
  type DiagnosisFolderNode,
} from '@/lib/diagnosisFolders';
import {
  normalizeServiceCode,
  isDuplicateDiagnosisName,
  isDuplicateServiceCode,
} from '@/lib/diagnosisCode';
import {
  loadKcdBundle,
  searchKcd,
  type KcdSearchResult,
} from '@/lib/kcd/kcdSearch';

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

// T-20260609-foot-DXMGMT-NEST-BUNDLE-FOLDER AC-3:
//   좌측 첫 노드 = "미분류" → "전체목록" 으로 격상. 클릭 시 폴더 소속 무관 전체 상병 노출.
//   드롭 시맨틱은 보존(전체목록으로 끌어다 놓으면 폴더 배정 해제 = 미분류 환원).
const ALL_LABEL = '전체목록';
// 좌측 "전체목록" 노드의 droppable/select 키 (uuid 와 충돌 없는 sentinel)
const ALL_KEY = '__all__';

// 상병 관리(CRUD)·폴더 관리·배치 권한 = 진료관리 write 권한(director+admin).
//   T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 진료관리 write 를 director+admin 로 통일
//   (manager 제거 = 노출 축소). 상병 테이블(services) RLS write 는 旣존 {director,manager,admin} 이라
//   director 무회귀 + manager FE-제거는 FE-stricter(안전). → 공통 헬퍼 canEditClinicMgmt 재사용.

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
        // AC-1: trim + 소문자→대문자 정규화 후 저장(빈 코드는 null 유지).
        service_code: normalizeServiceCode(form.service_code) || null,
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
// 우측: 상병 항목 행
//   드래그 2종(단일 핸들):
//     ① 좌측 폴더로 끌어 배치 (AC-2, useDraggable — 항상 가능)
//     ② 폴더 내 위/아래 순서변경 (T-...-DIAGNAMES-FOLDER-ITEM-REORDER, useSortable —
//        폴더 선택 + 추가순 오름차순일 때만. 그 외엔 ①만 동작)
//   표현부(DxItemView)는 공유, dnd wiring(ref/style/handle)만 두 변형이 주입.
// ---------------------------------------------------------------------------
interface DxItemViewProps {
  d: Diagnosis;
  canManage: boolean;
  delPending: boolean;
  onEdit: (d: Diagnosis) => void;
  onDelete: (id: string, name: string) => void;
  // dnd wiring (변형이 주입)
  setNodeRef: (el: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleAttributes: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleListeners: Record<string, any> | undefined;
  reorderable: boolean; // true면 핸들 안내문구 = 순서변경 포함
}

function DxItemView({
  d, canManage, delPending, onEdit, onDelete,
  setNodeRef, style, isDragging, handleAttributes, handleListeners, reorderable,
}: DxItemViewProps) {
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-card px-4 py-2.5 flex items-center justify-between ${isDragging ? 'shadow-md' : ''}`}
      data-testid="dx-item"
      data-dx-id={d.id}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 드래그 핸들 — 관리권한 전용, touch-none(태블릿 탭 오인식 방지) */}
        {canManage && (
          <button
            {...handleAttributes}
            {...handleListeners}
            type="button"
            tabIndex={-1}
            className="flex items-center justify-center min-w-[28px] min-h-[28px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title={reorderable ? '드래그: 위/아래 순서변경 또는 왼쪽 폴더로 옮기기' : '드래그하여 왼쪽 폴더로 옮기기'}
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
        {/* 6FIX AC-5: 미폴더(미분류) 항목 — 아주 약하게만 표기(강조 없음). */}
        {!d.diagnosis_folder_id && (
          <span className="text-[9px] text-muted-foreground/40 shrink-0" data-testid="dx-unfoldered-hint">미분류</span>
        )}
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

type DxItemWrapProps = Omit<
  DxItemViewProps,
  'setNodeRef' | 'style' | 'isDragging' | 'handleAttributes' | 'handleListeners' | 'reorderable'
>;

// 변형 ① 폴더 배치 전용 (전체목록 뷰 · 비-추가순 정렬에서 사용). 기존 동작 보존.
function DraggableDxItem(props: DxItemWrapProps) {
  const { d, canManage } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: d.id,
    disabled: !canManage,
  });
  return (
    <DxItemView
      {...props}
      setNodeRef={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 30 : undefined,
      }}
      isDragging={isDragging}
      handleAttributes={attributes}
      handleListeners={listeners}
      reorderable={false}
    />
  );
}

// 변형 ② 폴더 내 순서변경 + 폴더 배치 (폴더 선택 + 추가순 오름차순일 때). useSortable.
function SortableDxItem(props: DxItemWrapProps) {
  const { d, canManage } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    disabled: !canManage,
  });
  return (
    <DxItemView
      {...props}
      setNodeRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 30 : undefined,
      }}
      isDragging={isDragging}
      handleAttributes={attributes}
      handleListeners={listeners}
      reorderable
    />
  );
}

// ---------------------------------------------------------------------------
// 좌측: "전체목록" 노드 (AC-3) — 클릭 시 전체 상병 노출. drop 가능(폴더 배정 해제 = 미분류 환원).
// ---------------------------------------------------------------------------
function AllItemsBucket({
  count,
  selected,
  onSelect,
}: {
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ALL_KEY });
  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-1.5 rounded-md px-2 py-2 cursor-pointer select-none border ${
        selected ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-200 border-teal-200' : 'border-transparent hover:bg-muted/60'
      } ${isOver ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
      data-testid="dx-folder-node"
      data-folder-id={ALL_KEY}
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
      {/* AC-1: 폴더명 표시폭 확대(text-[13px]) · AC-2: 건수 괄호 인라인 텍스트 */}
      <span className="text-[13px] font-semibold truncate flex-1" data-testid="dx-folder-name">{ALL_LABEL}</span>
      <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums" data-testid="dx-folder-count">({count})</span>
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
        {/* AC-1: 폴더명 표시폭 확대(text-[13px], 패널 280px) · AC-2: 건수 괄호 인라인 텍스트(버튼형 배지 제거) */}
        <span className="text-[13px] font-semibold truncate flex-1" data-testid="dx-folder-name">{node.name}</span>
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
        {/* 6FIX AC-6: 괄호 건수를 관리버튼 뒤(맨 우측)로 이동 → 항상 우측 끝 정렬. 전체목록과 동일 정렬감. */}
        <span className="ml-auto text-[11px] text-muted-foreground shrink-0 tabular-nums text-right" data-testid="dx-folder-count">({count})</span>
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
// KCD 검색·클릭 입력 (AC-1) — 자유타이핑 제거. 번들 검색 → 후보 클릭 → 코드+명칭 확정.
//   T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN. dynamic import 번들, 신규 의존성 0.
//   드롭다운 = Dialog 내부 absolute 위치(팝오버 lib 불요).
// ---------------------------------------------------------------------------
interface SelectedKcd {
  code: string;
  name: string;
}

function KcdComboBox({
  value,
  onSelect,
  autoFocus,
}: {
  value: SelectedKcd | null;
  onSelect: (sel: SelectedKcd) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KcdSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [openList, setOpenList] = useState(false);

  // 번들 1회 로드(탭/다이얼로그 진입 시). dynamic import → 코드 스플릿.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadKcdBundle()
      .then(() => alive && setLoading(false))
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    setResults(searchKcd(query, 30));
  }, [query, loading]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenList(true);
          }}
          onFocus={() => setOpenList(true)}
          autoFocus={autoFocus}
          placeholder={loading ? 'KCD 목록 불러오는 중…' : 'KCD 코드 또는 상병명 검색 (예: M72.2, 족저근막염)'}
          disabled={loading}
          className="pl-8"
          data-testid="dx-kcd-search"
          autoComplete="off"
        />
      </div>

      {/* 선택된 KCD 표기 */}
      {value && (
        <div
          className="mt-2 flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2"
          data-testid="dx-kcd-selected"
        >
          <Check className="h-4 w-4 text-teal-600 shrink-0" />
          <Badge variant="outline" className="text-[11px] py-0 font-mono shrink-0">{value.code || '코드없음'}</Badge>
          <span className="text-sm font-medium text-teal-900 truncate">{value.name}</span>
        </div>
      )}

      {/* 후보 드롭다운 — Dialog 내부 absolute */}
      {openList && query.trim() && !loading && (
        <div
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg"
          data-testid="dx-kcd-results"
        >
          {results.length === 0 ? (
            <div
              className="px-3 py-3 text-xs text-muted-foreground"
              data-testid="dx-kcd-empty"
            >
              검색 결과가 없어요. KCD 목록에 있는 코드/상병명만 추가할 수 있어요.
            </div>
          ) : (
            results.map((r) => (
              <button
                key={`${r.code}-${r.name}`}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 border-b last:border-b-0"
                data-testid="dx-kcd-option"
                data-code={r.code}
                onClick={() => {
                  onSelect({ code: r.code, name: r.name });
                  setQuery('');
                  setOpenList(false);
                }}
              >
                <Badge variant="outline" className="text-[10px] py-0 font-mono shrink-0">{r.code}</Badge>
                <span className="text-sm truncate">{r.name}</span>
              </button>
            ))
          )}
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
  // T-20260619-foot-ROLE-MATRIX-3TIER-RBAC: profile 전달(has_ops_authority 반영).
  const canManage = canEditClinicMgmt(profile);

  const { data: items = [], isLoading } = useDiagnoses(clinicId);
  const { data: folders = [], isLoading: foldersLoading } = useDiagnosisFolders(clinicId);
  const upsert = useUpsertDx(clinicId);
  const del = useDeleteDx();
  const createFolder = useCreateDiagnosisFolder(clinicId);
  const updateFolder = useUpdateDiagnosisFolder();
  const deleteFolder = useDeleteDiagnosisFolder();
  const assign = useAssignDiagnosisToFolder();
  const reorder = useReorderDiagnoses(clinicId);

  // 항목 등록/수정 다이얼로그
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Diagnosis | null>(null);
  const [form, setForm] = useState<DxForm>(EMPTY_FORM);
  // AC-1: KCD 검색클릭 선택값(코드+명칭). 자유타이핑 폼 입력 대체.
  const [selectedKcd, setSelectedKcd] = useState<SelectedKcd | null>(null);
  // 인라인 검증 에러 (AC-2 코드 중복 / AC-3 이름 중복)
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // 좌측 선택(폴더 id 또는 ALL_KEY). 기본 = 미분류.
  const [selectedKey, setSelectedKey] = useState<string>(ALL_KEY);
  // 폴더 인라인 rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // 새 루트 폴더
  const [newRootName, setNewRootName] = useState('');
  // DnD overlay 라벨
  const [activeDx, setActiveDx] = useState<Diagnosis | null>(null);

  // 6FIX AC-4: 전체목록(우측) 정렬 — 가나다순(name) / 추가순(added=sort_order) × 오름/내림.
  //   기본 = 추가순 오름차순(종전 동작 보존: useDiagnoses 가 sort_order asc 로 적재).
  //   추가순은 sort_order(신규 등록 시 max+10 누적)를 등록순 프록시로 사용 — 신규 컬럼 없음(DB无변경).
  const [dxSortBy, setDxSortBy] = useState<'name' | 'added'>('added');
  const [dxSortDir, setDxSortDir] = useState<'asc' | 'desc'>('asc');

  // DnD sensors (태블릿 터치 호환)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const tree = useMemo(() => buildDiagnosisFolderTree(folders), [folders]);

  // 폴더별 항목 수 (좌측 트리 괄호 건수). 전체목록 건수는 items.length 직접 사용.
  const countByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of items) {
      if (d.diagnosis_folder_id) map.set(d.diagnosis_folder_id, (map.get(d.diagnosis_folder_id) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const countOf = (folderId: string) => countByFolder.get(folderId) ?? 0;

  // 좌측 드롭존(폴더 노드 + 전체목록) id 집합 — reorderActive 충돌판정에서 제외용.
  //   T-...-DIAGNAMES-REORDER-FOLDER-CAPTURE: 우측 항목 수직 드래그 시 좌측 280px 폴더 패널이
  //   closestCenter 로 "가장 가까운 드롭 대상"으로 오판되는 회귀 차단.
  const folderIdSet = useMemo(
    () => new Set<string>([ALL_KEY, ...folders.map((f) => f.id)]),
    [folders],
  );

  // 선택 폴더 키가 유효한지 보정(삭제된 폴더 → 미분류로 환원)
  useEffect(() => {
    if (selectedKey === ALL_KEY) return;
    if (!folders.some((f) => f.id === selectedKey)) setSelectedKey(ALL_KEY);
  }, [folders, selectedKey]);

  // 우측 목록 — 선택 폴더 소속 항목. AC-3: 전체목록(ALL_KEY) 선택 시 폴더 소속 무관 전체 노출.
  //   6FIX AC-4: 정렬 적용(가나다/추가순 × asc/desc). 원본 items 불변(복사본 정렬).
  const visibleItems = useMemo(() => {
    const base = selectedKey === ALL_KEY ? items : items.filter((d) => d.diagnosis_folder_id === selectedKey);
    const dir = dxSortDir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const cmp = dxSortBy === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'ko');
      return cmp * dir;
    });
  }, [items, selectedKey, dxSortBy, dxSortDir]);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedKey) ?? null,
    [folders, selectedKey],
  );

  // 폴더 내 순서변경(드래그) 활성 조건 (T-...-DIAGNAMES-FOLDER-ITEM-REORDER):
  //   특정 폴더 선택 + 추가순 오름차순(= sort_order 정본 순서 = 화면순서) + 관리권한.
  //   AC-4 별 트랙: 전체목록(ALL)·가나다순·내림차순에서는 순서변경 비활성(폴더 배치 드래그만).
  //     ↳ 화면순서가 sort_order 와 단조 일치하지 않으면 재번호가 왜곡되므로 정본 순서에서만 허용.
  const reorderActive =
    canManage && selectedKey !== ALL_KEY && dxSortBy === 'added' && dxSortDir === 'asc';

  // 충돌판정 — reorderActive(폴더 내 순서변경) 시에는 좌측 폴더/전체목록 droppable 을 후보에서
  //   제외하고 우측 sortable 항목끼리만 closestCenter 평가. 비-reorder(폴더 배치) 시에는 원본
  //   closestCenter 그대로(AC-3 회귀가드). T-...-DIAGNAMES-REORDER-FOLDER-CAPTURE.
  const dxCollisionDetection = useCallback(
    (args: Parameters<typeof closestCenter>[0]) => {
      if (reorderActive) {
        const filtered = {
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => !folderIdSet.has(String(c.id)),
          ),
        };
        return closestCenter(filtered);
      }
      return closestCenter(args);
    },
    [reorderActive, folderIdSet],
  );

  function nextSortOrder() {
    return items.length === 0 ? 0 : Math.max(...items.map((d) => d.sort_order ?? 0)) + 10;
  }

  // ── 항목 CRUD ──
  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sort_order: nextSortOrder() });
    setSelectedKcd(null); // 신규 = 반드시 KCD 검색클릭으로 선택
    setCodeError(null);
    setNameError(null);
    setOpen(true);
  }
  function openEdit(d: Diagnosis) {
    setEditing(d);
    setForm({ name: d.name, service_code: d.service_code ?? '', active: d.active, sort_order: d.sort_order });
    // 수정 = 기존 코드+명칭을 선택값으로 프리필(레거시 비-KCD 데이터도 보존, 강제 재선택 없음 = AC-4).
    setSelectedKcd({ code: d.service_code ?? '', name: d.name });
    setCodeError(null);
    setNameError(null);
    setOpen(true);
  }
  async function handleSave() {
    // AC-1: 자유타이핑 제거 → KCD 검색클릭 선택 필수.
    if (!selectedKcd || !selectedKcd.name.trim()) {
      setNameError('KCD 목록에서 상병을 검색해 선택해주세요.');
      return;
    }
    const name = selectedKcd.name.trim();
    const code = normalizeServiceCode(selectedKcd.code) || null;

    // AC-2: 코드 중복 차단(clinic 전체, dotless/dotted 동치). 이름 달라도 코드 같으면 불가.
    if (code && isDuplicateServiceCode(items, code, editing?.id)) {
      setCodeError(`이미 등록된 코드예요 (${code})`);
      return;
    }
    // AC-3: 같은 폴더(미분류 포함) 내 상병명 중복 차단. 신규=미분류(NULL), 수정=기존 폴더 유지.
    const targetFolder = editing ? (editing.diagnosis_folder_id ?? null) : null;
    if (isDuplicateDiagnosisName(items, name, targetFolder, editing?.id)) {
      setNameError('이미 등록된 상병명이에요.');
      return;
    }

    await upsert.mutateAsync({
      id: editing?.id,
      form: { ...form, name, service_code: code ?? '' },
    });
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
      if (selectedKey === node.id) setSelectedKey(ALL_KEY);
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
    if (serviceId === overKey) return; // 제자리

    const item = items.find((d) => d.id === serviceId);
    if (!item) return;

    // 드롭 대상이 다른 상병 항목 → 폴더 내 순서변경(reorder). 폴더 노드/전체목록이 아닐 때만.
    const isItemTarget = overKey !== ALL_KEY && items.some((d) => d.id === overKey);
    if (isItemTarget) {
      if (reorderActive) handleReorder(serviceId, overKey);
      return;
    }

    // 드롭 대상이 폴더 노드/전체목록 → 폴더 배치(이동/해제). 기존 동작(AC-2 별건) 보존.
    const targetFolderId = overKey === ALL_KEY ? null : overKey;
    if ((item.diagnosis_folder_id ?? null) === targetFolderId) return; // 변화 없음
    // AC-3: 전체목록(null) 드롭 = 폴더 분류 해제. 폴더 드롭 = 해당 폴더로 이동.
    const okMsg = targetFolderId
      ? `"${item.name}" → ${folders.find((f) => f.id === targetFolderId)?.name ?? '폴더'}`
      : `"${item.name}" 폴더 분류 해제`;
    assign.mutate(
      { service_id: serviceId, folder_id: targetFolderId },
      {
        onSuccess: () => toast.success(okMsg, { duration: 1500 }),
        onError: (err: Error) => toast.error(`이동 실패: ${err.message}`),
      },
    );
  }

  // 폴더 내 항목 순서변경 — 현재 폴더의 가시 항목(추가순 asc = 정본 순서)을 arrayMove 후
  //   0,10,20… 으로 재번호. 값이 바뀐 항목만 services.sort_order PATCH (AC-2/AC-3/AC-5).
  function handleReorder(activeId: string, overId: string) {
    const ids = visibleItems.map((d) => d.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from === -1 || to === -1 || from === to) return;
    const reordered = arrayMove(visibleItems, from, to);
    const updates = reordered
      .map((d, idx) => ({ id: d.id, sort_order: idx * 10, prev: d.sort_order ?? null }))
      .filter((u) => u.prev !== u.sort_order)
      .map(({ id, sort_order }) => ({ id, sort_order }));
    if (updates.length === 0) return;
    reorder.mutate(updates, {
      onError: (err: Error) => toast.error(`순서 변경 실패: ${err.message}`),
    });
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
      collisionDetection={dxCollisionDetection}
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

        {/* 2패널: 좌 = 폴더관리 / 우 = 상병항목. AC-1: 좌측 폴더 패널 240→280px(폴더명 잘림 해소) */}
        <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
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

            {/* 전체목록 노드 (AC-3) — 항상 최상단, 전체 상병 노출 + drop 시 분류 해제. 건수=전체 */}
            <AllItemsBucket
              count={items.length}
              selected={selectedKey === ALL_KEY}
              onSelect={() => setSelectedKey(ALL_KEY)}
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
              {selectedKey === ALL_KEY ? (
                <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
              )}
              <span className="text-xs font-semibold text-foreground">
                {selectedKey === ALL_KEY ? ALL_LABEL : selectedFolder?.name ?? '폴더'}
              </span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{visibleItems.length}</Badge>

              {/* 6FIX AC-4: 정렬 컨트롤 — 가나다순/추가순 토글 + 오름/내림 토글 */}
              <div className="ml-auto flex items-center gap-1" data-testid="dx-sort-controls">
                <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
                <button
                  type="button"
                  onClick={() => setDxSortBy((p) => (p === 'name' ? 'added' : 'name'))}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                  data-testid="dx-sort-by"
                  title="정렬 기준 전환"
                >
                  {dxSortBy === 'name' ? '가나다순' : '추가순'}
                </button>
                <button
                  type="button"
                  onClick={() => setDxSortDir((p) => (p === 'asc' ? 'desc' : 'asc'))}
                  className="inline-flex items-center rounded border border-border bg-background p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  data-testid="dx-sort-dir"
                  title={dxSortDir === 'asc' ? '오름차순 (클릭 시 내림차순)' : '내림차순 (클릭 시 오름차순)'}
                  aria-label={dxSortDir === 'asc' ? '오름차순' : '내림차순'}
                >
                  {dxSortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* 폴더 내 순서변경 안내 (AC-1) — 특정 폴더 + 관리권한 + 항목 있을 때만 */}
            {canManage && selectedKey !== ALL_KEY && visibleItems.length > 0 && (
              reorderActive ? (
                <p className="px-1 mb-2 text-[11px] text-teal-700" data-testid="dx-reorder-hint">
                  손잡이(⋮⋮)를 잡고 위/아래로 끌면 이 폴더 안에서 순서가 바뀝니다.
                </p>
              ) : (
                <p className="px-1 mb-2 text-[11px] text-muted-foreground" data-testid="dx-reorder-hint-disabled">
                  순서를 바꾸려면 정렬을 ‘추가순 · 오름차순(↑)’으로 두세요.
                </p>
              )
            )}

            {visibleItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? '등록된 상병명이 없습니다.'
                  : selectedKey === ALL_KEY
                    ? '등록된 상병명이 없습니다.'
                    : '이 폴더에 분류된 상병명이 없습니다. 전체목록에서 상병을 끌어다 놓으세요.'}
              </div>
            ) : reorderActive ? (
              // 폴더 선택 + 추가순 오름차순 → 폴더 내 드래그 순서변경 활성 (AC-1)
              <SortableContext
                items={visibleItems.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5" data-testid="dx-folder-items" data-reorderable="true">
                  {visibleItems.map((d) => (
                    <SortableDxItem
                      key={d.id}
                      d={d}
                      canManage={canManage}
                      delPending={del.isPending}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            ) : (
              // 전체목록/가나다순/내림차순 → 폴더 배치 드래그만(순서변경 비활성). 기존 동작 보존.
              <div className="space-y-1.5" data-testid="dx-folder-items" data-reorderable="false">
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
              {/* AC-1: 자유타이핑 제거 → KCD 공식목록 검색 + 클릭 선택. */}
              <div>
                <Label className="text-xs">상병 (KCD 검색) *</Label>
                <div className="mt-1">
                  <KcdComboBox
                    value={selectedKcd}
                    autoFocus={!editing}
                    onSelect={(sel) => {
                      setSelectedKcd(sel);
                      setNameError(null);
                      setCodeError(null);
                    }}
                  />
                </div>
                {codeError && (
                  <p className="mt-1 text-[11px] text-destructive" data-testid="dx-code-error">{codeError}</p>
                )}
                {nameError && (
                  <p className="mt-1 text-[11px] text-destructive" data-testid="dx-name-error">{nameError}</p>
                )}
              </div>
              {/* AC-2: 폴더(분류) 입력 필드 제거 — 등록 후 좌측 폴더로 드래그앤드롭 배치. */}
              <p className="text-[11px] text-muted-foreground">
                {editing
                  ? 'KCD 목록에서 다시 검색해 선택하면 코드·명칭이 바뀝니다. 폴더 분류는 목록에서 왼쪽 폴더로 끌어다 옮기세요.'
                  : '등록하면 "미분류"에 추가됩니다. 왼쪽 폴더로 끌어다 분류하세요.'}
              </p>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
                <Label className="text-xs">활성화</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button onClick={handleSave} disabled={upsert.isPending || !selectedKcd} data-testid="dx-save-btn">
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
