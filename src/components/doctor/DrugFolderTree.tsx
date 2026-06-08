// DrugFolderTree — 진료차트 '처방세트' 탭 좌측 약품 폴더 탐색기 (AC-R3 / AC-R5)
// Ticket: T-20260606-foot-RX-SET-REDESIGN
//
// 현장 용어(AC-R6): 여기 "폴더" = 약 분류/탐색 도구. 폴더에 담기는 단위 = 개별 약품(prescription_codes).
//   ※ "묶음처방"(prescription_sets)과는 별개 직교 섹션 — 본 컴포넌트는 폴더 축만 렌더.
//
// 동작:
//   - 다단계 폴더 트리(펼침/접힘). 폴더 노드 안에 분류된 약품 표시.
//   - 약품 클릭 = 단건 처방내역 추가(onAdd([code])).
//   - 체크박스 다중선택 → '선택 추가' = 여러 약 일괄 추가(AC-R5 "단일 약품 여러 개 직접 추가").

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useDrugFolders,
  useFolderDrugs,
  buildFolderTree,
  type DrugFolderNode,
  type FolderDrug,
} from '@/lib/drugFolders';

/** 처방내역에 추가할 약 1건의 최소 식별 정보 */
export interface DrugPick {
  id: string; // prescription_code_id
  name_ko: string;
  classification: string | null;
}

interface DrugFolderTreeProps {
  /** 약품 1건 이상을 처방내역에 추가 */
  onAdd: (codes: DrugPick[]) => void;
  /** 금기 체크 등 진행 중 비활성화 */
  disabled?: boolean;
}

export default function DrugFolderTree({ onAdd, disabled = false }: DrugFolderTreeProps) {
  const { data: folders = [], isLoading: foldersLoading } = useDrugFolders();
  const { data: drugs = [], isLoading: drugsLoading } = useFolderDrugs();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Map<string, DrugPick>>(new Map());

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const drugsByFolder = useMemo(() => {
    const m = new Map<string, FolderDrug[]>();
    for (const d of drugs) {
      if (!m.has(d.folder_id)) m.set(d.folder_id, []);
      m.get(d.folder_id)!.push(d);
    }
    return m;
  }, [drugs]);

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelect(d: FolderDrug) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(d.prescription_code_id)) next.delete(d.prescription_code_id);
      else
        next.set(d.prescription_code_id, {
          id: d.prescription_code_id,
          name_ko: d.name_ko,
          classification: d.classification,
        });
      return next;
    });
  }

  function addSelected() {
    if (selected.size === 0) return;
    onAdd(Array.from(selected.values()));
    setSelected(new Map());
  }

  if (foldersLoading || drugsLoading) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 약품 폴더 불러오는 중…
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground text-center"
        data-testid="drug-folder-empty"
      >
        등록된 약품 폴더 없음<br />
        <span className="text-[10px]">관리 화면에서 폴더를 만들고 약품을 분류하세요</span>
      </div>
    );
  }

  const renderNode = (node: DrugFolderNode) => {
    const isCollapsed = collapsed.has(node.id);
    const folderDrugs = drugsByFolder.get(node.id) ?? [];
    return (
      <div key={node.id} data-testid="drug-folder-node" className="space-y-1">
        <button
          type="button"
          onClick={() => toggleFolder(node.id)}
          className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-md hover:bg-teal-50/60 transition-colors"
          style={{ paddingLeft: `${node.depth * 12 + 4}px` }}
          data-testid="drug-folder-toggle"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          {isCollapsed ? (
            <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          )}
          <span
            className="text-xs font-semibold text-foreground truncate flex-1 text-left"
            data-testid="drug-folder-name"
          >
            {node.name}
          </span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
            {folderDrugs.length}
          </Badge>
        </button>

        {!isCollapsed && (
          <div className="space-y-1 pl-3 border-l border-teal-100 ml-2">
            {/* 하위 폴더 먼저 */}
            {node.children.map(renderNode)}
            {/* 이 폴더의 약품들 */}
            {folderDrugs.map((d) => {
              const isSel = selected.has(d.prescription_code_id);
              return (
                <div
                  key={d.prescription_code_id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors',
                    isSel ? 'border-teal-400 bg-teal-50/50' : 'border-transparent hover:border-teal-200 hover:bg-teal-50/30',
                  )}
                  data-testid="drug-folder-item"
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(d)}
                    disabled={disabled}
                    className="h-3.5 w-3.5 accent-teal-600 shrink-0"
                    data-testid="drug-folder-item-check"
                    aria-label={`${d.name_ko} 선택`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onAdd([{ id: d.prescription_code_id, name_ko: d.name_ko, classification: d.classification }])
                    }
                    disabled={disabled}
                    className="flex-1 text-left disabled:opacity-50"
                    data-testid="drug-folder-item-add"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate flex-1">{d.name_ko}</span>
                      {d.code_source === 'custom' && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">자체</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className="font-mono">{d.claim_code}</span>
                      {d.classification && <span>· {d.classification}</span>}
                      {/* DRUGINFO-MANUFACTURER: 제약사(제조사). NULL/빈값(custom)은 표기 생략 — 레이아웃 보존 */}
                      {d.manufacturer && d.manufacturer.trim() !== '' && (
                        <span data-testid="drug-folder-item-manufacturer" className="truncate">· {d.manufacturer}</span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
            {node.children.length === 0 && folderDrugs.length === 0 && (
              <div className="text-[10px] text-muted-foreground px-1 py-1">빈 폴더</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1" data-testid="drug-folder-tree">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-teal-300 bg-teal-50 px-2 py-1.5">
          <span className="text-[11px] font-medium text-teal-800">{selected.size}개 선택됨</span>
          <Button
            size="sm"
            className="h-6 text-[11px] bg-teal-600 hover:bg-teal-700 gap-1"
            onClick={addSelected}
            disabled={disabled}
            data-testid="drug-folder-add-selected"
          >
            <Plus className="h-3 w-3" />
            선택 추가
          </Button>
        </div>
      )}
      {tree.map(renderNode)}
    </div>
  );
}
