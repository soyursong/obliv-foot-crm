// PrescriptionSetsTab — 처방세트 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 3, 포팅: derm → foot)
// 어드민에서 처방세트 CRUD — 의사가 진료 시 처방 목록을 한 번에 불러옴

import { useState, useEffect, useRef } from 'react';
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
import { Loader2, Plus, Pencil, Trash2, X, Folder, Check, Search, Link2, MoreVertical } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PrescriptionItem {
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  days: number;
  notes: string;
  // T-20260603-foot-RX-CHART-ENHANCE AC-5: prescription_codes 마스터 연결 (nullable, additive).
  //   자유텍스트 수기입력은 null 유지(레거시 무중단). AC-2 금기증 게이트는 이 id 기준으로만 매칭.
  prescription_code_id?: string | null;
  classification?: string | null; // AC-3 색상매핑 프록시 (prescription_codes.classification 스냅샷)
  // T-20260603-foot-RX-CHART-FOLLOWUP3 C-2-5 (#9-1 현장확정): 처방 횟수 = 숫자만(예: 3).
  //   "회"는 값에 포함하지 않고 필드 배경(suffix)에서만 표기. 기존 frequency('1일 3회' 자유텍스트=용법)는
  //   분해하지 않고 별도 횟수칸 신설(additive·nullable, JSONB라 마이그 불요).
  count?: number | null;
}

// T-20260603-foot-RX-CHART-ENHANCE AC-5: prescription_codes.classification → 투여경로(route) 프록시 매핑.
//   route 는 AC-3 색상 도트의 기존 키이므로, 마스터 선택 시 classification 에서 route 를 파생해 채운다.
export function classificationToRoute(classification: string | null | undefined): string {
  const c = (classification ?? '').trim();
  if (!c) return '';
  if (c.includes('내복') || c.includes('경구')) return '경구';
  if (c.includes('외용') || c.includes('도포')) return '외용';
  if (c.includes('주사') || c.includes('점적') || c.includes('정맥') || c.includes('근육') || c.includes('피하')) return '주사';
  if (c.includes('점안')) return '점안';
  if (c.includes('흡입')) return '흡입';
  return ''; // 처치료 등 미매칭 → 기타(회색)
}

// T-20260608-foot-RXSET-MGMT-DRUG-SEARCH: 약품 마스터(prescription_codes) 검색 결과.
//   세트관리에서 약을 담을 때 쓰는 전체 카탈로그 검색 타입. (MedicalChartPanel RxCodeResult 와 동형)
interface RxCodeResult {
  id: string;
  name_ko: string;
  claim_code: string | null;
  classification: string | null;
  code_source: string | null;
}

// T-20260608-foot-RXSET-MGMT-DRUG-SEARCH (AC-1/STEP1 그라운딩 — FE 검색UI 미연결 해소):
//   처방세트(묶음처방) 관리에서 약을 담을 때 검색하는 출처는 '전체 약품 마스터(prescription_codes)'.
//   ⚠️ prescribableDrugs.searchPrescribableDrugs 는 출처를 '처방세트 등록 약'으로 제한 →
//      세트관리에서 쓰면 0건 순환(빈 세트에 약을 담아야 하는데 출처가 비어있음)이므로 사용 금지.
//   MedicalChartPanel.searchRxCodes 와 동일 쿼리(name_ko/claim_code ilike, custom 우선) — 패턴 재사용.
async function searchRxMaster(query: string): Promise<RxCodeResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const esc = q.replace(/[%,]/g, ' ');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('prescription_codes')
    .select('id,name_ko,claim_code,classification,code_source')
    .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
    .order('code_source', { ascending: false }) // custom(자체·카피약) 우선 노출
    .limit(20);
  if (error) throw error;
  return (data as RxCodeResult[]) ?? [];
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder?: string | null; // AC-1 폴더명 (nullable)
}

interface SetForm {
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder: string; // AC-1 폴더명 ('' = 미분류)
}

const EMPTY_ITEM: PrescriptionItem = {
  name: '',
  dosage: '',
  route: '경구',
  frequency: '1일 3회',
  days: 3,
  notes: '',
};

const EMPTY_FORM: SetForm = {
  name: '',
  items: [{ ...EMPTY_ITEM }],
  is_active: true,
  sort_order: 0,
  folder: '',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function usePrescriptionSets() {
  return useQuery({
    queryKey: ['prescription_sets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items, is_active, sort_order, folder')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PrescriptionSet[];
    },
  });
}

function useUpsertSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: SetForm }) => {
      const payload = {
        name: form.name,
        items: form.items as unknown as Record<string, unknown>[],
        is_active: form.is_active,
        sort_order: form.sort_order,
        folder: form.folder.trim() === '' ? null : form.folder.trim(), // AC-1
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('prescription_sets').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('prescription_sets').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('prescription_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 묶음처방(처방세트) 폴더명 인라인 변경.
//   폴더 = prescription_sets.folder 문자열값(별도 분류 테이블 없음) → 같은 폴더값 행 일괄 UPDATE.
//   기존 컬럼 UPDATE only(db_change=false). 빈값/중복 검증은 호출부에서 선행. AC-A(상병명)와 동일 UX.
function useRenameSetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const { error } = await supabase
        .from('prescription_sets')
        .update({ folder: newName, updated_at: new Date().toISOString() })
        .eq('folder', oldName);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('폴더 이름을 바꿨어요.');
    },
    onError: (e: Error) => toast.error(`폴더 이름 변경 실패: ${e.message}`),
  });
}

// T-20260609-foot-RXSET-FOLDER-DND: 세트 카드를 다른 폴더로 드래그&드롭 → 귀속 폴더 변경.
//   폴더 = prescription_sets.folder 단일 문자열 컬럼(별도 분류테이블 없음) →
//   이동 = 대상 세트 row 1건의 folder 값을 대상 폴더명으로 UPDATE(.eq('id', setId)).
//   미분류 드롭 = folder null. 기존 컬럼 UPDATE only(db_change=false). useRenameSetFolder 동형.
//   (문지은 대표원장: "폴더는 드래그로 바로 바꿀수있지 않아?" — KEBAB-GUARD '수정' 제거의 전제 기능)
function useMoveSetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ setId, folder }: { setId: number; folder: string | null }) => {
      const { error } = await supabase
        .from('prescription_sets')
        .update({ folder, updated_at: new Date().toISOString() })
        .eq('id', setId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('폴더를 옮겼어요.');
    },
    onError: (e: Error) => toast.error(`폴더 이동 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub-component: 처방 항목 편집 행
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: PrescriptionItem;
  idx: number;
  onChange: (idx: number, field: keyof PrescriptionItem, val: string | number | null) => void;
  onSelectDrug: (idx: number, code: RxCodeResult) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}

function ItemRow({ item, idx, onChange, onSelectDrug, onRemove, canRemove }: ItemRowProps) {
  // T-20260608-foot-RXSET-MGMT-DRUG-SEARCH: 약품명 필드를 마스터 검색 드롭다운으로.
  //   타이핑 → 디바운스 250ms → searchRxMaster → 결과 드롭다운. 선택 시 부모가 code_id/route/classification 자동채움.
  //   자유텍스트 수기입력도 그대로 허용(레거시 무중단): 선택 안 하면 prescription_code_id=null 유지.
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<RxCodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linked = item.prescription_code_id != null && `${item.prescription_code_id}`.trim() !== '';

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function runSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        setResults(await searchRxMaster(query));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }

  function handleNameChange(v: string) {
    onChange(idx, 'name', v); // 부모가 수기변경 시 code 연결 해제 처리
    setOpen(true);
    runSearch(v);
  }

  function handleSelect(code: RxCodeResult) {
    onSelectDrug(idx, code);
    setOpen(false);
    setResults([]);
  }

  return (
    // T-20260610-foot-RXSET-NAMEDESC-MODEL (Q1 LOCK): 처방세트 항목 = [이름+용량] / [설명] 2칸만.
    //   route·용법(frequency)·횟수(count)·일수(days)·용량(dosage) 입력칸은 세트등록 화면에서 제거.
    //   ⚠️ 값은 보존(손실0): onChange 가 항목 객체를 spread 갱신하므로 숨긴 필드는 그대로 유지되고,
    //      신규 항목은 EMPTY_ITEM 기본값을 캐리. 용법(1/3/2)은 묶음·빠른처방 '불러올 때'(MedicalChartPanel
    //      인라인 편집표 L2920~)에서 입력(비우면 빈칸). 마스터 선택 시 route/classification 자동채움은 유지.
    <div className="grid grid-cols-12 gap-1.5 items-end border rounded-lg p-2.5 bg-muted/30">
      <div className="col-span-8">
        <Label className="text-[10px] flex items-center gap-1">
          이름+용량 *
          {linked && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-teal-600" title="약품 마스터에 연결됨">
              <Link2 className="h-2.5 w-2.5" />연결됨
            </span>
          )}
        </Label>
        <div className="relative mt-0.5" ref={boxRef}>
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <Input
            value={item.name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => { if (item.name.trim()) { setOpen(true); runSearch(item.name); } }}
            placeholder="약품명+용량 (예: 주블리아외용액 4ml)·보험코드 검색"
            className="h-7 text-xs pl-6"
            data-testid="rx-set-item-name-input"
            autoComplete="off"
          />
          {open && item.name.trim().length >= 1 && (
            <div
              className="absolute z-50 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md"
              data-testid="rx-set-drug-search-dropdown"
            >
              {searching ? (
                <div className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> 검색 중…
                </div>
              ) : results.length === 0 ? (
                <div className="px-2.5 py-3 text-[11px] text-muted-foreground text-center" data-testid="rx-set-drug-search-empty">
                  검색 결과가 없습니다.
                  <span className="block text-[10px] mt-0.5 text-muted-foreground/70">입력한 이름 그대로 수기 등록됩니다.</span>
                </div>
              ) : (
                results.map((code) => (
                  <button
                    key={code.id}
                    type="button"
                    onClick={() => handleSelect(code)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-accent border-b last:border-b-0"
                    data-testid="rx-set-drug-search-option"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">{code.name_ko}</span>
                      {code.code_source === 'custom' && (
                        <Badge variant="secondary" className="text-[9px] h-3.5 px-1">자체</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {code.claim_code && <span className="font-mono">{code.claim_code}</span>}
                      {code.classification && <span>· {code.classification}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      {/* T-20260610-foot-RXSET-NAMEDESC-MODEL (Q1 LOCK): [설명] = notes 칸.
          용량(dosage)·투여경로(route)·용법(frequency)·횟수(count)·일수(days) 입력칸은 제거.
          숨긴 값은 item 객체에 보존(onChange spread)되고, 마스터 선택 시 route/classification 자동채움 유지. */}
      <div className="col-span-3">
        <Label className="text-[10px]">설명</Label>
        <Input
          value={item.notes}
          onChange={(e) => onChange(idx, 'notes', e.target.value)}
          placeholder="분류·메모 (예: 항진균제 연고)"
          className="h-7 text-xs mt-0.5"
          data-testid="rx-set-item-notes-input"
        />
      </div>
      <div className="col-span-1 flex items-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onRemove(idx)}
          disabled={!canRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RxSetKebabMenu — T-20260609-foot-RXSET-DELETE-KEBAB-GUARD
//   삭제 직접노출 제거 → 우측상단 ⋮(MoreVertical) 케밥. 메뉴엔 "삭제" 단일 옵션만.
//   (스펙 변경 MSG-…-dj5p, 문지은 대표원장: "수정은 무의미하지 폴더는 드래그로 바꾸지 않아?"
//    → '수정' 진입점 제거. 폴더이동은 별건 T-20260609-foot-RXSET-FOLDER-DND.)
//   신규 npm 패키지(@radix-ui/*) 대신 경량 인라인 popover(클릭 토글 + 바깥클릭/ESC 닫힘).
//   삭제는 destructive 톤. 실제 del 은 부모의 확인 다이얼로그에서만 실행.
// ---------------------------------------------------------------------------
function RxSetKebabMenu({
  onDelete,
  deleteDisabled,
}: {
  onDelete: () => void;
  deleteDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 바깥클릭/ESC 닫힘 — 열렸을 때만 document 리스너 부착(카드 다수여도 1개만 활성).
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
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setOpen((v) => !v)}
        title="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="rx-set-kebab-btn"
      >
        <MoreVertical className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 min-w-[128px] overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          data-testid="rx-set-kebab-menu"
        >
          {/* 삭제 단일 옵션 (수정 옵션 없음 — 스펙 변경 dj5p) */}
          <button
            type="button"
            role="menuitem"
            disabled={deleteDisabled}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            data-testid="rx-set-action-delete"
          >
            <Trash2 className="h-3.5 w-3.5" /> 삭제
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PrescriptionSetsTab() {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원은 읽기 전용, CRUD는 권한 보유 role만.
  // T-20260603-foot-RX-CHART-FOLLOWUP2 #8-2(문지은 대표원장): 처방세트 관리(등록/수정/삭제)
  //   권한 = 의사(director)/총괄(manager)/관리자(admin)급. director 누락 → 대표원장 본인이
  //   처방세트를 관리하지 못하던 갭 해소. QuickRxBar 의 DOCTOR_ROLES 와 동일 집합.
  const RX_SET_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;
  const { profile } = useAuth();
  const canEdit = !!profile?.role && (RX_SET_MANAGE_ROLES as readonly string[]).includes(profile.role);
  const { data: sets = [], isLoading } = usePrescriptionSets();
  const upsert = useUpsertSet();
  const del = useDeleteSet();
  // T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 폴더명 인라인 변경 (AC-A 상병명과 동일 UX).
  const renameFolder = useRenameSetFolder();
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // T-20260609-foot-RXSET-FOLDER-DND: 드래그 중인 세트 id + 드롭 하이라이트 폴더키.
  const moveFolder = useMoveSetFolder();
  const [draggingSetId, setDraggingSetId] = useState<number | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrescriptionSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);
  // T-20260609-foot-RXSET-DELETE-KEBAB-GUARD: 삭제 확인 다이얼로그 대상(네이티브 confirm 대체).
  const [deleteTarget, setDeleteTarget] = useState<PrescriptionSet | null>(null);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setOpen(true);
  }

  // T-20260609-foot-RXSET-DELETE-KEBAB-GUARD (스펙변경 dj5p): 세트 편집 진입점 제거.
  //   현장: "수정은 무의미하지 폴더는 드래그로 바꾸지 않아?" → openEdit(편집 모달) 제거.
  //   편집 인프라(editing 상태·upsert {id} 분기)는 잔존하나 UI 진입점은 추가(openAdd)만.

  function handleItemChange(idx: number, field: keyof PrescriptionItem, val: string | number | null) {
    setForm((f) => {
      const items = [...f.items];
      const next = { ...items[idx], [field]: val };
      // T-20260608-foot-RXSET-MGMT-DRUG-SEARCH: 약품명을 수기로 바꾸면 마스터 연결 해제.
      //   (잘못된 prescription_code_id/classification 잔존 방지 — 다시 검색·선택해야 재연결)
      if (field === 'name') {
        next.prescription_code_id = null;
        next.classification = null;
      }
      items[idx] = next;
      return { ...f, items };
    });
  }

  // T-20260608-foot-RXSET-MGMT-DRUG-SEARCH (AC-2): 검색 결과 약 1건 선택 → 세트 항목에 채움.
  //   name·route(classification 파생)·classification·prescription_code_id 자동채움.
  //   route 는 파생값이 비면 기존 값 유지(기타 분류 약 보호). dosage/frequency/days 등 사용자 입력은 보존.
  function handleSelectDrug(idx: number, code: RxCodeResult) {
    setForm((f) => {
      const items = [...f.items];
      const derivedRoute = classificationToRoute(code.classification);
      items[idx] = {
        ...items[idx],
        name: code.name_ko,
        route: derivedRoute || items[idx].route,
        classification: code.classification ?? null,
        prescription_code_id: code.id,
      };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('처방세트 이름을 입력해주세요.');
    if (form.items.some((i) => !i.name.trim())) return toast.error('각 처방 항목에 이름을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  // T-20260609-foot-RXSET-DELETE-KEBAB-GUARD: 네이티브 confirm() 제거.
  //   케밥 "삭제" → 확인 다이얼로그(setDeleteTarget). 실제 del 은 다이얼로그 [삭제]에서만 실행.
  function confirmDelete() {
    if (!deleteTarget) return;
    del.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
  }

  // T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 폴더명 인라인 변경 핸들러 (AC-A와 동일 로직)
  function startRenameFolder(folder: string) {
    if (!canEdit || folder === NO_FOLDER) return; // 권한 없음/미분류(합성 폴더)는 변경 불가
    setRenamingFolder(folder);
    setRenameValue(folder);
  }
  function cancelRenameFolder() {
    setRenamingFolder(null);
    setRenameValue('');
  }
  async function submitRenameFolder() {
    if (!renamingFolder) return;
    const oldName = renamingFolder;
    const next = renameValue.trim();
    if (!next) return toast.error('폴더 이름을 입력해주세요.'); // 빈값 검증
    if (next === oldName) return cancelRenameFolder(); // 변경 없음
    if (next === NO_FOLDER) return toast.error(`"${NO_FOLDER}"는 폴더 이름으로 쓸 수 없어요.`);
    // 중복 검증 — 다른 폴더와 동일 이름 금지(미분류/자기자신 제외)
    if (folderNames.some((f) => f !== oldName && f === next)) {
      return toast.error('이미 있는 폴더 이름이에요.');
    }
    await renameFolder.mutateAsync({ oldName, newName: next });
    cancelRenameFolder();
  }

  // T-20260609-foot-RXSET-FOLDER-DND: 세트 카드 드래그&드롭 → 폴더 이동.
  //   대상 폴더키가 NO_FOLDER(합성 '미분류')면 folder=null. 현재폴더 재드롭은 no-op.
  function handleSetDragStart(setId: number) {
    if (!canEdit) return;
    setDraggingSetId(setId);
  }
  function handleSetDragEnd() {
    setDraggingSetId(null);
    setDragOverFolder(null);
  }
  function handleDropToFolder(targetFolderKey: string) {
    const setId = draggingSetId;
    setDraggingSetId(null);
    setDragOverFolder(null);
    if (!canEdit || setId == null) return;
    const set = sets.find((s) => s.id === setId);
    if (!set) return;
    const currentKey = set.folder?.trim() ? set.folder.trim() : NO_FOLDER;
    if (currentKey === targetFolderKey) return; // 같은 폴더 재드롭 = no-op
    moveFolder.mutate({ setId, folder: targetFolderKey === NO_FOLDER ? null : targetFolderKey });
  }

  // AC-1: 폴더별 그룹핑 (미분류는 맨 끝). 폴더 내부는 기존 sort_order 순서 유지.
  const NO_FOLDER = '미분류';
  const grouped = (() => {
    const map = new Map<string, PrescriptionSet[]>();
    for (const s of sets) {
      const key = s.folder?.trim() ? s.folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    // 폴더명 가나다순, 미분류 맨 끝
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  })();
  const folderNames = Array.from(
    new Set(sets.map((s) => s.folder?.trim()).filter((x): x is string => !!x)),
  ).sort((a, b) => a.localeCompare(b, 'ko'));

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* T-20260606-foot-RX-SET-REDESIGN AC-R6 용어 매핑(코드 식별자 ↔ 현장용어):
            이 화면의 "처방세트"(코드 prescription_sets) = 현장용어 "묶음처방"(이름+약 묶음 프리셋).
            개별 약품을 분류하는 "약품 폴더"(prescription_folders)는 별도 탭(DrugFoldersTab). */}
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[11px] text-muted-foreground">
        이 화면은 <span className="font-semibold text-teal-700">묶음처방</span>(이름 + 약 묶음, 빠른처방 프리셋) 관리입니다.
        개별 약품을 폴더로 분류하려면 <span className="font-medium">처방세트</span> 탭을 이용하세요.
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{sets.length}개 처방세트</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="rx-set-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            처방세트 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 처방세트가 없습니다.
        </div>
      ) : (
        <div className="space-y-4" data-testid="rx-set-list">
          {grouped.map((g) => (
            <div
              key={g.folder}
              data-testid="rx-set-folder-group"
              // T-20260609-foot-RXSET-FOLDER-DND: 폴더 그룹 = 드롭존. 드래그 오버 시 ring 하이라이트.
              className={
                draggingSetId != null && dragOverFolder === g.folder
                  ? 'rounded-lg ring-2 ring-teal-400 ring-offset-2 transition-shadow'
                  : 'rounded-lg transition-shadow'
              }
              onDragOver={(e) => {
                if (!canEdit || draggingSetId == null) return;
                e.preventDefault(); // 드롭 허용
                if (dragOverFolder !== g.folder) setDragOverFolder(g.folder);
              }}
              onDragLeave={(e) => {
                // 자식으로의 이동은 무시(컨테이너 밖으로 나갈 때만 해제)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverFolder((cur) => (cur === g.folder ? null : cur));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropToFolder(g.folder);
              }}
            >
              {/* AC-1: 폴더 헤더 / T-20260607 AC-B: 더블클릭·우클릭·연필버튼 → 인라인 이름 변경 */}
              {renamingFolder === g.folder ? (
                <div
                  className="flex items-center gap-1 mb-1.5 px-1"
                  data-testid="rx-set-folder-header"
                  data-renaming="true"
                >
                  <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitRenameFolder();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameFolder();
                      }
                    }}
                    className="h-7 text-xs px-1.5 max-w-[220px]"
                    data-testid="rx-set-folder-rename-input"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-teal-600 hover:text-teal-700"
                    onClick={submitRenameFolder}
                    disabled={renameFolder.isPending}
                    title="저장"
                    data-testid="rx-set-folder-rename-save"
                  >
                    {renameFolder.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={cancelRenameFolder}
                    disabled={renameFolder.isPending}
                    title="취소"
                    data-testid="rx-set-folder-rename-cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div
                  className="group flex items-center gap-1.5 mb-1.5 px-1"
                  data-testid="rx-set-folder-header"
                  onDoubleClick={() => canEdit && g.folder !== NO_FOLDER && startRenameFolder(g.folder)}
                  onContextMenu={(e) => {
                    if (!canEdit || g.folder === NO_FOLDER) return;
                    e.preventDefault();
                    startRenameFolder(g.folder);
                  }}
                >
                  <Folder className="h-3.5 w-3.5 text-teal-600" />
                  <span className="text-xs font-semibold text-foreground select-none" data-testid="rx-set-folder-name">
                    {g.folder}
                  </span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{g.items.length}</Badge>
                  {canEdit && g.folder !== NO_FOLDER && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground/50 hover:text-teal-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => startRenameFolder(g.folder)}
                      title="폴더 이름 바꾸기"
                      data-testid="rx-set-folder-rename-btn"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
              <div className="space-y-2 pl-1">
          {g.items.map((s) => (
            <div
              key={s.id}
              // T-20260609-foot-RXSET-FOLDER-DND: 권한 보유 시 카드를 다른 폴더로 드래그 이동.
              draggable={canEdit}
              onDragStart={(e) => {
                if (!canEdit) return;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(s.id));
                handleSetDragStart(s.id);
              }}
              onDragEnd={handleSetDragEnd}
              className={`rounded-lg border bg-card px-4 py-3 ${
                canEdit ? 'cursor-grab active:cursor-grabbing' : ''
              } ${draggingSetId === s.id ? 'opacity-50' : ''}`}
              data-testid="rx-set-item"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {s.name}
                  </span>
                  {!s.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {s.items.length}개 항목
                  </Badge>
                </div>
                {canEdit && (
                  // T-20260609-foot-RXSET-DELETE-KEBAB-GUARD: 삭제 직접노출 제거 → 우측상단 ⋮ 케밥(삭제 단일).
                  <RxSetKebabMenu
                    onDelete={() => setDeleteTarget(s)}
                    deleteDisabled={del.isPending}
                  />
                )}
              </div>
              {s.items.length > 0 && (
                <div className="space-y-1">
                  {/* T-20260610-foot-RXSET-NAMEDESC-MODEL (Q2): 세트관리 카드 = [이름+용량] + [설명] 만.
                      route/용법/횟수/일수 메타는 '불러올 때' 입력이므로 세트관리 미리보기에서 제거. */}
                  {s.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.notes && <span className="text-muted-foreground">· {item.notes}</span>}
                    </div>
                  ))}
                  {s.items.length > 3 && (
                    <p className="text-[11px] text-muted-foreground">+{s.items.length - 3}개 항목 더</p>
                  )}
                </div>
              )}
            </div>
          ))}
              </div>
            </div>
          ))}
          {/* T-20260609-foot-RXSET-FOLDER-DND: 모든 세트가 폴더에 속해 '미분류' 그룹이 없는 경우,
              드래그 중에만 '미분류' 드롭존을 노출해 폴더 해제(folder=null) 경로를 보장. */}
          {draggingSetId != null && !grouped.some((g) => g.folder === NO_FOLDER) && (
            <div
              data-testid="rx-set-unfiled-dropzone"
              className={`rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground transition-colors ${
                dragOverFolder === NO_FOLDER ? 'ring-2 ring-teal-400 bg-teal-50/40' : ''
              }`}
              onDragOver={(e) => {
                if (!canEdit || draggingSetId == null) return;
                e.preventDefault();
                if (dragOverFolder !== NO_FOLDER) setDragOverFolder(NO_FOLDER);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverFolder((cur) => (cur === NO_FOLDER ? null : cur));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDropToFolder(NO_FOLDER);
              }}
            >
              여기에 놓으면 <span className="font-medium text-teal-700">{NO_FOLDER}</span>로 이동돼요.
            </div>
          )}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '처방세트 수정' : '처방세트 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">처방세트 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 발톱무좀 기본 처방"
                  className="mt-1"
                  data-testid="rx-set-name-input"
                />
              </div>
              {/* AC-1: 폴더(분류) — 같은 이름끼리 묶임. 비우면 미분류. */}
              <div>
                <Label className="text-xs">폴더 (분류)</Label>
                <Input
                  value={form.folder}
                  onChange={(e) => setForm((f) => ({ ...f, folder: e.target.value }))}
                  placeholder="예) 무좀"
                  className="mt-1"
                  list="rx-folder-suggestions"
                  data-testid="rx-set-folder-input"
                />
                <datalist id="rx-folder-suggestions">
                  {folderNames.map((fn) => (
                    <option key={fn} value={fn} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1"
                  min={0}
                />
              </div>
            </div>

            {/* 처방 항목 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">처방 항목 ({form.items.length}개)</Label>
                <Button size="sm" variant="ghost" onClick={addItem} className="h-6 text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  항목 추가
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <ItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    onChange={handleItemChange}
                    onSelectDrug={handleSelectDrug}
                    onRemove={removeItem}
                    canRemove={form.items.length > 1}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="rx-set-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* T-20260609-foot-RXSET-DELETE-KEBAB-GUARD: 삭제 확인 다이얼로그 (네이티브 confirm 대체) */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm" data-testid="rx-set-delete-dialog">
          <DialogHeader>
            <DialogTitle>처방세트 삭제</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            처방세트 &lsquo;{deleteTarget?.name}&rsquo;을 삭제할까요? 이 작업은 되돌릴 수 없어요.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>취소</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={del.isPending}
              data-testid="rx-set-delete-confirm-btn"
            >
              {del.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
