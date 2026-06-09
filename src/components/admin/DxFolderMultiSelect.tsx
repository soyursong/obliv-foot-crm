// DxFolderMultiSelect — 묶음상병 "상병 추가" 폴더트리 다중선택 picker
// Ticket: T-20260609-foot-DXMGMT-NEST-BUNDLE-FOLDER
//   AC-4 묶음상병에 상병 추가 시 상병명관리의 동일 (중첩)폴더 구조로 탐색 + 여러 상병 중복선택(체크박스) 일괄추가.
//   AC-6 선택 "순서"를 보존해 반환 → 호출부에서 첫 선택=주상병(primary), 나머지=부상병으로 자동 지정.
//
// 데이터 모델(무변경): 폴더 = diagnosis_folders(자기참조 트리), 배치 = services.diagnosis_folder_id FK(0~1).
//   ※ multi-folder membership(AC-5)은 junction 도입 전이라 본 picker는 1상병 = 0~1폴더 전제로 동작.
//   상병명관리(DiagnosisNamesTab) 좌측 트리와 동일 빌더(buildDiagnosisFolderTree) 재사용 → 구조 일치.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildDiagnosisFolderTree,
  type DiagnosisFolder,
  type DiagnosisFolderNode,
} from '@/lib/diagnosisFolders';
import { Folder, ChevronRight, ChevronDown, Check, Search, Inbox } from 'lucide-react';

export interface DxPickRow {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder_id: string | null;
}

interface Props {
  folders: DiagnosisFolder[];
  diagnoses: DxPickRow[];
  /** 이미 묶음에 담긴 상병(중복 차단·"추가됨" 표시) */
  addedIds: Set<string>;
  /** 선택 순서를 보존한 service_id 배열을 호출부로 반환(AC-6 주/부 자동지정 근거) */
  onConfirm: (orderedIds: string[]) => void;
  onCancel: () => void;
}

function fmt(row: DxPickRow): string {
  const code = (row.service_code ?? '').trim();
  return code ? `${code} ${row.name}` : row.name;
}

export default function DxFolderMultiSelect({ folders, diagnoses, addedIds, onConfirm, onCancel }: Props) {
  // 선택 순서 보존(AC-6): 배열 push 순서 = 주/부 결정 순서.
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildDiagnosisFolderTree(folders), [folders]);

  // folder_id → 소속 상병(이름순). null = 미분류.
  const byFolder = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string | null, DxPickRow[]>();
    for (const d of diagnoses) {
      if (q && !`${d.name} ${d.service_code ?? ''}`.toLowerCase().includes(q)) continue;
      const key = d.diagnosis_folder_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return map;
  }, [diagnoses, query]);

  const selectedOrder = useMemo(() => {
    const m = new Map<string, number>();
    selected.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [selected]);

  function toggle(id: string) {
    if (addedIds.has(id)) return; // 이미 담김 — 무시
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 검색 중엔 자동 펼침(필터 결과를 가리지 않도록).
  const searching = query.trim().length > 0;

  function renderRow(d: DxPickRow, depth: number) {
    const added = addedIds.has(d.id);
    const order = selectedOrder.get(d.id);
    const isSel = order !== undefined;
    return (
      <button
        key={d.id}
        type="button"
        disabled={added}
        onClick={() => toggle(d.id)}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        className={`flex w-full items-center gap-2 py-2 pr-2 text-left text-sm border-b last:border-b-0 ${
          added
            ? 'cursor-not-allowed text-muted-foreground/60'
            : isSel
              ? 'bg-teal-50 text-teal-900'
              : 'hover:bg-muted/50'
        }`}
        data-testid="dx-pick-row"
        data-selected={isSel ? 'true' : 'false'}
        data-added={added ? 'true' : 'false'}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            isSel ? 'border-teal-500 bg-teal-500 text-white' : added ? 'border-muted bg-muted' : 'border-input'
          }`}
        >
          {isSel ? <span className="text-[10px] font-bold tabular-nums">{order}</span> : added ? <Check className="h-3 w-3" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{fmt(d)}</span>
        {added && <span className="shrink-0 text-[10px] text-muted-foreground">추가됨</span>}
      </button>
    );
  }

  function renderFolder(node: DiagnosisFolderNode) {
    const rows = byFolder.get(node.id) ?? [];
    const hasChildContent =
      rows.length > 0 || node.children.some((c) => hasContent(c));
    // 검색 중 매칭 없는 폴더는 숨김.
    if (searching && !hasChildContent) return null;
    const isCollapsed = !searching && collapsed.has(node.id);
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => toggleCollapse(node.id)}
          style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
          className="flex w-full items-center gap-1 py-1.5 pr-2 text-left text-[13px] font-semibold text-foreground bg-muted/30 border-b"
          data-testid="dx-pick-folder"
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-teal-600/70" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums">({rows.length})</span>
        </button>
        {!isCollapsed && (
          <>
            {rows.map((d) => renderRow(d, node.depth + 1))}
            {node.children.map((c) => renderFolder(c))}
          </>
        )}
      </div>
    );
  }

  // 폴더(자손 포함)에 검색 매칭 내용이 있는지.
  function hasContent(node: DiagnosisFolderNode): boolean {
    if ((byFolder.get(node.id) ?? []).length > 0) return true;
    return node.children.some((c) => hasContent(c));
  }

  const unfiled = byFolder.get(null) ?? [];

  return (
    <div className="rounded-lg border bg-background" data-testid="dx-folder-multiselect">
      {/* 검색 */}
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상병명·코드 검색"
          className="h-7 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
          data-testid="dx-pick-search"
        />
      </div>

      {/* 트리 */}
      <div className="max-h-[44vh] overflow-y-auto" data-testid="dx-pick-tree">
        {diagnoses.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            등록된 상병명이 없습니다 — 상병명 관리에서 먼저 등록하세요.
          </div>
        ) : (
          <>
            {tree.map((node) => renderFolder(node))}
            {/* 미분류 그룹(folder_id null) — 항상 최하단 */}
            {(!searching || unfiled.length > 0) && (
              <div>
                <div
                  style={{ paddingLeft: '8px' }}
                  className="flex w-full items-center gap-1 py-1.5 pr-2 text-[13px] font-semibold text-muted-foreground bg-muted/30 border-b"
                >
                  <Inbox className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">미분류</span>
                  <span className="shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums">({unfiled.length})</span>
                </div>
                {unfiled.map((d) => renderRow(d, 1))}
              </div>
            )}
            {searching && tree.every((n) => !hasContent(n)) && unfiled.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</div>
            )}
          </>
        )}
      </div>

      {/* 푸터: 선택 일괄 추가 */}
      <div className="flex items-center justify-between gap-2 border-t px-2 py-2">
        <span className="text-[11px] text-muted-foreground">
          {selected.length > 0 ? `${selected.length}개 선택 · 첫 선택 = 주상병` : '추가할 상병을 체크하세요'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-8" onClick={onCancel} data-testid="dx-pick-cancel">
            닫기
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={selected.length === 0}
            onClick={() => {
              onConfirm(selected);
              setSelected([]);
            }}
            data-testid="dx-pick-confirm"
          >
            선택한 상병 추가 ({selected.length})
          </Button>
        </div>
      </div>
    </div>
  );
}
