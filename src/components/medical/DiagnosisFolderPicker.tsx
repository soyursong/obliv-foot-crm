// DiagnosisFolderPicker — 진료차트 상병명 폴더 탐색 선택기 (다중·주/부 지정)
// Ticket: T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-2 [B] + AC-3 [C], 문지은 대표원장 C0ATE5P6JTH)
//   [B] 자동완성/이력 리스트업 전면 폐지 → 폴더 탐색 드롭다운(폴더 클릭→하위 상병 목록).
//       드롭다운 넓게/오른쪽 아래로 확장. 등록(services category_label='상병')된 상병만 선택.
//   [C] 원장별 즐겨찾기(doctor_diagnosis_favorites, auth.uid() 격리) → 패널 상단 빠른선택.
//
// Ticket: T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX (문지은 대표원장 C0ATE5P6JTH)
//   AC-1 주/부상병 지정: 선택 순서 기반 — 맨 앞(index 0)=주상병, 나머지=부상병.
//                        칩의 [주상병] 버튼으로 해당 상병을 맨 앞으로 승격(주상병 재지정).
//   AC-2 진단명 다중(중복) 선택: 폴더 항목 클릭 시 기존 선택을 대체하지 않고 누적(append).
//                        동일 상병 중복 추가 허용(현장이 직접 삭제). 패널은 닫지 않아 연속 추가 가능.
//   저장값은 medical_charts.diagnosis(text) 무스키마변경 — 선택 상병을 줄바꿈(\n)으로 직렬화.
//     줄 순서 = 주/부 순서. (applySuperPhrase 의 기존 `\n` 누적 포맷과 호환)
//   새 의존성 없음(Popover 미보유) — 커스텀 절대배치 패널 + click-outside.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { ChevronDown, Folder, FolderOpen, Star, X, Search, Plus, Boxes } from 'lucide-react';

interface DxRow {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder: string | null;
}

const NO_FOLDER = '미분류';
const DX_MASTER_KEY = 'diagnosis_picker_master';
const FAV_KEY = 'diagnosis_picker_fav';
// T-20260608-foot-DX-BUNDLE-SET (AC-2): 묶음상병 세트 — 진료차트 일괄 적용 소스.
const DX_SET_KEY = 'diagnosis_picker_sets';

// 묶음상병 세트(진료차트 적용용). is_active 만, 항목 service_id + 주/부 + 순서.
interface DxSetItem {
  service_id: string;
  diagnosis_type: 'primary' | 'secondary';
  sort_order: number;
}
interface DxSet {
  id: string;
  name: string;
  items: DxSetItem[];
}

// T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-1 (문지은 대표원장):
//   "상병명과 코드는 항상 같이 따라다니는 세트. 하나만 출력하지마."
//   선택 시 저장값을 "코드 상병명" 으로 동반(코드 공란이면 이름 단독 폴백). medical_charts.diagnosis(text) 무스키마변경.
function fmtDx(row: { name: string; service_code: string | null }): string {
  const code = (row.service_code ?? '').trim();
  return code ? `${code} ${row.name}` : row.name;
}

// ── T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX: 순수 직렬화 헬퍼 (테스트 정본) ──
//   diagnosis(text) ↔ 선택 상병 목록 변환. 줄 순서 = 주/부 순서(index 0 = 주상병).
export function parseDxEntries(value: string): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function serializeDxEntries(entries: string[]): string {
  return entries.join('\n');
}

// AC-2: 중복 허용 누적. 빈 라벨은 무시(GUARD).
export function addDxEntry(entries: string[], label: string): string[] {
  const v = (label ?? '').trim();
  if (!v) return entries;
  return [...entries, v];
}

export function removeDxEntry(entries: string[], idx: number): string[] {
  if (idx < 0 || idx >= entries.length) return entries;
  return entries.filter((_, i) => i !== idx);
}

// AC-1: 주상병 재지정 — 해당 항목을 맨 앞으로 이동(나머지 상대순서 보존).
export function makeDxPrimary(entries: string[], idx: number): string[] {
  if (idx <= 0 || idx >= entries.length) return entries; // 0(이미 주) 또는 범위밖 → 무변경
  const next = [...entries];
  const [moved] = next.splice(idx, 1);
  next.unshift(moved);
  return next;
}

// 순서 기반 주/부 판정. index 0 = 주상병.
export function isDxPrimary(idx: number): boolean {
  return idx === 0;
}

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

// T-20260608-foot-DX-BUNDLE-SET (AC-2): 묶음상병 세트 목록(진료차트 일괄 적용).
//   테이블 미적용(마이그 미게이트) 환경에서도 graceful(빈 목록 → 섹션 미노출).
function useDxSets(clinicId: string | null) {
  return useQuery({
    queryKey: [DX_SET_KEY, clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb
        .from('diagnosis_sets')
        .select('id, name, is_active, sort_order, diagnosis_set_items(service_id, diagnosis_type, sort_order)')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) return [] as DxSet[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id,
        name: s.name,
        items: ((s.diagnosis_set_items ?? []) as DxSetItem[])
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      })) as DxSet[];
    },
  });
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  clinicId: string | null;
  className?: string;
  disabled?: boolean; // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4: 차트 읽기전용 모드 비활성
  'data-testid'?: string;
}

export default function DiagnosisFolderPicker({ value, onChange, clinicId, className, disabled, ...rest }: Props) {
  const { profile } = useAuth();
  const staffId = profile?.id ?? null;
  const qc = useQueryClient();
  const { data: master = [] } = useDxMaster(clinicId);
  const { data: favIds = new Set<string>() } = useFavorites(staffId);
  // T-20260608-foot-DX-BUNDLE-SET (AC-2): 묶음상병 세트(일괄 적용)
  const { data: dxSets = [] } = useDxSets(clinicId);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  // 묶음상병 섹션 접힘 상태(기본 펼침)
  const [setsOpen, setSetsOpen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // service_id → master row 빠른 조회 (묶음상병 적용 시 라벨 변환)
  const masterById = useMemo(() => {
    const m = new Map<string, DxRow>();
    for (const r of master) m.set(r.id, r);
    return m;
  }, [master]);

  // T-20260607: 선택된 상병 목록(다중·순서=주/부). value(text) 의 단일 정본.
  const entries = useMemo(() => parseDxEntries(value), [value]);

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

  // AC-2: 항목 선택 = 누적(append, 중복 허용). 패널은 닫지 않음(연속 추가).
  function select(row: DxRow) {
    onChange(serializeDxEntries(addDxEntry(entries, fmtDx(row))));
    // 패널 유지 — 다른 상병 추가가능. 검색어는 보존(같은 폴더 연속 추가 편의).
  }

  // AC-2: 묶음상병 일괄 적용 — 세트의 상병들을 현재 선택에 누적(append, 기존 단건 입력경로 무변경).
  //   순서: 주상병(primary) 먼저 → 부상병, 각 그룹 내 sort_order. 삭제된 상병(master 부재)은 건너뜀.
  function applySet(set: DxSet) {
    const ordered = [...set.items].sort((a, b) => {
      const pa = a.diagnosis_type === 'primary' ? 0 : 1;
      const pb = b.diagnosis_type === 'primary' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    let next = entries;
    let applied = 0;
    for (const it of ordered) {
      const row = masterById.get(it.service_id);
      if (!row) continue;
      next = addDxEntry(next, fmtDx(row));
      applied += 1;
    }
    if (applied === 0) return;
    onChange(serializeDxEntries(next));
    // 패널 유지 — 추가 세트/단건 선택 연속 가능.
  }

  function handleRemove(idx: number) {
    onChange(serializeDxEntries(removeDxEntry(entries, idx)));
  }

  function handleMakePrimary(idx: number) {
    onChange(serializeDxEntries(makeDxPrimary(entries, idx)));
  }

  function clearAll() {
    onChange('');
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

  // 트리거 요약 라벨 — 주상병 우선 노출 + 추가건수.
  const triggerLabel =
    entries.length === 0
      ? '상병명을 선택하세요 (다중 선택)'
      : entries.length === 1
        ? entries[0]
        : `${entries[0]} 외 ${entries.length - 1}건`;

  return (
    <div ref={rootRef} className="relative">
      {/* 선택된 상병 칩 — 주/부 배지 + 주상병 재지정 + 삭제 (AC-1/AC-2) */}
      {entries.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="dx-selected-chips">
          {entries.map((label, idx) => {
            const primary = isDxPrimary(idx);
            return (
              <span
                key={`${idx}-${label}`}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                  primary ? 'border-teal-300 bg-teal-50' : 'border-input bg-muted/40'
                }`}
                data-testid="dx-chip"
                data-primary={primary ? 'true' : 'false'}
              >
                <span
                  className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
                    primary ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-700'
                  }`}
                  data-testid="dx-chip-badge"
                >
                  {primary ? '주' : '부'}
                </span>
                <span className="truncate max-w-[180px]">{label}</span>
                {!primary && !disabled && (
                  <button
                    type="button"
                    onClick={() => handleMakePrimary(idx)}
                    className="shrink-0 rounded px-1 text-[10px] text-teal-700 hover:bg-teal-100"
                    title="주상병으로 지정"
                    data-testid="dx-chip-make-primary"
                  >
                    주상병
                  </button>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`${label} 삭제`}
                    data-testid="dx-chip-remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* 트리거 — 등록 상병만 폴더에서 선택(자유 타이핑 없음). 다중 선택 누적. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 disabled:opacity-100 ${className ?? ''}`}
        data-testid={rest['data-testid']}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Plus className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <span className={`truncate ${entries.length ? 'text-foreground' : 'text-gray-300'}`}>
            {triggerLabel}
          </span>
        </span>
        <span className="flex items-center gap-1">
          {entries.length > 0 && !disabled && (
            <X
              className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
              aria-label="전체 삭제"
            />
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>

      {/* 폴더 탐색 패널 — 넓게, 왼쪽 정렬로 오른쪽 아래 방향 확장 */}
      {open && !disabled && (
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
              placeholder="상병명·코드 검색 (등록된 상병만) — 클릭 시 누적 추가"
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-300"
              data-testid="dx-picker-search"
            />
          </div>

          <div className="overflow-y-auto">
            {/* T-20260608-foot-DX-BUNDLE-SET (AC-2): 묶음상병 — 세트 선택 시 상병 일괄 적용(누적).
                검색어 없을 때만 노출(검색은 단건 상병 탐색에 집중). 세트 없으면 섹션 자체 미노출. */}
            {!query.trim() && dxSets.length > 0 && (
              <div className="border-b px-2 py-1.5" data-testid="dx-picker-sets">
                <button
                  type="button"
                  onClick={() => setSetsOpen((o) => !o)}
                  className="flex w-full items-center gap-1.5 px-1 py-1"
                  data-testid="dx-picker-sets-toggle"
                >
                  <Boxes className="h-3.5 w-3.5 text-teal-600" />
                  <span className="text-[11px] font-semibold text-muted-foreground">묶음상병</span>
                  <span className="text-[10px] text-muted-foreground">{dxSets.length}</span>
                  <ChevronDown
                    className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${setsOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {setsOpen && (
                  <div className="space-y-0.5 pt-0.5">
                    {dxSets.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => applySet(s)}
                        className="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
                        data-testid="dx-picker-set-item"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Plus className="h-3 w-3 shrink-0 text-teal-600" />
                          <span className="truncate text-sm">{s.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">상병 {s.items.length}개</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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

          {/* 푸터 — 완료(패널 닫기). 다중 추가 후 명시적 종료. */}
          {entries.length > 0 && (
            <div className="border-t px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                선택 {entries.length}건 · 맨 위=주상병
              </span>
              <button
                type="button"
                onClick={() => { setOpen(false); setQuery(''); }}
                className="rounded bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-700"
                data-testid="dx-picker-done"
              >
                완료
              </button>
            </div>
          )}
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
  onSelect: (row: DxRow) => void;
  onToggleFav: (serviceId: string, e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
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
