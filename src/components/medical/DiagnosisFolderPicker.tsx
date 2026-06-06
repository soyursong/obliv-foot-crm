// DiagnosisFolderPicker — 진료차트 상병명 폴더 탐색 선택기
// Ticket: T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B] + AC-3 [C], 문지은 대표원장 C0ATE5P6JTH)
//   [B] 자동완성/이력 리스트업 전면 폐지 → 폴더 탐색 드롭다운(폴더 클릭→하위 상병 목록).
//       드롭다운 넓게/오른쪽 아래로 확장. 등록(services category_label='상병')된 상병만 선택.
//   [C] 원장별 즐겨찾기(doctor_diagnosis_favorites, auth.uid() 격리) → 패널 상단 빠른선택.
//   저장값은 순수 상병명(name) — medical_charts.diagnosis 저장경로 무변경.
//   새 의존성 없음(Popover 미보유) — 커스텀 절대배치 패널 + click-outside.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { ChevronDown, Folder, FolderOpen, Star, X, Search } from 'lucide-react';

interface DxRow {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder: string | null;
}

const NO_FOLDER = '미분류';
const DX_MASTER_KEY = 'diagnosis_picker_master';
const FAV_KEY = 'diagnosis_picker_fav';

function useDxMaster(clinicId: string | null) {
  return useQuery({
    queryKey: [DX_MASTER_KEY, clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // deploy-tolerant: diagnosis_folder 컬럼 미적용(42703) 시 폴백.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder')
        .eq('clinic_id', clinicId)
        .eq('category_label', '상병')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (withFolder.error) {
        const fb = await sb
          .from('services')
          .select('id, name, service_code')
          .eq('clinic_id', clinicId)
          .eq('category_label', '상병')
          .eq('active', true)
          .order('sort_order', { ascending: true });
        if (fb.error) return [] as DxRow[];
        return ((fb.data ?? []) as DxRow[]).map((r) => ({ ...r, diagnosis_folder: null }));
      }
      return (withFolder.data ?? []) as DxRow[];
    },
  });
}

function useFavorites(staffId: string | null) {
  return useQuery({
    queryKey: [FAV_KEY, staffId],
    enabled: !!staffId,
    queryFn: async () => {
      // 테이블 미적용 환경에서도 graceful(빈 집합).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('doctor_diagnosis_favorites')
        .select('service_id')
        .eq('staff_id', staffId);
      if (error) return new Set<string>();
      return new Set<string>(((data ?? []) as { service_id: string }[]).map((r) => r.service_id));
    },
  });
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  clinicId: string | null;
  className?: string;
  'data-testid'?: string;
}

export default function DiagnosisFolderPicker({ value, onChange, clinicId, className, ...rest }: Props) {
  const { profile } = useAuth();
  const staffId = profile?.id ?? null;
  const qc = useQueryClient();
  const { data: master = [] } = useDxMaster(clinicId);
  const { data: favIds = new Set<string>() } = useFavorites(staffId);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  // click-outside 닫기
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const favRows = useMemo(
    () => master.filter((m) => favIds.has(m.id)),
    [master, favIds],
  );

  // 검색어 필터 → 폴더 그룹핑
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? master.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.service_code ?? '').toLowerCase().includes(q),
        )
      : master;
    const map = new Map<string, DxRow[]>();
    for (const m of filtered) {
      const key = m.diagnosis_folder?.trim() ? m.diagnosis_folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  }, [master, query]);

  function toggleFolder(name: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setQuery('');
  }

  async function toggleFav(serviceId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!staffId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      if (favIds.has(serviceId)) {
        await sb.from('doctor_diagnosis_favorites').delete().eq('staff_id', staffId).eq('service_id', serviceId);
      } else {
        await sb.from('doctor_diagnosis_favorites').insert({ staff_id: staffId, service_id: serviceId });
      }
      qc.invalidateQueries({ queryKey: [FAV_KEY, staffId] });
    } catch {
      /* 즐겨찾기 미적용 환경 — 무시 */
    }
  }

  // 검색어가 있으면 폴더 자동 펼침
  const effectiveOpenFolders = query.trim()
    ? new Set(grouped.map((g) => g.folder))
    : openFolders;

  return (
    <div ref={rootRef} className="relative">
      {/* 트리거 — 읽기전용 표시 + 드롭다운 토글 (자유 타이핑 없음) */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm ${className ?? ''}`}
        data-testid={rest['data-testid']}
      >
        <span className={value ? 'text-foreground' : 'text-gray-300'}>
          {value || '상병명을 선택하세요'}
        </span>
        <span className="flex items-center gap-1">
          {value && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
            />
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>

      {/* 폴더 탐색 패널 — 넓게, 왼쪽 정렬로 오른쪽 아래 방향 확장 */}
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[min(560px,92vw)] max-h-[60vh] overflow-hidden rounded-lg border bg-popover shadow-lg flex flex-col"
          data-testid="dx-picker-panel"
        >
          {/* 검색 */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="상병명·코드 검색 (등록된 상병만)"
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-300"
              data-testid="dx-picker-search"
            />
          </div>

          <div className="overflow-y-auto">
            {/* 즐겨찾기 — 원장별 빠른선택 */}
            {!query.trim() && favRows.length > 0 && (
              <div className="border-b px-2 py-1.5">
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-[11px] font-semibold text-muted-foreground">즐겨찾기</span>
                </div>
                {favRows.map((m) => (
                  <DxItemRow key={m.id} row={m} isFav onSelect={select} onToggleFav={toggleFav} />
                ))}
              </div>
            )}

            {/* 폴더 트리 */}
            {grouped.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {master.length === 0
                  ? '등록된 상병명이 없습니다. 진료도구 → 상병명 관리에서 등록하세요.'
                  : '검색 결과가 없습니다.'}
              </div>
            ) : (
              grouped.map((g) => {
                const expanded = effectiveOpenFolders.has(g.folder);
                return (
                  <div key={g.folder} data-testid="dx-picker-folder">
                    <button
                      type="button"
                      onClick={() => toggleFolder(g.folder)}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-accent"
                      data-testid="dx-picker-folder-toggle"
                    >
                      {expanded ? (
                        <FolderOpen className="h-3.5 w-3.5 text-teal-600" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 text-teal-600" />
                      )}
                      <span className="text-xs font-semibold">{g.folder}</span>
                      <span className="text-[10px] text-muted-foreground">{g.items.length}</span>
                    </button>
                    {expanded && (
                      <div className="pl-3">
                        {g.items.map((m) => (
                          <DxItemRow
                            key={m.id}
                            row={m}
                            isFav={favIds.has(m.id)}
                            onSelect={select}
                            onToggleFav={toggleFav}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DxItemRow({
  row,
  isFav,
  onSelect,
  onToggleFav,
}: {
  row: DxRow;
  isFav: boolean;
  onSelect: (name: string) => void;
  onToggleFav: (serviceId: string, e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.name)}
      className="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
      data-testid="dx-picker-item"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate text-sm">{row.name}</span>
        {row.service_code && (
          <span className="font-mono text-[10px] text-muted-foreground">{row.service_code}</span>
        )}
      </span>
      <Star
        className={`h-3.5 w-3.5 shrink-0 ${isFav ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400'}`}
        onClick={(e) => onToggleFav(row.id, e)}
        data-testid="dx-picker-fav-toggle"
      />
    </button>
  );
}
