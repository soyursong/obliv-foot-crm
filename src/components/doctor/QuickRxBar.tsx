// QuickRxBar — 빠른처방 단축 버튼 바
// T-20260512-foot-QUICK-RX-BUTTON
//
// 사용처:
//   A) DoctorTreatmentPanel (처방 탭 상단) — onSelectItems 콜백 모드 (DB 직접 안 씀)
//   B) DoctorPatientList (행별 처방 버튼)  — checkInId 직접 모드 (DB에 바로 저장)
//
// 의사(director/admin/manager) 클릭 → prescription_status='confirmed' + doctor_confirm_prescription=true
// 치료사/기타 클릭 → prescription_status='pending' (임시)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconRenderer } from '@/components/admin/QuickRxButtonsTab';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface QuickRxButtonRow {
  id: string;
  name: string;
  icon: string;
  prescription_set_id: number;
  sort_order: number;
  prescription_sets: {
    id: number;
    name: string;
    items: PrescriptionItem[];
  } | null;
}

/** 의사 역할 판단 */
const DOCTOR_ROLES = ['director', 'admin', 'manager'] as const;
export function isDoctor(role: string): boolean {
  return (DOCTOR_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Hook — 빠른처방 버튼 목록
// ---------------------------------------------------------------------------
function useQuickRxButtonsBar() {
  return useQuery({
    queryKey: ['quick_rx_buttons', 'bar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quick_rx_buttons')
        .select('id, name, icon, prescription_set_id, sort_order, prescription_sets(id, name, items)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QuickRxButtonRow[];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Hook — DB에 처방 직접 저장 (standalone 모드)
// ---------------------------------------------------------------------------
function useApplyQuickRx(checkInId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items,
      doctorMode,
    }: {
      items: PrescriptionItem[];
      doctorMode: boolean;
    }) => {
      if (!checkInId) throw new Error('checkInId 없음');
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        prescription_items: items as unknown as Record<string, unknown>[],
        prescription_status: doctorMode ? 'confirmed' : 'pending',
      };
      if (doctorMode) {
        patch.doctor_confirm_prescription = true;
        patch.doctor_confirmed_at = now;
      }
      const { error } = await supabase.from('check_ins').update(patch).eq('id', checkInId);
      if (error) throw error;
    },
    onSuccess: (_, { doctorMode }) => {
      if (checkInId) {
        qc.invalidateQueries({ queryKey: ['doctor_fields', checkInId] });
        qc.invalidateQueries({ queryKey: ['quick_rx_patient_list'] });
      }
      toast.success(doctorMode ? '처방이 확정됐어요.' : '임시 처방이 입력됐어요. 원장 확인 필요.');
    },
    onError: (e: Error) => toast.error(`처방 입력 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// QuickRxBar Props
// ---------------------------------------------------------------------------
export interface QuickRxBarProps {
  /** 의사 여부 — true면 '확정', false면 '임시' */
  doctorMode: boolean;

  // ── 모드 A: 콜백 모드 (DoctorTreatmentPanel 내부) ──
  /** items 콜백 제공 시 DB 직접 저장 안 함 */
  onSelectItems?: (items: PrescriptionItem[]) => void;

  // ── 모드 B: 직접 DB 저장 모드 ──
  checkInId?: string;
  /** DB 저장 완료 후 콜백 */
  onApplied?: () => void;

  className?: string;
  /** 컴팩트 모드 (리스트 행 내 사용 시) */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function QuickRxBar({
  doctorMode,
  onSelectItems,
  checkInId,
  onApplied,
  className,
  compact = false,
}: QuickRxBarProps) {
  const { data: buttons = [], isLoading } = useQuickRxButtonsBar();
  const applyMut = useApplyQuickRx(checkInId);

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">처방 버튼 로딩 중…</span>
      </div>
    );
  }

  if (buttons.length === 0) {
    return null; // 버튼 없으면 렌더 안 함
  }

  async function handleClick(btn: QuickRxButtonRow) {
    const items = btn.prescription_sets?.items ?? [];
    if (items.length === 0) {
      toast.warning(`"${btn.name}" 처방세트에 항목이 없어요.`);
      return;
    }

    if (onSelectItems) {
      // 모드 A: 콜백만 호출, DB 저장은 부모가 담당
      onSelectItems(items);
      toast.success(
        doctorMode
          ? `"${btn.name}" 처방이 입력됐어요. 처방 컨펌 버튼으로 확정하세요.`
          : `"${btn.name}" 임시 처방이 입력됐어요.`,
      );
    } else if (checkInId) {
      // 모드 B: DB에 직접 저장
      await applyMut.mutateAsync({ items, doctorMode });
      onApplied?.();
    }
  }

  // 버튼 크기 결정
  const btnBase = compact
    ? 'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition active:scale-95'
    : 'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition active:scale-95 min-h-[36px]';

  const confirmedStyle = doctorMode
    ? 'border-teal-400 bg-teal-50 text-teal-800 hover:bg-teal-100'
    : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100';

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* 라벨 */}
      {!compact && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">빠른처방</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
              doctorMode
                ? 'bg-teal-100 text-teal-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {doctorMode ? '의사 — 바로 확정' : '치료사 — 임시 처방'}
          </span>
        </div>
      )}

      {/* 버튼 바 (가로 스크롤) */}
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5"
        data-testid="quick-rx-bar"
      >
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => handleClick(btn)}
            disabled={applyMut.isPending}
            className={cn(btnBase, confirmedStyle, 'shrink-0')}
            data-testid={`quick-rx-btn-${btn.name}`}
          >
            {applyMut.isPending ? (
              <Loader2 className={compact ? 'h-3 w-3 animate-spin' : 'h-3.5 w-3.5 animate-spin'} />
            ) : (
              <IconRenderer
                icon={btn.icon}
                className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}
              />
            )}
            {btn.name}
          </button>
        ))}
      </div>
    </div>
  );
}
