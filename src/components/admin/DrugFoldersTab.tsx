// DrugFoldersTab — 약품 폴더 관리 (AC-R2)
// Ticket: T-20260606-foot-RX-SET-REDESIGN
//
// 현장 용어(AC-R6): "폴더" = 약 분류/탐색 도구. 어드민(관리권한 role)이 폴더 트리를 만들고
//   개별 약품(prescription_codes)을 폴더에 분류한다. 진료차트 '처방세트' 탭 좌측 탐색기에 동일 트리가 노출.
//   ※ "묶음처방"(prescription_sets, 슈퍼상용구성 약 묶음)과는 별개 관리 화면.
//
// 권한: 폴더·분류 CRUD = 관리권한 role 한정(현장 "어드민만 관리").
//   PrescriptionSetsTab 과 동일 집합(director/manager/admin) — 대표원장(director) 본인 관리 동선 보존.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
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
  type DrugFolderNode,
  type FolderDrug,
} from '@/lib/drugFolders';

const FOLDER_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;

interface RxCodeResult {
  id: string;
  name_ko: string;
  claim_code: string;
  classification: string | null;
  code_source: string;
}

export default function DrugFoldersTab() {
  const { profile } = useAuth();
  const canEdit =
    !!profile?.role && (FOLDER_MANAGE_ROLES as readonly string[]).includes(profile.role);

  const { data: folders = [], isLoading: foldersLoading } = useDrugFolders();
  const { data: drugs = [], isLoading: drugsLoading } = useFolderDrugs();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const assignDrug = useAssignDrugToFolder();
  const unassignDrug = useUnassignDrug();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newRootName, setNewRootName] = useState('');
  const [drugQuery, setDrugQuery] = useState('');
  // 인라인 이름 변경(rename) — 형제 탭(DiagnosisNamesTab/PrescriptionSetsTab)과 동일 UX.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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

          {selectedFolder && canEdit && (
            <div className="rounded-lg border bg-card p-2 space-y-1.5">
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
                <div className="max-h-44 overflow-y-auto space-y-0.5">
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

          {selectedFolder && (
            <div className="rounded-lg border p-2 min-h-[100px] space-y-1" data-testid="drug-folder-assigned-list">
              {(drugsByFolder.get(selectedFolder.id) ?? []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-6">
                  이 폴더에 분류된 약품이 없습니다.
                </div>
              ) : (
                (drugsByFolder.get(selectedFolder.id) ?? []).map((d) => (
                  <div key={d.prescription_code_id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 bg-muted/20" data-testid="drug-folder-assigned-item">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{d.name_ko}</span>
                        {d.code_source === 'custom' && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">{d.claim_code}</div>
                    </div>
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0" title="분류 해제" onClick={() => handleUnassign(d)} disabled={unassignDrug.isPending}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
