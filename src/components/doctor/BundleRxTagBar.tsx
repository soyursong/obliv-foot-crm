// BundleRxTagBar — 묶음처방 태그 = 빠른처방 트리거 (AC-3, 원클릭 즉시 삽입)
// T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER (문지은 대표원장, MSG-20260615-003419-lbkd)
//
// 현장 직관: "태그만 누르면 그 약이 뜨는게 기존 빠른처방" → 묶음처방(prescription_sets)에 부여된
//   색깔 태그를 진료화면 처방 패널에 칩으로 노출. 칩 탭 → 그 묶음 약물을 처방 목록에 즉시 추가(A안, 확인팝업 없음).
//
// ★ 설계 격리(§B 좌표확인 ztrf): 기존 빠른처방(quick_rx_buttons / QuickRxBar)을 전혀 건드리지 않는다.
//   - quick_rx_buttons 는 prescription_sets(id) 를 FK 참조하는 별도 버튼 테이블.
//   - 본 바는 prescription_sets 에 직접 부여된 태그(tag_label NOT NULL)만 별도로 읽어 칩으로 렌더 →
//     동일 삽입 패턴(onSelectItems)을 재사용. 빠른처방 폐지/대체 없음 = 순수 ADDITIVE 새 접근경로.
//   - role 게이트(부원장 자유텍스트)·급여 게이트는 QuickRxBar 와 동일 SSOT(prescriptionGate/prescribableDrugs) 재사용.
//
// 사용처: DoctorTreatmentPanel 처방 탭 (모드 A — onSelectItems 콜백, DB 직접 저장 안 함. 확정은 부모 처방컨펌).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { IconRenderer } from '@/components/admin/QuickRxButtonsTab';
import { tagChipClass } from '@/lib/rxTagPalette';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import { checkRxRoleGate, rxRoleGateMessage, rxInsuranceGateMessage, rxInsuranceOverrideConfirm } from '@/lib/prescriptionGate';
import { evaluateRxInsuranceGate } from '@/lib/prescribableDrugs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TaggedSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  tag_label: string | null;
  tag_color: string | null;
  icon: string | null;
}

// ---------------------------------------------------------------------------
// Hook — 태그가 부여된 활성 묶음처방만 (tag_label NOT NULL)
// ---------------------------------------------------------------------------
function useTaggedBundles() {
  return useQuery({
    queryKey: ['prescription_sets', 'tagged_bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items, tag_label, tag_color, icon')
        .eq('is_active', true)
        .not('tag_label', 'is', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaggedSet[];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface BundleRxTagBarProps {
  /** 의사 여부 — 토스트 문구 분기(확정 안내 vs 임시). */
  doctorMode: boolean;
  /** 현재 사용자 role — 부원장 자유텍스트 게이트 등(미지정 시 게이트 비적용). */
  role?: string;
  /** 태그 탭 시 호출 — 부모(처방 목록)가 items 를 받아 삽입. A안: 미리보기/확인 없이 즉시. */
  onSelectItems: (items: PrescriptionItem[]) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BundleRxTagBar({ doctorMode, role, onSelectItems, className }: BundleRxTagBarProps) {
  const { data: bundles = [], isLoading } = useTaggedBundles();

  if (isLoading || bundles.length === 0) {
    return null; // 태그 부여된 묶음 없으면 미노출(빈 영역 방지)
  }

  async function handleTagClick(b: TaggedSet) {
    const items = b.items ?? [];
    if (items.length === 0) {
      toast.warning(`"${b.name}" 묶음처방에 약이 없어요.`);
      return;
    }

    // role 게이트 — 부원장은 prescription_code_id 없는 자유텍스트 약 차단(QuickRxBar 와 동일 SSOT, fail-closed).
    const roleGate = checkRxRoleGate(role, items);
    if (!roleGate.allowed) {
      toast.error(rxRoleGateMessage(roleGate.blockedNames));
      return;
    }

    // 급여여부 게이트 — 급여중지/삭제/기준변경 약 경고+차단(관리자 해제 가능). QuickRxBar 와 동일 SSOT.
    const insGate = await evaluateRxInsuranceGate(role, items);
    if (!insGate.allowed) {
      if (!insGate.overridable) {
        toast.error(rxInsuranceGateMessage(insGate.blocked));
        return;
      }
      if (!window.confirm(rxInsuranceOverrideConfirm(insGate.blocked))) {
        toast.info('취소했어요.');
        return;
      }
    }

    // A안: 미리보기/확인 팝업 없이 즉시 처방 목록에 추가. DB 저장은 부모(처방 컨펌)가 담당.
    onSelectItems(items);
    toast.success(
      doctorMode
        ? `"${b.tag_label}" 처방이 입력됐어요. 처방 컨펌 버튼으로 확정하세요.`
        : `"${b.tag_label}" 임시 처방이 입력됐어요.`,
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <span className="text-[11px] font-medium text-muted-foreground">묶음처방 태그</span>
      <div
        className="flex flex-wrap gap-1.5"
        data-testid="bundle-rx-tag-bar"
        role="listbox"
        aria-label="묶음처방 태그 빠른삽입"
      >
        {bundles.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => handleTagClick(b)}
            data-testid={`bundle-rx-tag-${b.id}`}
            aria-label={`묶음처방 태그 ${b.tag_label}`}
            title={`${b.name} — 탭하면 약이 처방 목록에 추가돼요`}
            className={cn(
              'inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition active:scale-[0.97] hover:brightness-95',
              tagChipClass(b.tag_color),
            )}
          >
            {b.icon && <IconRenderer icon={b.icon} className="h-3.5 w-3.5" />}
            {b.tag_label}
          </button>
        ))}
      </div>
    </div>
  );
}
