// T-20260526-foot-SVC-CATEGORY-SORT: 탭별 DnD/↑↓ 순서 변경 + DB 저장 (sort_order)
// T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME: 진료관리(ClinicManagement)를 서비스관리 화면 내
//   top-level 서브탭으로 편입. lazy 로드로 services 청크 비대화 방지(ClinicManagement 는 10+ 탭 컴포넌트 의존).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Download, Eye, EyeOff, Search, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Service } from '@/lib/types';

// T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME: 진료관리 서브탭 — 기존 /admin/clinic-management 페이지 재사용(이동만).
const ClinicManagementPanel = lazy(() => import('@/pages/ClinicManagement'));

// AC-4 핵심: 진료관리 서브탭은 admin/manager/director 한정 노출/렌더.
// services 페이지 roles=[admin,manager,consultant,coordinator,therapist] 보다 좁음 →
// consultant/coordinator/therapist 권한 회귀 금지(서브탭 비노출 + 렌더 가드). App.tsx clinic-management RoleGuard 이중가드 보존.
const CLINIC_MGMT_ROLES = ['admin', 'manager', 'director'] as const;

const VAT_LABEL: Record<Service['vat_type'], string> = {
  none: '비과세',
  exclusive: '별도',
  inclusive: '포함',
};

const SERVICE_TYPE_LABEL: Record<Service['service_type'], string> = {
  single: '단일',
  package_component: '패키지',
  addon: '추가',
};

const CATEGORY_OPTIONS = ['레이저', '수액', '사전처치', '풋케어', '상담', '검사', '풋화장품', '기타'];

// T-20260510-foot-SVCMENU-REVAMP: 항목분류 옵션
// T-20260601-foot-SVC-PRESCRIPTION-CATEGORY: '처방약' 독립 카테고리 신설.
//   처방약 서비스는 이미 DB에 category_label='처방약'(16건)으로 분류돼 있으나
//   본 옵션 배열에 누락되어 탭/필터가 렌더되지 않고 '전체' 탭에서만 노출되던 상태.
//   여기에 '처방약'을 추가하면 (1) 카테고리 탭 자동 생성 (CATEGORY_TABS),
//   (2) ServiceDialog 항목분류 버튼 자동 추가 — 데이터 변경 없이 노출 복구.
const CATEGORY_LABEL_OPTIONS = ['기본', '검사', '상병', '처방약', '풋케어', '수액', '풋화장품'];

// T-20260526-foot-SVC-CATEGORY-SORT: 탭 목록 (전체 + 각 category_label)
const CATEGORY_TABS = ['전체', ...CATEGORY_LABEL_OPTIONS] as const;
type CategoryTab = typeof CATEGORY_TABS[number];

// T-20260601-foot-SVC-COSMETIC-LABEL-BACKFILL: 탭 분류 기준값.
// category_label 미설정(NULL) 레거시 row 는 category 값으로 fallback 하여 탭에 분류한다.
// (데이터 정규화로 대부분 category_label 채워지나, 향후 NULL 유입 방어 + 일반화)
const effectiveCategoryLabel = (svc: Service): string => svc.category_label ?? svc.category ?? '';

// ── T-20260526-foot-SVC-CATEGORY-SORT: 정렬 가능한 서비스 행 ─────────────────
// useSortable hook 규칙상 별도 컴포넌트 필요. DnD + ↑↓ 버튼 복합 지원 (AC-1).
interface SortableServiceRowProps {
  svc: Service;
  idx: number;
  total: number;
  canReorder: boolean;
  isAdmin: boolean;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  onEdit: (svc: Service) => void;
  onSoftDelete: (svc: Service) => void;
  onHardDelete: (svc: Service) => void;
  showCategoryLabel: boolean; // 전체 탭에서는 항목분류 컬럼 표시
}

function SortableServiceRow({
  svc,
  idx,
  total,
  canReorder,
  isAdmin,
  onReorder,
  onEdit,
  onSoftDelete,
  onHardDelete,
  showCategoryLabel,
}: SortableServiceRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: svc.id,
    disabled: !canReorder,
  });

  return (
    <tr
      ref={setNodeRef}
      data-testid={`svc-row-${svc.id}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn('border-t', !svc.active && 'opacity-50 bg-muted/30', isDragging && 'shadow-md')}
    >
      {/* 순서 변경 컬럼 (admin + 특정 탭 + 검색 없을 때만) */}
      {canReorder && (
        <td className="w-16 px-2 py-2">
          <div className="flex items-center gap-0.5">
            {/* 드래그 핸들 — touch-none 유지 (PointerSensor 경유, 태블릿 탭 오인식 방지) */}
            <button
              {...attributes}
              {...listeners}
              type="button"
              tabIndex={-1}
              className="flex items-center justify-center min-w-[28px] min-h-[28px] rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
              title="드래그하여 순서 변경"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            {/* ↑↓ 버튼 */}
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => onReorder(svc.id, 'up')}
                disabled={idx === 0}
                className="flex items-center justify-center w-5 h-4 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition"
                title="위로"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onReorder(svc.id, 'down')}
                disabled={idx === total - 1}
                className="flex items-center justify-center w-5 h-4 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition"
                title="아래로"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          </div>
        </td>
      )}
      {/* 항목분류 — 전체 탭에서만 표시 */}
      {showCategoryLabel && (
        <td className="px-4 py-2 text-xs text-muted-foreground">{svc.category_label ?? svc.category ?? '—'}</td>
      )}
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{svc.service_code ?? '—'}</td>
      <td className="px-4 py-2 font-medium">
        {svc.name}
        {!svc.active && (
          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">[비활성]</span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{formatAmount(svc.price)}</td>
      <td className="px-4 py-2 text-xs text-muted-foreground">{VAT_LABEL[svc.vat_type]}</td>
      {isAdmin && (
        <td className="px-4 py-2">
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => onEdit(svc)}
              className="rounded p-1.5 hover:bg-muted transition"
              title="수정"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {svc.active ? (
              <button
                onClick={() => onSoftDelete(svc)}
                className="rounded p-1.5 hover:bg-red-50 transition"
                title="비활성 처리"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </button>
            ) : (
              <button
                onClick={() => onHardDelete(svc)}
                className="rounded p-1.5 hover:bg-red-100 transition"
                title="완전 삭제 (참조 없는 경우만 가능)"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-700" />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

export default function Services() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME: top-level 서브탭 (서비스 관리 / 진료관리)
  // AC-4: 진료관리 서브탭은 admin/manager/director 한정. (CLINIC_MGMT_ROLES)
  const canViewClinicMgmt = !!profile?.role && (CLINIC_MGMT_ROLES as readonly string[]).includes(profile.role);
  const [topTab, setTopTab] = useState<'services' | 'clinic'>('services');
  // 권한 박탈/역할 변경 등으로 가시성을 잃은 경우 서비스 탭으로 강제 복귀(렌더 가드 보강).
  const effectiveTopTab: 'services' | 'clinic' = topTab === 'clinic' && canViewClinicMgmt ? 'clinic' : 'services';

  const [rows, setRows] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  // T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 표시 토글 (기본 숨김)
  const [showInactive, setShowInactive] = useState(false);
  // T-20260517-foot-SVC-FILTER-SEARCH: 텍스트 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // T-20260526-foot-SVC-CATEGORY-SORT: 활성 탭
  const [activeTab, setActiveTab] = useState<CategoryTab>('전체');

  // T-20260526-foot-SVC-CATEGORY-SORT: sort_order 저장 debounce 타이머
  const sortSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // T-20260526-foot-SVC-CATEGORY-SORT: DnD sensors (태블릿 터치 호환, AC-1)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  // 엑셀 내보내기 (T-20260507-foot-SERVICE-CATALOG-SEED Phase 2)
  const exportExcel = () => {
    const data = rows.map((s) => ({
      상품코드: s.service_code ?? '',
      상품명: s.name,
      대분류: s.category,
      단가: s.price,
      할인가: s.discount_price ?? '',
      수가코드: s.hira_code ?? '',
      실비여부: s.is_insurance_covered ? 'Y' : 'N',
      유형: SERVICE_TYPE_LABEL[s.service_type],
      VAT: VAT_LABEL[s.vat_type],
      상태: s.active ? '활성' : '비활성',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '판매상품');
    XLSX.writeFile(wb, `풋센터_판매상품_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('엑셀 내보내기 완료');
  };

  // T-20260526-foot-SVC-CATEGORY-SORT: sort_order 기준 정렬 (AC-3: 재진입 시 유지)
  const fetchServices = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('category_label', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }); // name은 sort_order 동일값 tie-break
    setLoading(false);
    if (error) { toast.error('서비스 목록 로딩 실패'); return; }
    setRows((data ?? []) as Service[]);
  }, [clinic]);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  // debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // T-20260526-foot-SVC-CATEGORY-SORT: 탭별 항목 (sort_order 기준)
  // AC-1: 탭별 DnD/↑↓, AC-3: sort_order 재진입 유지, AC-4: 탭 간 독립
  const tabItems = useMemo(() => {
    const base = rows.filter((svc) => {
      if (!svc.active && !showInactive) return false;
      if (activeTab !== '전체' && effectiveCategoryLabel(svc) !== activeTab) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        if (
          !svc.name.toLowerCase().includes(q) &&
          !(svc.service_code ?? '').toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
    if (activeTab === '전체') {
      // 전체 탭: category_label → sort_order → name 3단 정렬
      return [...base].sort((a, b) => {
        const catCmp = effectiveCategoryLabel(a).localeCompare(effectiveCategoryLabel(b), 'ko');
        if (catCmp !== 0) return catCmp;
        const orderCmp = (a.sort_order ?? 999) - (b.sort_order ?? 999);
        if (orderCmp !== 0) return orderCmp;
        return a.name.localeCompare(b.name, 'ko');
      });
    }
    // 특정 탭: sort_order → name 2단 정렬
    return [...base].sort((a, b) => {
      const orderCmp = (a.sort_order ?? 999) - (b.sort_order ?? 999);
      if (orderCmp !== 0) return orderCmp;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [rows, activeTab, showInactive, debouncedSearch]);

  // T-20260526-foot-SVC-CATEGORY-SORT: 재정렬 가능 조건
  // AC-1: admin 전용, 특정 탭(전체 제외), 검색 없을 때
  const canReorder = isAdmin && activeTab !== '전체' && !debouncedSearch;

  // T-20260526-foot-SVC-CATEGORY-SORT: sort_order DB 저장 (debounce 800ms, AC-2, AC-3)
  const scheduleSortSave = useCallback(
    (updates: { id: string; sort_order: number }[]) => {
      if (sortSaveTimerRef.current) clearTimeout(sortSaveTimerRef.current);
      sortSaveTimerRef.current = setTimeout(async () => {
        try {
          await Promise.all(
            updates.map(({ id, sort_order }) =>
              supabase.from('services').update({ sort_order }).eq('id', id),
            ),
          );
          toast.success('순서 저장됨', { duration: 1500 });
        } catch {
          toast.error('순서 저장 실패');
        }
      }, 800);
    },
    [],
  );

  // T-20260526-foot-SVC-CATEGORY-SORT: DnD 끝 → 순서 변경 + DB 저장
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canReorder) return;
      const { active, over } = event;
      if (!over || String(active.id) === String(over.id)) return;
      const activeStr = String(active.id);
      const overStr = String(over.id);

      setRows((prev) => {
        const inTab = prev
          .filter((s) => effectiveCategoryLabel(s) === activeTab && (showInactive || s.active))
          .sort((a, b) => {
            const o = (a.sort_order ?? 999) - (b.sort_order ?? 999);
            return o !== 0 ? o : a.name.localeCompare(b.name, 'ko');
          });
        const activeIdx = inTab.findIndex((s) => s.id === activeStr);
        const overIdx = inTab.findIndex((s) => s.id === overStr);
        if (activeIdx === -1 || overIdx === -1) return prev;

        const reordered = arrayMove(inTab, activeIdx, overIdx);
        const updated = reordered.map((s, i) => ({ ...s, sort_order: i * 10 }));

        scheduleSortSave(updated.map(({ id, sort_order }) => ({ id, sort_order })));

        const others = prev.filter(
          (s) => !(effectiveCategoryLabel(s) === activeTab && (showInactive || s.active)),
        );
        return [...others, ...updated];
      });
    },
    [canReorder, activeTab, showInactive, scheduleSortSave],
  );

  // T-20260526-foot-SVC-CATEGORY-SORT: ↑↓ 버튼 → 순서 변경 + DB 저장
  const handleReorderBtn = useCallback(
    (svcId: string, dir: 'up' | 'down') => {
      if (!canReorder) return;

      setRows((prev) => {
        const inTab = prev
          .filter((s) => effectiveCategoryLabel(s) === activeTab && (showInactive || s.active))
          .sort((a, b) => {
            const o = (a.sort_order ?? 999) - (b.sort_order ?? 999);
            return o !== 0 ? o : a.name.localeCompare(b.name, 'ko');
          });
        const idx = inTab.findIndex((s) => s.id === svcId);
        if (dir === 'up' && idx <= 0) return prev;
        if (dir === 'down' && idx >= inTab.length - 1) return prev;
        const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
        const reordered = [...inTab];
        [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
        const updated = reordered.map((s, i) => ({ ...s, sort_order: i * 10 }));

        scheduleSortSave(updated.map(({ id, sort_order }) => ({ id, sort_order })));

        const others = prev.filter(
          (s) => !(effectiveCategoryLabel(s) === activeTab && (showInactive || s.active)),
        );
        return [...others, ...updated];
      });
    },
    [canReorder, activeTab, showInactive, scheduleSortSave],
  );

  // T-20260510-foot-SVCMENU-REVAMP: 삭제 (soft delete = active=false)
  const softDelete = async (svc: Service) => {
    if (!isAdmin) return;
    if (!confirm(`"${svc.name}" 항목을 삭제하시겠습니까? (비활성 처리되며 과거 기록은 보존됩니다)`)) return;
    const { error } = await supabase
      .from('services')
      .update({ active: false })
      .eq('id', svc.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('삭제됨 (비활성 처리)');
    fetchServices();
  };

  // T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 완전 삭제
  const hardDelete = async (svc: Service) => {
    if (!isAdmin || svc.active) return;

    const [chargesRes, cisRes, resvRes] = await Promise.all([
      supabase.from('service_charges').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
      supabase.from('check_in_services').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
      supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('service_id', svc.id),
    ]);

    const refCount = (chargesRes.count ?? 0) + (cisRes.count ?? 0) + (resvRes.count ?? 0);

    if (refCount > 0) {
      toast.error(
        `"${svc.name}"은 과거 기록에서 참조 중입니다 (${refCount}건). 완전 삭제 불가 — 비활성 상태로 유지됩니다.`,
        { duration: 5000 },
      );
      return;
    }

    if (!confirm(`"${svc.name}" 항목을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', svc.id)
      .eq('active', false);

    if (error) { toast.error(`완전 삭제 실패: ${error.message}`); return; }
    toast.success(`"${svc.name}" 완전 삭제됨`);
    fetchServices();
  };

  // T-20260526-foot-SVC-CATEGORY-SORT: 탭별 항목 수 표시
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of CATEGORY_TABS) {
      if (tab === '전체') {
        counts['전체'] = rows.filter((s) => showInactive || s.active).length;
      } else {
        counts[tab] = rows.filter((s) => effectiveCategoryLabel(s) === tab && (showInactive || s.active)).length;
      }
    }
    return counts;
  }, [rows, showInactive]);

  // 표 컬럼 수 계산 (canReorder 여부 + 항목분류 여부 + admin 여부)
  const colCount = (canReorder ? 1 : 0) + (activeTab === '전체' ? 1 : 0) + 4 + (isAdmin ? 1 : 0);

  return (
    <div className="flex h-full flex-col">
      {/* T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME: top-level 서브탭 (서비스 관리 / 진료관리).
          진료관리는 admin/manager/director 한정 노출(AC-4). */}
      <div className="shrink-0 border-b px-6 pt-4">
        <div role="tablist" className="flex gap-1" data-testid="svc-top-tab-nav">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTopTab === 'services'}
            data-testid="svc-top-tab-services"
            onClick={() => setTopTab('services')}
            className={cn(
              'h-9 rounded-t-md border-b-2 px-4 text-sm font-semibold transition-colors',
              effectiveTopTab === 'services'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            서비스 관리
          </button>
          {canViewClinicMgmt && (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveTopTab === 'clinic'}
              data-testid="svc-top-tab-clinic"
              onClick={() => setTopTab('clinic')}
              className={cn(
                'h-9 rounded-t-md border-b-2 px-4 text-sm font-semibold transition-colors',
                effectiveTopTab === 'clinic'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              진료관리
            </button>
          )}
        </div>
      </div>

      {/* 진료관리 서브탭 — 기존 ClinicManagement 페이지 재사용(이동만). 가시성 + 렌더 이중 가드(AC-4). */}
      {effectiveTopTab === 'clinic' && canViewClinicMgmt ? (
        <div className="flex-1 min-h-0 overflow-hidden" data-testid="svc-clinic-panel">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                불러오는 중…
              </div>
            }
          >
            <ClinicManagementPanel />
          </Suspense>
        </div>
      ) : (
        // 함수 호출(컴포넌트 경계 X)로 인라인 렌더 — 상태는 Services 본체에 유지되어 리마운트/상태소실 없음.
        renderServiceCatalog()
      )}
    </div>
  );

  // ── 서비스 목록 패널 (기존 서비스 관리 화면) ──────────────────────────────
  // 클로저로 기존 상태/핸들러를 그대로 사용. (서브탭 편입에 따른 래핑만, 로직 무변경)
  function renderServiceCatalog() {
    return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold">서비스 관리</h1>
        <div className="flex items-center gap-2">
          {/* T-20260511-foot-SVCMENU-HARDDELETE: 비활성 항목 토글 */}
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setShowInactive((v) => !v)}
              className={cn('gap-1 text-sm', showInactive && 'border-amber-400 bg-amber-50 text-amber-700')}
              title={showInactive ? '비활성 항목 숨기기' : '비활성 항목 보기'}
            >
              {showInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showInactive ? '비활성 숨기기' : '비활성 보기'}
            </Button>
          )}
          <Button variant="outline" onClick={exportExcel} className="gap-1 text-sm">
            <Download className="h-4 w-4" /> 엑셀 내보내기
          </Button>
          {isAdmin && (
            <Button onClick={() => setOpenCreate(true)} className="gap-1">
              <Plus className="h-4 w-4" /> 서비스 추가
            </Button>
          )}
        </div>
      </div>

      {/* T-20260526-foot-SVC-CATEGORY-SORT: 탭 네비게이션 (기존 Select 대체) */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div
          role="tablist"
          className="flex flex-wrap gap-1"
          data-testid="svc-tab-nav"
        >
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`svc-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                activeTab === tab
                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                  : 'border-input bg-background hover:bg-muted text-muted-foreground',
              )}
            >
              {tab}
              {tabCounts[tab] !== undefined && tabCounts[tab] > 0 && (
                <span className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                  activeTab === tab ? 'bg-teal-100 text-teal-700' : 'bg-muted text-muted-foreground',
                )}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 검색 — 모든 탭에서 동작, 검색 중에는 재정렬 비활성 */}
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="시술명 또는 상품코드 검색"
            className="pl-8"
          />
        </div>
      </div>

      {/* 재정렬 안내 (admin + 특정 탭 + 검색 없음) */}
      {canReorder && (
        <p className="mb-2 text-xs text-teal-600" data-testid="reorder-hint">
          드래그 또는 ↑↓ 버튼으로 순서를 바꾸면 자동 저장됩니다.
        </p>
      )}
      {isAdmin && activeTab !== '전체' && debouncedSearch && (
        <p className="mb-2 text-xs text-amber-600">
          검색 중에는 순서 변경이 비활성화됩니다.
        </p>
      )}

      {/* 서비스 목록 테이블 */}
      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {/* 재정렬 핸들 컬럼 */}
                  {canReorder && (
                    <th className="w-16 px-2 py-2 text-left font-medium text-[10px]">순서</th>
                  )}
                  {/* 항목분류 — 전체 탭에서만 */}
                  {activeTab === '전체' && (
                    <th className="px-4 py-2 text-left font-medium">항목분류</th>
                  )}
                  <th className="px-3 py-2 text-left font-medium">상품코드</th>
                  <th className="px-4 py-2 text-left font-medium">시술명</th>
                  <th className="px-4 py-2 text-right font-medium">단가</th>
                  <th className="px-4 py-2 text-left font-medium">VAT</th>
                  {isAdmin && <th className="px-4 py-2 text-center font-medium">관리</th>}
                </tr>
              </thead>
              <SortableContext
                items={canReorder ? tabItems.map((s) => s.id) : []}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {tabItems.map((svc, idx) => (
                    <SortableServiceRow
                      key={svc.id}
                      svc={svc}
                      idx={idx}
                      total={tabItems.length}
                      canReorder={canReorder}
                      isAdmin={isAdmin}
                      onReorder={handleReorderBtn}
                      onEdit={setEditTarget}
                      onSoftDelete={softDelete}
                      onHardDelete={hardDelete}
                      showCategoryLabel={activeTab === '전체'}
                    />
                  ))}
                  {!loading && tabItems.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        {debouncedSearch
                          ? '검색 결과 없음'
                          : activeTab === '전체'
                          ? '등록된 서비스가 없습니다'
                          : `[${activeTab}] 탭에 등록된 서비스가 없습니다`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        )}
      </div>

      {isAdmin && (
        <>
          <ServiceDialog
            open={openCreate}
            clinicId={clinic?.id}
            service={null}
            onOpenChange={setOpenCreate}
            onSaved={() => { setOpenCreate(false); fetchServices(); }}
          />
          <ServiceDialog
            open={!!editTarget}
            clinicId={clinic?.id}
            service={editTarget}
            onOpenChange={(o) => { if (!o) setEditTarget(null); }}
            onSaved={() => { setEditTarget(null); fetchServices(); }}
          />
        </>
      )}
    </div>
    );
  }
}

function ServiceDialog({
  open,
  clinicId,
  service,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  clinicId: string | undefined;
  service: Service | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('기타');
  // T-20260510-foot-SVCMENU-REVAMP: 항목분류
  const [categoryLabel, setCategoryLabel] = useState('풋케어');
  const [serviceCode, setServiceCode] = useState('');
  const [price, setPrice] = useState(0);
  const [discountPrice, setDiscountPrice] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState(30);
  const [vatType, setVatType] = useState<Service['vat_type']>('none');
  const [serviceType, setServiceType] = useState<Service['service_type']>('single');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(service?.name ?? '');
      setCategory(service?.category ?? '기타');
      setCategoryLabel(service?.category_label ?? '풋케어');
      setServiceCode(service?.service_code ?? '');
      setPrice(service?.price ?? 0);
      setDiscountPrice(service?.discount_price ?? null);
      setDurationMin(service?.duration_min ?? 30);
      setVatType(service?.vat_type ?? 'none');
      setServiceType(service?.service_type ?? 'single');
      setActive(service?.active ?? true);
    }
  }, [open, service]);

  const save = async () => {
    if (!clinicId || !name.trim()) return;
    setSubmitting(true);

    const payload = {
      clinic_id: clinicId,
      name: name.trim(),
      category,
      category_label: categoryLabel,
      service_code: serviceCode.trim() || null,
      price,
      discount_price: discountPrice,
      duration_min: durationMin,
      vat_type: vatType,
      service_type: serviceType,
      active,
    };

    // T-20260526-foot-SVC-CATEGORY-SORT: 신규 서비스 sort_order = 카테고리 내 마지막+10
    // 간단히 999로 넣으면 해당 카테고리 탭에서 맨 뒤에 위치
    const { error } = service
      ? await supabase.from('services').update(payload).eq('id', service.id)
      : await supabase.from('services').insert({ ...payload, sort_order: 999 });

    setSubmitting(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(service ? '수정됨' : '서비스 추가됨');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? '서비스 수정' : '서비스 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>시술명</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {/* T-20260510-foot-SVCMENU-REVAMP: 항목분류 + 상품코드 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>항목분류</Label>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_LABEL_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryLabel(c)}
                    className={cn(
                      'h-7 rounded-md border px-2 text-xs font-medium',
                      categoryLabel === c ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>상품코드</Label>
              <Input value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} placeholder="예: FC001" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>카테고리 (레거시)</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs font-medium',
                    category === c ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {c}
                </button>
              ))}
              {!CATEGORY_OPTIONS.includes(category) && (
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="직접 입력"
                  className="h-8 w-28 text-xs"
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>가격</Label>
              <AmountInput
                value={price}
                onChange={(raw) => setPrice(Number(raw) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>할인가 (옵션)</Label>
              <AmountInput
                value={discountPrice ?? ''}
                onChange={(raw) => setDiscountPrice(raw ? Number(raw) : null)}
                placeholder="없음"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>시간 (분)</Label>
            <Input
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>VAT</Label>
            <div className="flex gap-2">
              {(['none', 'exclusive', 'inclusive'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVatType(v)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs',
                    vatType === v ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {VAT_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="flex gap-2">
              {(['single', 'package_component', 'addon'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setServiceType(v)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-xs',
                    serviceType === v ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-input hover:bg-muted',
                  )}
                >
                  {SERVICE_TYPE_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="svc-active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="svc-active">활성</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
