// DrugFoldersTab — 약품 폴더 관리 (AC-R2)
// Ticket: T-20260606-foot-RX-SET-REDESIGN
//
// 현장 용어(AC-R6): "폴더" = 약 분류/탐색 도구. 어드민(관리권한 role)이 폴더 트리를 만들고
//   개별 약품(prescription_codes)을 폴더에 분류한다. 진료차트 '처방세트' 탭 좌측 탐색기에 동일 트리가 노출.
//   ※ "묶음처방"(prescription_sets, 슈퍼상용구성 약 묶음)과는 별개 관리 화면.
//
// 권한: 폴더·분류 CRUD = 관리권한 role 한정(현장 "어드민만 관리").
//   PrescriptionSetsTab 과 동일 집합(director/manager/admin) — 대표원장(director) 본인 관리 동선 보존.

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { canEditClinicMgmt } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
// T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: 급여여부 인라인 편집(우측 단) + HIRA 동기화(AC-5 이전처).
import InsuranceStatusPanel, { INSURANCE_STATUS_STYLE } from '@/components/admin/InsuranceStatusPanel';
import HiraInsuranceSyncPanel from '@/components/admin/HiraInsuranceSyncPanel';
// T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY: 처방세트 화면 안에 '묶음처방' 서브탭 적층.
//   묶음처방(prescription_sets) 좌측 전체 약 목록 + 묶음처방 추가 동선은 PrescriptionSetsTab(CREATE-FLOW-OVERHAUL 2-pane)이
//   이미 구현 — 신규 로직 0, 컴포넌트 재배치(재사용)만. 기존 top-level 묶음처방 탭(value=prescriptions)도 보존(삭제·치환 금지).
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
import { insuranceStatusLabel, type InsuranceStatus } from '@/lib/prescriptionGate';
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  useDrugFolders,
  useFolderDrugs,
  buildFolderTree,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useAssignDrugToFolder,
  useUnassignDrug,
  useUpdateDrugDescription,
  MIGRATED_CODE_TYPE,
  type DrugFolderNode,
  type FolderDrug,
} from '@/lib/drugFolders';

// T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 처방세트(폴더) 관리 write = director+admin.
//   manager 제거(축소). drug_folders RLS write 旣존 {director,manager,admin} → director 무회귀. canEditClinicMgmt 재사용.

interface RxCodeResult {
  id: string;
  name_ko: string;
  claim_code: string;
  classification: string | null;
  code_source: string;
}

// ---------------------------------------------------------------------------
// DrugRowMoreMenu — T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX (AC-3)
//   문지은 대표원장: 삭제(분류 해제) 버튼 직접노출 제거 → "…"(더보기) 버튼 뒤로 숨기고,
//   클릭 시 팝업으로 "삭제하기"를 한 번 더 확인한 뒤에만 실행.
//   PrescriptionSetsTab.RxSetKebabMenu(DELETE-KEBAB-GUARD) 동형 — 신규 패키지 없이
//   경량 인라인 popover(클릭 토글 + 바깥클릭/ESC 닫힘). 실제 삭제는 destructive "삭제하기"에서만.
// ---------------------------------------------------------------------------
function DrugRowMoreMenu({ onDelete, disabled }: { onDelete: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
        title="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="drug-folder-row-more-btn"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 min-w-[120px] overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          data-testid="drug-folder-row-more-menu"
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            data-testid="drug-folder-row-delete-action"
          >
            <Trash2 className="h-3.5 w-3.5" /> 삭제하기
          </button>
        </div>
      )}
    </div>
  );
}

export default function DrugFoldersTab() {
  const { profile } = useAuth();
  // T-20260619-foot-ROLE-MATRIX-3TIER-RBAC: profile 전달(has_ops_authority 반영). EDIT=대표원장(flag)·admin escape.
  const canEdit = canEditClinicMgmt(profile);
  // T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: 급여여부 편집 권한.
  //   T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 진료관리 write = director+admin 통일 방향.
  //   ★급여여부 RLS(is_admin_or_manager)에 director 부재 → FE 에서 director grant 시 저장이 RLS 거부됨.
  //   Phase A 는 노출 축소만(manager 제거 → admin-only). director 추가는 Phase B(AC-3 RLS, CONSULT GO 후) RLS 와 동시.
  const canManageInsurance = profile?.role === 'admin';
  const qc = useQueryClient();

  const { data: folders = [], isLoading: foldersLoading } = useDrugFolders();
  const { data: drugs = [], isLoading: drugsLoading } = useFolderDrugs();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const assignDrug = useAssignDrugToFolder();
  const unassignDrug = useUnassignDrug();
  // T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C): 약별 설명 인라인 저장.
  const updateDesc = useUpdateDrugDescription();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newRootName, setNewRootName] = useState('');
  const [drugQuery, setDrugQuery] = useState('');
  // 인라인 이름 변경(rename) — 형제 탭(DiagnosisNamesTab/PrescriptionSetsTab)과 동일 UX.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // T-20260617-foot-RXSET-VIEWALL-TABLE-MIGCLEAR — Part A/B
  //   §0.3 krhg 확정: 패널 상단 서브탭 [폴더 선택]/[전체보기] 분리. 폴더 뷰 동작 회귀 0.
  //   [전체보기] = 전 폴더 약 통합 테이블뷰 + 행 체크박스 다중선택 → 일괄 삭제
  //     (= 기존 단건 삭제 로직 useUnassignDrug 재사용 = 분류 해제, 약 마스터는 보존).
  // T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY: 'bundle'(묶음처방) 적층. 기본값 'folder' 유지(기존 동작 보존).
  const [subTab, setSubTab] = useState<'folder' | 'all' | 'bundle'>('folder');
  const [selectedDrugIds, setSelectedDrugIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE (AC-1): 전체보기 우측 단 급여여부 편집 대상(단건 선택).
  //   다중선택(selectedDrugIds=일괄삭제)와 직교 — 행의 약명 클릭 = 인라인 편집 패널 열기.
  const [insuranceSelectedId, setInsuranceSelectedId] = useState<string | null>(null);
  // T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C): '설명' 셀 더블클릭 인라인 에디터.
  //   editingDescId=편집 중인 약의 prescription_code_id, editDescValue=입력값. 폴더 rename 패턴 동형.
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [editDescValue, setEditDescValue] = useState('');

  const tree = buildFolderTree(folders);
  const drugsByFolder = new Map<string, FolderDrug[]>();
  for (const d of drugs) {
    if (!drugsByFolder.has(d.folder_id)) drugsByFolder.set(d.folder_id, []);
    drugsByFolder.get(d.folder_id)!.push(d);
  }
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null;

  // ── 약품 검색(폴더 배정용) — prescription_codes 카탈로그 ──────────────────────────
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['drug-folder-search', drugQuery],
    enabled: drugQuery.trim().length >= 1,
    queryFn: async (): Promise<RxCodeResult[]> => {
      const esc = drugQuery.trim().replace(/[%,]/g, ' ');
      const { data } = await supabase
        .from('prescription_codes')
        .select('id,name_ko,claim_code,classification,code_source')
        .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
        .order('code_source', { ascending: false })
        .limit(20);
      return (data ?? []) as RxCodeResult[];
    },
    staleTime: 10_000,
  });

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateRoot() {
    if (!newRootName.trim()) return toast.error('폴더 이름을 입력하세요.');
    try {
      await createFolder.mutateAsync({ name: newRootName, parent_id: null });
      setNewRootName('');
      toast.success('폴더가 추가됐어요.');
    } catch (e) {
      toast.error(`폴더 추가 실패: ${(e as Error).message}`);
    }
  }

  async function handleAddChild(parentId: string) {
    const name = window.prompt('하위 폴더 이름');
    if (!name?.trim()) return;
    try {
      await createFolder.mutateAsync({ name, parent_id: parentId });
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      toast.success('하위 폴더가 추가됐어요.');
    } catch (e) {
      toast.error(`하위 폴더 추가 실패: ${(e as Error).message}`);
    }
  }

  function startRename(node: DrugFolderNode) {
    if (!canEdit) return;
    setEditingId(node.id);
    setEditValue(node.name);
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue('');
  }

  async function submitRename(node: DrugFolderNode) {
    const next = editValue.trim();
    if (!next) return toast.error('폴더 이름을 입력하세요.'); // 빈이름 차단
    if (next === node.name) return cancelRename(); // 변경 없음
    // 같은 부모 아래 동일 이름 차단(형제 중복 방지). FK·소속 약품은 건드리지 않고 name 만 UPDATE.
    const dup = folders.some(
      (f) => f.id !== node.id && f.parent_id === node.parent_id && f.name.trim() === next,
    );
    if (dup) return toast.error('같은 위치에 같은 이름의 폴더가 이미 있어요.');
    try {
      await updateFolder.mutateAsync({ id: node.id, name: next });
      toast.success('폴더 이름이 변경됐어요.');
      cancelRename();
    } catch (e) {
      toast.error(`이름 변경 실패: ${(e as Error).message}`);
    }
  }

  async function handleDeleteFolder(node: DrugFolderNode) {
    const drugCount = (drugsByFolder.get(node.id) ?? []).length;
    const childCount = node.children.length;
    const warn =
      childCount > 0 || drugCount > 0
        ? `\n하위 폴더 ${childCount}개 · 분류된 약품 ${drugCount}개의 분류가 함께 해제됩니다(약품 자체는 보존).`
        : '';
    if (!window.confirm(`"${node.name}" 폴더를 삭제할까요?${warn}`)) return;
    try {
      await deleteFolder.mutateAsync(node.id);
      if (selectedFolderId === node.id) setSelectedFolderId(null);
      toast.success('폴더가 삭제됐어요.');
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    }
  }

  async function handleAssign(code: RxCodeResult) {
    if (!selectedFolderId) return toast.error('먼저 왼쪽에서 폴더를 선택하세요.');
    try {
      await assignDrug.mutateAsync({
        prescription_code_id: code.id,
        folder_id: selectedFolderId,
      });
      toast.success(`"${code.name_ko}" 분류됨`);
    } catch (e) {
      toast.error(`분류 실패: ${(e as Error).message}`);
    }
  }

  async function handleUnassign(d: FolderDrug) {
    try {
      await unassignDrug.mutateAsync(d.prescription_code_id);
      toast.success('분류가 해제됐어요.');
    } catch (e) {
      toast.error(`해제 실패: ${(e as Error).message}`);
    }
  }

  // ── Part B: 전체보기 다중선택 + 일괄 삭제 ───────────────────────────────────
  //   소속 폴더 이름 lookup (drug.folder_id → 폴더명).
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
  //   전체보기 행 = 폴더에 분류된 전체 약(prescription_code_folders ⋈ codes). 약명 가나다 정렬.
  const allDrugs = [...drugs].sort((a, b) => a.name_ko.localeCompare(b.name_ko, 'ko'));
  const allSelected = allDrugs.length > 0 && allDrugs.every((d) => selectedDrugIds.has(d.prescription_code_id));
  // INLINE-MERGE: 우측 급여여부 편집 대상 약(단건). 목록에서 사라지면(분류 해제 등) 자동 null 처리는 패널 조건부 렌더로 흡수.
  const insuranceSelectedDrug = insuranceSelectedId
    ? allDrugs.find((d) => d.prescription_code_id === insuranceSelectedId) ?? null
    : null;

  function toggleDrugSelect(id: string) {
    setSelectedDrugIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllDrugs() {
    setSelectedDrugIds((prev) =>
      allDrugs.length > 0 && allDrugs.every((d) => prev.has(d.prescription_code_id))
        ? new Set()
        : new Set(allDrugs.map((d) => d.prescription_code_id)),
    );
  }

  async function handleBulkDelete() {
    const ids = allDrugs
      .filter((d) => selectedDrugIds.has(d.prescription_code_id))
      .map((d) => d.prescription_code_id);
    if (ids.length === 0) return;
    // §0.3-3: 기존 단건 삭제 확인 패턴 재사용(handleDeleteFolder 동형 window.confirm).
    //   삭제 = 폴더 분류 해제. 약품(prescription_codes) 자체는 보존됨.
    if (!window.confirm(`선택한 ${ids.length}개 약품의 폴더 분류를 해제할까요?\n(약품 자체는 보존됩니다.)`)) return;
    setBulkDeleting(true);
    try {
      // 기존 단건 삭제 로직(useUnassignDrug) 그대로 재사용 — 신규 삭제 경로 만들지 않음(§0.3-3).
      await Promise.all(ids.map((id) => unassignDrug.mutateAsync(id)));
      setSelectedDrugIds(new Set());
      toast.success(`${ids.length}개 약품의 분류가 해제됐어요.`);
    } catch (e) {
      toast.error(`일괄 삭제 실패: ${(e as Error).message}`);
    } finally {
      setBulkDeleting(false);
    }
  }

  // 검증(verify) 버튼 = UI surface 만 제공(본 티켓 MIGCLEAR 범위).
  //   CORRECTION: "검증 action 의 의미·DML 은 MIGCLEAR 에서 구현하지 말 것. code_type 임의 UPDATE 금지."
  //   실제 검증 semantics/DML(태그 의미 그라운딩 + 정합 + 게이트)은 T-20260617-foot-RX-VALID-TAG-REMOVE
  //   정본 경로에서 단일 구현. 그 전까지 버튼은 표면만 노출하고 DML 을 수행하지 않는다(no-op 안내).
  function handleVerify(_d: FolderDrug) {
    toast.warning('검증 기능은 준비 중입니다.');
  }

  // ── Part C: 약별 '설명' 인라인 편집 ─────────────────────────────────────────
  //   더블클릭 → 인라인 입력 에디터(Enter 저장 / Esc 취소). 자유텍스트(빈 설명 허용=NULL).
  //   ※ reporter "더블클릭 하면 드롭다운" 표현은 자유텍스트 입력과 상충 → 인라인 입력 에디터로 해석(AC-2).
  function startEditDesc(d: FolderDrug) {
    if (!canEdit) return;
    setEditingDescId(d.prescription_code_id);
    setEditDescValue(d.description ?? '');
  }
  function cancelEditDesc() {
    setEditingDescId(null);
    setEditDescValue('');
  }
  async function submitDesc(d: FolderDrug) {
    const next = editDescValue.trim();
    if ((d.description ?? '') === next) return cancelEditDesc(); // 변경 없음
    try {
      await updateDesc.mutateAsync({ prescription_code_id: d.prescription_code_id, description: next });
      toast.success('설명이 저장됐어요.');
      cancelEditDesc();
    } catch (e) {
      toast.error(`설명 저장 실패: ${(e as Error).message}`);
    }
  }

  const renderNode = (node: DrugFolderNode) => {
    const isCollapsed = collapsed.has(node.id);
    const folderDrugs = drugsByFolder.get(node.id) ?? [];
    const isSelected = selectedFolderId === node.id;
    const isEditing = editingId === node.id;
    return (
      <div key={node.id} data-testid="drug-folder-admin-node">
        {isEditing ? (
          /* 인라인 편집 모드 — Enter 저장 / Esc 취소 / ✓✕ */
          <div
            className="flex items-center gap-1 rounded-md px-1 py-1 bg-teal-50 ring-1 ring-teal-300"
            style={{ marginLeft: `${node.depth * 14}px` }}
            data-testid="drug-folder-admin-node-editing"
          >
            <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitRename(node);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="h-7 text-xs px-1.5 flex-1 min-w-0"
              data-testid="drug-folder-rename-input"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-teal-600 hover:text-teal-700 shrink-0"
              title="저장"
              onClick={() => void submitRename(node)}
              disabled={updateFolder.isPending}
              data-testid="drug-folder-rename-save"
            >
              {updateFolder.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground shrink-0"
              title="취소"
              onClick={cancelRename}
              disabled={updateFolder.isPending}
              data-testid="drug-folder-rename-cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div
            className={`flex items-center gap-1 rounded-md px-1 py-1 ${isSelected ? 'bg-teal-50 border border-teal-300' : 'hover:bg-muted/50 border border-transparent'}`}
            style={{ marginLeft: `${node.depth * 14}px` }}
          >
            <button
              type="button"
              // DRUGFOLDER-COUNT-EMPTY: 펼침 화살표(chevron)는 "폴더 열기" 어포던스로 인식됨 →
              //   토글만 하고 폴더를 선택하지 않으면 우측 "약 목록" 패널이 안 떠서
              //   "숫자(배지)는 뜨는데 눌러보면 약이 안 뜸" 증상이 됨. 토글과 동시에 선택까지 수행해
              //   어느 버튼을 눌러도 담긴 약이 우측 목록으로 보이도록 보장(AC2).
              onClick={() => {
                toggleFolder(node.id);
                setSelectedFolderId(node.id);
              }}
              className="shrink-0 text-muted-foreground"
              data-testid="drug-folder-admin-toggle"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setSelectedFolderId(node.id)}
              onDoubleClick={() => startRename(node)}
              className="flex items-center gap-1.5 flex-1 text-left"
              data-testid="drug-folder-admin-select"
            >
              {isCollapsed ? (
                <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 text-teal-600 shrink-0" />
              )}
              <span className="text-xs font-medium truncate">{node.name}</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{folderDrugs.length}</Badge>
            </button>
            {canEdit && (
              <div className="flex items-center gap-0.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-6 w-6" title="하위 폴더 추가" onClick={() => handleAddChild(node.id)}>
                  <FolderPlus className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="이름 변경" onClick={() => startRename(node)} data-testid="drug-folder-rename-start">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="삭제" onClick={() => handleDeleteFolder(node)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
        {!isCollapsed && node.children.length > 0 && (
          <div className="mt-0.5 space-y-0.5">{node.children.map(renderNode)}</div>
        )}
      </div>
    );
  };

  if (foldersLoading || drugsLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-teal-700">처방세트</span> = 약을 분류·탐색하는 도구입니다.
        진료차트의 처방세트 탭 좌측 탐색기에 동일하게 나타납니다.
        (이름+약 묶음을 만드는 <span className="font-medium">묶음처방</span>은 별도 탭입니다.)
      </div>

      {!canEdit && (
        <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground text-center">
          읽기 전용 — 폴더 관리 권한이 없습니다.
        </div>
      )}

      {/* Part A (§0.3 krhg): 서브탭 [폴더 선택] / [전체보기] — 인라인 토글 아닌 화면 분리 */}
      <div className="flex items-center gap-1 border-b" data-testid="drug-folder-subtabs">
        <button
          type="button"
          onClick={() => setSubTab('folder')}
          className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
            subTab === 'folder'
              ? 'border-teal-500 text-teal-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="drug-folder-subtab-folder"
        >
          폴더 선택
        </button>
        <button
          type="button"
          onClick={() => setSubTab('all')}
          className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
            subTab === 'all'
              ? 'border-teal-500 text-teal-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="drug-folder-subtab-all"
        >
          전체보기
        </button>
        {/* T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY: '묶음처방' 서브탭 적층(기존 탭 보존).
            content = PrescriptionSetsTab(좌측 전체 약 목록+검색 → 묶음처방 추가). 신규 로직 없음. */}
        <button
          type="button"
          onClick={() => setSubTab('bundle')}
          className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 transition-colors ${
            subTab === 'bundle'
              ? 'border-teal-500 text-teal-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="drug-folder-subtab-bundle"
        >
          묶음처방
        </button>
      </div>

      {/* T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY: 묶음처방 서브탭 = PrescriptionSetsTab 재사용(재배치).
          좌측 전체 약 목록(검색)+약 선택→묶음처방 추가 동선이 그 컴포넌트에 이미 존재. subTab==='bundle'일 때만 마운트. */}
      {subTab === 'bundle' && (
        <div data-testid="drug-folder-bundle">
          <PrescriptionSetsTab />
        </div>
      )}

      {/* ── Part B: 전체보기 = 전 폴더 약 통합 테이블뷰 + 체크박스 다중 삭제 ───────────────────
          T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: 기존 미사용 우측 단을 활용해 2-pane 구성.
            좌측 = 약 통합 테이블(체크박스 다중삭제 + 급여여부 배지 컬럼), 약명 클릭 → 우측 단 급여여부 편집(인라인).
            급여여부 별도 탭(InsuranceStatusTab) 제거 → 본 우측 패널 + 하단 HIRA 동기화로 통합(AC-1/AC-5). */}
      {subTab === 'all' && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_340px] gap-4" data-testid="drug-folder-viewall">
          {/* 좌: 약 통합 테이블 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                전체 {allDrugs.length}개 약품 · 선택 {selectedDrugIds.size}건
              </span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1"
                  disabled={selectedDrugIds.size === 0 || bulkDeleting}
                  onClick={handleBulkDelete}
                  data-testid="drug-folder-viewall-bulk-delete"
                >
                  {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  선택 {selectedDrugIds.size}건 삭제
                </Button>
              )}
            </div>
            {canManageInsurance && (
              <p className="text-[10px] text-muted-foreground" data-testid="drug-folder-viewall-insurance-hint">
                약 이름을 클릭하면 오른쪽에서 급여여부를 바로 설정할 수 있어요.
              </p>
            )}
            <div className="rounded-lg border min-h-[120px] overflow-x-auto" data-testid="drug-folder-viewall-list">
              {allDrugs.length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-8">
                  폴더에 분류된 약품이 없습니다.
                </div>
              ) : (
                // Part B: 전체보기 테이블 우측 여백 활용 — table-fixed + colgroup 폭 배분으로 가로 공간을 채운다.
                //   약 이름·설명 컬럼이 가용 폭(나머지)을 흡수(우측 빈 칸 최소화). 급여여부/소속폴더는 고정 폭.
                <table className="w-full text-left table-fixed" data-testid="drug-folder-viewall-table">
                  <colgroup>
                    <col className="w-9" />
                    {/* 약 이름(용량) — 가용 폭 흡수 */}
                    <col />
                    {/* 급여여부 — 고정 narrow */}
                    <col className="w-24" />
                    {/* 소속 폴더 — 고정 */}
                    <col className="w-32" />
                    {/* Part C: 설명 — 가용 폭 흡수(소속 폴더 옆) */}
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="border-b bg-muted/30 text-[10px] text-muted-foreground">
                      <th className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAllDrugs}
                          disabled={!canEdit}
                          className="h-3.5 w-3.5 accent-teal-600 align-middle"
                          aria-label="전체선택"
                          data-testid="drug-folder-viewall-select-all"
                        />
                      </th>
                      {/* §0.5 reporter(문지은 대표원장) 직접 정정 MSG-xi5h: '약 이름(용량)'=name_ko 단일 데이터(예 '어쩌구 10mg'), 용량 별도 컬럼 X. */}
                      <th className="px-2 py-1.5 font-medium">약 이름(용량)</th>
                      {/* INLINE-MERGE: 급여여부 배지 컬럼 — 차단상태(비급여/급여삭제/급여기준변경) 한눈에 식별 */}
                      <th className="px-2 py-1.5 font-medium">급여여부</th>
                      <th className="px-2 py-1.5 font-medium">소속 폴더</th>
                      {/* Part C: 소속 폴더 옆 '설명' 컬럼(약별 자유텍스트, 더블클릭 인라인 편집) */}
                      <th className="px-2 py-1.5 font-medium" data-testid="drug-folder-viewall-desc-head">설명</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allDrugs.map((d) => {
                      const checked = selectedDrugIds.has(d.prescription_code_id);
                      const insSelected = insuranceSelectedId === d.prescription_code_id;
                      const insStatus = (d.insurance_status ?? null) as InsuranceStatus | null;
                      return (
                        <tr
                          key={d.prescription_code_id}
                          className={`border-b last:border-b-0 align-middle ${
                            insSelected ? 'bg-teal-50 ring-1 ring-inset ring-teal-300' : checked ? 'bg-teal-50/50' : 'hover:bg-muted/20'
                          }`}
                          data-testid="drug-folder-viewall-row"
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleDrugSelect(d.prescription_code_id)}
                              disabled={!canEdit}
                              className="h-3.5 w-3.5 accent-teal-600 align-middle"
                              aria-label={`${d.name_ko} 선택`}
                              data-testid="drug-folder-viewall-row-check"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {/* AC-1: 약명 클릭 → 우측 급여여부 편집 패널 열기(편집 권한자만). 권한 없으면 일반 텍스트. */}
                              {canManageInsurance ? (
                                <button
                                  type="button"
                                  onClick={() => setInsuranceSelectedId(d.prescription_code_id)}
                                  className="text-xs font-medium truncate text-left hover:text-teal-700 hover:underline"
                                  data-testid="drug-folder-viewall-name-btn"
                                  aria-pressed={insSelected}
                                >
                                  {d.name_ko}
                                </button>
                              ) : (
                                <span className="text-xs font-medium truncate">{d.name_ko}</span>
                              )}
                              {d.code_source === 'custom' && (
                                <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                              )}
                              {/* reporter: 이관약(code_type='이관약')만 '이관' 태그 + 검증 버튼 노출.
                                  검증 버튼은 UI surface 만(DML 없음) — 검증 semantics 는
                                  T-20260617-foot-RX-VALID-TAG-REMOVE 정본 경로에서 단일 구현(CORRECTION). */}
                              {d.code_type === MIGRATED_CODE_TYPE && (
                                <>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-4 px-1 shrink-0 border-amber-300 text-amber-700"
                                    data-testid="drug-folder-viewall-migrated-tag"
                                  >
                                    이관
                                  </Badge>
                                  {canEdit && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 gap-1 px-1.5 text-[10px] shrink-0 border-teal-300 text-teal-700 hover:bg-teal-50"
                                      onClick={() => handleVerify(d)}
                                      data-testid="drug-folder-viewall-verify-btn"
                                      title="검증(준비 중)"
                                    >
                                      <BadgeCheck className="h-3 w-3" />
                                      검증
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {insStatus ? (
                              <Badge
                                variant="outline"
                                className={`text-[9px] h-4 px-1 ${INSURANCE_STATUS_STYLE[insStatus] ?? ''}`}
                                data-testid="drug-folder-viewall-insurance-badge"
                              >
                                {insuranceStatusLabel(insStatus)}
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">미설정</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="text-[11px] text-muted-foreground truncate">
                              {folderNameById.get(d.folder_id) ?? '—'}
                            </span>
                          </td>
                          {/* Part C: '설명' 셀 — 더블클릭 → 인라인 입력 에디터(Enter 저장 / Esc 취소). 자유텍스트·빈값 허용. */}
                          <td className="px-2 py-1.5" data-testid="drug-folder-viewall-desc-cell">
                            {editingDescId === d.prescription_code_id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={editDescValue}
                                  onChange={(e) => setEditDescValue(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void submitDesc(d);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      cancelEditDesc();
                                    }
                                  }}
                                  placeholder="설명 입력 (예: 식후 30분, 졸림 주의)"
                                  className="h-7 text-xs px-1.5 flex-1 min-w-0"
                                  data-testid="drug-folder-viewall-desc-input"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-teal-600 hover:text-teal-700 shrink-0"
                                  title="저장"
                                  onClick={() => void submitDesc(d)}
                                  disabled={updateDesc.isPending}
                                  data-testid="drug-folder-viewall-desc-save"
                                >
                                  {updateDesc.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground shrink-0"
                                  title="취소"
                                  onClick={cancelEditDesc}
                                  disabled={updateDesc.isPending}
                                  data-testid="drug-folder-viewall-desc-cancel"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : canEdit ? (
                              <button
                                type="button"
                                onDoubleClick={() => startEditDesc(d)}
                                onClick={() => startEditDesc(d)}
                                className="w-full text-left text-[11px] truncate rounded px-1 py-0.5 hover:bg-teal-50/60 hover:ring-1 hover:ring-teal-200"
                                title="더블클릭 또는 클릭하면 설명을 입력할 수 있어요"
                                data-testid="drug-folder-viewall-desc-trigger"
                              >
                                {d.description && d.description.trim() !== '' ? (
                                  <span className="text-foreground">{d.description}</span>
                                ) : (
                                  <span className="text-muted-foreground/60">설명 추가…</span>
                                )}
                              </button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground truncate">
                                {d.description && d.description.trim() !== '' ? d.description : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 우: 급여여부 편집 패널(인라인) + HIRA 배치동기화(AC-5 이전처). canManageInsurance(admin/manager)만. */}
          {canManageInsurance && (
            <div className="space-y-3" data-testid="drug-folder-viewall-insurance-pane">
              {insuranceSelectedDrug ? (
                <InsuranceStatusPanel
                  codeId={insuranceSelectedDrug.prescription_code_id}
                  nameKo={insuranceSelectedDrug.name_ko}
                  claimCode={insuranceSelectedDrug.claim_code}
                  canWrite={canManageInsurance}
                  onClose={() => setInsuranceSelectedId(null)}
                  onSaved={() => qc.invalidateQueries({ queryKey: ['prescription_code_folders'] })}
                />
              ) : (
                <div
                  className="flex flex-col items-center justify-center py-10 px-3 text-center text-xs text-muted-foreground gap-1.5 rounded-lg border border-dashed"
                  data-testid="drug-folder-viewall-insurance-empty"
                >
                  <BadgeCheck className="h-5 w-5 text-muted-foreground/50" />
                  <span>왼쪽 목록에서 약 이름을 클릭하면 급여여부를 설정할 수 있어요.</span>
                </div>
              )}
              {/* AC-5: 급여여부 탭 제거에 따라 HIRA 배치동기화 패널을 처방폴더 보조영역으로 이전 */}
              <HiraInsuranceSyncPanel canWrite={canManageInsurance} />
            </div>
          )}
        </div>
      )}

      {subTab === 'folder' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 좌: 폴더 트리 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">폴더 트리</span>
            <span className="text-[10px] text-muted-foreground">{folders.length}개 폴더</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1.5">
              <Input
                value={newRootName}
                onChange={(e) => setNewRootName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateRoot()}
                placeholder="새 폴더 이름 (예: 알약)"
                className="h-8 text-xs"
                data-testid="drug-folder-new-root-input"
              />
              <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" onClick={handleCreateRoot} disabled={createFolder.isPending} data-testid="drug-folder-new-root-btn">
                <Plus className="h-3.5 w-3.5" /> 폴더
              </Button>
            </div>
          )}
          <div className="rounded-lg border p-2 min-h-[120px] space-y-0.5" data-testid="drug-folder-admin-tree">
            {tree.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">
                폴더가 없습니다. 위에서 첫 폴더를 만드세요.
              </div>
            ) : (
              tree.map(renderNode)
            )}
          </div>
        </div>

        {/* 우: 선택 폴더의 약품 + 배정 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            {selectedFolder ? (
              <>
                <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
                <span className="truncate">{selectedFolder.name}</span>
                <span className="text-[10px] text-muted-foreground font-normal">의 약품</span>
              </>
            ) : (
              <span className="text-muted-foreground font-normal">왼쪽에서 폴더를 선택하세요</span>
            )}
          </div>

          {/* AC-1 (REFINE-5FIX): 검색창을 감싸던 외겹 라운드박스(rounded-lg border bg-card) 제거.
              검색 input 자체 테두리만 유지. 검색 결과 드롭다운은 입력 아래 별도 박스로 노출. */}
          {selectedFolder && canEdit && (
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={drugQuery}
                  onChange={(e) => setDrugQuery(e.target.value)}
                  placeholder="약품명·보험코드 검색 → 클릭하면 이 폴더로 분류"
                  className="h-8 text-xs pl-7"
                  data-testid="drug-folder-assign-search"
                />
                {searching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              {drugQuery.trim() !== '' && (
                <div className="max-h-44 overflow-y-auto space-y-0.5 rounded-md border bg-popover p-1 shadow-sm">
                  {searchResults.length === 0 && !searching ? (
                    <div className="text-[10px] text-muted-foreground text-center py-2">검색 결과 없음</div>
                  ) : (
                    searchResults.map((code) => (
                      <button
                        key={code.id}
                        type="button"
                        onClick={() => handleAssign(code)}
                        disabled={assignDrug.isPending}
                        className="w-full text-left rounded-md px-2 py-1.5 hover:bg-teal-50/60 border border-transparent hover:border-teal-200 transition-colors disabled:opacity-50"
                        data-testid="drug-folder-assign-result"
                      >
                        <div className="flex items-center gap-1.5">
                          <Plus className="h-3 w-3 text-teal-600 shrink-0" />
                          <span className="text-xs font-medium truncate flex-1">{code.name_ko}</span>
                          {code.code_source === 'custom' && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground pl-4">
                          <span className="font-mono">{code.claim_code}</span>
                          {code.classification && <span> · {code.classification}</span>}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* AC-2 (REFINE-5FIX): 분류된 약물 목록을 라운드박스(카드) 나열 → 데이터테이블(헤더행+약물명행).
              AC-3: 행 우측 직접노출 삭제(X) 제거 → "…"(더보기) + 팝업 "삭제하기" 확인 후에만 분류 해제. */}
          {selectedFolder && (
            <div className="rounded-lg border min-h-[100px] overflow-visible" data-testid="drug-folder-assigned-list">
              {(drugsByFolder.get(selectedFolder.id) ?? []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-6">
                  이 폴더에 분류된 약품이 없습니다.
                </div>
              ) : (
                <table className="w-full text-left" data-testid="drug-folder-assigned-table">
                  <thead>
                    <tr className="border-b bg-muted/30 text-[10px] text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">약물명</th>
                      <th className="px-2 py-1.5 font-medium">보험코드</th>
                      {canEdit && <th className="px-1 py-1.5 w-9" aria-label="작업" />}
                    </tr>
                  </thead>
                  <tbody>
                    {(drugsByFolder.get(selectedFolder.id) ?? []).map((d) => (
                      <tr
                        key={d.prescription_code_id}
                        className="border-b last:border-b-0 hover:bg-muted/20 align-middle"
                        data-testid="drug-folder-assigned-item"
                      >
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium truncate">{d.name_ko}</span>
                            {d.code_source === 'custom' && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                          {d.claim_code}
                        </td>
                        {canEdit && (
                          <td className="px-1 py-1 text-right">
                            <DrugRowMoreMenu
                              onDelete={() => handleUnassign(d)}
                              disabled={unassignDrug.isPending}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
