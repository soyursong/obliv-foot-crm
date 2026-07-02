// TreatmentRequestBox — 2번차트 패키지 섹션 [치료신청] 박스 (치료부위 박스와 병렬)
// T-20260701-foot-CHART2-TREATREQ-SPLIT
//
// 5항목 체크박스(피검사/KOH균검사/무좀PC+NL/내성PD/각질RB). 태블릿 큰 버튼 UX.
//   · 치료유형 축(내성=podologue / 각질=ribbon / 무좀=preconditioning+unheated_laser) → chart_treatment_requests 저장.
//       한 체크박스가 복수 코드를 함의할 수 있다(무좀 PC+NL). 체크=전 코드 present, 해제=전 코드 delete.
//   · 피검사(blood_flag) / KOH(koh_flag) → 既존 리스트업 엔티티 위임(request_*_for_customer RPC).
//       본 박스 체크 = 既존 토글과 동일 상태 공유(같은 플래그·같은 query key invalidate). chart_treatment_requests 미저장(DA AC-4).
//       ⚠ request_*_for_customer 는 現 SSOT push(T-20260623 이 set_*_requested 를 supersede — no-service-row 차단 해소).
//         既존 KohRequestToggle/BloodTestRequestToggle 이 호출하는 바로 그 RPC → 동작 동일, 신규 저장소 0.
//
// 초진(new)  = 실장 수동 체크(source='manual').
// 재진(returning) = 생성 패키지 시술유형에서 자동 파생(source='package_derived', 체크인 시점 스냅샷 1회 —
//                    이후 패키지 편집에 안 흔들림, live mirror 아님. AC-3). 수동 추가/해제도 가능.
//
// graceful: chart_treatment_requests 미적용(마이그 전) prod 도달 시 42P01 → reads 빈배열/writes 안내 토스트.

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { Loader2, Check, ClipboardList } from 'lucide-react';
import {
  TREATMENT_REQUEST_ITEMS,
  type TreatmentRequestItem,
} from '@/lib/treatmentRequestCodes';

interface CtrRow {
  request_code: string;
  request_axis: string;
  source: string;
}

interface Props {
  customerId: string | null | undefined;
  checkInId: string | null | undefined;
  clinicId: string | null | undefined;
  /** customers.visit_type 스냅샷: 'new'(초진) | 'returning'(재진) | null */
  visitType: string | null | undefined;
  canEdit: boolean;
  createdBy: string | null | undefined;
  /**
   * 재진 자동 파생 코드(부모가 active 패키지 시술유형에서 산출). 예: 포돌로게 잔여 → ['podologue'].
   * AC-3 스냅샷 소스. 모두 treatment 축 session_type 코드.
   */
  packageDerivedCodes?: string[];
}

// ── chart_treatment_requests 조회(graceful) ─────────────────────────────────
function useTreatmentRequests(checkInId: string | null | undefined) {
  return useQuery<CtrRow[]>({
    queryKey: ['chart_treatment_requests', checkInId],
    enabled: !!checkInId,
    queryFn: async () => {
      if (!checkInId) return [];
      const { data, error } = await supabase
        .from('chart_treatment_requests')
        .select('request_code, request_axis, source')
        .eq('check_in_id', checkInId);
      if (error) {
        if (/chart_treatment_requests|relation|does not exist|42P01/i.test(error.message ?? '')) return [];
        throw error;
      }
      return (data ?? []) as CtrRow[];
    },
    staleTime: 20_000,
  });
}

// ── 피검사/KOH 既존 플래그 상태(check_in_services) ──────────────────────────
function useExamFlags(customerId: string | null | undefined) {
  return useQuery<{ blood: boolean; koh: boolean }>({
    queryKey: ['treatreq_exam_flags', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const empty = { blood: false, koh: false };
      if (!customerId) return empty;
      const SEL = 'blood_test_requested, koh_requested, check_ins!inner(customer_id, status)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.customer_id', customerId)
        .neq('check_ins.status', 'cancelled');
      if (error) {
        if (/blood_test_requested|koh_requested|42703/i.test(error.message ?? '')) return empty;
        throw error;
      }
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      return {
        blood: rows.some((r) => r['blood_test_requested'] === true),
        koh: rows.some((r) => r['koh_requested'] === true),
      };
    },
    staleTime: 20_000,
  });
}

export default function TreatmentRequestBox({
  customerId,
  checkInId,
  clinicId,
  visitType,
  canEdit,
  createdBy,
  packageDerivedCodes,
}: Props) {
  const qc = useQueryClient();
  const { data: ctrRows = [], isLoading } = useTreatmentRequests(checkInId);
  const { data: examFlags } = useExamFlags(customerId);
  const snapshotDone = useRef(false);

  const codeSet = new Set(ctrRows.map((r) => r.request_code));
  const derivedCodeSet = new Set(
    ctrRows.filter((r) => r.source === 'package_derived').map((r) => r.request_code),
  );

  // ── chart_treatment_requests upsert/delete (treatment 항목의 codes 전체) ────
  const ctrMutation = useMutation({
    mutationFn: async (args: { item: TreatmentRequestItem; next: boolean; source?: string }) => {
      if (!checkInId || !customerId || !clinicId) {
        throw new Error('내원(체크인) 기록이 있어야 치료신청을 저장할 수 있습니다');
      }
      const { item, next, source = 'manual' } = args;
      if (next) {
        const { error } = await supabase.from('chart_treatment_requests').upsert(
          item.codes.map((code) => ({
            clinic_id: clinicId,
            customer_id: customerId,
            check_in_id: checkInId,
            visit_type: visitType ?? null,
            request_code: code,
            request_axis: item.axis,
            source,
            created_by: createdBy ?? null,
          })),
          { onConflict: 'check_in_id,request_code' },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('chart_treatment_requests')
          .delete()
          .eq('check_in_id', checkInId)
          .in('request_code', item.codes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chart_treatment_requests', checkInId] });
    },
    onError: (e: Error) => {
      if (/chart_treatment_requests|relation|does not exist|42P01/i.test(e.message ?? '')) {
        toast.error('치료신청 저장 준비 중입니다(스키마 적용 대기)');
      } else {
        toast.error(`치료신청 변경 실패: ${e.message}`);
      }
    },
  });

  // ── 피검사/KOH 既존 RPC 위임 ────────────────────────────────────────────────
  const examMutation = useMutation({
    mutationFn: async (args: { entity: 'blood_flag' | 'koh_flag'; next: boolean }) => {
      const rpc = args.entity === 'blood_flag'
        ? 'request_blood_test_for_customer'
        : 'request_koh_for_customer';
      const { error } = await supabase.rpc(rpc, { p_customer_id: customerId, p_value: args.next });
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ['treatreq_exam_flags', customerId] });
      // 既존 토글 + 진료대시보드 리스트업 목록 동시 반영(끊김 없이, AC-4).
      qc.invalidateQueries({ queryKey: ['blood_toggle_target', customerId] });
      qc.invalidateQueries({ queryKey: ['koh_toggle_target', customerId] });
      qc.invalidateQueries({ queryKey: ['exam_targets'] });
      qc.invalidateQueries({ queryKey: ['koh_report'] });
      toast.success(args.next ? '검사 신청(ON)' : '검사 신청 해제(OFF)');
    },
    onError: (e: Error) => {
      toast.error(`검사 신청 변경 실패: ${e.message}`);
    },
  });

  // ── 재진 자동 파생 스냅샷(AC-3): 미저장 상태에서 1회만 삽입(point-in-time 동결) ──
  useEffect(() => {
    if (snapshotDone.current) return;
    if (!canEdit || visitType !== 'returning') return;
    if (!checkInId || !customerId || !clinicId) return;
    if (isLoading) return;
    const derived = (packageDerivedCodes ?? []).filter((c) => !codeSet.has(c));
    if (ctrRows.length > 0 || derived.length === 0) return; // 이미 스냅샷됨/파생없음 → 재삽입 금지(동결)
    snapshotDone.current = true;
    (async () => {
      const { error } = await supabase.from('chart_treatment_requests').upsert(
        derived.map((code) => ({
          clinic_id: clinicId,
          customer_id: customerId,
          check_in_id: checkInId,
          visit_type: visitType ?? null,
          request_code: code,
          request_axis: 'treatment',
          source: 'package_derived',
          created_by: createdBy ?? null,
        })),
        { onConflict: 'check_in_id,request_code' },
      );
      if (!error) qc.invalidateQueries({ queryKey: ['chart_treatment_requests', checkInId] });
      // 42P01 등은 조용히 무시(graceful) — snapshotDone 이미 true 라 폭주 없음.
    })();
  }, [
    canEdit, visitType, checkInId, customerId, clinicId, isLoading,
    ctrRows.length, packageDerivedCodes, codeSet, createdBy, qc,
  ]);

  const busy = ctrMutation.isPending || examMutation.isPending;

  const isChecked = (item: TreatmentRequestItem): boolean => {
    if (item.existingEntity === 'blood_flag') return examFlags?.blood ?? false;
    if (item.existingEntity === 'koh_flag') return examFlags?.koh ?? false;
    // treatment: 함의하는 모든 코드가 present 여야 checked
    return item.codes.length > 0 && item.codes.every((c) => codeSet.has(c));
  };

  const isDerived = (item: TreatmentRequestItem): boolean =>
    item.existingEntity === null && item.codes.length > 0 && item.codes.every((c) => derivedCodeSet.has(c));

  const onToggle = (item: TreatmentRequestItem) => {
    if (!canEdit || busy) return;
    const next = !isChecked(item);
    if (item.existingEntity === 'blood_flag' || item.existingEntity === 'koh_flag') {
      examMutation.mutate({ entity: item.existingEntity, next });
    } else {
      ctrMutation.mutate({ item, next });
    }
  };

  return (
    <div className="rounded-lg border bg-white p-2" data-testid="pkg-tab-treatreq-section">
      <div className="mb-1.5 flex items-center gap-1.5">
        <ClipboardList className="h-4 w-4 text-teal-600" />
        <span className="text-xs font-semibold text-muted-foreground">치료신청</span>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />}
      </div>
      {/* T-20260702-CHART2-TREATREQ-COMPACT-ONELINE: 한 줄에 하나씩(1항목/행) 세로 스택 + 컴팩트 여백. 기존 2~3열 grid 폐기. */}
      <div className="flex flex-col gap-1" data-testid="treatreq-checkbox-grid">
        {TREATMENT_REQUEST_ITEMS.map((item) => {
          const checked = isChecked(item);
          const derived = isDerived(item);
          return (
            <button
              key={item.key}
              type="button"
              disabled={!canEdit || busy}
              onClick={() => onToggle(item)}
              data-testid={`treatreq-item-${item.key}`}
              data-checked={checked}
              aria-pressed={checked}
              className={[
                'flex w-full items-center justify-between gap-1.5 rounded-md border px-2.5 py-1.5 text-left transition',
                'min-h-[36px] text-[13px] font-medium', // 컴팩트 세로 스택(1항목/행) — 태블릿 터치 유지
                checked
                  ? 'border-teal-400 bg-teal-50 text-teal-800'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
                !canEdit ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-teal-500 bg-teal-500 text-white' : 'border-neutral-300 bg-white',
                  ].join(' ')}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {item.label}
              </span>
              {derived && (
                <span className="rounded bg-teal-100 px-1 py-0.5 text-[9px] font-semibold text-teal-700">
                  자동
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!canEdit && (
        <p className="mt-1 text-[10px] text-muted-foreground">조회 권한 — 치료신청은 실장/관리자만 변경 가능</p>
      )}
    </div>
  );
}
