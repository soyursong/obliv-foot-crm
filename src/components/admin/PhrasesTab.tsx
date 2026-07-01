// PhrasesTab — 상용구 템플릿 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 2, 포팅: derm → foot)
// T-20260522-foot-PHRASE-MENU-UX:
//   AC-1: 드롭다운 → 사이드 메뉴 클릭 형태
//   AC-2: 리스트 행 높이/간격 축소 (컴팩트)
//   AC-3: [서류] → [원장님] 라벨 변경
// T-20260526-foot-PHRASE-SLASH:
//   AC-4: 단축어(shortcut_key) 입력 필드 추가 + 중복 경고
// T-20260526-foot-MEDCHART-SYNC:
//   phrase_type 분리: pen_chart(펜차트) / medical_chart(진료차트) 구분 관리

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { canEditStaffAreaPhrase } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
// T-20260701-foot-REORDER-ARROW-TO-DRAG: 행 ↑↓ 화살표 순서변경 → @dnd-kit 잡아끌기(드래그)로 통일.
//   참조 패턴 = QuickRxButtonsTab SortableQuickRxRow (드롭 시 sort_order 일괄저장 + 낙관반영 + 실패롤백).
//   신규 패키지 0 — @dnd-kit(core/sortable/utilities) 旣설치. sort_order 저장경로(useReorderPhrases) 불변.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-2: 'customer_chart'(고객차트/2번차트) surface 신설.
//   pen_chart(펜차트)·medical_chart(진료차트, 의사 진료관리)와 별개인 제3 surface.
//   DB CHECK constraint additive 확장(DA CONSULT GO MSG-20260619-001458-5t5o) 동반.
type PhraseType = 'pen_chart' | 'medical_chart' | 'customer_chart';

interface PhraseTemplate {
  id: number;
  category: string;
  name: string;
  content: string;
  shortcut_key: string | null;
  is_active: boolean;
  sort_order: number;
  phrase_type: PhraseType;
}

interface PhraseForm {
  category: string;
  name: string;
  content: string;
  shortcut_key: string;
  is_active: boolean;
  sort_order: number;
  phrase_type: PhraseType;
}

const EMPTY_FORM: PhraseForm = {
  category: 'charting',
  name: '',
  content: '',
  shortcut_key: '',
  is_active: true,
  sort_order: 0,
  phrase_type: 'pen_chart',
};

// T-20260526-foot-MEDCHART-SYNC: 상용구 유형 라벨
// T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-1 (cross-party 확정):
//   고객차트=신규 제3 surface(customer_chart)로 확정 → medical_chart 라벨은 '진료차트'(의사 진료관리)로 환원,
//   '고객차트'(2번차트)는 customer_chart 신규 type에 귀속. (직전 6df52103의 medical_chart→'고객차트' 오라벨 정정)
const PHRASE_TYPE_LABELS: Record<string, string> = {
  pen_chart: '펜차트',
  medical_chart: '진료차트',
  customer_chart: '고객차트',
};

// surface 별 배지 색상 (펜=blue / 진료=emerald / 고객=teal)
const PHRASE_TYPE_BADGE: Record<string, string> = {
  pen_chart: 'text-blue-600 border-blue-200 bg-blue-50',
  medical_chart: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  customer_chart: 'text-teal-700 border-teal-200 bg-teal-50',
};

// surface 별 안내 문구
const PHRASE_TYPE_DESC: Record<string, string> = {
  pen_chart: '진료메모/서류 입력용',
  medical_chart: '진료차트(진료관리) 임상경과 입력용',
  customer_chart: '고객차트(2번차트) 3구역[상세] 예약·상담·치료메모 입력용',
};

// AC-3: document '서류' → '원장님'
const CATEGORY_LABELS: Record<string, string> = {
  charting: '차팅',
  prescription: '처방',
  document: '원장님',
  general: '일반',
};

// T-20260620-foot-PHRASE-CUSTCHART-CATEGORY-LINK AC-1 (김주연 총괄 U0ATDB587PV):
//   고객차트(customer_chart) surface 전용 분류 — 예약/상담/치료.
//   ★NO-DDL: phrase_type CHECK 불변. 기존 free-text `category` 컬럼 재사용 —
//     customer_chart row 의 category 에 'reservation'|'consult'|'treatment' 저장(미지정=기본 버킷).
//   소비 지점(2번차트 3구역[상세] 예약/상담/치료메모, CustomerChartPage)이 이 분류로 필터.
const CUSTCHART_CATEGORY_LABELS: Record<string, string> = {
  reservation: '예약',
  consult: '상담',
  treatment: '치료',
};

// 펜/진료 + 고객차트 라벨 통합 조회용 (surface 무관 행 배지 표기 — 키 충돌 없음).
const MERGED_CATEGORY_LABELS: Record<string, string> = {
  ...CATEGORY_LABELS,
  ...CUSTCHART_CATEGORY_LABELS,
};

// AC-1: 사이드 메뉴용 카테고리 목록 (전체 포함)
const SIDE_MENU_CATS = [
  { key: 'all', label: '전체' },
  { key: 'charting', label: '차팅' },
  { key: 'prescription', label: '처방' },
  { key: 'document', label: '원장님' },
  { key: 'general', label: '일반' },
] as const;

// T-20260620-foot-PHRASE-CUSTCHART-CATEGORY-LINK AC-2: 고객차트 surface 전용 사이드 메뉴 [전체/예약/상담/치료].
const CUSTCHART_SIDE_MENU_CATS = [
  { key: 'all', label: '전체' },
  { key: 'reservation', label: '예약' },
  { key: 'consult', label: '상담' },
  { key: 'treatment', label: '치료' },
] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function usePhraseTemplates() {
  return useQuery({
    queryKey: ['phrase_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phrase_templates')
        .select('id, category, name, content, shortcut_key, is_active, sort_order, phrase_type')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PhraseTemplate[];
    },
  });
}

function useUpsertPhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: PhraseForm }) => {
      const payload = {
        category: form.category,
        name: form.name,
        content: form.content,
        shortcut_key: form.shortcut_key.trim() || null,
        is_active: form.is_active,
        sort_order: form.sort_order,
        phrase_type: form.phrase_type,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('phrase_templates').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('phrase_templates').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase_templates'] });
      toast.success('상용구가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeletePhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('phrase_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase_templates'] });
      toast.success('상용구가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU AC-1: 행 단위 ↑↓ 순서변경.
//   현장 요청 "펜/고객차트 노출 순서를 등록순서가 아니라 원하는 대로". sort_order 일괄 UPDATE(무DB 스키마변경).
//   소비부(PenChartTab·MedicalChartPanel·DoctorTreatmentPanel)가 모두 .order('sort_order') 라 즉시 반영.
function useReorderPhrases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: number; sort_order: number }[]) => {
      const now = new Date().toISOString();
      // 소량(현장 수십 건) — 변경된 행만 개별 UPDATE 병렬 실행.
      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from('phrase_templates')
            .update({ sort_order: u.sort_order, updated_at: now })
            .eq('id', u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase_templates'] });
    },
    onError: (e: Error) => toast.error(`순서 변경 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// T-20260701-foot-REORDER-ARROW-TO-DRAG: 정렬 가능한 상용구 행 (useSortable — hook 규칙상 별도 컴포넌트).
//   좌측 GripVertical 핸들을 잡아 끌어 순서 변경. 기존 ↑↓ 버튼 제거(편집/삭제 액션만 유지).
//   태블릿 탭 오인식 방지 touch-none. 관리권한 없으면 핸들 비노출 + useSortable disabled.
// ---------------------------------------------------------------------------
interface SortablePhraseRowProps {
  p: PhraseTemplate;
  canEdit: boolean;
  delPending: boolean;
  onEdit: (p: PhraseTemplate) => void;
  onDelete: (id: number, name: string) => void;
}

function SortablePhraseRow({ p, canEdit, delPending, onEdit, onDelete }: SortablePhraseRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
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
      className={`flex items-center justify-between px-3 py-1.5 gap-2 hover:bg-muted/20 transition-colors ${isDragging ? 'bg-card shadow-md' : ''}`}
      data-testid="phrase-item"
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {/* 드래그 핸들 — 관리권한 전용 */}
        {canEdit && (
          <button
            {...attributes}
            {...listeners}
            type="button"
            tabIndex={-1}
            className="flex items-center justify-center min-w-[24px] min-h-[24px] -ml-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="드래그하여 순서 변경"
            onClick={(e) => e.stopPropagation()}
            data-testid="phrase-drag-handle"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
              {MERGED_CATEGORY_LABELS[p.category] ?? p.category}
            </Badge>
            {/* T-20260526-foot-MEDCHART-SYNC: phrase_type 배지 */}
            <Badge
              variant="outline"
              className={`text-[9px] h-4 px-1 shrink-0 ${PHRASE_TYPE_BADGE[p.phrase_type ?? 'pen_chart'] ?? PHRASE_TYPE_BADGE.pen_chart}`}
            >
              {PHRASE_TYPE_LABELS[p.phrase_type ?? 'pen_chart']}
            </Badge>
            <span
              className={`text-xs font-medium truncate ${
                !p.is_active ? 'text-muted-foreground line-through' : ''
              }`}
            >
              {p.name}
            </span>
            {p.shortcut_key && (
              <Badge variant="outline" className="text-[10px] py-0 px-1 shrink-0 font-mono text-teal-600 border-teal-200">
                //{p.shortcut_key}
              </Badge>
            )}
            {!p.is_active && (
              <Badge variant="outline" className="text-[10px] py-0 shrink-0">비활성</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-1 whitespace-pre-wrap mt-0.5 pl-0.5">
            {p.content}
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onEdit(p)}
            data-testid="phrase-edit-btn"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={() => onDelete(p.id, p.name)}
            disabled={delPending}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
// T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT:
//   상용구를 phrase_type 축으로 두 surface 로 물리 분할 (DB 변경 0 — phrase_type 컬럼 旣존).
//   lockedType 지정 시: (1) 상단 세그먼트 필터 숨김, (2) 해당 type 으로 목록 고정 필터,
//   (3) 추가/편집 다이얼로그의 유형 선택 UI 숨김 + form.phrase_type 를 lockedType 으로 고정,
//   (4) 빈상태/카운트도 lockedType 기준. prop 미지정 시 현행 그대로(세그먼트 노출) — 회귀 0.
//   단일 컴포넌트를 두 surface(상용구관리=pen_chart / 진료관리=medical_chart)가 prop 만 달리 재사용.
interface PhrasesTabProps {
  lockedType?: PhraseType;
}

export default function PhrasesTab({ lockedType }: PhrasesTabProps = {}) {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원(consultant/coordinator/therapist)은 탭 열람 가능하나 읽기 전용.
  // CRUD는 admin/manager 전용 (Services·Staff write-guard 패턴).
  const { profile } = useAuth();
  // T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW Phase A(AC-2): 이 컴포넌트는 두 surface 가 공유 재사용.
  //   ① 진료관리(ClinicManagement, lockedType='medical_chart') = 의사 영역 → write = admin-only(게이트 대상, 무변경).
  //   ② 상용구관리(Services, lockedType='pen_chart'|'customer_chart') = 직원 영역.
  // T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK AC-2(김주연 총괄 U0ATDB587PV): ②(펜/고객차트)를 직원 편집 개방.
  //   기존 {admin,manager} → PHRASE_STAFFAREA_EDIT_ROLES(= ALL_STAFF_ROLES − director, 7역할)로 확대.
  //   ★director 제외(현행 유지) — PHRASE-AREA-SEPARATION-AUDIT AC-4(human_pending) 사람결정 선점 금지.
  //   ★medical_chart surface(의사영역)는 admin-only 절대 무변경(AC-5 회귀 0).
  //   서버측: phrase_templates RLS 2-policy ADDITIVE(admin_write{admin,manager} + 신규 staff_write{5역할,
  //     pen/customer 가드}) = FE set 과 동일 effective. (migration 20260620_phrase_templates_staff_write_staffarea)
  const isMedchartSurface = lockedType === 'medical_chart';
  const canEdit = isMedchartSurface
    ? profile?.role === 'admin'
    : canEditStaffAreaPhrase(profile?.role);
  const { data: phrases = [], isLoading } = usePhraseTemplates();
  const upsert = useUpsertPhrase();
  const del = useDeletePhrase();
  const reorder = useReorderPhrases();

  // T-20260701-foot-REORDER-ARROW-TO-DRAG: DnD 정렬용 로컬 미러(낙관적 반영). 저장 중엔 서버캐시로 덮지 않음.
  const [localPhrases, setLocalPhrases] = useState<PhraseTemplate[]>([]);
  const savingRef = useRef(false);
  useEffect(() => {
    if (savingRef.current) return;
    setLocalPhrases(phrases);
  }, [phrases]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PhraseTemplate | null>(null);
  const [form, setForm] = useState<PhraseForm>(EMPTY_FORM);
  const [filterCat, setFilterCat] = useState<string>('all');
  // T-20260526-foot-MEDCHART-SYNC: phrase_type 필터 ('all' | 'pen_chart' | 'medical_chart')
  const [filterPhraseType, setFilterPhraseType] = useState<string>('all');
  // T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: lockedType 지정 시 해당 type 으로 강제 고정.
  const effectivePhraseType = lockedType ?? filterPhraseType;
  // T-20260620-foot-PHRASE-CUSTCHART-CATEGORY-LINK AC-2: 고객차트 surface 면 사이드 분류 = [전체/예약/상담/치료].
  //   그 외(펜/진료/혼합) = 기존 [전체/차팅/처방/원장님/일반] 그대로.
  const isCustchartView = effectivePhraseType === 'customer_chart';
  const sideMenuCats = isCustchartView ? CUSTCHART_SIDE_MENU_CATS : SIDE_MENU_CATS;

  function openAdd() {
    setEditing(null);
    // lockedType surface 에서 추가하면 그 type 으로 자동 저장 (세그먼트 선택 UI 없음).
    // T-20260620-foot-PHRASE-CUSTCHART-CATEGORY-LINK AC-2/시나리오1: 고객차트 surface 에서
    //   특정 분류(예약/상담/치료) 탭을 보고 있을 때 '추가'하면 그 분류로 기본 선택(전체에선 '예약').
    //   ★펜/진료차트(비 customer_chart) 동작은 무변경(EMPTY_FORM.category='charting' 유지) — AC-4 무회귀.
    const defaultCategory =
      lockedType === 'customer_chart'
        ? (filterCat !== 'all' ? filterCat : 'reservation')
        : EMPTY_FORM.category;
    setForm({ ...EMPTY_FORM, category: defaultCategory, phrase_type: lockedType ?? EMPTY_FORM.phrase_type });
    setOpen(true);
  }

  function openEdit(p: PhraseTemplate) {
    setEditing(p);
    setForm({
      category: p.category,
      name: p.name,
      content: p.content,
      shortcut_key: p.shortcut_key ?? '',
      is_active: p.is_active,
      sort_order: p.sort_order,
      phrase_type: p.phrase_type ?? 'pen_chart',
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('상용구 이름을 입력해주세요.');
    if (!form.content.trim()) return toast.error('내용을 입력해주세요.');
    // AC-4: 단축어 중복 경고 (같은 shortcut_key가 다른 상용구에 이미 있으면 경고)
    const trimmedKey = form.shortcut_key.trim();
    if (trimmedKey) {
      const dup = phrases.find(
        (p) => p.shortcut_key === trimmedKey && p.id !== editing?.id,
      );
      if (dup) {
        toast.error(`단축어 //${trimmedKey} 는 이미 "${dup.name}"에서 사용 중입니다.`);
        return;
      }
    }
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 상용구를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // T-20260526-foot-MEDCHART-SYNC: phrase_type + category 복합 필터
  // T-20260608-foot-PHRASE-PEN-MED-SPLIT: phrase_type 활성 시 좌측 카테고리 카운트도 용도별로 산출
  //   (펜차트/진료차트 분리는 phrase_type 컬럼으로 이미 존재 — 무DB. 좌측 사이드 카운트만 type 미반영 버그였음)
  // T-20260701-foot-REORDER-ARROW-TO-DRAG: 표시 목록은 낙관적 로컬미러(localPhrases)에서 파생.
  const typeFiltered = localPhrases.filter(
    (p) => effectivePhraseType === 'all' || (p.phrase_type ?? 'pen_chart') === effectivePhraseType,
  );
  const displayed = typeFiltered.filter((p) => filterCat === 'all' || p.category === filterCat);

  // T-20260701-foot-REORDER-ARROW-TO-DRAG: ↑↓ 화살표 → 잡아끌기(드래그) 순서변경.
  //   화면 목록(displayed, 카테고리 필터 반영)을 arrayMove 로 재배치하되, sort_order 는 같은 유형 전체
  //   (typeFiltered) 기준 10 간격 재부여 — 카테고리 필터가 걸려 있어도 유형 전역 순서 일관성 유지(AC-6).
  //   필터로 화면에서 빠진 행은 유형 전역 순서상 제자리 고정(displayed 가 차지한 슬롯에만 새 순서 주입).
  //   소비부(PenChartTab·MedicalChartPanel·DoctorTreatmentPanel 등)는 유형별 sort_order 오름차순 조회라 즉시 반영.
  async function handleDragEnd(e: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = e;
    if (!over || String(active.id) === String(over.id)) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);
    const fromDisp = displayed.findIndex((p) => p.id === activeId);
    const toDisp = displayed.findIndex((p) => p.id === overId);
    if (fromDisp === -1 || toDisp === -1) return;

    // (1) 화면 목록 재배치 → (2) 유형 전역 순서에 주입(displayed 슬롯만 갱신, 그 외 제자리).
    const newDisplayed = arrayMove(displayed, fromDisp, toDisp);
    const dispIds = new Set(displayed.map((p) => p.id));
    const nextTypeOrder = [...typeFiltered];
    let k = 0;
    for (let i = 0; i < nextTypeOrder.length; i++) {
      if (dispIds.has(nextTypeOrder[i].id)) nextTypeOrder[i] = newDisplayed[k++];
    }
    // (3) 유형 전역 10 간격 재번호 → 변경분만 DB 반영.
    const renumbered = nextTypeOrder.map((p, i) => ({ ...p, sort_order: (i + 1) * 10 }));
    const prevOrder = new Map(typeFiltered.map((p) => [p.id, p.sort_order]));
    const updates = renumbered
      .filter((p) => prevOrder.get(p.id) !== p.sort_order)
      .map((p) => ({ id: p.id, sort_order: p.sort_order }));
    if (updates.length === 0) return;

    // (4) 낙관적 반영 — 전체 배열의 이 유형 슬롯에 renumbered 주입(타 유형 위치 불변). 실패 시 snapshot 롤백.
    const snapshot = localPhrases;
    const typeIds = new Set(typeFiltered.map((p) => p.id));
    const nextFull = [...localPhrases];
    let j = 0;
    for (let i = 0; i < nextFull.length; i++) {
      if (typeIds.has(nextFull[i].id)) nextFull[i] = renumbered[j++];
    }
    setLocalPhrases(nextFull);
    savingRef.current = true;
    reorder.mutate(updates, {
      onError: () => setLocalPhrases(snapshot), // useReorderPhrases.onError 가 토스트 담당
      onSettled: () => { savingRef.current = false; },
    });
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-3">
      {/* 헤더: 상용구 유형 필터 + 추가 버튼 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* T-20260526-foot-MEDCHART-SYNC: phrase_type 세그먼트 필터.
            T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: lockedType surface 에서는 숨김(단일 type 고정).
            대신 어떤 용도의 상용구 화면인지 안내 배지 노출. */}
        {lockedType ? (
          <div
            className="flex items-center gap-1.5 text-sm font-semibold text-teal-700"
            data-testid={`phrase-locked-type-${lockedType}`}
          >
            <Badge
              variant="outline"
              className={`text-[11px] h-5 px-2 ${PHRASE_TYPE_BADGE[lockedType] ?? PHRASE_TYPE_BADGE.pen_chart}`}
            >
              {PHRASE_TYPE_LABELS[lockedType]} 상용구
            </Badge>
            <span className="text-xs font-normal text-muted-foreground">
              {PHRASE_TYPE_DESC[lockedType] ?? PHRASE_TYPE_DESC.pen_chart}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-0.5">
            {(['all', 'pen_chart', 'medical_chart', 'customer_chart'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setFilterPhraseType(t); setFilterCat('all'); }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filterPhraseType === t
                    ? 'bg-background shadow-sm text-teal-700 font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`phrase-type-filter-${t}`}
              >
                {t === 'all' ? '전체' : PHRASE_TYPE_LABELS[t]}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {t === 'all'
                    ? phrases.length
                    : phrases.filter((p) => (p.phrase_type ?? 'pen_chart') === t).length}
                </span>
              </button>
            ))}
          </div>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="phrase-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            상용구 추가
          </Button>
        )}
      </div>

      {/* AC-1: 사이드 메뉴 + 리스트 2-컬럼 레이아웃 */}
      <div className="flex rounded-lg border overflow-hidden min-h-[240px]" data-testid="phrase-side-menu-layout">
        {/* 좌측 사이드 메뉴 — 카테고리 클릭 */}
        <div
          className="w-20 flex-shrink-0 border-r bg-muted/10 flex flex-col"
          data-testid="phrase-category-sidebar"
        >
          {sideMenuCats.map(({ key, label }) => {
            // T-20260608-foot-PHRASE-PEN-MED-SPLIT: 활성 phrase_type 기준 카운트(펜차트/진료차트 분리 정합)
            const count =
              key === 'all'
                ? typeFiltered.length
                : typeFiltered.filter((p) => p.category === key).length;
            const isActive = filterCat === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterCat(key)}
                className={`w-full flex flex-col items-center gap-0.5 px-1 py-2.5 text-center transition-colors border-b border-border/30 last:border-0 ${
                  isActive
                    ? 'bg-teal-50 text-teal-700 font-semibold border-l-2 border-l-teal-500'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                }`}
                data-testid={`phrase-cat-btn-${key}`}
              >
                <span className="text-[11px] leading-tight break-keep">{label}</span>
                <span className={`text-[10px] tabular-nums ${isActive ? 'text-teal-500' : 'text-muted-foreground/60'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 우측 리스트 영역 */}
        <div className="flex-1 min-w-0 overflow-y-auto max-h-[600px]">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-sm text-muted-foreground gap-1.5">
              <span>등록된 상용구가 없습니다.</span>
              <button
                type="button"
                onClick={openAdd}
                className="text-teal-600 text-xs hover:underline"
              >
                + 상용구 추가하기
              </button>
            </div>
          ) : (
            // AC-2: 컴팩트 리스트 — py-3→py-1.5, space-y-2→divide-y
            // T-20260701-foot-REORDER-ARROW-TO-DRAG: ↑↓ 화살표 제거 → 좌측 GripVertical 핸들 잡아끌기 순서변경.
            //   SortableContext items = 현재 화면(displayed) — 같은 화면 내에서만 재정렬(카테고리/유형 간 이동 아님).
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayed.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <div data-testid="phrase-list" className="divide-y divide-border/40">
                  {displayed.map((p) => (
                    <SortablePhraseRow
                      key={p.id}
                      p={p}
                      canEdit={canEdit}
                      delPending={del.isPending}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '상용구 수정' : '상용구 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* T-20260526-foot-MEDCHART-SYNC: 상용구 유형 선택 (전체 폭).
                T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT:
                - lockedType surface 에서 '신규 추가' 시: 유형 선택 숨김 → openAdd 에서 lockedType 자동 고정(AC1).
                - '편집' 시: 유형 선택 노출 → 레거시/NULL 상용구를 다른 surface 로 옮길 수 있게(AC3·AC6③).
                  편집으로 type 변경 시 type 필터에서 빠져 다른 화면으로 자동 이동. */}
            {(!lockedType || editing) && (
              <div>
                <Label className="text-xs font-semibold">
                  상용구 유형{' '}
                  <span className="text-muted-foreground font-normal text-[11px]">
                    — 어디서 사용하는 상용구인지 선택
                  </span>
                </Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(['pen_chart', 'medical_chart', 'customer_chart'] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="phrase_type"
                        value={t}
                        checked={form.phrase_type === t}
                        onChange={() => setForm((f) => ({ ...f, phrase_type: t }))}
                        className="accent-teal-600"
                      />
                      <span className={`text-sm px-2 py-0.5 rounded font-medium border ${PHRASE_TYPE_BADGE[t]}`}>
                        {PHRASE_TYPE_LABELS[t]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">카테고리</Label>
                {/* Dialog 내부 portal 충돌 방지 — native select 사용 */}
                {/* T-20260620-foot-PHRASE-CUSTCHART-CATEGORY-LINK AC-1/AC-2:
                    고객차트(customer_chart) 유형이면 [예약/상담/치료], 그 외는 기존 [차팅/처방/원장님/일반].
                    편집 중인 상용구의 현재 category 가 옵션에 없으면(레거시·미분류) 그 값을 보존 옵션으로 노출 → 무손실. */}
                {(() => {
                  const dialogCatLabels =
                    form.phrase_type === 'customer_chart' ? CUSTCHART_CATEGORY_LABELS : CATEGORY_LABELS;
                  const hasCurrent = Object.prototype.hasOwnProperty.call(dialogCatLabels, form.category);
                  return (
                    <select
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      {!hasCurrent && form.category && (
                        <option value={form.category}>
                          {MERGED_CATEGORY_LABELS[form.category] ?? `${form.category} (미분류)`}
                        </option>
                      )}
                      {Object.entries(dialogCatLabels).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  );
                })()}
              </div>
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1 w-full"
                  min={0}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">상용구 이름 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예) 족부 초진 기본"
                className="mt-1"
                data-testid="phrase-name-input"
              />
            </div>
            {/* AC-4: 단축어 입력 필드 (T-20260526-foot-PHRASE-SLASH) */}
            <div>
              <Label className="text-xs">
                단축어{' '}
                <span className="text-muted-foreground font-normal">
                  — 텍스트 입력 시 <code className="bg-muted px-0.5 rounded text-[10px]">//단축어</code> 로 자동완성
                </span>
              </Label>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted-foreground select-none font-mono">//</span>
                <Input
                  value={form.shortcut_key}
                  onChange={(e) => {
                    // 공백 제거, 소문자 통일 (영문/숫자/한글 허용)
                    const val = e.target.value.replace(/\s/g, '');
                    setForm((f) => ({ ...f, shortcut_key: val }));
                  }}
                  placeholder="예) 족통감소"
                  className="flex-1 font-mono"
                  data-testid="phrase-shortcut-input"
                />
              </div>
              {/* 중복 실시간 힌트 */}
              {(() => {
                const key = form.shortcut_key.trim();
                if (!key) return null;
                const dup = phrases.find((p) => p.shortcut_key === key && p.id !== editing?.id);
                if (!dup) return null;
                return (
                  <p className="mt-1 text-[11px] text-destructive">
                    ⚠️ 이미 &quot;{dup.name}&quot;에서 사용 중인 단축어입니다.
                  </p>
                );
              })()}
            </div>
            <div>
              <Label className="text-xs">내용 *</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="진료 메모에 삽입될 내용을 입력하세요..."
                className="mt-1 min-h-[120px] text-sm resize-none"
                data-testid="phrase-content-input"
              />
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
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="phrase-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
