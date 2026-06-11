// rxMutationGuard — 진료대시보드 인플레이스 처방 mutate 공통 가드 + 차트변경 내부로그(audit)
// T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK
//
// 정책(대표원장 U0ALGAAAJAV 재요청):
//   "귀가처리 환자는 대시보드에서 처방취소 같은 거 안 되게. 처방수정은 차트 직접 열어서만.
//    귀가되면 대시보드 인플레이스 처리 막아줘. 그리고 다 내부로그 남겨야 함."
//
// 누수 진단(diff-first):
//   inClinicRxGate(932a0d7)는 '판정(checkRxInClinic)'은 SSOT지만, '강제(enforcement)'가
//   진입점마다 흩어져 있었다.
//     · apply(useApplyQuickRx)        = 적용 시점 DB 재검증으로 fail-closed ✅
//     · cancel(useCancelConfirmedRx)  = DB 게이트 없음. opt-in UI prop(checkedInAt)에만 의존 → fail-OPEN ❌
//     · confirm(useConfirmPrescription)= DB 게이트 없음 → fail-OPEN ❌
//   진료대시보드(DoctorCallDashboard)는 RxConfirmedSummary 에 게이트 prop 을 안 넘겨
//   (opt-in) 귀가환자 처방취소가 통과됐다(현장 신고와 일치).
//
// 해결: '강제'를 이 모듈 1곳으로 수렴(우회 0).
//   모든 인플레이스 처방 mutate(apply/cancel/confirm)는 실행 직전 assertInClinicForRxMutation 으로
//   DB 최신값 기준 재검증 → 귀가/전날/미래/취소면 차단(throw). UI prop 누락과 무관하게 fail-CLOSED.
//   판정 로직은 checkRxInClinic(inClinicRxGate SSOT) 그대로 — 별도 신설 0(불일치 0).
//
// 차트변경 내부로그(audit):
//   apply/cancel/undo/confirm 성공 + '차단된 시도'까지 기록(best-effort, fire-and-forget).
//   actor/시각/check_in_id/action/surface/before·after 약물요약 적재.
//   ⚠️ PII·RRN 평문 금지 — 환자 식별은 check_in_id/customer_id(FK)로만. 본문엔 약물요약(임상)만.

import { supabase } from './supabase';
import {
  checkRxInClinic,
  rxInClinicMessage,
  type RxInClinicBlockReason,
  type RxInClinicGateResult,
} from './inClinicRxGate';
import { formatRxConfirmedSummary } from './rxTooltip';

/** 게이트 차단 시 mutation 이 던지는 에러 코드(호출부가 사유별 토스트 분기) */
export const IN_CLINIC_GATE_CODE = 'IN_CLINIC_GATE';

/** 차트변경 audit 액션 — 성공/차단 모두 기록 */
export type RxAuditAction =
  | 'rx_apply'
  | 'rx_cancel'
  | 'rx_undo'
  | 'rx_confirm'
  | 'rx_apply_blocked'
  | 'rx_cancel_blocked'
  | 'rx_confirm_blocked';

/** 발생 화면(surface) — 어느 동선에서 차트변경이 일어났는지 추적 */
export type RxAuditSurface =
  | 'doctor_call_dashboard'
  | 'doctor_patient_list'
  | 'doctor_treatment_panel'
  | 'chart'
  | 'unknown';

export interface RxAuditActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
}

interface CheckInGateRow {
  status?: string | null;
  status_flag?: string | null;
  checked_in_at?: string | null;
  prescription_items?: unknown;
}

export interface RxGateFetchResult {
  /** check_ins 최신 행(없으면 null) */
  row: CheckInGateRow | null;
  /** 원내잔류 게이트 판정(SSOT checkRxInClinic) */
  gate: RxInClinicGateResult;
}

/**
 * check_in 최신 상태를 단일 read 로 가져와 원내잔류 게이트를 판정한다(race-safe).
 * 낙관적 UI/탭 경합/귀가 직후를 모두 방어 — DB 최신값이 진실.
 * fail-closed: 행이 없거나 read 실패면 allowed=false(missing).
 */
export async function fetchRxGate(checkInId: string): Promise<RxGateFetchResult> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('status, status_flag, checked_in_at, prescription_items')
    .eq('id', checkInId)
    .single();
  if (error || !data) {
    return { row: null, gate: { allowed: false, reason: 'missing' } };
  }
  const row = data as CheckInGateRow;
  const gate = checkRxInClinic({
    status: row.status,
    status_flag: row.status_flag,
    checked_in_at: row.checked_in_at,
  });
  return { row, gate };
}

/** 게이트 차단 사유 → IN_CLINIC_GATE 코드 에러(현장 안내문구 포함). */
export function rxGateError(reason: RxInClinicBlockReason | null): Error & { code: string } {
  const err = new Error(rxInClinicMessage(reason)) as Error & { code: string };
  err.code = IN_CLINIC_GATE_CODE;
  return err;
}

/**
 * 인플레이스 처방 mutate 공통 가드 — 실행 직전 호출.
 * 원내잔류면 현재 행을 반환, 비잔류(귀가/전날/미래/취소)면 audit(차단) 후 throw(IN_CLINIC_GATE).
 * 모든 진입점(apply/cancel/confirm)이 이 함수를 거치게 하여 강제를 1곳으로 수렴(우회 0).
 *
 * @param checkInId 대상 체크인
 * @param ctx       audit 컨텍스트(차단 시도 기록용)
 */
export async function assertInClinicForRxMutation(
  checkInId: string,
  ctx: { blockedAction: Extract<RxAuditAction, `${string}_blocked`>; surface: RxAuditSurface; actor?: RxAuditActor; customerId?: string | null },
): Promise<CheckInGateRow> {
  const { row, gate } = await fetchRxGate(checkInId);
  if (!gate.allowed) {
    // 차단된 시도도 내부로그(요청 명시) — best-effort.
    void logRxAudit({
      checkInId,
      customerId: ctx.customerId ?? null,
      action: ctx.blockedAction,
      surface: ctx.surface,
      actor: ctx.actor,
      beforeSummary: summarizeRxForAudit(row?.prescription_items),
      blockedReason: gate.reason ?? null,
    });
    throw rxGateError(gate.reason);
  }
  return row as CheckInGateRow;
}

export interface RxAuditEntry {
  checkInId: string;
  customerId?: string | null;
  clinicId?: string | null;
  action: RxAuditAction;
  surface: RxAuditSurface;
  actor?: RxAuditActor;
  /** 변경 전 약물요약(PII/RRN 금지 — 약물명/용법만). */
  beforeSummary?: string | null;
  /** 변경 후 약물요약. */
  afterSummary?: string | null;
  /** 차단 사유(차단 액션일 때만). */
  blockedReason?: RxInClinicBlockReason | string | null;
}

/**
 * 차트변경 내부로그 — fire-and-forget(best-effort).
 * rx_audit_log 테이블 미존재/RLS 거부여도 본 동작(처방 적용/취소)을 절대 막지 않는다.
 *   → 감사로그 실패가 진료를 멈추면 안 됨. 테이블 배포 전(supervisor DB 게이트 대기)에도 안전.
 */
export async function logRxAudit(entry: RxAuditEntry): Promise<void> {
  try {
    await supabase.from('rx_audit_log').insert({
      check_in_id: entry.checkInId,
      customer_id: entry.customerId ?? null,
      clinic_id: entry.clinicId ?? null,
      action: entry.action,
      surface: entry.surface,
      actor_id: entry.actor?.id ?? null,
      actor_name: entry.actor?.name ?? null,
      actor_role: entry.actor?.role ?? null,
      before_summary: entry.beforeSummary ?? null,
      after_summary: entry.afterSummary ?? null,
      blocked_reason: entry.blockedReason ?? null,
    });
  } catch {
    /* 감사로그 실패는 무시(best-effort) — 진료 흐름 우선 */
  }
}

/**
 * 처방 약물 JSONB → audit용 짧은 요약(PII/RRN 없음).
 * formatRxConfirmedSummary(정본) 재사용 — '약물명 용법 *' 나열. 200자 캡.
 * 빈/비배열 → '(없음)'.
 */
export function summarizeRxForAudit(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '(없음)';
  const s = formatRxConfirmedSummary(
    items as Parameters<typeof formatRxConfirmedSummary>[0],
  ).trim();
  const head = `${items.length}건`;
  if (!s) return head;
  const body = s.length > 200 ? `${s.slice(0, 197)}…` : s;
  return `${head}: ${body}`;
}
