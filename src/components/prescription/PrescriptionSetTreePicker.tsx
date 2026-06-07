// PrescriptionSetTreePicker — 묶음처방(prescription_sets) folder→set 2단 탐색기 트리 (공용)
// T-20260607-foot-RXQUICK-SET-FOLDER-NAV
//   추출 원본: MedicalChartPanel 우측 처방세트 탭 inline 트리
//     (T-20260605-foot-RX-SET-EXPLORER-TREE, L2471~ folder→set / L360 collapsedRxFolders).
//   재사용처: ① 진료차트 우측 처방세트 탭(action 모드) ② 빠른처방 admin picker(select 모드 + 검색).
//
// 그룹핑 규칙(원본 보존): 폴더 가나다순, '미분류' 맨 끝, 폴더 내부는 입력 배열 순서(sort_order) 유지.
// 회귀 가드: testIdPrefix 기본값 'rx-set' → 진료차트 surface의 기존 testid(rx-set-folder-node 등) byte 동일 유지.

import { useMemo, useState } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const NO_FOLDER = '미분류';

// 트리 picker가 요구하는 최소 shape — 호출처 타입은 이 superset이면 됨.
export interface TreePickerSet {
  id: number;
  name: string;
  folder?: string | null;
}

export interface PrescriptionSetTreePickerProps<T extends TreePickerSet> {
  sets: T[];
  /** leaf(세트) 클릭 핸들러. action 모드(적용) / select 모드(선택) 공용. */
  onSelect: (set: T) => void;
  /** select 모드: 현재 선택된 세트 id (하이라이트). 미지정 시 비-선택(action) 모드. */
  selectedId?: number | null;
  disabled?: boolean;
  /** 검색 입력 노출 + 세트명 부분일치 필터 (AC-2). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * controlled 접힘 상태. onToggleFolder와 함께 주면 외부가 collapse를 소유.
   * 진료차트 surface는 "폴더 기본 전체 접힘"(RX-PANEL-UX-5FIX) 초기화를 외부에서 유지 → 회귀 보존.
   * 미지정 시 내부 state(기본 전체 펼침) 사용 = picker 친화 동작.
   */
  collapsedFolders?: Set<string>;
  onToggleFolder?: (folderName: string) => void;
  /** leaf 부제(약 미리보기 등) 커스텀 렌더. */
  renderLeafSubtitle?: (set: T) => React.ReactNode;
  /** testid prefix. 기본 'rx-set' = 진료차트 surface 회귀 호환. */
  testIdPrefix?: string;
  /** 빈 목록 메시지. */
  emptyMessage?: React.ReactNode;
  className?: string;
}

export default function PrescriptionSetTreePicker<T extends TreePickerSet>({
  sets,
  onSelect,
  selectedId,
  disabled = false,
  searchable = false,
  searchPlaceholder = '묶음처방 검색...',
  renderLeafSubtitle,
  testIdPrefix = 'rx-set',
  emptyMessage,
  collapsedFolders,
  onToggleFolder,
  className,
}: PrescriptionSetTreePickerProps<T>) {
  const [query, setQuery] = useState('');
  // 내부 접힘 state(uncontrolled 경로). 사용자가 토글한 폴더만 기록, 기본 전체 펼침.
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(new Set<string>());
  const controlled = collapsedFolders != null && onToggleFolder != null;
  const collapsed = controlled ? collapsedFolders! : internalCollapsed;

  const trimmed = query.trim().toLowerCase();
  const filtering = searchable && trimmed.length > 0;

  // 폴더→세트 그룹핑 (원본 규칙 보존).
  const groups = useMemo(() => {
    const visible = filtering
      ? sets.filter((s) => s.name.toLowerCase().includes(trimmed))
      : sets;
    const map = new Map<string, T[]>();
    for (const s of visible) {
      const key = s.folder?.trim() ? s.folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((folderName) => ({ folderName, items: map.get(folderName)! }));
  }, [sets, filtering, trimmed]);

  function toggleFolder(folderName: string) {
    if (controlled) {
      onToggleFolder!(folderName);
      return;
    }
    setInternalCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  }

  const searchBox = searchable ? (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        className="pl-8 h-9"
        data-testid={`${testIdPrefix}-search`}
      />
    </div>
  ) : null;

  // 빈 상태 분기: 원본 데이터 없음 vs 검색 0건(시나리오2 엣지, AC-3).
  if (sets.length === 0) {
    return (
      <div className={className}>
        {emptyMessage ?? (
          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center" data-testid={`${testIdPrefix}-empty`}>
            등록된 묶음처방이 없습니다.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {searchBox}
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center mt-2" data-testid={`${testIdPrefix}-search-empty`}>
          "{query.trim()}" 검색 결과가 없습니다.
        </div>
      ) : (
        <div className={searchable ? 'space-y-1 mt-2' : ''}>
          {groups.map(({ folderName, items }) => {
            // 검색 중에는 매칭 폴더를 강제로 펼침(결과 가림 방지). 그 외엔 사용자 토글 반영.
            const isCollapsed = !filtering && collapsed.has(folderName);
            return (
              <div key={folderName} data-testid={`${testIdPrefix}-folder-node`} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleFolder(folderName)}
                  className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-md hover:bg-teal-50/60 transition-colors"
                  data-testid={`${testIdPrefix}-folder-toggle`}
                  aria-expanded={!isCollapsed}
                  disabled={filtering}
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
                  <span className="text-xs font-semibold text-foreground truncate flex-1 text-left" data-testid={`${testIdPrefix}-folder-name`}>
                    {folderName}
                  </span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{items.length}</Badge>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1 pl-3 border-l border-teal-100 ml-2">
                    {items.map((set) => {
                      const isSelected = selectedId != null && set.id === selectedId;
                      return (
                        <button
                          key={set.id}
                          type="button"
                          onClick={() => onSelect(set)}
                          disabled={disabled}
                          aria-pressed={selectedId != null ? isSelected : undefined}
                          className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-50 ${
                            isSelected
                              ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-400'
                              : 'bg-card hover:border-teal-400 hover:bg-teal-50/30'
                          }`}
                          data-testid={`${testIdPrefix}-option`}
                        >
                          <div className="font-medium text-xs">{set.name}</div>
                          {renderLeafSubtitle && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {renderLeafSubtitle(set)}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
