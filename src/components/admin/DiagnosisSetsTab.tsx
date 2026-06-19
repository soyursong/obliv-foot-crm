// DiagnosisSetsTab — 묶음상병(상병 세트) 관리
// Ticket: T-20260608-foot-DX-BUNDLE-SET (AC-1, 문지은 대표원장 C0ATE5P6JTH)
//   "묶음상병 — 여러 상병코드를 한 세트로 묶어 진료차트에서 일괄 적용. 묶음처방(prescription_sets)이랑 동일 개념."
//   처방세트(PrescriptionSetsTab) 패턴 미러. 단, 적용대상이 RELATIONAL(진료차트 상병 행)이라
//   items 는 JSONB 가 아닌 정규화 자식 테이블(diagnosis_set_items, service_id FK → services 상병정본)로 둠.
//
//   상병 정본 = services.category_label='상병' 단일 SSOT (DiagnosisNamesTab 와 동일 소스).
//   세트 item 은 그 마스터를 service_id FK 로 참조만 함(두번째 상병 마스터 신설 아님).
//   진료차트 단건 상병 입력 경로(DiagnosisFolderPicker)는 무변경 — 세트는 '일괄 적용' additive 동선.
//
// Ticket: T-20260609-foot-DX-BUNDLE-REFINE (문지은 대표원장 실사용 후 단순화 요청)
//   AC-1 폴더제거: optgroup/폴더 그룹핑 폐지 → 플랫 목록. diagnosis_folder 컬럼은 DB 보존·UI 비노출.
//   AC-2 이름순 자동정렬: sort_order 숫자입력 UI 제거. 목록 기본 = name ASC(미드래그 시). sort_order = DnD 전용.
//   AC-3 세트 즐겨찾기: diagnosis_sets.is_favorite(★) — 즐찾 최상단(그 안 name ASC). 진료차트 섹션도 동일.
//     ⚠️ 이 즐찾 = 세트(diagnosis_sets) 단위. doctor_diagnosis_favorites(상병코드 원장별)와 別엔티티.
//   AC-4 :: DnD: GripVertical 좌측 핸들. 드롭 순서 → sort_order 저장(QuickRxButtonsTab/PROCMENU-RX-UNIFY 패턴).
//     정렬 우선순위: is_favorite DESC → sort_order ASC → name ASC. 미드래그(sort_order 동일) 시 name ASC.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  DndContext,
  closestCenter,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, X, Star, GripVertical } from 'lucide-react';
import { useDiagnosisFolders } from '@/lib/diagnosisFolders';
import DxFolderMultiSelect from './DxFolderMultiSelect';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DxMasterRow {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder_id: string | null; // AC-4: 폴더트리 picker 그룹핑용 (NULL=미분류)
}

interface DiagnosisSetItem {
  service_id: string;
  diagnosis_type: 'primary' | 'secondary';
  sort_order: number;
}

interface DiagnosisSet {
  id: string;
  name: string;
  is_active: boolean;
  is_favorite: boolean;
  sort_order: number;
  items: DiagnosisSetItem[];
}

interface SetForm {
  name: string;
  is_active: boolean;
  items: DiagnosisSetItem[];
}

const EMPTY_FORM: SetForm = {
  name: '',
  is_active: true,
  items: [],
};

// 묶음상병 관리(CRUD) 권한 = 진료관리 write(director+admin).
//   T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): manager 제거(축소) → canEditClinicMgmt 재사용.
//   diagnosis_sets RLS write 旣존 {director,manager,admin} → director 무회귀.

// AC-2/AC-3 정렬: 즐겨찾기 우선 → sort_order(DnD) → name ASC(미드래그 기본).
function compareSets(a: DiagnosisSet, b: DiagnosisSet): number {
  if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
  if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return a.name.localeCompare(b.name, 'ko');
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
// 상병 마스터(services category_label='상병') — DiagnosisNamesTab 와 동일 소스(active만).
// T-...-NEST-BUNDLE-FOLDER AC-4: 폴더트리 picker 복원 → diagnosis_folder_id 재조회(deploy-tolerant).
function useDxMaster(clinicId: string | null) {
  return useQuery({
    queryKey: ['dx_set_master', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder_id')
        .eq('clinic_id', clinicId)
        .eq('category_label', '상병')
        .eq('active', true)
        .order('name', { ascending: true });
      if (withFolder.error) {
        // diagnosis_folder_id 컬럼 미적용(42703) 환경 — 폴더 없는 플랫 목록으로 폴백.
        const fb = await sb
          .from('services')
          .select('id, name, service_code')
          .eq('clinic_id', clinicId)
          .eq('category_label', '상병')
          .eq('active', true)
          .order('name', { ascending: true });
        if (fb.error) throw fb.error;
        return ((fb.data ?? []) as DxMasterRow[]).map((r) => ({ ...r, diagnosis_folder_id: null }));
      }
      return (withFolder.data ?? []) as DxMasterRow[];
    },
  });
}

// 묶음상병 세트 + 항목. 테이블/컬럼 미적용(마이그 미게이트) 환경에서도 graceful(빈 목록 / is_favorite=false 폴백).
function useDiagnosisSets(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_sets', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // AC-3 deploy-tolerant: is_favorite 컬럼 우선 조회 → 미적용(42703) 시 폴백.
      const withFav = await sb
        .from('diagnosis_sets')
        .select(
          'id, name, is_active, is_favorite, sort_order, diagnosis_set_items(service_id, diagnosis_type, sort_order)',
        )
        .eq('clinic_id', clinicId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalize = (rows: any[], hasFav: boolean): DiagnosisSet[] =>
        rows
          .map((s) => ({
            id: s.id,
            name: s.name,
            is_active: s.is_active,
            is_favorite: hasFav ? !!s.is_favorite : false,
            sort_order: s.sort_order ?? 0,
            items: ((s.diagnosis_set_items ?? []) as DiagnosisSetItem[])
              .slice()
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
          }))
          .sort(compareSets);
      if (!withFav.error) return normalize((withFav.data ?? []) as unknown[], true);
      // 폴백: is_favorite 미적용 환경
      const fb = await sb
        .from('diagnosis_sets')
        .select('id, name, is_active, sort_order, diagnosis_set_items(service_id, diagnosis_type, sort_order)')
        .eq('clinic_id', clinicId);
      if (fb.error) return [] as DiagnosisSet[]; // 테이블 자체 미적용 → 빈 목록
      return normalize((fb.data ?? []) as unknown[], false);
    },
  });
}

function useUpsertSet(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: SetForm }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // AC-1: diagnosis_folder 는 payload 에서 제외 — DB 기존값 보존(UI 비노출, FE 미터치).
      // AC-2: sort_order 도 일반 저장경로에서 미터치 — DnD 전용. 신규는 0(name ASC 기본).
      const setPayload: Record<string, unknown> = {
        name: form.name.trim(),
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      // 1) 세트 행 upsert → setId 확보
      let setId = id;
      if (id) {
        const { error } = await sb.from('diagnosis_sets').update(setPayload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb
          .from('diagnosis_sets')
          .insert({ ...setPayload, clinic_id: clinicId, sort_order: 0 })
          .select('id')
          .single();
        if (error) throw error;
        setId = data.id as string;
      }

      // 2) 항목 정규화 테이블 replace(전체 삭제 후 재삽입). 순서 = 배열 index.
      //    같은 세트 내 동일 상병 중복은 UNIQUE 인덱스로 차단 — 저장 전 dedupe(첫 등장 우선).
      const seen = new Set<string>();
      const rows = form.items
        .filter((it) => {
          if (!it.service_id || seen.has(it.service_id)) return false;
          seen.add(it.service_id);
          return true;
        })
        .map((it, idx) => ({
          diagnosis_set_id: setId,
          service_id: it.service_id,
          diagnosis_type: it.diagnosis_type,
          sort_order: idx,
        }));

      const { error: delErr } = await sb
        .from('diagnosis_set_items')
        .delete()
        .eq('diagnosis_set_id', setId);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await sb.from('diagnosis_set_items').insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
      toast.success('묶음상병이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // diagnosis_set_items 는 FK ON DELETE CASCADE 로 함께 정리됨.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('diagnosis_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
      toast.success('묶음상병이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// AC-4: 정렬 가능한 세트 행 — :: 드래그핸들 DnD. useSortable hook 규칙상 별도 컴포넌트.
//   QuickRxButtonsTab SortableQuickRxRow 패턴 미러(flat 목록).
// ---------------------------------------------------------------------------
interface SortableDxSetRowProps {
  set: DiagnosisSet;
  canEdit: boolean;
  delPending: boolean;
  favPending: boolean;
  fmtDx: (row: DxMasterRow | undefined, fallbackId: string) => string;
  masterById: Map<string, DxMasterRow>;
  onEdit: (s: DiagnosisSet) => void;
  onDelete: (id: string, name: string) => void;
  onToggleFav: (s: DiagnosisSet) => void;
}

function SortableDxSetRow({
  set: s,
  canEdit,
  delPending,
  favPending,
  fmtDx,
  masterById,
  onEdit,
  onDelete,
  onToggleFav,
}: SortableDxSetRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`rounded-lg border bg-card px-4 py-3 ${isDragging ? 'shadow-md' : ''}`}
      data-testid="dx-set-item"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* AC-4: 드래그 핸들 — admin/manager 전용, touch-none(태블릿 탭 오인식 방지) */}
          {canEdit && (
            <button
              {...attributes}
              {...listeners}
              type="button"
              tabIndex={-1}
              className="flex items-center justify-center min-w-[28px] min-h-[28px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
              title="드래그하여 순서 변경"
              onClick={(e) => e.stopPropagation()}
              data-testid="dx-set-handle"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          {/* AC-3: 즐겨찾기 토글(★) */}
          {canEdit && (
            <button
              type="button"
              onClick={() => onToggleFav(s)}
              disabled={favPending}
              className="shrink-0 rounded p-0.5"
              title={s.is_favorite ? '즐겨찾기 해제' : '즐겨찾기'}
              data-testid="dx-set-fav-toggle"
              data-fav={s.is_favorite ? 'true' : 'false'}
            >
              <Star
                className={`h-4 w-4 ${s.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400'}`}
              />
            </button>
          )}
          <span className={`text-sm font-medium truncate ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
            {s.name}
          </span>
          {!s.is_active && <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>}
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
            상병 {s.items.length}개
          </Badge>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(s)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(s.id, s.name)}
              disabled={delPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {s.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.items.map((it, idx) => {
            const row = masterById.get(it.service_id);
            const primary = it.diagnosis_type === 'primary';
            return (
              <span
                key={`${it.service_id}-${idx}`}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
                  primary ? 'border-teal-300 bg-teal-50' : 'border-input bg-muted/40'
                }`}
              >
                <span
                  className={`rounded px-1 text-[9px] font-semibold ${
                    primary ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {primary ? '주' : '부'}
                </span>
                {fmtDx(row, it.service_id)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosisSetsTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const canEdit = canEditClinicMgmt(profile?.role);

  const qc = useQueryClient();
  const { data: master = [] } = useDxMaster(clinicId);
  const { data: folders = [] } = useDiagnosisFolders(clinicId); // AC-4 폴더트리 picker
  const { data: sets = [], isLoading } = useDiagnosisSets(clinicId);
  const upsert = useUpsertSet(clinicId);
  const del = useDeleteSet();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DiagnosisSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);
  const [favPendingId, setFavPendingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false); // AC-4 상병 추가 폴더트리 picker 토글

  // AC-4: DnD 정렬용 로컬 미러(낙관적 반영). 쿼리 데이터로 동기화.
  const [items, setItems] = useState<DiagnosisSet[]>([]);
  const savingRef = useRef(false);
  useEffect(() => {
    if (savingRef.current) return; // 저장 중엔 서버 캐시로 덮어쓰지 않음(깜빡임/되돌림 방지)
    setItems(sets);
  }, [sets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  // 상병 마스터 빠른 조회 맵 (service_id → row)
  const masterById = useMemo(() => {
    const m = new Map<string, DxMasterRow>();
    for (const r of master) m.set(r.id, r);
    return m;
  }, [master]);

  function fmtDx(row: DxMasterRow | undefined, fallbackId: string): string {
    if (!row) return `(삭제된 상병 ${fallbackId.slice(0, 6)})`;
    const code = (row.service_code ?? '').trim();
    return code ? `${code} ${row.name}` : row.name;
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [] });
    setPickerOpen(false);
    setOpen(true);
  }

  function openEdit(s: DiagnosisSet) {
    setEditing(s);
    setForm({
      name: s.name,
      is_active: s.is_active,
      // AC-6: 저장된 순서(sort_order)대로 index0=주, 나머지=부 재정규화(과거 수동지정분 정합).
      items: withAutoTypes(s.items.map((it) => ({ ...it }))),
    });
    setPickerOpen(false);
    setOpen(true);
  }

  // AC-6: 묶음 상병의 주/부는 "선택(배열) 순서"로 자동 결정 — index0=주상병(primary), 나머지=부상병.
  //   별도 주/부 지정 UI 없음(field_confirm MSG-m2th). sort_order=index 동기화.
  function withAutoTypes(arr: DiagnosisSetItem[]): DiagnosisSetItem[] {
    return arr.map((it, i) => ({
      ...it,
      diagnosis_type: i === 0 ? 'primary' : 'secondary',
      sort_order: i,
    }));
  }

  // AC-4: picker 다중선택 일괄 추가 — 선택 순서 보존, 중복 제외. 추가 후 주/부 자동 재지정(AC-6).
  function addItems(orderedIds: string[]) {
    setForm((f) => {
      const existing = new Set(f.items.map((it) => it.service_id));
      const additions = orderedIds
        .filter((id) => !existing.has(id))
        .map((id) => ({ service_id: id, diagnosis_type: 'secondary' as const, sort_order: 0 }));
      if (additions.length === 0) {
        toast.error('이미 추가된 상병이에요.');
        return f;
      }
      return { ...f, items: withAutoTypes([...f.items, ...additions]) };
    });
    setPickerOpen(false);
  }

  function removeItem(idx: number) {
    // 제거 후 주/부 자동 재지정 — 첫 항목 제거 시 다음 항목이 주상병으로 승격(AC-6).
    setForm((f) => ({ ...f, items: withAutoTypes(f.items.filter((_, i) => i !== idx)) }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('묶음상병 이름을 입력해주세요.');
    if (form.items.length === 0) return toast.error('상병을 한 개 이상 추가해주세요.');
    // AC-6: 저장 직전 주/부 최종 재정규화(순서 SSOT). upsert 가 sort_order=index 로 차트 정렬 일관 유지.
    await upsert.mutateAsync({ id: editing?.id, form: { ...form, items: withAutoTypes(form.items) } });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 묶음상병을 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // AC-3: 즐겨찾기 토글 — 컬럼 단건 업데이트(낙관적). 미적용 환경이면 무시(graceful).
  async function toggleFav(s: DiagnosisSet) {
    if (!canEdit) return;
    setFavPendingId(s.id);
    const nextFav = !s.is_favorite;
    // 낙관적 반영 + 정렬 재계산
    setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_favorite: nextFav } : x)).slice().sort(compareSets));
    savingRef.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('diagnosis_sets')
        .update({ is_favorite: nextFav, updated_at: new Date().toISOString() })
        .eq('id', s.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
    } catch (err) {
      // 롤백
      setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_favorite: s.is_favorite } : x)).slice().sort(compareSets));
      toast.error(`즐겨찾기 변경 실패: ${(err as Error)?.message ?? ''}`.trim());
    } finally {
      savingRef.current = false;
      setFavPendingId(null);
    }
  }

  // AC-4: 드롭 시점 순번 일괄 저장 — 변경분만 sort_order UPDATE + 실패 시 롤백.
  //   QuickRxButtonsTab handleDragEnd 패턴. 즐겨찾기 경계를 넘는 드래그는
  //   재조회 시 is_favorite DESC 가 우선이라 즐찾이 자동 상단 고정(그룹 내 상대순서 보존).
  async function handleDragEnd(e: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const oldIdx = items.findIndex((x) => x.id === String(active.id));
    const newIdx = items.findIndex((x) => x.id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;

    const snapshot = items; // 실패 롤백용
    const reordered = arrayMove(items, oldIdx, newIdx).map((s, i) => ({ ...s, sort_order: i * 10 }));
    const prevById = new Map(snapshot.map((s) => [s.id, s.sort_order]));
    const updates = reordered
      .filter((s) => prevById.get(s.id) !== s.sort_order)
      .map(({ id, sort_order }) => ({ id, sort_order }));
    if (updates.length === 0) return;

    setItems(reordered); // 낙관적 반영
    savingRef.current = true;
    try {
      await Promise.all(
        updates.map(({ id, sort_order }) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).from('diagnosis_sets').update({ sort_order }).eq('id', id),
        ),
      );
      toast.success('순서가 저장됐어요.', { duration: 1500 });
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
    } catch (err) {
      setItems(snapshot); // 저장 실패 시 직전 순서로 롤백
      toast.error(`순서 저장 실패 — 되돌렸어요. ${(err as Error)?.message ?? ''}`.trim());
    } finally {
      savingRef.current = false;
    }
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 용어 안내 — 묶음상병 = 여러 상병을 한 세트로 묶어 진료차트에서 일괄 적용 */}
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[11px] text-muted-foreground">
        이 화면은 <span className="font-semibold text-teal-700">묶음상병</span>(여러 상병을 한 세트로 묶어
        진료차트에서 한 번에 적용) 관리입니다. 상병은 <span className="font-medium">상병명 관리</span>에 등록된
        것만 묶을 수 있어요. <span className="text-amber-600">★ 즐겨찾기</span>는 맨 위로 고정되고, 나머지는 이름순입니다.
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{items.length}개 묶음상병</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="dx-set-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            묶음상병 추가
          </Button>
        )}
      </div>

      {/* 목록 — AC-1 플랫(폴더 그룹핑 없음) · AC-4 :: 드래그 정렬(드롭 시 일괄 저장) */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 묶음상병이 없습니다.
        </div>
      ) : (
        <>
          {canEdit && (
            <p className="text-[11px] text-muted-foreground -mb-1">
              <GripVertical className="inline h-3 w-3 align-text-bottom" /> 핸들을 끌어 순서를 바꾸면 자동 저장됩니다.
              ({'★'} 즐겨찾기는 항상 위쪽 고정)
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2" data-testid="dx-set-list">
                {items.map((s) => (
                  <SortableDxSetRow
                    key={s.id}
                    set={s}
                    canEdit={canEdit}
                    delPending={del.isPending}
                    favPending={favPendingId === s.id}
                    fmtDx={fmtDx}
                    masterById={masterById}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onToggleFav={toggleFav}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '묶음상병 수정' : '묶음상병 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* AC-1/AC-2: 폴더·정렬순서 입력 제거 — 이름만. 정렬은 이름순 자동 + 목록 :: 드래그. */}
            <div>
              <Label className="text-xs">묶음상병 이름 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예) 당뇨 합병증 세트"
                className="mt-1"
                data-testid="dx-set-name-input"
              />
            </div>

            {/* 상병 추가 — AC-4: 상병명관리 동일 (중첩)폴더트리 picker + 다중선택 일괄추가 */}
            <div>
              <Label className="text-xs">상병 추가</Label>
              {pickerOpen ? (
                <div className="mt-1">
                  <DxFolderMultiSelect
                    folders={folders}
                    diagnoses={master}
                    addedIds={new Set(form.items.map((it) => it.service_id))}
                    onConfirm={addItems}
                    onCancel={() => setPickerOpen(false)}
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-1 w-full justify-start gap-2"
                  onClick={() => setPickerOpen(true)}
                  disabled={master.length === 0}
                  data-testid="dx-set-open-picker"
                >
                  <Plus className="h-4 w-4" />
                  {master.length === 0 ? '등록된 상병명이 없습니다 — 상병명 관리에서 먼저 등록' : '폴더에서 상병 선택…'}
                </Button>
              )}
            </div>

            {/* 묶음에 포함된 상병 목록 — AC-6: 첫 항목=주상병, 나머지=부상병 자동(순서 기반, 별도 지정 UI 없음) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">묶음 상병 ({form.items.length}개)</Label>
                <span className="text-[10px] text-muted-foreground">맨 위 = 주상병 · 나머지 = 부상병(자동)</span>
              </div>
              {form.items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  위 “폴더에서 상병 선택”으로 상병을 추가하세요.
                </div>
              ) : (
                <div className="space-y-1.5" data-testid="dx-set-item-rows">
                  {form.items.map((it, idx) => {
                    const row = masterById.get(it.service_id);
                    const primary = idx === 0; // AC-6: 순서 기반 주/부
                    return (
                      <div
                        key={`${it.service_id}-${idx}`}
                        className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-muted/30"
                        data-testid="dx-set-item-row"
                      >
                        {/* 읽기전용 주/부 배지(자동) — 토글 UI 제거(field_confirm MSG-m2th) */}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${
                            primary ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-700'
                          }`}
                          data-testid="dx-set-item-type-badge"
                          data-type={primary ? 'primary' : 'secondary'}
                        >
                          {primary ? '주' : '부'}
                        </span>
                        <span className="text-sm flex-1 min-w-0 truncate">{fmtDx(row, it.service_id)}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                          onClick={() => removeItem(idx)}
                          data-testid="dx-set-item-remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
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
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="dx-set-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
