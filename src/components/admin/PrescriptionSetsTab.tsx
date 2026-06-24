// PrescriptionSetsTab — 처방세트 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 3, 포팅: derm → foot)
// 어드민에서 처방세트 CRUD — 의사가 진료 시 처방 목록을 한 번에 불러옴

import { useState, useEffect, useRef } from 'react';
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
import RxCountInput from '@/components/admin/RxCountInput';
import { RX_COL } from '@/lib/rxFormat';
import { searchServiceRxDrugs } from '@/lib/prescribableDrugs';
import { Loader2, Plus, Pencil, Trash2, X, Folder, Check, Search, Link2, MoreVertical, Tag } from 'lucide-react';
// T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 태그/아이콘 vocab SSOT 공유 — 빠른처방과 동일 어휘(분기 방지).
import { DRUG_ICON_OPTIONS, IconRenderer } from '@/components/admin/QuickRxButtonsTab';
import { RX_TAG_COLORS, DEFAULT_RX_TAG_COLOR, tagChipClass } from '@/lib/rxTagPalette';

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

// 세트관리에서 약을 담을 때 쓰는 검색 결과 행 타입.
//   T-20260615-foot-RXSET-DRUGSOURCE-SVCRX: 약 출처를 services 처방약으로 스왑(아래 searchRxMaster 참조).
//   id = services.id (⚠️ prescription_codes.id 아님 — handleSelectDrug에서 prescription_code_id로 저장 금지).
interface RxCodeResult {
  id: string;
  name_ko: string;
  claim_code: string | null; // services.service_code(EDI 청구코드) 표시용
  classification: string | null; // services 처방약은 분류 미보유 → 항상 null
  code_source: string | null; // services 소스 → '자체' 배지 미표시(null)
}

// T-20260615-foot-RXSET-DRUGSOURCE-SVCRX (AC-1): 처방세트 빌더 약 출처 스왑.
//   (이전) 전체 EDI 약품 마스터(prescription_codes) 자유검색 →
//   (현재) services category_label='처방약' AND active=true 리스트(근방 약국 실제 처방 가능 약).
//   김주연 총괄 A(공유) 회신. 단일 재바인딩 지점 = prescribableDrugs.searchServiceRxDrugs.
//   query '' → 전체 처방약 리스트(포커스 시 '리스트 선택' UX). 처방약 외 임의 EDI 약명은 결과에 안 뜸.
async function searchRxMaster(query: string): Promise<RxCodeResult[]> {
  const rows = await searchServiceRxDrugs(query);
  return rows.map((r) => ({
    id: r.id, // services.id (전시·key 용도. prescription_code_id로 저장 금지)
    name_ko: r.name,
    claim_code: r.service_code,
    classification: null,
    code_source: null,
  }));
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder?: string | null; // AC-1 폴더명 (nullable)
  // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: set-level 태그/아이콘 메타(ADDITIVE, nullable).
  //   tag_label=라벨 텍스트, tag_color=tailwind 팔레트 토큰(rxTagPalette SSOT), icon=lucide 식별자(DRUG_ICON_OPTIONS).
  tag_label?: string | null;
  tag_color?: string | null;
  icon?: string | null;
  // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL: 태그칩 이름 숨김(true=아이콘+색상만). 표시 플래그(name/tag_label 보존).
  hide_name?: boolean | null;
}

interface SetForm {
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder: string; // AC-1 폴더명 ('' = 미분류)
  // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: '' / null = 태그·아이콘 없음.
  tag_label: string;
  tag_color: string;
  icon: string;
  // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL: 이름 숨기기 토글.
  hide_name: boolean;
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
  tag_label: '',
  tag_color: DEFAULT_RX_TAG_COLOR,
  icon: '',
  hide_name: false,
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
        .select('id, name, items, is_active, sort_order, folder, tag_label, tag_color, icon, hide_name')
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
        // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER → T-20260617 OVERHAUL: 태그 식별자(라벨 또는 아이콘) 둘 다 없으면 색/태그 null.
        //   ★ 이름숨김(hide_name)+아이콘만 인 묶음도 '태그 있음' → tag_color 보존(useUpdateSetTagMeta 의 hasTag 와 동형).
        //     (구버전은 라벨만으로 판단해 icon-only hide_name 태그의 색을 null 화 → 진료화면 칩 미렌더 회귀가 있었음.)
        ...(() => {
          const label = form.tag_label.trim();
          const iconV = form.icon.trim();
          const hasTag = label !== '' || iconV !== '';
          return {
            tag_label: label === '' ? null : label,
            tag_color: hasTag ? (form.tag_color || DEFAULT_RX_TAG_COLOR) : null,
            icon: iconV === '' ? null : iconV,
          };
        })(),
        // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL: 이름 숨김 플래그(아이콘만 있을 때도 의미 있음).
        hide_name: !!form.hide_name,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        // T-20260624-foot-BUNDLERX-ICON-NOAPPLY (AC-0): .select() 로 영향 행 회수 →
        //   RLS 필터로 0행이 되면 error:null 이라도 throw(silent no-op = false-positive 성공토스트 차단).
        const { data, error } = await supabase
          .from('prescription_sets')
          .update(payload)
          .eq('id', id)
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0)
          throw new Error('수정 권한이 없거나 대상을 찾지 못했어요. 변경된 내용이 없습니다.');
      } else {
        const { data, error } = await supabase.from('prescription_sets').insert(payload).select('id');
        if (error) throw error;
        if (!data || data.length === 0)
          throw new Error('저장 권한이 없어요. 새 처방세트가 생성되지 않았습니다.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

// T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 태그/아이콘 메타만 부분 UPDATE.
//   KEBAB-GUARD(dj5p)로 전체 '수정' 진입점은 제거됨 — 태그는 별도 경량 편집(라벨/색/아이콘 3컬럼만)으로 부여.
//   기존 컬럼 외 무접촉(items/name/folder 등 보존). tag_label 비면 색까지 null 정규화(고아 색 방지).
interface TagMeta {
  tag_label: string;
  tag_color: string;
  icon: string;
  hide_name: boolean; // T-20260617 OVERHAUL: 이름 숨김 토글.
}
function useUpdateSetTagMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, meta }: { id: number; meta: TagMeta }) => {
      const label = meta.tag_label.trim();
      // 이름숨김+아이콘만(라벨 없음)도 유효한 태그 → 라벨 비어도 색은 유지(아이콘 식별).
      const hasTag = label !== '' || meta.icon.trim() !== '';
      const payload = {
        tag_label: label === '' ? null : label,
        tag_color: hasTag ? (meta.tag_color || DEFAULT_RX_TAG_COLOR) : null,
        icon: meta.icon.trim() === '' ? null : meta.icon.trim(),
        hide_name: !!meta.hide_name,
        updated_at: new Date().toISOString(),
      };
      // T-20260624-foot-BUNDLERX-ICON-NOAPPLY (AC-0): .select() 로 0행 RLS no-op 검출 → throw.
      const { data, error } = await supabase
        .from('prescription_sets')
        .update(payload)
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error('태그를 저장할 권한이 없거나 대상을 찾지 못했어요. 변경된 내용이 없습니다.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('태그를 저장했어요.');
    },
    onError: (e: Error) => toast.error(`태그 저장 실패: ${e.message}`),
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

  // T-20260615-foot-RXSET-DRUGSOURCE-SVCRX: 빈 쿼리도 전체 처방약 리스트 노출('리스트 선택' UX).
  //   (이전엔 1글자 미만이면 결과 비움 — 자유검색 전제. 이제 services 처방약 ≤16건 전체를 즉시 보여줌.)
  function runSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    setSearching(true);
    const delay = query.length < 1 ? 0 : 250;
    debounceRef.current = setTimeout(async () => {
      try {
        setResults(await searchRxMaster(query));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, delay);
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
    <div className="grid grid-cols-12 gap-1.5 items-end border rounded-lg p-2.5 bg-muted/30">
      {/* T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE AC-2 (NAMEDESC AC2-2 PARTIAL supersede):
          묶음처방 빌더에 1/3/2(용량·횟수·일수) baked default 입력 재도입 → items JSONB로 저장.
          문지은 대표원장(MSG-20260615-001650): "묶음처방에 숫자까지 넣어서 저장하고 처방할때 진료의가 수동 조정 가능."
          저장값은 default일 뿐 잠금 아님 — 적용(처방 흡수) 시 진료의가 use-time 수동 조정 가능(AC-3, MedicalChartPanel formRx).
          투여경로·용법(frequency)은 여전히 등록화면 미노출(use-time 입력 유지) — NAMEDESC AC2-2 중 route/frequency 금지만 존속. */}
      <div className="col-span-4">
        <Label className="text-[10px] flex items-center gap-1">
          {RX_COL.name} *
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
            onFocus={() => { setOpen(true); runSearch(item.name); }}
            placeholder="처방약 목록에서 선택 (이름·코드 검색)"
            className="h-7 text-xs pl-6"
            data-testid="rx-set-item-name-input"
            autoComplete="off"
          />
          {open && (
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
      <div className="col-span-2">
        <Label className="text-[10px]">{RX_COL.dosage}</Label>
        <Input
          value={item.dosage}
          onChange={(e) => onChange(idx, 'dosage', e.target.value)}
          placeholder="적정량"
          className="h-7 text-xs mt-0.5"
          data-testid="rx-set-item-dosage-input"
        />
      </div>
      {/* AC-2: 횟수(count) baked default — 숫자만 저장, "회"는 RxCountInput suffix. use-time 수동 조정 가능. */}
      <div className="col-span-2">
        <Label className="text-[10px]">{RX_COL.count}</Label>
        <RxCountInput
          value={item.count ?? null}
          onChange={(v) => onChange(idx, 'count', v)}
        />
      </div>
      {/* AC-2: 일수(days) baked default — 정수. use-time 수동 조정 가능. */}
      <div className="col-span-1">
        <Label className="text-[10px]">{RX_COL.days}</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={item.days}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(idx, 'days', raw === '' ? 0 : Math.max(0, Math.floor(Number(raw)) || 0));
          }}
          placeholder="3"
          className="h-7 text-xs mt-0.5 text-center"
          data-testid="rx-set-item-days-input"
        />
      </div>
      {/* 설명(notes) — 상세 관리화면 限 노출(공식문서·미니멀목록 금지, AC-4). 투여경로/용법(frequency) 입력칸은 제거(값은 보존). */}
      <div className="col-span-2">
        <Label className="text-[10px]">설명</Label>
        <Input
          value={item.notes}
          onChange={(e) => onChange(idx, 'notes', e.target.value)}
          placeholder="분류·메모"
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
  onEdit,
  onEditTag,
  onDelete,
  deleteDisabled,
}: {
  onEdit?: () => void;
  onEditTag?: () => void;
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
          {/* T-20260617-foot-...-OVERHAUL Part G2: 우측 단 묶음처방 '수정'(이름/색/아이콘/이름숨김/약·1·3·2 일괄).
              dj5p로 제거됐던 전체 수정 진입점을 reporter 직접요청(MSG-0b5d)으로 재도입 — 생성 팝업 재사용. */}
          {onEdit && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              data-testid="rx-set-action-edit"
            >
              <Pencil className="h-3.5 w-3.5" /> 수정
            </button>
          )}
          {/* T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 태그 편집(라벨/색/아이콘 경량 편집).
              전체 '수정' 진입점은 dj5p로 제거됐으나, 태그는 별도 경량 부여 동선으로 제공. */}
          {onEditTag && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              onClick={() => {
                setOpen(false);
                onEditTag();
              }}
              data-testid="rx-set-action-edit-tag"
            >
              <Tag className="h-3.5 w-3.5" /> 태그 편집
            </button>
          )}
          {/* 삭제 옵션 */}
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
// TagEditorFields — 태그 편집 공통 필드(이름/이름숨김/10색/아이콘/미리보기).
//   T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL Part C. 생성 팝업·태그편집 다이얼로그 양쪽 재사용(분기 방지).
//   testid는 idPrefix로 분기(기존 TAG-QUICKTRIGGER 스펙 호환 위해 편집 다이얼로그는 'rx-set-tag' 유지).
// ---------------------------------------------------------------------------
interface TagFieldsValue {
  tag_label: string;
  tag_color: string;
  icon: string;
  hide_name: boolean;
}
function TagEditorFields({
  value,
  onChange,
  idPrefix,
}: {
  value: TagFieldsValue;
  onChange: (patch: Partial<TagFieldsValue>) => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      {/* 라벨 + 이름 숨기기 */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">묶음처방 이름</Label>
          {/* '이름 숨기기 <' 옵션 — ON: 태그 안에 아이콘(이모지)+색상만, 이름 생략 */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid={`${idPrefix}-hidename-wrap`}>
            <span className="text-[11px] text-muted-foreground">이름 숨기기</span>
            <Switch
              checked={value.hide_name}
              onCheckedChange={(v) => onChange({ hide_name: v })}
              data-testid={`${idPrefix}-hidename-toggle`}
            />
          </label>
        </div>
        <Input
          value={value.tag_label}
          onChange={(e) => onChange({ tag_label: e.target.value })}
          placeholder="예) 무좀"
          className="mt-1"
          maxLength={12}
          data-testid={`${idPrefix}-label-input`}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          {value.hide_name
            ? '이름을 숨기면 태그에 아이콘+색상만 표시돼요(아이콘을 골라주세요).'
            : '비우면 태그가 사라져요.'}
        </p>
      </div>

      {/* 색상 팔레트 (rxTagPalette SSOT — 10색 어두운톤) */}
      <div>
        <Label className="text-xs">색상</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={`${idPrefix}-color-palette`}>
          {RX_TAG_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange({ tag_color: c.value })}
              title={c.label}
              aria-label={`색상 ${c.label}`}
              aria-pressed={value.tag_color === c.value}
              data-testid={`${idPrefix}-color-${c.value}`}
              className={`h-7 w-7 rounded-full ${c.dot} transition ${
                value.tag_color === c.value
                  ? 'ring-2 ring-offset-2 ring-foreground'
                  : 'opacity-70 hover:opacity-100'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 아이콘 (quick_rx_buttons 와 동일 vocab — DRUG_ICON_OPTIONS). 안 고를 수도 있음. 고르면 태그 왼쪽 배치. */}
      <div>
        <Label className="text-xs">아이콘 (선택)</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={`${idPrefix}-icon-palette`}>
          <button
            type="button"
            onClick={() => onChange({ icon: '' })}
            aria-pressed={value.icon === ''}
            title="아이콘 없음"
            data-testid={`${idPrefix}-icon-none`}
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-[10px] text-muted-foreground transition ${
              value.icon === '' ? 'border-teal-500 bg-teal-50' : 'hover:bg-accent'
            }`}
          >
            없음
          </button>
          {DRUG_ICON_OPTIONS.map(({ value: iv, label }) => (
            <button
              key={iv}
              type="button"
              onClick={() => onChange({ icon: iv })}
              aria-pressed={value.icon === iv}
              title={label}
              aria-label={`아이콘 ${label}`}
              data-testid={`${idPrefix}-icon-${iv}`}
              className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
                value.icon === iv ? 'border-teal-500 bg-teal-50 text-teal-700' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <IconRenderer icon={iv} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {/* 미리보기 칩 — 이름숨김 반영(아이콘+색만) */}
      {(value.tag_label.trim() || (value.hide_name && value.icon)) && (
        <div>
          <Label className="text-xs">미리보기</Label>
          <div className="mt-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tagChipClass(value.tag_color)}`}
              data-testid={`${idPrefix}-preview-chip`}
              data-hide-name={value.hide_name ? 'true' : 'false'}
            >
              {value.icon && <IconRenderer icon={value.icon} className="h-3 w-3" />}
              {!value.hide_name && value.tag_label.trim()}
            </span>
          </div>
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
  // T-20260603-foot-RX-CHART-FOLLOWUP2 #8-2(문지은 대표원장): 처방세트 관리(등록/수정/삭제) 권한.
  //   T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 진료관리 write = director+admin 통일
  //   (manager 제거 = 노출 축소). prescription_sets RLS write 旣존 {admin,manager,director} → director 무회귀.
  //   → 공통 헬퍼 canEditClinicMgmt 재사용.
  const { profile } = useAuth();
  // T-20260619-foot-ROLE-MATRIX-3TIER-RBAC: profile 전달(has_ops_authority 반영).
  const canEdit = canEditClinicMgmt(profile);
  const { data: sets = [], isLoading } = usePrescriptionSets();
  const upsert = useUpsertSet();
  const del = useDeleteSet();
  // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 태그 메타 경량 편집(라벨/색/아이콘).
  const updateTagMeta = useUpdateSetTagMeta();
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
  // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 태그 편집 대상 + 경량 폼(라벨/색/아이콘 + 이름숨김).
  const [tagTarget, setTagTarget] = useState<PrescriptionSet | null>(null);
  const [tagForm, setTagForm] = useState<TagMeta>({ tag_label: '', tag_color: DEFAULT_RX_TAG_COLOR, icon: '', hide_name: false });

  function openEditTag(s: PrescriptionSet) {
    setTagTarget(s);
    setTagForm({
      tag_label: s.tag_label ?? '',
      tag_color: s.tag_color ?? DEFAULT_RX_TAG_COLOR,
      icon: s.icon ?? '',
      hide_name: !!s.hide_name,
    });
  }
  async function handleSaveTag() {
    if (!tagTarget) return;
    // 이름숨김 ON 인데 라벨·아이콘 둘 다 없으면 식별 불가 → 검증(시나리오4-2와 동형).
    if (tagForm.hide_name && tagForm.tag_label.trim() === '' && tagForm.icon.trim() === '') {
      return toast.error('이름을 숨기려면 아이콘을 골라주세요.');
    }
    await updateTagMeta.mutateAsync({ id: tagTarget.id, meta: tagForm });
    setTagTarget(null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — 신규 생성 동선(좌측 약 테이블 → 생성 팝업)
  //   Part B: 좌측 단 = services 처방약 테이블뷰(체크박스+검색).  Part C/D: 생성 팝업(태그편집+선택약 1·3·2).
  //   기존 '처방세트 추가'(ItemRow) 동선은 회귀호환 위해 보존 — 본 동선은 ADDITIVE 새 경로.
  // ───────────────────────────────────────────────────────────────────────────
  const [drugSearch, setDrugSearch] = useState('');
  // 체크된 약: services.id → {id,name,service_code} (선택 순서 보존 위해 배열).
  const [checkedDrugs, setCheckedDrugs] = useState<{ id: string; name: string; service_code: string | null }[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<SetForm>(EMPTY_FORM);
  // T-20260617-foot-...-OVERHAUL Part G2: 우측 단 생성 묶음처방 '수정'. 생성 팝업(Part C/D)을 그대로 재사용 —
  //   editingSetId != null 이면 같은 팝업이 '수정' 모드(upsert {id})로 동작(이름/색/아이콘/이름숨김/약·1·3·2 일괄 편집).
  //   별도 인플레이스 편집 컴포넌트를 만들지 않음(회귀면 최소화 + create/edit 단일 폼).
  const [editingSetId, setEditingSetId] = useState<number | null>(null);

  // Part B 좌측 테이블 약 출처 = services 처방약(빌더 현행 출처, gate#1 ⓑ 확정). 전체 1회 로드 후 클라 실시간 필터.
  const { data: allRxDrugs = [], isLoading: drugsLoading } = useQuery({
    queryKey: ['service_rx_drugs', 'all'],
    queryFn: () => searchServiceRxDrugs(''),
    staleTime: 60_000,
  });
  const filteredDrugs = (() => {
    const q = drugSearch.trim().toLowerCase();
    if (!q) return allRxDrugs;
    return allRxDrugs.filter(
      (d) => d.name.toLowerCase().includes(q) || (d.service_code ?? '').toLowerCase().includes(q),
    );
  })();
  const checkedIds = new Set(checkedDrugs.map((d) => d.id));
  const allFilteredChecked = filteredDrugs.length > 0 && filteredDrugs.every((d) => checkedIds.has(d.id));

  function toggleDrug(d: { id: string; name: string; service_code: string | null }) {
    setCheckedDrugs((prev) =>
      prev.some((p) => p.id === d.id) ? prev.filter((p) => p.id !== d.id) : [...prev, d],
    );
  }
  function toggleAllFiltered() {
    setCheckedDrugs((prev) => {
      if (allFilteredChecked) {
        const fset = new Set(filteredDrugs.map((d) => d.id));
        return prev.filter((p) => !fset.has(p.id));
      }
      const have = new Set(prev.map((p) => p.id));
      return [...prev, ...filteredDrugs.filter((d) => !have.has(d.id))];
    });
  }

  // [묶음처방 생성] → 체크약을 1·3·2 입력 가능한 items 로 변환해 생성 팝업 오픈.
  function openCreateFromChecked() {
    if (checkedDrugs.length === 0) return;
    const items: PrescriptionItem[] = checkedDrugs.map((d) => ({
      ...EMPTY_ITEM,
      name: d.name,
      // services 처방약 = prescription_codes FK 미보유 → null(자유텍스트 동일 취급, DRUGSOURCE-SVCRX 정합).
      prescription_code_id: null,
      classification: null,
    }));
    setEditingSetId(null); // 생성 모드
    setCreateForm({ ...EMPTY_FORM, items });
    setCreateOpen(true);
  }

  // Part G2: 우측 단 생성 묶음처방 '수정' — 같은 생성 팝업을 편집 모드로 오픈.
  //   이름(=태그라벨)/색/아이콘/이름숨김/포함약·1·3·2 일괄 편집. 저장 = useUpsertSet({id}).
  //   ⚠ 새 모델 invariant: name === tag_label. 레거시(태그 없는) 세트는 기존 name 을 태그라벨로 승계해 편집 가능하게 함.
  function openEditBundle(s: PrescriptionSet) {
    setEditingSetId(s.id);
    setCreateForm({
      name: s.name,
      // 깊은 복사(편집 중 원본 불변) — items 는 객체배열.
      items: (s.items ?? []).map((it) => ({ ...it })),
      is_active: s.is_active,
      sort_order: s.sort_order,
      folder: s.folder ?? '',
      // 이름 필드 = 태그라벨. 레거시 세트(tag_label 없음)는 name 을 라벨로 승계 → 이름 보존+편집.
      tag_label: (s.tag_label ?? '').trim() !== '' ? (s.tag_label as string) : s.name,
      tag_color: s.tag_color ?? DEFAULT_RX_TAG_COLOR,
      icon: s.icon ?? '',
      hide_name: !!s.hide_name,
    });
    setCreateOpen(true);
  }
  function closeCreate() {
    setCreateOpen(false);
    setEditingSetId(null);
  }

  function handleCreateItemChange(idx: number, field: 'dosage' | 'count' | 'days', val: string | number | null) {
    setCreateForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  }
  function moveCreateItem(idx: number, dir: -1 | 1) {
    setCreateForm((f) => {
      const items = [...f.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return f;
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...f, items };
    });
  }
  function removeCreateItem(idx: number) {
    setCreateForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleCreateSave() {
    const label = createForm.tag_label.trim();
    // 시나리오4-2: 이름 미입력 + 이름숨기기 OFF → 이름 필수. 이름숨김 ON 이면 아이콘 필수(식별).
    if (label === '' && !createForm.hide_name) {
      return toast.error('묶음처방 이름을 입력해주세요.');
    }
    if (label === '' && createForm.hide_name && createForm.icon.trim() === '') {
      return toast.error('이름을 숨기려면 아이콘을 골라주세요.');
    }
    if (createForm.items.length === 0) {
      return toast.error('약을 1개 이상 선택해주세요.');
    }
    // 세트 name(NOT NULL) = 라벨 우선, 없으면 첫 약 이름 폴백.
    const setName = label !== '' ? label : (createForm.items[0]?.name ?? '묶음처방');
    // Part G2: editingSetId 있으면 수정(update {id}), 없으면 생성(insert).
    await upsert.mutateAsync({ id: editingSetId ?? undefined, form: { ...createForm, name: setName } });
    closeCreate();
    setCheckedDrugs([]);
    setDrugSearch('');
  }

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

  // T-20260615-foot-RXSET-DRUGSOURCE-SVCRX (AC-1): services 처방약 1건 선택 → 세트 항목 name 채움.
  //   ⚠️ code.id = services.id 이므로 prescription_code_id(=prescription_codes 참조)에 저장하지 않는다.
  //      → services 처방약은 prescription_codes FK 미보유(별도 엔티티). 진료차트 금기/급여 게이트는
  //        prescription_code_id=null을 자유텍스트와 동일하게 skip(AC-0 §C 그라운딩). 청구는 services.service_code 경로로 무손실.
  //   route/dosage/frequency/days 등 사용자 입력은 보존(처방약 분류 미보유 → route 파생 없음, 기존 값 유지).
  function handleSelectDrug(idx: number, code: RxCodeResult) {
    setForm((f) => {
      const items = [...f.items];
      items[idx] = {
        ...items[idx],
        name: code.name_ko,
        classification: null,
        prescription_code_id: null,
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

      {/* T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL: 2-pane — 좌측 약 테이블(생성 소스) / 우측 묶음처방 목록 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr] items-start">

        {/* ── Part B: 좌측 단 = 처방약 테이블뷰(체크박스+검색) ── */}
        {canEdit && (
          <div className="rounded-lg border bg-card p-3 space-y-2.5" data-testid="bundlerx-drug-panel">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">처방약 선택</span>
              <span className="text-[11px] text-muted-foreground" data-testid="bundlerx-checked-count">
                선택 {checkedDrugs.length}개
              </span>
            </div>
            {/* 검색 */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
                placeholder="약 이름·코드 검색"
                className="h-8 text-xs pl-7"
                data-testid="bundlerx-drug-search"
                autoComplete="off"
              />
            </div>
            {/* 테이블 */}
            <div className="rounded-md border max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs" data-testid="bundlerx-drug-table">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b">
                    <th className="w-9 px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={allFilteredChecked}
                        onChange={toggleAllFiltered}
                        aria-label="검색된 약 전체선택"
                        className="h-3.5 w-3.5 accent-teal-600 cursor-pointer"
                        data-testid="bundlerx-drug-selectall"
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{RX_COL.name}</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">코드</th>
                  </tr>
                </thead>
                <tbody>
                  {drugsLoading ? (
                    <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
                  ) : filteredDrugs.length === 0 ? (
                    <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground" data-testid="bundlerx-drug-empty">
                      {allRxDrugs.length === 0 ? '처방약이 없습니다.' : '검색 결과가 없습니다.'}
                    </td></tr>
                  ) : (
                    filteredDrugs.map((d) => {
                      const on = checkedIds.has(d.id);
                      return (
                        <tr
                          key={d.id}
                          className={`border-b last:border-b-0 cursor-pointer hover:bg-accent/50 ${on ? 'bg-teal-50/60' : ''}`}
                          onClick={() => toggleDrug(d)}
                          data-testid="bundlerx-drug-row"
                        >
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleDrug(d)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`${d.name} 선택`}
                              className="h-3.5 w-3.5 accent-teal-600 cursor-pointer"
                              data-testid="bundlerx-drug-checkbox"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-foreground">{d.name}</td>
                          <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{d.service_code ?? '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* 생성 버튼 — 0건이면 비활성(시나리오4-1) */}
            <Button
              size="sm"
              className="w-full"
              onClick={openCreateFromChecked}
              disabled={checkedDrugs.length === 0}
              data-testid="bundlerx-create-btn"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              묶음처방 생성 ({checkedDrugs.length})
            </Button>
          </div>
        )}

        {/* ── 우측 = 기존 묶음처방 목록 ── */}
        <div className="space-y-4">

      {/* 헤더 — Part G1b: 우측 단 라벨 "처방세트"→"묶음처방"(현장용어 통일, reporter MSG-0b5d) */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground" data-testid="rx-set-count-label">{sets.length}개 묶음처방</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="rx-set-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            묶음처방 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 묶음처방이 없습니다.
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {s.name}
                  </span>
                  {/* T-20260615 TAG-QUICKTRIGGER AC-2 + T-20260617 OVERHAUL: 태그 색상 칩(라벨+색)+아이콘.
                      tag_label 또는 (이름숨김+아이콘) 있을 때 렌더. 이름숨김=라벨 생략(아이콘+색만). 색=rxTagPalette SSOT. */}
                  {(s.tag_label || (s.hide_name && s.icon)) && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tagChipClass(s.tag_color)}`}
                      data-testid="rx-set-tag-chip"
                      data-hide-name={s.hide_name ? 'true' : 'false'}
                      title={s.tag_label ?? undefined}
                    >
                      {s.icon && <IconRenderer icon={s.icon} className="h-3 w-3" />}
                      {!s.hide_name && s.tag_label}
                    </span>
                  )}
                  {!s.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {s.items.length}개 항목
                  </Badge>
                </div>
                {canEdit && (
                  // T-20260609-foot-RXSET-DELETE-KEBAB-GUARD: 삭제 직접노출 제거 → 우측상단 ⋮ 케밥.
                  // T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER: 케밥에 '태그 편집' 추가.
                  <RxSetKebabMenu
                    onEdit={() => openEditBundle(s)}
                    onEditTag={() => openEditTag(s)}
                    onDelete={() => setDeleteTarget(s)}
                    deleteDisabled={del.isPending}
                  />
                )}
              </div>
              {/* Part G3: 미리보기/접힘(slice 3 + "+N개 항목 더") 제거 → 무조건 전체 펼침으로 포함약 전부 노출(reporter MSG-0b5d) */}
              {s.items.length > 0 && (
                <div className="space-y-1" data-testid="rx-set-items-expanded">
                  {s.items.map((item, idx) => (
                    <div key={idx} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.dosage && <span>{item.dosage}</span>}
                      <span>{item.route}</span>
                      <span>{item.frequency}</span>
                      {item.count != null && <span>{item.count}회</span>}
                      <span>{item.days}일</span>
                    </div>
                  ))}
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
        </div>{/* 우측 묶음처방 목록 끝 */}
      </div>{/* 2-pane grid 끝 */}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            {/* Part G1b: 현장용어 통일 "처방세트"→"묶음처방" */}
            <DialogTitle>{editing ? '묶음처방 수정' : '묶음처방 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">묶음처방 이름 *</Label>
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
              {/* AC-3 안내: 여기 넣은 용량·횟수·일수는 '기본값'입니다. 처방 때 진료의가 환자별로 수정할 수 있어요. */}
              <p className="mb-2 text-[11px] text-muted-foreground" data-testid="rx-set-baked-default-hint">
                용량·횟수·일수는 <span className="font-medium text-teal-700">기본값</span>이에요. 처방할 때 진료의가 환자별로 바꿀 수 있어요.
              </p>
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

      {/* T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — 신규 생성 팝업(Part C 태그편집 + Part D 선택약 1·3·2).
          좌측 약테이블에서 체크 → [묶음처방 생성] → 이 팝업. 저장 시 prescription_sets 1세트 upsert. */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && closeCreate()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="bundlerx-create-dialog">
          <DialogHeader>
            {/* Part G2: 동일 팝업이 생성/수정 겸용 */}
            <DialogTitle>{editingSetId != null ? '묶음처방 수정' : '묶음처방 만들기'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {/* Part C: 태그 편집(이름/이름숨김/10색/아이콘/미리보기) — 공통 필드 재사용 */}
            <TagEditorFields
              value={{
                tag_label: createForm.tag_label,
                tag_color: createForm.tag_color,
                icon: createForm.icon,
                hide_name: createForm.hide_name,
              }}
              onChange={(patch) => setCreateForm((f) => ({ ...f, ...patch }))}
              idPrefix="bundlerx-tag"
            />

            {/* Part D: 선택약 리스트 — 순서(위/아래) / 약이름(읽기전용) / 용량·횟수·일수(숫자만, RX_COL SSOT) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">선택한 약 ({createForm.items.length}개)</Label>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-teal-700">{RX_COL.dosage} · {RX_COL.count} · {RX_COL.days}</span>는 기본값이에요. 처방할 때 진료의가 환자별로 바꿀 수 있어요.
              </p>
              <div className="rounded-md border overflow-hidden" data-testid="bundlerx-create-items">
                <table className="w-full text-xs">
                  <thead className="bg-muted/80">
                    <tr className="border-b">
                      <th className="w-14 px-1.5 py-1.5 text-center font-medium text-muted-foreground">순서</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{RX_COL.name}</th>
                      {/* T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL Part D usability(MSG-64ge): 숫자 입력칸 너무 작아 입력불가(갤탭) 호소 → w-16→w-20 + 입력 h-7→h-9. '회'는 헤더로 이동(hideSuffix)해 입력폭 확보. */}
                      <th className="w-20 px-1.5 py-1.5 text-center font-medium text-muted-foreground">{RX_COL.dosage}</th>
                      <th className="w-20 px-1.5 py-1.5 text-center font-medium text-muted-foreground">{RX_COL.count}</th>
                      <th className="w-20 px-1.5 py-1.5 text-center font-medium text-muted-foreground">{RX_COL.days}</th>
                      <th className="w-8 px-1 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {createForm.items.length === 0 ? (
                      <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">선택된 약이 없습니다.</td></tr>
                    ) : (
                      createForm.items.map((item, idx) => (
                        <tr key={idx} className="border-b last:border-b-0" data-testid="bundlerx-create-item-row">
                          {/* 순서 = 위/아래 이동 */}
                          <td className="px-1.5 py-1 text-center">
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveCreateItem(idx, -1)}
                                disabled={idx === 0}
                                aria-label="위로"
                                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                                data-testid="bundlerx-create-item-up"
                              >▲</button>
                              <button
                                type="button"
                                onClick={() => moveCreateItem(idx, 1)}
                                disabled={idx === createForm.items.length - 1}
                                aria-label="아래로"
                                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                                data-testid="bundlerx-create-item-down"
                              >▼</button>
                            </div>
                          </td>
                          {/* 약이름 = 읽기전용(좌측 테이블에서 고른 약) */}
                          <td className="px-2 py-1 text-foreground" data-testid="bundlerx-create-item-name">{item.name}</td>
                          {/* 1회량(dosage) — 숫자만 */}
                          <td className="px-1.5 py-1">
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={item.dosage}
                              onChange={(e) => handleCreateItemChange(idx, 'dosage', e.target.value.replace(/[^0-9.]/g, ''))}
                              placeholder="1"
                              className="h-9 text-sm text-center"
                              data-testid="bundlerx-create-item-dosage"
                            />
                          </td>
                          {/* 횟수(count) — RxCountInput. 단위 suffix는 hideSuffix로 숨김·입력박스는 셀 전폭 사용. 높이 h-9(갤탭 터치). */}
                          <td className="px-1.5 py-1">
                            <RxCountInput
                              value={item.count ?? null}
                              onChange={(v) => handleCreateItemChange(idx, 'count', v)}
                              hideSuffix
                              inputClassName="h-9 text-sm"
                            />
                          </td>
                          {/* 투여일수(days) — 정수만 */}
                          <td className="px-1.5 py-1">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              value={item.days}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                handleCreateItemChange(idx, 'days', raw === '' ? 0 : Math.max(0, Math.floor(Number(raw)) || 0));
                              }}
                              placeholder="3"
                              className="h-9 text-sm text-center"
                              data-testid="bundlerx-create-item-days"
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => removeCreateItem(idx)}
                              aria-label={`${item.name} 제거`}
                              className="flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                              data-testid="bundlerx-create-item-remove"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>취소</Button>
            <Button onClick={handleCreateSave} disabled={upsert.isPending} data-testid="bundlerx-create-save-btn">
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

      {/* T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER AC-1: 태그/아이콘 경량 편집 다이얼로그.
          라벨/색/아이콘 3필드만 — items/name/folder 등 기존 컬럼 무접촉(useUpdateSetTagMeta). */}
      <Dialog open={!!tagTarget} onOpenChange={(o) => !o && setTagTarget(null)}>
        <DialogContent className="max-w-md" data-testid="rx-set-tag-dialog">
          <DialogHeader>
            <DialogTitle>태그 편집 — {tagTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-[11px] text-muted-foreground">
              묶음처방에 <span className="font-medium text-teal-700">색깔 태그</span>를 붙이면, 진료화면에서 그 태그만 눌러 약을 바로 넣을 수 있어요.
            </p>
            {/* T-20260617 OVERHAUL: 라벨/이름숨김/10색/아이콘/미리보기 공통 필드. testid='rx-set-tag-*'(기존 스펙 호환). */}
            <TagEditorFields
              value={tagForm}
              onChange={(patch) => setTagForm((f) => ({ ...f, ...patch }))}
              idPrefix="rx-set-tag"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagTarget(null)}>취소</Button>
            <Button onClick={handleSaveTag} disabled={updateTagMeta.isPending} data-testid="rx-set-tag-save-btn">
              {updateTagMeta.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
