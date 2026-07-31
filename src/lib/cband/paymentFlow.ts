/**
 * cband/paymentFlow.ts — 코밴 CAT 직결 결제 흐름 오케스트레이션 (★이중결제 방지 D 상태머신)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 안전 오케스트레이션)
 *
 * 이 파일이 D(이중결제 방지, 티켓 §D — 후순위 금지 최우선)의 심장이다.
 *   1. ★insert-first: WS 로 요청을 **보내기 전에** 시도 레코드를 먼저 저장(MSG_TRACE 12자리 포함).
 *      → 응답이 유실돼도 MSG_TRACE 로 단말기 [승인내역조회] 가능(유일 키).
 *   2. send(catClient) — protocol.buildMsg 로 조립 후 송신, 무응답은 timedOut.
 *   3. classify(protocol) — APPROVED / FAIL / ATTENTION.
 *      · ATTENTION(C011/8003/8555/무응답): **자동 재시도 금지** → 시도레코드 'attention'(확인 필요) 정지.
 *      · APPROVED: 시도레코드 approved + AUTHNO/MERNO/응답코드 저장 → payments 수납기록 write.
 *      · FAIL: 시도레코드 failed(과금 미발생 확정 — 재시도 안전).
 *
 * ── 아키텍처: 순수 상태머신(runPaymentFlow) + 주입 store(AttemptStore) 분리 ────────────
 *   상태머신은 DB·WS 를 직접 몰라도 되게 store/sender 를 주입받는다(unit 테스트 결정론 확보).
 *   실 supabase store 는 supabaseAttemptStore.ts(별도, DDL 게이트) 가 제공한다.
 *
 * ── ★ DDL 게이트 (data policy §S2.4) ────────────────────────────────────────
 *   payment_attempts 테이블/payments 채널컬럼은 data-architect CONSULT-REPLY GO 후 확정.
 *   본 오케스트레이션·상태머신은 회신 대기 없이 착수 가능(planner 지시 §1).
 *   실 DB 연결(supabaseAttemptStore) + 기능플래그 ON 은 DDL 적용·MIG-GATE 통과 후.
 */

import {
  buildMsg,
  classify,
  makeTrace,
  normalize,
  responseMessageForUser,
  safeParse,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
  type NormalizedResponse,
  type PaymentClassification,
  type TranType,
} from './protocol';
import { send as wsSend, type SendResult } from './catClient';

// ── 기능 플래그(기본 OFF) — DDL 적용 전 프로덕션 노출 0 ──────────────────────
const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

/** 코밴 CAT 직결 결제(플랜A) 노출 여부. 기본 OFF — 플래그 ON + DDL 적용 후에만 활성. */
export function isCbandPayEnabled(): boolean {
  const raw = (viteEnv.VITE_CBAND_PAY ?? procEnv.VITE_CBAND_PAY ?? '').toString().trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

// ── 시도 레코드 상태 ─────────────────────────────────────────────────────────
export type AttemptStatus =
  | 'requested'  // insert-first 직후(요청 전 저장)
  | 'approved'   // 승인/취소 성공
  | 'failed'     // 명확한 실패(과금 미발생)
  | 'attention'; // ★확인 필요(불확실 — 자동 재시도 금지)

export interface AttemptRecord {
  msgTrace: string;
  tranType: TranType;
  amount: number;
  merno: string;
  tid: string;
  clinicId: string;
  customerId: string | null;
  checkInId: string | null;
  /** 취소 시 원거래 AUTHNO(승인 시 null). */
  originalAuthNo: string | null;
  status: AttemptStatus;
  /** 응답 확정 후 채워짐. */
  authNo?: string | null;
  responseCode?: string | null;
}

/**
 * 시도 레코드 저장소(주입). 실 구현은 supabaseAttemptStore(payment_attempts 테이블, DDL 게이트).
 * 상태머신은 이 인터페이스만 알면 되므로 unit 테스트에서 in-memory 스텁 주입 가능.
 */
export interface AttemptStore {
  /** ★insert-first: 요청 송신 '전' 시도 레코드를 저장. MSG_TRACE 중복 시 throw(교차세션 유일성 DB unique). */
  insertAttempt(rec: AttemptRecord): Promise<void>;
  /** 응답 확정 후 상태·AUTHNO·응답코드 갱신(멱등 — MSG_TRACE 키). */
  updateAttempt(msgTrace: string, patch: Partial<AttemptRecord>): Promise<void>;
  /** 승인 성공 시 수납(payments) 정본 기록. pg_provider='cband' + AUTHNO/MERNO/MSG_TRACE 저장. */
  recordCardPayment(rec: AttemptRecord & { authNo: string }): Promise<void>;
}

export interface PaymentFlowInput {
  tranType: TranType;
  tid: string;
  merno: string;
  amount: number;
  catPort: number | string;
  clinicId: string;
  customerId: string | null;
  checkInId: string | null;
  /** 취소(0430) 시 원거래 승인번호. */
  originalAuthNo?: string;
  originalAuthDate?: string;
}

export interface PaymentFlowResult {
  classification: PaymentClassification;
  msgTrace: string;
  response: NormalizedResponse | null;
  /** 사용자(현장) 메시지. */
  userMessage: string;
  /** ★확인 필요(정지) — true 면 자동 재시도 절대 금지, 화면 '확인 필요' 정지. */
  needsCheck: boolean;
  /** 승인 시 AUTHNO. */
  authNo: string | null;
}

/** WS 송신부 주입 타입(테스트 시 mock). */
export type Sender = (message: string, msgTrace: string, opts?: { url?: string; timeoutMs?: number }) => Promise<SendResult>;

/**
 * ★ 결제 흐름 상태머신. insert-first → send → classify → 상태확정(+승인 시 수납기록).
 *   무응답/ATTENTION 은 절대 자동 재시도하지 않는다(needsCheck=true 로 정지).
 *
 * @param store  시도레코드 저장소(주입). in-memory(테스트) 또는 supabase(운영).
 * @param sender WS 송신부(주입). 기본 catClient.send. 테스트는 mock 주입.
 */
export async function runPaymentFlow(
  input: PaymentFlowInput,
  store: AttemptStore,
  sender: Sender = wsSend,
  opts: { url?: string; timeoutMs?: number; trace?: string } = {},
): Promise<PaymentFlowResult> {
  const msgTrace = opts.trace ?? makeTrace();

  // 0) 조립(규칙 1~4·실측 강제) — 조립 실패는 송신 전 차단(과금 위험 0).
  const { message } = buildMsg({
    tranType: input.tranType,
    tid: input.tid,
    merno: input.merno,
    amount: input.amount,
    catPort: input.catPort,
    msgTrace,
    originalAuthNo: input.originalAuthNo,
    originalAuthDate: input.originalAuthDate,
  });

  const baseRec: AttemptRecord = {
    msgTrace,
    tranType: input.tranType,
    amount: input.amount,
    merno: input.merno,
    tid: input.tid,
    clinicId: input.clinicId,
    customerId: input.customerId,
    checkInId: input.checkInId,
    originalAuthNo: input.originalAuthNo ?? null,
    status: 'requested',
  };

  // 1) ★insert-first — 반드시 송신 '전'에 저장(응답 유실 대비 MSG_TRACE 확보).
  //    저장 실패 시 송신하지 않는다(추적 불가 상태로 과금하지 않음).
  await store.insertAttempt(baseRec);

  // 2) 송신(+타임아웃). 무응답은 timedOut=true, raw=null.
  let sr: SendResult;
  try {
    sr = await sender(message, msgTrace, { url: opts.url, timeoutMs: opts.timeoutMs });
  } catch (e) {
    // 송신 자체 예외(동시요청 CbandBusyError 등) → 승인 성립 가능성 배제 못함 → ATTENTION 정지.
    await store.updateAttempt(msgTrace, { status: 'attention' });
    const cls: PaymentClassification = 'ATTENTION';
    return {
      classification: cls, msgTrace, response: null, needsCheck: true, authNo: null,
      userMessage: (e as Error)?.name === 'CbandBusyError'
        ? '결제 요청이 이미 진행 중입니다. 잠시 후 상태를 확인해 주세요. (확인 필요)'
        : responseMessageForUser(cls, null),
    };
  }

  // 3) 파싱 → 정규화 → 분류. 무응답(timedOut)은 null → classify ATTENTION.
  const resp: NormalizedResponse | null = sr.timedOut ? null : normalize(safeParse(sr.raw));
  const cls = classify(resp);
  const userMessage = responseMessageForUser(cls, resp);

  // 4) 상태 확정.
  if (cls === 'ATTENTION') {
    // ★자동 재시도 금지 — 확인 필요 정지. 시도레코드는 MSG_TRACE 로 조회 가능(insert-first).
    await store.updateAttempt(msgTrace, {
      status: 'attention',
      responseCode: resp?.responseCode ?? null,
    });
    return { classification: cls, msgTrace, response: resp, userMessage, needsCheck: true, authNo: null };
  }

  if (cls === 'APPROVED') {
    const authNo = resp?.authNo ?? '';
    await store.updateAttempt(msgTrace, {
      status: 'approved', authNo, responseCode: resp?.responseCode ?? null,
    });
    // 승인 성공 → payments 정본 수납기록(pg_provider='cband' + AUTHNO/MERNO/MSG_TRACE).
    //   취소(0430)의 '성공'은 수납취소 반영이므로 승인 수납기록과 구분(store 내부 tranType 분기).
    await store.recordCardPayment({ ...baseRec, status: 'approved', authNo, responseCode: resp?.responseCode ?? null });
    return { classification: cls, msgTrace, response: resp, userMessage, needsCheck: false, authNo };
  }

  // FAIL — 과금 미발생 확정(재시도 안전).
  await store.updateAttempt(msgTrace, {
    status: 'failed', responseCode: resp?.responseCode ?? null,
  });
  return { classification: cls, msgTrace, response: resp, userMessage, needsCheck: false, authNo: null };
}

/** 승인 흐름 헬퍼. */
export function approve(
  input: Omit<PaymentFlowInput, 'tranType' | 'originalAuthNo' | 'originalAuthDate'>,
  store: AttemptStore, sender?: Sender, opts?: { url?: string; timeoutMs?: number; trace?: string },
): Promise<PaymentFlowResult> {
  return runPaymentFlow({ ...input, tranType: TRANTYPE_APPROVE }, store, sender, opts);
}

/** 취소 흐름 헬퍼 — 원거래 AUTHNO 동봉(실측#2: 취소 AUTHNO=원거래 동일, TRANTYPE 으로만 구분). */
export function cancel(
  input: Omit<PaymentFlowInput, 'tranType'> & { originalAuthNo: string },
  store: AttemptStore, sender?: Sender, opts?: { url?: string; timeoutMs?: number; trace?: string },
): Promise<PaymentFlowResult> {
  return runPaymentFlow({ ...input, tranType: TRANTYPE_CANCEL }, store, sender, opts);
}
