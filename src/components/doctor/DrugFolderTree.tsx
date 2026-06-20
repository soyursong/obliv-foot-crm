// DrugFolderTree — 진료차트 '처방세트' 탭 좌측 약품 폴더 탐색기 (AC-R3 / AC-R5)
// Ticket: T-20260606-foot-RX-SET-REDESIGN
//
// 현장 용어(AC-R6): 여기 "폴더" = 약 분류/탐색 도구. 폴더에 담기는 단위 = 개별 약품(prescription_codes).
//   ※ "묶음처방"(prescription_sets)과는 별개 직교 섹션 — 본 컴포넌트는 폴더 축만 렌더.
//
// 동작:
//   - 다단계 폴더 트리(펼침/접힘). 폴더 노드 안에 분류된 약품 표시.
//   - 약품명 클릭 = 단건 처방내역 추가(onAdd([code])).
//   - T-20260609-foot-RXSET-ITEM-ARROW-INSERT: 각 약품 항목 좌측 `<`(ChevronLeft) compact 버튼
//     클릭 = 즉시 단건 처방내역 삽입(onAdd([code]) 재사용). 기존 체크박스 다중선택+'선택 추가'
//     bulk UI는 제거 — 1클릭 즉시삽입으로 단순화. (묶음처방 다중약 일괄삽입은 별 컴포넌트가 유지)

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
// T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part D): 약 hover → 약 정보(설명) 라운드박스 툴팁.
import DrugInfoTooltip from '@/components/doctor/DrugInfoTooltip';
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

  // T-20260609-foot-RXSET-ITEM-ARROW-INSERT: 단건 즉시삽입 — 기존 onAdd([단건]) 로직 재사용.
  function addOne(d: FolderDrug) {
    onAdd([{ id: d.prescription_code_id, name_ko: d.name_ko, classification: d.classification }]);
  }

  if (foldersLoading || drugsLoading) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 처방세트 불러오는 중…
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground text-center"
        data-testid="drug-folder-empty"
      >
        등록된 처방세트 없음<br />
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
              return (
                <div
                  key={d.prescription_code_id}
                  className={cn(
                    // DRUGINFO-TRUNCATE-FIX AC5-3: 약품명 줄바꿈 시 좌측 버튼 상단정렬(items-start) — 행 높이 자동확장
                    'flex items-start gap-1.5 rounded-md border px-2 py-1.5 transition-colors',
                    'border-transparent hover:border-teal-200 hover:bg-teal-50/30',
                  )}
                  data-testid="drug-folder-item"
                >
                  {/* T-20260609-foot-RXSET-ITEM-ARROW-INSERT: 좌측 `<`(ChevronLeft) compact 즉시삽입 버튼.
                      클릭 시 기존 onAdd([단건]) 삽입 로직 재사용 → 즉시 좌측 처방내역 삽입.
                      PHRASE-CHECKBOX-ARROW 톤 일관(ChevronLeft, compact w-5(≤w-6), 좌측 여백). */}
                  <button
                    type="button"
                    onClick={() => addOne(d)}
                    disabled={disabled}
                    className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-neutral-800 text-white shrink-0 hover:bg-neutral-900 disabled:opacity-50"
                    data-testid="drug-folder-item-arrow"
                    aria-label={`${d.name_ko} 처방내역에 삽입`}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {/* Part D: 약 hover → 약 정보(설명) 라운드 사각 툴팁. 클릭(즉시삽입) 동선 방해 X(pointer-events:none). */}
                  <DrugInfoTooltip
                    name={d.name_ko}
                    description={d.description}
                    className="flex-1 min-w-0"
                    testId="rx-drug-tooltip-select"
                  >
                    <button
                      type="button"
                      onClick={() => addOne(d)}
                      disabled={disabled}
                      className="w-full text-left disabled:opacity-50"
                      data-testid="drug-folder-item-add"
                    >
                      {/* T-20260609-foot-DRUGINFO-TRUNCATE-FIX AC5-1/5-2: 약품명 말줄임(...) 제거 →
                          줄바꿈(break-words)으로 전체표시. 행 높이 자동확장 허용(AC5-3). */}
                      <div className="flex items-start gap-1.5">
                        <span className="text-xs font-medium break-words flex-1 min-w-0">{d.name_ko}</span>
                        {d.code_source === 'custom' && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0 mt-0.5">자체</Badge>
                        )}
                      </div>
                      {/* AC5-2: 약정보 메타(코드·분류·제조사)도 가로 잘림 없이 줄바꿈 흐름. */}
                      <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                        <span className="font-mono break-all">{d.claim_code}</span>
                        {d.classification && <span className="break-words">· {d.classification}</span>}
                        {/* DRUGINFO-MANUFACTURER: 제약사(제조사). NULL/빈값(custom)은 표기 생략 — 레이아웃 보존 */}
                        {d.manufacturer && d.manufacturer.trim() !== '' && (
                          <span data-testid="drug-folder-item-manufacturer" className="break-words">· {d.manufacturer}</span>
                        )}
                      </div>
                    </button>
                  </DrugInfoTooltip>
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
      {tree.map(renderNode)}
    </div>
  );
}
