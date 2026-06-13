// QuickRxBar — 빠른처방 단축 버튼 바
// T-20260512-foot-QUICK-RX-BUTTON
//
// 사용처:
//   A) DoctorTreatmentPanel (처방 탭 상단) — onSelectItems 콜백 모드 (DB 직접 안 씀)
//   B) DoctorPatientList (행별 처방 버튼)  — checkInId 직접 모드 (DB에 바로 저장)
//
// 의사(director/admin/manager) 클릭 → prescription_status='confirmed' + doctor_confirm_prescription=true
// 치료사/기타 클릭 → prescription_status='pending' (임시)

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { Loader2, FileText, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconRenderer } from '@/components/admin/QuickRxButtonsTab';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import { checkRxRoleGate, rxRoleGateMessage, rxInsuranceGateMessage, rxInsuranceOverrideConfirm } from '@/lib/prescriptionGate';
import { evaluateRxInsuranceGate } from '@/lib/prescribableDrugs';
import {
  checkRxInClinic,
  rxInClinicMessage,
} from '@/lib/inClinicRxGate';
import {
  // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 인플레이스 처방 mutate 공통 가드 + 차트변경 audit.
  assertInClinicForRxMutation,
  rxGateError,
  logRxAudit,
  summarizeRxForAudit,
  IN_CLINIC_GATE_CODE,
  type RxAuditSurface,
  type RxAuditActor,
} from '@/lib/rxMutationGuard';
import { captureRxSnapshot, buildUndoPatch, type RxSnapshot } from '@/lib/rxUndo';
import { rxItemTooltipLine, formatRxConfirmedSummary } from '@/lib/rxTooltip';

/**
 * T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 인플레이스 처방 mutate 가드/감사 컨텍스트.
 * surface(발생 화면) + actor(처리자) + customerId(audit FK). 강제(enforcement)는 DB 재검증으로
 * 진입점과 무관하게 fail-closed — UI prop 누락에 의존하지 않는다(우회 0).
 */
interface RxAuditCtx {
  surface: RxAuditSurface;
  actor: RxAuditActor;
  customerId?: string | null;
}

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
// QuickRxButton — 빠른처방 버튼 1개 + hover 약정보 툴팁(portal·무DB)
//   툴팁 포맷은 src/lib/rxTooltip(순수 함수)에 위임. items 배열 map(다중 약).
//   버튼 바는 overflow-x-auto 스크롤 컨테이너 → CSS 절대배치 툴팁이 클리핑됨.
//   → createPortal + position:fixed(getBoundingClientRect 기준)로 클리핑 회피(신규 패키지 0).
// ---------------------------------------------------------------------------
function QuickRxButton({
  btn,
  disabled,
  loading,
  compact,
  className,
  onClick,
}: {
  btn: QuickRxButtonRow;
  disabled: boolean;
  loading: boolean;
  compact: boolean;
  className: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const items = btn.prescription_sets?.items ?? [];
  const hasItems = items.length > 0;

  function showTooltip() {
    const el = ref.current;
    if (!el || !hasItems) return;
    const r = el.getBoundingClientRect();
    const TOOLTIP_W = 240;
    // 우측 화면 이탈 방지 클램프 + 8px 여백.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - TOOLTIP_W - 8));
    setPos({ top: r.bottom + 6, left });
  }
  function hideTooltip() {
    setPos(null);
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        disabled={disabled}
        className={className}
        data-testid={`quick-rx-btn-${btn.name}`}
        aria-label={`빠른처방 ${btn.name}`}
      >
        {loading ? (
          <Loader2 className={compact ? 'h-3 w-3 animate-spin' : 'h-3.5 w-3.5 animate-spin'} />
        ) : (
          <IconRenderer icon={btn.icon} className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        )}
        {btn.name}
      </button>

      {pos &&
        hasItems &&
        createPortal(
          <div
            role="tooltip"
            data-testid={`quick-rx-tooltip-${btn.name}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240, zIndex: 9999 }}
            className="pointer-events-none rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-lg"
          >
            <p className="mb-1 text-[11px] font-semibold text-teal-700">{btn.name}</p>
            <ul className="space-y-1">
              {items.map((item, idx) => {
                const { name, meta } = rxItemTooltipLine(item);
                return (
                  <li key={idx} className="text-[11px] leading-tight">
                    <span className="font-medium text-foreground">{name}</span>
                    {meta && <span className="block text-[10px] text-muted-foreground">{meta}</span>}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
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

/** 처방 관련 react-query 캐시 무효화(적용·되돌리기 공통) */
function invalidateRxQueries(qc: ReturnType<typeof useQueryClient>, checkInId: string) {
  qc.invalidateQueries({ queryKey: ['doctor_fields', checkInId] });
  qc.invalidateQueries({ queryKey: ['quick_rx_patient_list'] });
  qc.invalidateQueries({ queryKey: ['doctor_call_dashboard'] });
}

// ---------------------------------------------------------------------------
// Hook — DB에 처방 직접 저장 (standalone 모드)
//   T-20260609-foot-QUICKRX-INCLINIC-GATE:
//     적용 직전 DB 최신값을 단일 read 로 가져와 (1) 원내 잔류 게이트 재검증(race-safe)
//     + (2) 되돌리기(undo) 스냅샷 확보. 차단 시 IN_CLINIC_GATE 코드로 throw.
//     성공 시 적용 전 스냅샷을 반환 → 호출부가 '되돌리기' 토스트 액션으로 사용.
// ---------------------------------------------------------------------------
function useApplyQuickRx(checkInId: string | undefined, auditCtx: RxAuditCtx) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items,
      doctorMode,
    }: {
      items: PrescriptionItem[];
      doctorMode: boolean;
    }): Promise<RxSnapshot> => {
      if (!checkInId) throw new Error('checkInId 없음');

      // 1) 적용 전 현재 상태 + undo 스냅샷 단일 조회
      //    T-20260610-foot-DOCDASH-STATUS-SPLIT: status_flag 추가 — 진료완료(pink) 원내 잔류 게이트 판정용.
      const { data: cur, error: readErr } = await supabase
        .from('check_ins')
        .select(
          'status, status_flag, checked_in_at, prescription_items, prescription_status, doctor_confirm_prescription, doctor_confirmed_at',
        )
        .eq('id', checkInId)
        .single();
      if (readErr) throw readErr;

      // 2) 원내 잔류 게이트 — DB 최신값 기준(낙관적 UI/탭 경합 방어, race-safe)
      //    진료완료(pink)는 원내 잔류로 허용, 귀가(done)만 차단 — inClinicRxGate SSOT(공통 판정).
      //    T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차단된 시도도 audit(best-effort) + 공통 에러코드.
      const gate = checkRxInClinic(cur as { status?: string; status_flag?: string | null; checked_in_at?: string | null });
      const beforeSummary = summarizeRxForAudit((cur as { prescription_items?: unknown }).prescription_items);
      if (!gate.allowed) {
        void logRxAudit({
          checkInId,
          customerId: auditCtx.customerId,
          action: 'rx_apply_blocked',
          surface: auditCtx.surface,
          actor: auditCtx.actor,
          beforeSummary,
          blockedReason: gate.reason,
        });
        throw rxGateError(gate.reason);
      }

      // 3) 되돌리기 스냅샷 보존(적용 전 4개 필드 그대로) — rxUndo 단일 출처
      const snapshot = captureRxSnapshot(cur as Record<string, unknown>);

      // 4) 적용
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

      // 5) 차트변경 내부로그(성공) — apply.
      void logRxAudit({
        checkInId,
        customerId: auditCtx.customerId,
        action: 'rx_apply',
        surface: auditCtx.surface,
        actor: auditCtx.actor,
        beforeSummary,
        afterSummary: summarizeRxForAudit(items),
      });

      return snapshot;
    },
    onSuccess: () => {
      if (checkInId) invalidateRxQueries(qc, checkInId);
      // 성공/실패 토스트(되돌리기 액션 포함)는 호출부 handleClick 에서 단일 처리.
    },
    // onError 토스트는 handleClick 에서 사유별(게이트/일반)로 분기 처리.
  });
}

// ---------------------------------------------------------------------------
// Hook — 빠른처방 되돌리기(undo)
//   방금 적용 전 스냅샷(4개 필드)을 그대로 write-back → 원복.
//   덮어쓰기(overwrite)이므로 이중적용·유령행 없음(단일 check_ins 행, INSERT 없음).
// ---------------------------------------------------------------------------
function useUndoQuickRx(checkInId: string | undefined, auditCtx: RxAuditCtx) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (snapshot: RxSnapshot) => {
      if (!checkInId) throw new Error('checkInId 없음');
      const { error } = await supabase
        .from('check_ins')
        .update(buildUndoPatch(snapshot) as unknown as Record<string, unknown>)
        .eq('id', checkInId);
      if (error) throw error;
      // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 되돌리기도 차트변경 — 내부로그(성공).
      //   직전 apply 의 8초 토스트 내 동선이라 게이트 재검증은 생략(직전 적용 원복일 뿐).
      void logRxAudit({
        checkInId,
        customerId: auditCtx.customerId,
        action: 'rx_undo',
        surface: auditCtx.surface,
        actor: auditCtx.actor,
        afterSummary: summarizeRxForAudit(snapshot?.prescription_items),
      });
    },
    onSuccess: () => {
      if (checkInId) invalidateRxQueries(qc, checkInId);
    },
  });
}

// ---------------------------------------------------------------------------
// QuickRxBar Props
// ---------------------------------------------------------------------------
export interface QuickRxBarProps {
  /** 의사 여부 — true면 '확정', false면 '임시' */
  doctorMode: boolean;

  /**
   * #8-1b(role 게이트): 현재 사용자 role.
   * 부원장(vice_director)은 prescription_code_id 없는 자유텍스트 처방세트 적용 차단.
   * 미지정 시 게이트 비적용(종전 동작 보존).
   */
  role?: string;

  // ── 모드 A: 콜백 모드 (DoctorTreatmentPanel 내부) ──
  /** items 콜백 제공 시 DB 직접 저장 안 함 */
  onSelectItems?: (items: PrescriptionItem[]) => void;

  // ── 모드 B: 직접 DB 저장 모드 ──
  checkInId?: string;
  /** DB 저장 완료 후 콜백 */
  onApplied?: () => void;

  /**
   * T-20260609-foot-QUICKRX-INCLINIC-GATE: 원내 잔류 게이트 컨텍스트(모드 B 전용).
   * 제공 시 클릭 전 UI 단계에서 비잔류(전날/미래/귀가/취소) 환자면 버튼 대신 차단 패널을 렌더.
   * 미제공이어도 적용 시점 DB 재검증 게이트가 동작하므로 안전(이중 방어).
   */
  checkInStatus?: string | null;
  checkedInAt?: string | null;
  /**
   * T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(status_flag='pink') 컨텍스트.
   * 진료완료 환자는 원내 잔류 → 처방 허용(귀가 아님). 미제공 시 status 기준만 판정(무회귀).
   */
  checkInFlag?: string | null;
  /** 차단 안내에서 '차트 열기' 진입 동선(제공 시 액션 버튼 노출). */
  onOpenChart?: () => void;

  /**
   * T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit 컨텍스트.
   * surface=발생 화면(추적), customerId=audit FK(옵션). 미지정 시 'unknown'/null(무회귀, audit만 약화).
   * ⚠️ 강제(귀가환자 차단)는 DB 재검증으로 surface와 무관하게 동작 — audit 정확도용 메타일 뿐.
   */
  surface?: RxAuditSurface;
  customerId?: string | null;

  className?: string;
  /** 컴팩트 모드 (리스트 행 내 사용 시) */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function QuickRxBar({
  doctorMode,
  role,
  onSelectItems,
  checkInId,
  onApplied,
  checkInStatus,
  checkedInAt,
  checkInFlag,
  onOpenChart,
  surface = 'unknown',
  customerId = null,
  className,
  compact = false,
}: QuickRxBarProps) {
  const { profile } = useAuth();
  // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 처리자(actor) — 차트변경 audit 적재용.
  const auditCtx: RxAuditCtx = {
    surface,
    actor: { id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null },
    customerId,
  };
  const { data: buttons = [], isLoading } = useQuickRxButtonsBar();
  const applyMut = useApplyQuickRx(checkInId, auditCtx);
  const undoMut = useUndoQuickRx(checkInId, auditCtx);

  // T-20260609-foot-QUICKRX-INCLINIC-GATE: 모드 B + 게이트 컨텍스트 제공 시 클릭 전 차단 판정.
  //   checkedInAt 이 주어졌을 때만 UI 선검증(미제공 시 적용 시점 DB 게이트로 방어).
  const isDirectMode = !onSelectItems && !!checkInId;
  const hasGateContext = isDirectMode && checkedInAt !== undefined && checkedInAt !== null;
  const uiGate = hasGateContext
    ? checkRxInClinic({ status: checkInStatus, status_flag: checkInFlag, checked_in_at: checkedInAt })
    : null;
  const blockedByUiGate = !!uiGate && !uiGate.allowed;

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">처방 버튼 로딩 중…</span>
      </div>
    );
  }

  // 원내 비잔류(전날/미래/귀가/취소) — T-20260610-foot-QUICKRX-BLOCKED-PANEL-HIDE:
  //   "빠른처방 불가" 앰버 패널·텍스트·차트열기 버튼 전부 제거(문지은 6/10 요청).
  //   불가 환자는 QuickRxBar 영역을 빈 렌더로 둠(버튼 자체 미노출). 게이트 판정 로직은 불변.
  if (blockedByUiGate) {
    return null;
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

    // #8-1b(role 게이트): 부원장은 prescription_code_id 없는 자유텍스트 약이 섞인 빠른처방 세트 적용 차단.
    //   official 499 코드만으로 구성된 세트는 통과. fail-closed.
    const roleGate = checkRxRoleGate(role, items);
    if (!roleGate.allowed) {
      toast.error(rxRoleGateMessage(roleGate.blockedNames));
      return;
    }

    // 급여여부 게이트(DECISION 2-B): 급여중지/삭제/기준변경 약은 경고+차단(관리자 해제 가능).
    //   Phase1 = FE 게이트(fail-open). TODO(Phase1.5): 서버측 강제(RPC/trigger) 하드닝 후보.
    const insGate = await evaluateRxInsuranceGate(role, items);
    if (!insGate.allowed) {
      if (!insGate.overridable) {
        toast.error(rxInsuranceGateMessage(insGate.blocked));
        return;
      }
      if (!window.confirm(rxInsuranceOverrideConfirm(insGate.blocked))) {
        toast.info('빠른처방을 취소했어요.');
        return;
      }
      console.warn('[RX-INSURANCE-GATE][OVERRIDE] 관리자 급여상태 해제 빠른처방', {
        ticket: 'T-20260609-foot-DRUG-INSURANCE-GATE',
        blocked: insGate.blocked,
        at: new Date().toISOString(),
      });
    }

    if (onSelectItems) {
      // 모드 A: 콜백만 호출, DB 저장은 부모가 담당 (차트 동선 — 원내 잔류 게이트 미적용)
      onSelectItems(items);
      toast.success(
        doctorMode
          ? `"${btn.name}" 처방이 입력됐어요. 처방 컨펌 버튼으로 확정하세요.`
          : `"${btn.name}" 임시 처방이 입력됐어요.`,
      );
      return;
    }

    if (!checkInId) return;

    // 모드 B: DB에 직접 저장 — 적용 시점 원내 잔류 게이트 재검증 + 되돌리기 스냅샷
    try {
      const snapshot = await applyMut.mutateAsync({ items, doctorMode });
      onApplied?.();
      // 되돌리기(undo) 토스트 — toast.confirm 은 묵음 제외 채널(현장 반드시 확인).
      toast.confirm(
        doctorMode ? `"${btn.name}" 처방이 확정됐어요.` : `"${btn.name}" 임시 처방이 입력됐어요.`,
        {
          duration: 8000,
          action: {
            label: '되돌리기',
            onClick: () => {
              void undoMut
                .mutateAsync(snapshot)
                .then(() => {
                  onApplied?.();
                  toast.confirm('빠른처방을 되돌렸어요.');
                })
                .catch((e: Error) => toast.error(`되돌리기 실패: ${e.message}`));
            },
          },
        },
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === IN_CLINIC_GATE_CODE) {
        // 원내 비잔류 차단 — 안내 + 차트 진입 동선
        toast.error(
          err.message,
          onOpenChart ? { action: { label: '차트 열기', onClick: onOpenChart } } : undefined,
        );
      } else {
        toast.error(`처방 입력 실패: ${err.message}`);
      }
    }
  }

  // 처방 항목 스타일 — T-20260610-foot-DOCDASH-DIAGMGMT-6FIX AC-1:
  //   QUICKRX-DROPDOWN-LIST-REDESIGN(3299ff5)에서 "처방버튼 사라지고 빠른처방 이름만 구석에 우측정렬"
  //   되었던 무테두리·blue-text 목록을 → 명시적 '처방' 버튼 affordance로 복원.
  //   teal 테두리 + bg-teal-50 + shadow + 전폭 → 클릭 가능 버튼임이 명확. 동선/로직은 불변.
  const listItemBase = compact
    ? 'flex w-full items-center gap-1.5 rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-left text-[11px] font-semibold text-teal-700 shadow-sm transition hover:bg-teal-100 active:scale-[0.99] disabled:opacity-50'
    : 'flex w-full items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-3 py-2.5 text-left text-sm font-semibold text-teal-700 shadow-sm transition hover:bg-teal-100 active:scale-[0.99] min-h-[44px] disabled:opacity-50';

  return (
    // #4(FOLLOWUP2): 빠른처방 버튼 바 가시성 하드닝 — 자체 stacking context(relative + isolate)로
    //   부모 transform/opacity 컨텍스트에 묻혀 깔리는 경우 방어. 정확 재현 화면은 현장 스크린샷 확인 중.
    <div className={cn('relative isolate space-y-1.5', className)}>
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

      {/* 처방 버튼 목록 — 6FIX AC-1: 전폭 세로 버튼(우측정렬 폐지). 항목 클릭 = 확정. */}
      <div
        className="flex w-full flex-col gap-1.5"
        data-testid="quick-rx-bar"
        role="listbox"
        aria-label="빠른처방 선택지"
      >
        {buttons.map((btn) => (
          <QuickRxButton
            key={btn.id}
            btn={btn}
            disabled={applyMut.isPending || undoMut.isPending}
            loading={applyMut.isPending}
            compact={compact}
            className={cn(listItemBase)}
            onClick={() => handleClick(btn)}
          />
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// useCancelConfirmedRx — 의사 확정(prescription_status='confirmed') 후 처방 취소(원복)
//   T-20260609-foot-QUICKRX-HOVER-TOOLTIP-CANCEL ② → -DROPDOWN-LIST-REDESIGN AC-4 에서
//   "처방완료" 재클릭 동선(RxConfirmedSummary)이 단일 소비자.
//
//   취소 = 빠른처방 적용 전(clean) 상태로 원복. rxUndo 의 captureRxSnapshot/buildUndoPatch 를
//   단일 출처로 재사용 → 4개 처방필드만 원복(차팅/문서 확정 등 인접 필드 불간섭, INSERT 없음).
//   성공 시 invalidateRxQueries 로 적용/되돌리기 공통 캐시 무효화(정합).
//   ⚠️ AC-6 guard: 본 훅 내부로직·rxUndo·invalidateRxQueries 3쿼리 변경금지.
// ===========================================================================
function useCancelConfirmedRx(checkInId: string | undefined, auditCtx: RxAuditCtx) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!checkInId) throw new Error('checkInId 없음');

      // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK (본체 누수 close):
      //   기존엔 cancel 에 DB 게이트가 없어, UI prop(checkedInAt) 미제공 소비처(진료대시보드)에서
      //   귀가환자 처방취소가 통과(fail-open)됐다. → 공통 가드로 강제 수렴(우회 0, fail-closed).
      //   비잔류(귀가/전날/미래/취소)면 audit(차단) 후 throw — UI prop 누락과 무관하게 차단.
      const cur = await assertInClinicForRxMutation(checkInId, {
        blockedAction: 'rx_cancel_blocked',
        surface: auditCtx.surface,
        actor: auditCtx.actor,
        customerId: auditCtx.customerId,
      });
      const beforeSummary = summarizeRxForAudit(cur.prescription_items);

      // 적용 전(clean) 스냅샷 = captureRxSnapshot(undefined) → none/false/null 정규화. rxUndo 단일 출처.
      const patch = buildUndoPatch(captureRxSnapshot(undefined));
      const { error } = await supabase
        .from('check_ins')
        .update(patch as unknown as Record<string, unknown>)
        .eq('id', checkInId);
      if (error) throw error;

      // 차트변경 내부로그(성공) — cancel.
      void logRxAudit({
        checkInId,
        customerId: auditCtx.customerId,
        action: 'rx_cancel',
        surface: auditCtx.surface,
        actor: auditCtx.actor,
        beforeSummary,
        afterSummary: '(없음)',
      });
    },
    onSuccess: () => {
      if (checkInId) invalidateRxQueries(qc, checkInId);
    },
  });
}

// ---------------------------------------------------------------------------
// RxConfirmedSummary — 확정 상태 표시 + 재클릭 취소 (T-20260609-foot-QUICKRX-DROPDOWN-LIST-REDESIGN)
//   AC-2: "처방완료" 라벨 + 옆에 약물리스트(검은글씨, items 배열 전체 다중약).
//   AC-4: 별도 '취소' 버튼 폐지 → "처방완료" 재클릭 → "취소하시겠습니까?" 팝업 →
//         useCancelConfirmedRx(=rxUndo clean 원복) + invalidateRxQueries(훅 내부, 변경금지).
//   AC-5: 취소 권한 = DOCTOR_ROLES(doctorMode). 비의사면 표시만(클릭 무효), checkInId 없으면 표시만.
//   취소 내부로직(useCancelConfirmedRx/rxUndo/invalidateRxQueries)은 그대로 재사용 — 변경 없음.
//
//   T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE:
//     진료환자목록에서 귀가(원내 비잔류) 환자의 처방취소(재클릭 동선) 차단 → 차트에서 수정 유도.
//     귀가 판정은 별도 신설 없이 inClinicRxGate(checkRxInClinic) SSOT 그대로 재사용
//     (QUICKRX-INCLINIC-GATE 932a0d7 = status==='done' 귀가 + 전날/미래/취소 비잔류, 불일치 0).
//     게이트 컨텍스트(checkedInAt)가 주어진 소비처(DoctorPatientList)에서만 게이팅 →
//     컨텍스트 미제공 소비처(DoctorCallDashboard)는 종전 동작 보존(무회귀).
// ---------------------------------------------------------------------------
export function RxConfirmedSummary({
  checkInId,
  items,
  doctorMode,
  onCancelled,
  className,
  label = '처방완료',
  plainText = false,
  checkInStatus,
  checkedInAt,
  checkInFlag,
  onOpenChart,
  surface = 'unknown',
  customerId = null,
  actionMenu = false,
}: {
  checkInId: string | undefined;
  /** 확정된 처방 약물(JSONB) — 약물리스트 검은글씨 나열용. 배열 아니면 빈 줄. */
  items: unknown;
  /** DOCTOR_ROLES 여부 — false면 클릭(취소) 무효, 표시만(AC-5 권한 가드). */
  doctorMode: boolean;
  onCancelled?: () => void;
  className?: string;
  /**
   * T-20260609-foot-DOCDASH-LABEL-RX-REFINE item2: 라벨 텍스트 주입(기본 '처방완료').
   * 진료환자목록(환자 창)에서는 '처방 내용'으로 표기. 취소 동선·저장 로직은 불변(라벨만 교체).
   * DoctorCallDashboard 등 다른 소비처는 기본값 유지 → 무회귀.
   */
  label?: string;
  /**
   * T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI item9(문지은 대표원장):
   * 진료대시보드 처방 셀은 "버튼 chrome 금지, 그냥 파란글씨 '처방완료'". true면 테두리/배경 버튼이 아니라
   * 파란 텍스트 링크(취소 재클릭 동선 보존)로 렌더. 다른 소비처(기본 false)는 종전 버튼 affordance 유지 → 무회귀.
   */
  plainText?: boolean;
  /**
   * T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE: 귀가 게이트 컨텍스트.
   * 둘 다(특히 checkedInAt) 주어졌을 때만 게이팅 — 귀가/전날/미래/취소 환자는 취소 차단 + 차트 안내.
   * 미제공 시 게이트 비적용(종전 동작 보존, 무회귀).
   */
  checkInStatus?: string | null;
  checkedInAt?: string | null;
  /**
   * T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(status_flag='pink') 컨텍스트.
   * 진료완료 환자는 원내 잔류 → 처방취소 허용(아직 안 나감). 귀가(done)만 차단. 무제공 시 status 기준만.
   */
  checkInFlag?: string | null;
  /** 차단 시 '차트 열기' 진입 동선(제공 시 인라인 버튼 + 안내 토스트 액션 노출). */
  onOpenChart?: () => void;
  /**
   * T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: 차트변경 audit 컨텍스트(surface/customerId).
   * 강제(귀가환자 처방취소 차단)는 useCancelConfirmedRx 내부 DB 재검증으로 동작 — 이 props 미제공이어도 fail-closed.
   */
  surface?: RxAuditSurface;
  customerId?: string | null;
  /**
   * T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3 (문지은 대표원장): true면 '처방완료' 클릭 시 즉시 취소가 아니라
   * 드롭다운(수정/취소) 노출. 귀가(원내 비잔류) 환자는 버튼 비활성(드롭다운 미노출). 미지정(기본 false)이면
   * 종전 즉시-취소확인 동선 유지 → 다른 소비처(DoctorPatientList) 무회귀.
   *   · 수정 → onOpenChart() (처방을 차트에서 수정). · 취소 → 기존 취소확인+원복 동선.
   */
  actionMenu?: boolean;
}) {
  const { profile } = useAuth();
  const cancelAuditCtx: RxAuditCtx = {
    surface,
    actor: { id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null },
    customerId,
  };
  const cancelMut = useCancelConfirmedRx(checkInId, cancelAuditCtx);
  const list = Array.isArray(items) ? (items as Parameters<typeof formatRxConfirmedSummary>[0]) : null;
  const summary = formatRxConfirmedSummary(list);

  // 귀가 게이트 — checkedInAt 제공 시에만 판정(SSOT 재사용). 비잔류면 취소 차단.
  const hasGateContext = checkedInAt !== undefined && checkedInAt !== null;
  const gate = hasGateContext
    ? checkRxInClinic({ status: checkInStatus, status_flag: checkInFlag, checked_in_at: checkedInAt })
    : null;
  const blockedByGate = !!gate && !gate.allowed;

  // AC-5(권한) + 귀가 차단: 의사 + checkInId + 게이트 미차단일 때만 실제 취소.
  const cancellable = doctorMode && !!checkInId && !blockedByGate;
  // 클릭 자체는 게이트 차단 시에도 살림(거부 + 안내 토스트). 표시 전용(비의사·차단없음)만 비활성.
  const interactive = cancellable || blockedByGate;

  // T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3: actionMenu 모드 드롭다운(수정/취소) 상태 + portal anchor.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // 실제 취소(원복) 실행 — 즉시동선/드롭다운동선 공용.
  function executeCancel() {
    if (cancelMut.isPending) return;
    if (!cancellable) return;
    // AC-4: 취소 확인 팝업 → clean 원복.
    if (!window.confirm('처방완료를 취소할까요?')) return;
    void cancelMut
      .mutateAsync()
      .then(() => {
        onCancelled?.();
        toast.confirm('처방 확정을 취소했어요.');
      })
      .catch((e: Error & { code?: string }) => {
        // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK: DB 재검증 가드가 귀가환자 취소를 막은 경우
        //   (UI prop 미제공 소비처 방어) — 친절 안내 + 차트 진입 동선.
        if (e.code === IN_CLINIC_GATE_CODE) {
          toast.error(
            e.message,
            onOpenChart ? { action: { label: '차트 열기', onClick: onOpenChart } } : undefined,
          );
        } else {
          toast.error(`처방 취소 실패: ${e.message}`);
        }
      });
  }

  function handleDoneClick() {
    if (cancelMut.isPending) return;
    // 귀가(원내 비잔류) — 취소 거부 + "차트에서 수정" 안내 + 차트 진입 동선.
    if (blockedByGate && gate) {
      toast.error(
        rxInClinicMessage(gate.reason),
        onOpenChart ? { action: { label: '차트 열기', onClick: onOpenChart } } : undefined,
      );
      return;
    }
    if (!cancellable) return;
    executeCancel();
  }

  // T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3: actionMenu=true 면 '처방완료' 클릭 → 드롭다운 토글(즉시취소 금지).
  //   귀가(blockedByGate)면 버튼 자체가 비활성이라 이 핸들러 미도달(드롭다운 미노출).
  function handleButtonClick() {
    if (cancelMut.isPending) return;
    if (!actionMenu) {
      handleDoneClick();
      return;
    }
    if (!cancellable) return; // AC-3: 귀가 환자 등 비활성 — 드롭다운 안 띄움.
    const el = btnRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const MENU_W = 132;
      setMenuPos((cur) =>
        cur
          ? null // 토글 닫기
          : { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)) },
      );
    }
  }

  // actionMenu 모드: 귀가(blocked) → 버튼 비활성(AC-3). 그 외(취소 가능)만 활성.
  const buttonDisabled = cancelMut.isPending || (actionMenu ? !cancellable : !interactive);
  const menuOpen = actionMenu && menuPos !== null;

  return (
    <div
      className={cn('flex min-w-0 items-center gap-1.5', className)}
      data-testid="rx-confirmed-summary"
      data-rx-cancel-blocked={blockedByGate ? 'true' : undefined}
      data-block-reason={blockedByGate ? gate?.reason ?? '' : undefined}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={handleButtonClick}
        disabled={buttonDisabled}
        data-testid="rx-confirmed-done"
        aria-haspopup={actionMenu ? 'menu' : undefined}
        aria-expanded={actionMenu ? menuOpen : undefined}
        title={
          blockedByGate
            ? '귀가 환자는 차트에서 수정하세요'
            : actionMenu && cancellable
              ? '클릭 — 수정/취소 선택'
              : cancellable
                ? '재클릭 시 처방 확정을 취소합니다'
                : label
        }
        className={cn(
          plainText
            ? // FULLWIDTH-INLINE-EMOJI item9: 버튼 chrome 제거 → 파란글씨 '처방완료'. 취소 가능 시 hover=rose 신호.
              cn(
                'inline-flex shrink-0 items-center gap-0.5 bg-transparent p-0 text-[13px] font-semibold text-sky-600 transition',
                cancellable && 'cursor-pointer hover:text-rose-600 hover:underline underline-offset-2',
                blockedByGate && 'cursor-help',
                !interactive && !blockedByGate && 'cursor-default',
                'disabled:opacity-60',
              )
            : // 6FIX AC-1: 확정 후에도 명시적 버튼 affordance(테두리+배경) 복원. 무테두리 글씨 폐지.
              //   AC-2 O=sky 정합 → 확정 상태도 sky 톤 버튼. 취소 가능 시 hover=rose(취소 신호).
              cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-md border px-2 py-1 text-[11px] font-semibold shadow-sm transition',
                cancellable && 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600',
                blockedByGate && 'cursor-help border-sky-200 bg-sky-50 text-sky-700',
                !interactive && !blockedByGate && 'cursor-default border-sky-200 bg-sky-50 text-sky-700',
                'disabled:opacity-60',
              ),
        )}
      >
        {cancelMut.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : plainText ? null : (
          <CheckCircle2 className="h-3 w-3" />
        )}
        {label}
      </button>
      {summary && (
        <span
          className={cn('truncate text-foreground', plainText ? 'text-[13px]' : 'text-[11px]')}
          data-testid="rx-confirmed-drugs"
          title={summary}
        >
          {summary}
        </span>
      )}
      {/* 귀가 차단 — 차트 진입 동선(AC2). onOpenChart 제공 시 인라인 노출. */}
      {blockedByGate && onOpenChart && (
        <button
          type="button"
          onClick={onOpenChart}
          data-testid="rx-cancel-open-chart"
          title="귀가 환자는 차트에서 수정하세요"
          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
        >
          <FileText className="h-2.5 w-2.5" />
          차트에서 수정
        </button>
      )}

      {/* T-20260613-foot-DOCDASH-CALLUX-3FIX AC-3: 처방완료 드롭다운(수정/취소). 표 overflow 클리핑 회피 위해 portal+fixed.
          수정 → onOpenChart(처방을 차트에서 수정). 취소 → executeCancel(확인 팝업 + clean 원복). */}
      {menuOpen && menuPos && createPortal(
        <>
          {/* 바깥 클릭 닫기 backdrop(투명) */}
          <div
            className="fixed inset-0 z-[290]"
            data-testid="rx-confirmed-menu-backdrop"
            onMouseDown={() => setMenuPos(null)}
          />
          <div
            role="menu"
            data-testid="rx-confirmed-menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 132, zIndex: 300 }}
            className="overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="rx-confirmed-menu-edit"
              onClick={() => {
                setMenuPos(null);
                onOpenChart?.();
              }}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-100"
            >
              <FileText className="h-3 w-3 text-gray-400" />
              수정
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="rx-confirmed-menu-cancel"
              onClick={() => {
                setMenuPos(null);
                executeCancel();
              }}
              className="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50"
            >
              취소
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
