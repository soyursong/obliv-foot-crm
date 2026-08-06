/**
 * cband/splitPayment.ts — 플랜A 분할결제(복수 결제수단·한 수납 N건) 순수 오케스트레이션
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260806-foot-PLANA-SPLIT-MULTIPAY (플랜A ② · design-first AC-0)
 *
 * 한 수납을 여러 카드 레그로 나눠 순차 전송(코밴 규격: 한 전문=한 결제)하고,
 * 각 레그의 승인번호를 한 수납(check_in_id)으로 묶는다. 설계 근거는
 * docs/PLANA-SPLIT-MULTIPAY-DESIGN.md (AC-0 설계안).
 *
 * ── ★ 3대 불변식 (자동취소 금지 · 하드락 유지 · 스키마 무접촉) ──────────────────
 *   1. 🔴 자동취소 절대 금지(AC-2): 중간 실패/확인필요 발생 시 세션은 halt(정지)만 한다.
 *      승인분을 자동으로 취소·롤백하는 경로는 이 파일에 **존재하지 않는다**. 취소는 항상
 *      사람이 명시적으로 고른 옵션(partialFailureOptions.cancelApproved)으로만 일어난다.
 *   2. 하드락 유지(AC-3): 잠금 예외는 소프트(patient_completed)만 억제한다. 진짜 동시성
 *      하드락(patient_in_progress·terminal_busy)은 paymentFlow.classifyConcurrency 가 유지.
 *   3. 스키마 무접촉(AC-4): 승인번호 묶음 = 기존 check_in_id 링크. 신규 컬럼/테이블/enum 0
 *      → DA CONSULT 불요(AC-6 동시성방지 선례 계승).
 *
 * ── 아키텍처: 순수 상태머신 ────────────────────────────────────────────────────
 *   이 모듈은 DB·WS·React 를 모른다. 레그 실행(runPaymentFlow)·취소(cancel)는 호출측이
 *   수행하고, 그 PaymentFlowResult 를 applyLegResult 로 세션에 반영한다(결정론·테스트가능).
 */

import type { PaymentFlowResult } from './paymentFlow';

/** 결제수단(분할 각 레그). PMW PayMethod 서브셋 — 카드 레그는 실제 CAT 전송, 그 외는 표시/합산용. */
export type SplitPayMethod = 'card' | 'cash' | 'transfer' | 'health_maintenance' | 'other';

/** 한 레그의 실행 결과 상태. */
export type LegOutcome =
  | 'pending'    // 아직 미전송
  | 'approved'   // 승인 성공(승인번호 확보)
  | 'failed'     // 명확한 실패(과금 미발생 — 재시도 안전)
  | 'attention'  // ★확인 필요(응답 불명 — 자동/수동 재시도 금지)
  | 'cancelled'; // 승인분을 사람이 명시적으로 취소(0430 원거래 취소 성공) — 종결·환불 반영(AC-5)

/** 분할 세션의 한 레그(전송 단위). id 는 세션 내 안정 식별자(재시도 시 유지). */
export interface SplitLeg {
  /** 세션 내 0-based 순번(전송 순서). */
  index: number;
  method: SplitPayMethod;
  amount: number;
  /** 카드 레그 할부개월(일시불=0/미지정). formatHalbu 대상(protocol). */
  installmentMonths?: number;
  outcome: LegOutcome;
  /** 승인 성공 시 AUTHNO(승인번호). */
  authNo?: string | null;
  /** insert-first MSG_TRACE(단말 승인내역조회 키). */
  msgTrace?: string | null;
  /** 승인일자(YYMMDD) — 취소 전문 ORI_AUTHDATE echo 용. */
  approvalDate?: string | null;
}

/** 분할 세션. 한 수납(check_in_id)에 속한 레그들의 순차 상태를 담는다. */
export interface SplitSession {
  checkInId: string;
  clinicId: string;
  customerId: string | null;
  /** 이 수납의 총 결제 예정액(= 각 레그 amount 합, 상위 PMW 빌더가 검증). */
  totalAmount: number;
  legs: SplitLeg[];
}

/** 세션 전체 상태 분류. */
export type SplitSessionStatus =
  | 'idle'            // 전 레그 pending(아직 시작 전)
  | 'in_progress'     // 일부 승인 + 나머지 pending(정상 진행 중, 실패 없음)
  | 'completed'       // 전 레그 approved
  | 'partial_failure' // 일부 approved + 일부 failed/attention ← 사람 판단 정지
  | 'failed';         // approved 0(전부 실패/확인필요)

// ════════════════════════════════════════════════════════════════════════════
// 세션 생성 · 레그 진행
// ════════════════════════════════════════════════════════════════════════════

/** (method, amount)[] 입력으로 분할 세션 생성. amount≤0 레그는 제외(합산 무의미). */
export function createSplitSession(
  ctx: { checkInId: string; clinicId: string; customerId: string | null },
  rows: { method: SplitPayMethod; amount: number; installmentMonths?: number }[],
): SplitSession {
  const legs: SplitLeg[] = rows
    .filter((r) => r.amount > 0)
    .map((r, i) => ({
      index: i,
      method: r.method,
      amount: r.amount,
      installmentMonths: r.installmentMonths,
      outcome: 'pending' as LegOutcome,
      authNo: null,
      msgTrace: null,
      approvalDate: null,
    }));
  const totalAmount = legs.reduce((s, l) => s + l.amount, 0);
  return { ...ctx, totalAmount, legs };
}

/** 다음 전송할 레그(가장 앞의 pending). 없으면 null. */
export function nextPendingLeg(session: SplitSession): SplitLeg | null {
  return session.legs.find((l) => l.outcome === 'pending') ?? null;
}

/**
 * 레그 실행 결과(PaymentFlowResult) 를 세션에 반영(순수·불변 — 새 세션 반환).
 *   · APPROVED → outcome='approved' + authNo/msgTrace/approvalDate 각인.
 *   · ATTENTION(needsCheck) → 'attention'(자동/수동 재시도 금지). msgTrace 보존(조회용).
 *   · 그 외 → 'failed'(과금 미발생 확정 — 재시도 안전).
 * ★자동으로 다음 레그를 전송하거나 승인분을 취소하지 않는다(호출측이 advanceHalts 판정 후 사람 확인).
 */
export function applyLegResult(
  session: SplitSession,
  legIndex: number,
  result: PaymentFlowResult,
): SplitSession {
  const outcome: LegOutcome =
    result.classification === 'APPROVED' && !result.needsCheck
      ? 'approved'
      : result.needsCheck
        ? 'attention'
        : 'failed';
  const legs = session.legs.map((l) =>
    l.index === legIndex
      ? {
          ...l,
          outcome,
          authNo: outcome === 'approved' ? (result.authNo ?? null) : l.authNo,
          msgTrace: result.msgTrace || l.msgTrace,
          approvalDate: result.approvalDate ?? l.approvalDate,
        }
      : l,
  );
  return { ...session, legs };
}

/**
 * '유지' 등으로 실패 레그를 재시도 준비 상태로 되돌린다(failed → pending, 순수·불변).
 *   ★attention 은 되돌리지 않는다 — 확인필요는 자동/수동 재시도 금지(D 상태머신 규칙 계승).
 *   승인분(approved)은 절대 건드리지 않는다(자동취소 금지 불변식).
 */
export function resetLegForRetry(session: SplitSession, legIndex: number): SplitSession {
  const legs = session.legs.map((l) =>
    l.index === legIndex && l.outcome === 'failed'
      ? { ...l, outcome: 'pending' as LegOutcome, msgTrace: null }
      : l,
  );
  return { ...session, legs };
}

/**
 * 승인된 레그를 '취소됨'으로 종결한다(approved → cancelled, 순수·불변). AC-5 커플링.
 *   ★호출측이 실제 0430 취소 전문(cancel(), 원거래 AUTHNO)을 **성공**시킨 뒤에만 호출한다.
 *   승인 상태가 아닌 레그(pending/failed/attention)는 무변경(취소 대상 아님).
 *   authNo 는 감사 목적으로 보존(취소 원거래 추적) — 단 collectApprovals 에서는 제외된다.
 */
export function markLegCancelled(session: SplitSession, legIndex: number): SplitSession {
  const legs = session.legs.map((l) =>
    l.index === legIndex && l.outcome === 'approved'
      ? { ...l, outcome: 'cancelled' as LegOutcome }
      : l,
  );
  return { ...session, legs };
}

// ════════════════════════════════════════════════════════════════════════════
// 세션 상태 분류 · 진행 게이트
// ════════════════════════════════════════════════════════════════════════════

/** 세션 전체 상태(순수). */
export function classifySession(session: SplitSession): SplitSessionStatus {
  const legs = session.legs;
  if (legs.length === 0) return 'idle';
  const approved = legs.filter((l) => l.outcome === 'approved').length;
  const halted = legs.filter((l) => l.outcome === 'failed' || l.outcome === 'attention').length;
  const pending = legs.filter((l) => l.outcome === 'pending').length;
  const cancelled = legs.filter((l) => l.outcome === 'cancelled').length;

  if (approved === legs.length) return 'completed';
  if (halted > 0) {
    // 일부라도 승인됐는데 실패/확인필요 존재 = 부분결제(사람 판단). 승인 0이면 전체 실패.
    return approved > 0 ? 'partial_failure' : (pending > 0 ? 'partial_failure' : 'failed');
  }
  if (pending > 0) return approved > 0 ? 'in_progress' : 'idle';
  // 실패/확인필요·pending 없음 — 남은 건 approved+cancelled 뿐(사람이 승인분 취소한 뒤 상태).
  //   승인분 취소로 총액에 못 미치면 사람 판단(유지/재시도) 필요 → partial_failure 로 정지 유지.
  if (cancelled > 0) return approved > 0 ? 'partial_failure' : 'failed';
  if (approved > 0) return 'in_progress';
  return 'idle';
}

/**
 * 다음 레그를 전송해도 되는가(순수). ★자동 진행 게이트.
 *   전송 금지(halt) 조건: 실패/확인필요 레그가 하나라도 있으면 사람 판단 전까지 정지.
 *   → 중간 실패 시 자동으로 다음 레그를 밀어붙이지 않는다(AC-2 정합).
 */
export function advanceHalts(session: SplitSession): boolean {
  return session.legs.some((l) => l.outcome === 'failed' || l.outcome === 'attention');
}

// ════════════════════════════════════════════════════════════════════════════
// (b) 부분결제 — 사람 판단 옵션 (★자동취소 금지)
// ════════════════════════════════════════════════════════════════════════════

/** 부분결제 상태에서 실장에게 노출할 사람-판단 옵션(순수·표시용). */
export interface PartialFailureOptions {
  /** 부분결제 상태인가(=사람 판단 정지 화면 노출). */
  isPartial: boolean;
  /** 재시도 가능한 실패 레그 index (failed 만 — attention 제외). */
  retryableLegs: number[];
  /** 이미 승인되어 '취소 가능'한 레그 index (사람이 명시적으로 골라야 취소). */
  cancellableApprovedLegs: number[];
  /** 확인필요(응답불명) 레그 index — 재시도 금지, 단말 [승인내역조회] 안내 대상. */
  attentionLegs: number[];
  /** 승인분 합계(원). '유지' 선택 시 이 금액이 이미 수납된 상태. */
  approvedTotal: number;
  /** 총 예정액 대비 미결 잔액(원). '유지' 시 별도 수단으로 이어받을 금액. */
  outstanding: number;
  /** 현장 안내 문구(자동취소하지 않았음을 명시). */
  userMessage: string;
}

/**
 * 부분결제 사람-판단 옵션 산출(순수). ★CRM 이 임의로 승인분을 취소하지 않는다 —
 *   cancellableApprovedLegs 는 '취소 가능 후보'일 뿐, 취소는 사람 클릭으로만.
 */
export function partialFailureOptions(session: SplitSession): PartialFailureOptions {
  const status = classifySession(session);
  const approvedLegs = session.legs.filter((l) => l.outcome === 'approved');
  const approvedTotal = approvedLegs.reduce((s, l) => s + l.amount, 0);
  const retryableLegs = session.legs.filter((l) => l.outcome === 'failed').map((l) => l.index);
  const attentionLegs = session.legs.filter((l) => l.outcome === 'attention').map((l) => l.index);
  const isPartial = status === 'partial_failure';

  return {
    isPartial,
    retryableLegs,
    cancellableApprovedLegs: isPartial ? approvedLegs.map((l) => l.index) : [],
    attentionLegs,
    approvedTotal,
    outstanding: Math.max(0, session.totalAmount - approvedTotal),
    userMessage: isPartial
      ? '일부만 결제되었습니다. 안전을 위해 이미 승인된 결제를 자동으로 취소하지 않았습니다. '
        + '재시도 · 승인분 취소 · 이대로 유지(잔액 별도 수납) 중에서 선택해 주세요.'
      : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// (c) 한 수납 ↔ 복수 승인번호 묶음 (스키마 무접촉 · check_in_id 링크)
// ════════════════════════════════════════════════════════════════════════════

/** 묶음 표시용 승인 레그 항목(레드페이 대조·차트 표시). */
export interface ApprovalGroupItem {
  legIndex: number;
  method: SplitPayMethod;
  amount: number;
  authNo: string;
  msgTrace: string | null;
  approvalDate: string | null;
}

/**
 * 세션의 승인 레그들을 한 수납(check_in_id) 묶음으로 수집(순수).
 *   각 항목의 authNo = payments.external_approval_no 와 1:1 → 레드페이 별개 승인과 대조 정합.
 *   묶음 앵커는 checkInId(신규 그룹 컬럼 없이 기존 링크로 묶임 — AC-4).
 */
export function collectApprovals(session: SplitSession): {
  checkInId: string;
  items: ApprovalGroupItem[];
  approvalNumbers: string[];
  total: number;
} {
  const items: ApprovalGroupItem[] = session.legs
    .filter((l) => l.outcome === 'approved' && l.authNo)
    .map((l) => ({
      legIndex: l.index,
      method: l.method,
      amount: l.amount,
      authNo: l.authNo as string,
      msgTrace: l.msgTrace ?? null,
      approvalDate: l.approvalDate ?? null,
    }));
  return {
    checkInId: session.checkInId,
    items,
    approvalNumbers: items.map((i) => i.authNo),
    total: items.reduce((s, i) => s + i.amount, 0),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// UI 배선 SSOT — 컴포넌트 렌더 결정 단일 파생(순수·테스트가능)
// ════════════════════════════════════════════════════════════════════════════

/** 분할 UI 뷰모델(CbandSplitPayDialog 렌더 결정의 단일 소스). */
export interface SplitView {
  status: SplitSessionStatus;
  /** 전송 정지 상태인가(실패/확인필요 레그 존재 → 사람 판단 전까지 자동 진행 금지). */
  halted: boolean;
  /** 다음 전송할 pending 레그 index(정지 상태면 null — 자동으로 다음 레그 밀지 않음). */
  nextLegIndex: number | null;
  /** '결제 요청'(다음 레그 전송) 버튼 활성 여부. */
  canSendNext: boolean;
  /** 부분결제 사람-판단 옵션(정지 화면 3옵션 렌더). */
  options: PartialFailureOptions;
  /** 승인 레그 묶음(완료/부분 요약 표시·레드페이 대조). */
  approvals: ReturnType<typeof collectApprovals>;
}

/**
 * 세션 → UI 뷰모델 파생(순수). 컴포넌트는 이 함수 결과만 보고 렌더한다(결정 SSOT).
 *   ★자동 진행/자동 취소 결정은 여기 없다 — halted 이면 canSendNext=false 로 정지만 하고,
 *   재시도·취소·유지는 전부 사람 클릭(옵션)으로만 일어난다(AC-2 불변식 준수).
 */
export function deriveSplitView(session: SplitSession): SplitView {
  const halted = advanceHalts(session);
  const next = nextPendingLeg(session);
  return {
    status: classifySession(session),
    halted,
    nextLegIndex: !halted && next ? next.index : null,
    canSendNext: !halted && next != null,
    options: partialFailureOptions(session),
    approvals: collectApprovals(session),
  };
}
