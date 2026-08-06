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
 * ── ★ 3-way CANON 저장레이아웃 (external_* 착지, zpas) ───────────────────────
 *   승인 성공 시 payments 는 external_approval_no=AUTHNO / external_tid=TID / payment_attempt_id=attemptId(FK)로 착지.
 *   pos_provider/pos_transaction_id 는 prod 부재(dead) → 금지. external_trxid 는 RedPay 예약키(write 금지).
 *   CAT-origin 판별자 = payment_attempt_id IS NOT NULL. 실 구현은 supabaseAttemptStore.ts.
 *
 * ── ★ DDL 게이트 (data policy §S2.4) ────────────────────────────────────────
 *   순 DDL = 신규테이블 cband_payment_attempts(mig 20260731190000) + payments.payment_attempt_id FK(mig 20260731190500).
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
import { isSimulationAmount } from './config';

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

/**
 * ★T-20260810-foot-CONSULTROOM-PLANA-PAY-BTN-BESIDE-CREATE(AC-2/AC-4) — 다건 미수 일괄 결제 착지 대상 1건.
 *   '구입 티켓 추가' 모달 [결제] 버튼 = 환자 open 미수(패키지 잔금) 전체를 단일 CAT 승인으로 charge 하고,
 *   그 승인 1건(authNo/attemptId)을 여러 package_payments 행(패키지별 잔금)으로 원자 분개(split)한다.
 *   각 target = { 대상 패키지, 그 패키지에 착지시킬 금액(=그 패키지 잔금) }. Σ target.amount = 단말 승인 총액.
 */
export interface PkgPayTarget {
  packageId: string;
  amount: number;
}

export interface AttemptRecord {
  msgTrace: string;
  tranType: TranType;
  amount: number;
  merno: string;
  tid: string;
  clinicId: string;
  customerId: string | null;
  checkInId: string | null;
  /**
   * ★T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-1/AC-3/AC-4) — 패키지 탭 CAT 결제 착지 대상.
   *   set(비-null) 이면 이 CAT 결제/취소는 payments 가 아니라 **package_payments 행**으로 착지한다
   *   (DA-20260806-...-LANDING-MODEL(b) canonical · VG-1 double-count firewall: payments 중복 revenue행 금지).
   *   null/undefined = 기존 check_in 수납 경로(payments 착지, 무변경).
   */
  packageId?: string | null;
  /**
   * ★T-20260810-foot-CONSULTROOM-PLANA-PAY-BTN-BESIDE-CREATE(AC-2/AC-4) — 다건 미수 일괄 분개 대상(비어있지 않으면 aggregate 모드).
   *   set(길이>0) 이면 recordCardPayment 은 단일 packageId 착지 대신 target 별 package_payments 행을 **한 statement 로 원자 INSERT**한다.
   *   신규 컬럼/테이블 없음(기존 package_payments 재사용, DA-20260806 landing 모델 계승) → db_change=false·ADDITIVE.
   *   packageId 와 상호배타(aggregate 모드에서는 packageId=null). undefined/[] = 기존 경로(회귀 0).
   */
  paymentTargets?: PkgPayTarget[] | null;
  /** 취소 시 원거래 AUTHNO(승인 시 null). */
  originalAuthNo: string | null;
  /**
   * ★할부 개월수 — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT.
   *   undefined/null/0/1 = 일시불, 2~12 = 개월수. buildMsg 가 HALBU 로 조립, payments.installment(int) 착지.
   *   취소(0430) 시엔 원거래 승인의 installment 를 그대로 전달(취소 HALBU=원거래 동일값, 실측 MSG-iyn7).
   */
  installmentMonths?: number | null;
  status: AttemptStatus;
  /** ★C6 테스트금액(1001~1006) 여부 — attempt·payments is_simulation 각인(매출/감사 제외). */
  isSimulation: boolean;
  /** 응답 확정 후 채워짐. */
  authNo?: string | null;
  responseCode?: string | null;
  /** ★K2(3-way canon): 응답 raw(정규화·PCI-safe) — cband_payment_attempts.raw_response 에 착지(payments 미착지). */
  rawResponse?: NormalizedResponse | null;
  /** ★BINDING#3 승인일자(TRANDATE, YYMMDD) — payments.accounting_date 매출일자 앵커. */
  approvalDate?: string | null;
  /** ★BINDING#3 승인시각(TRANTIME, HHMMSS). */
  approvalTime?: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// ★AC-6 동시결제 중복방지 (2026-08-03 신설, 플랜B §7-4/§4-4 → 플랜A 이관)
//   출처: 최필경 총괄 field(MSG-20260803-090530-nz88) "두 실장이 같은 환자에 동시에
//   결제를 누르는 케이스는 플랜A에서도 동일 발생". 서로 다른 브라우저(PC) → client 상태 불신,
//   서버측 잠금 + 서버 재확인이 유일 방어.
//
//   ★스키마 무접촉: 신규 컬럼/테이블/제약 0. 아래 3층으로 커버(DA CONSULT 불요).
//     · (a) 한 환자 하드백스톱 = 기존 L2 partial UNIQUE(clinic_id, check_in_id) WHERE status='requested'
//           (mig 20260731190000, prod 적용 2026-08-01). insert-first 시점에 23505 발화 → 송신 0.
//     · (b) 한 단말기(MERNO) = 순수 서버 read-recheck(probeConcurrent) + CAT 프로토콜 동시1건 한도(§6-4).
//     · (c) 한 PC(세션) = catClient send-lock(앱뮤텍스, 기존).
// ════════════════════════════════════════════════════════════════════════════

export type ConcurrencyReason = 'patient_in_progress' | 'patient_completed' | 'terminal_busy';

/**
 * ★AC-6-1 서버측 동시성 잠금(L2 partial UNIQUE) 발화 — 동일 환자(check_in)에 in-flight('requested')
 * 시도가 이미 존재하여 insert-first 가 거부됨. runPaymentFlow 는 이 에러를 잡아 **송신하지 않고**(과금 0)
 * '확인 필요' 정지로 반환한다(두 실장 다른 PC 동시결제 하드백스톱). 그 외 저장오류(DB down 등)는 이 에러가 아님.
 */
export class CbandConcurrentPaymentError extends Error {
  readonly reason: ConcurrencyReason;
  constructor(reason: ConcurrencyReason = 'patient_in_progress', message?: string) {
    super(message ?? '이미 진행 중인 결제가 있습니다.');
    this.name = 'CbandConcurrentPaymentError';
    this.reason = reason;
  }
}

/** ★AC-6-2 서버 재확인 결과(순수 read). */
export interface OpenPaymentProbe {
  /** 동일 환자(check_in) in-flight('requested') 시도 존재 — 다른 PC 진행중(하드 차단). */
  patientInProgress: boolean;
  /** 동일 환자(check_in) 완료('approved', 승인 0210) 시도 존재 — 재결제 confirm 유도. */
  patientCompleted: boolean;
  /** 동일 단말기(MERNO) in-flight 존재 — 단말 사용중(§6-4 동시1건 정합). */
  terminalBusy: boolean;
}

export interface ConcurrencyDecision {
  /** true 면 정상 결제 팝업을 열지 않고 분기 안내를 노출. */
  blocked: boolean;
  reason: ConcurrencyReason | null;
  /** true 면 실장 confirm 후 진행 허용(완료건 재결제). false 면 진행 불가(진행중/단말사용중). */
  allowOverride: boolean;
  userMessage: string;
}

/**
 * ★T-20260806-foot-PLANA-SPLIT-MULTIPAY AC-3 — 분할결제 잠금 예외 옵션.
 *   splitContext=true(분할 세션의 2번째 이후 레그) 이면 소프트 confirm(patient_completed)만 억제한다.
 *   진짜 동시성 하드락(patient_in_progress·terminal_busy)은 절대 억제하지 않는다(두 실장 동시결제 방어 유지).
 *   default(미지정) = 기존 동작 완전 동일(회귀 0).
 */
export interface ConcurrencyOptions {
  /** 분할결제 세션 컨텍스트 — 완료건 재결제 소프트 confirm(patient_completed)을 통과시킨다(하드락은 유지). */
  splitContext?: boolean;
}

/** OpenPaymentProbe → 분기 결정(순수함수·우선순위: 진행중 > 단말사용중 > 완료). */
export function classifyConcurrency(probe: OpenPaymentProbe, opts: ConcurrencyOptions = {}): ConcurrencyDecision {
  if (probe.patientInProgress) {
    return {
      blocked: true, reason: 'patient_in_progress', allowOverride: false,
      userMessage: '이 환자의 카드 결제가 이미 진행 중입니다. 다른 PC에서 결제 중일 수 있어요. 잠시 후 상태를 확인해 주세요.',
    };
  }
  if (probe.terminalBusy) {
    return {
      blocked: true, reason: 'terminal_busy', allowOverride: false,
      userMessage: '이 카드 단말기가 다른 결제를 처리하고 있습니다. 완료된 뒤 다시 시도해 주세요.',
    };
  }
  // ★AC-3: 분할 세션에서는 '이미 결제된 환자'(patient_completed) 소프트 confirm 을 억제(의도된 추가 레그).
  //   하드락(위 2건)은 이 지점에 도달하기 전에 이미 차단하므로 안전 불변(과잉해제 0).
  if (opts.splitContext) {
    return { blocked: false, reason: null, allowOverride: false, userMessage: '' };
  }
  if (probe.patientCompleted) {
    return {
      blocked: true, reason: 'patient_completed', allowOverride: true,
      userMessage: '이 환자는 이미 결제가 완료된 내역이 있습니다. 추가 결제가 맞는지 확인한 뒤 진행해 주세요.',
    };
  }
  return { blocked: false, reason: null, allowOverride: false, userMessage: '' };
}

/**
 * ★AC-6-2 버튼 순간 서버 재확인 — 팝업 open 직전 호출. 서버(store)에서 동일 환자/단말 진행중·완료 재조회 → 분기.
 *   client 상태 불신(두 실장=다른 브라우저) → 서버 재확인이 유일 방어. store.probeConcurrent 미구현/조회실패 시
 *   degrade-open(차단 안 함) — 하드 백스톱(L2 partial UNIQUE)은 insert-first 에서 여전히 유효.
 */
export async function precheckConcurrentPayment(
  q: { clinicId: string; checkInId: string | null; merno: string | null },
  store: AttemptStore,
  opts: ConcurrencyOptions = {},
): Promise<ConcurrencyDecision> {
  // ★T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY (RCA 확정 · AC-1/AC-2):
  //   재결제 정밀검사 직전, 자기 check_in 의 고착 'requested' 를 기회주의 스윕으로 해소한다.
  //   RCA(prod 실증): 취소(0430) 성공 시도가 payment_id(환불행) 는 남겼으나 status='requested' 로
  //   고착(updateAttempt 승격 유실) → (a) probeConcurrent 가 '진행 중'으로 오인 (b) insert-first
  //   L2 partial UNIQUE(status='requested') 가 재결제 INSERT 를 23505 로 차단. sweepStaleRequested 의
  //   HEAL(status='requested' ∧ payment_id IS NOT NULL → 'approved', 근거게이팅·오승격 0)이 이 고착을
  //   terminal 로 승격 → L2 자연 해제 + 아래 probe 에서 자연 제외. payments 무생성(이중수납 0).
  //   ★실패는 무시(로그만) — 스윕이 재결제 진입을 막지 않는다(degrade-open, 하드백스톱 L2 여전 유효).
  if (store.sweepStaleRequested && q.checkInId) {
    try {
      await store.sweepStaleRequested({ clinicId: q.clinicId, checkInId: q.checkInId });
    } catch (e) {
      console.error('동시결제 재확인 前 고착 스윕 실패(무시, 재결제 진행):', (e as Error)?.message);
    }
  }
  if (!store.probeConcurrent) return { blocked: false, reason: null, allowOverride: false, userMessage: '' };
  try {
    const probe = await store.probeConcurrent(q);
    return classifyConcurrency(probe, opts);
  } catch (e) {
    // degrade-open: 재확인 실패해도 하드백스톱(insert-first L2)은 유효 → 진행 허용(로그만).
    console.error('동시결제 서버 재확인 실패(degrade-open, L2 하드백스톱 유효):', (e as Error)?.message);
    return { blocked: false, reason: null, allowOverride: false, userMessage: '' };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ★T-20260803-foot-CBAND-PAYRESULT-SWEEP — 결과 미아건(orphan 'requested') 회수 + 상세시트 재표시
//   출처: ASYNCFLOW-CONFIRM A안(현행 동기) 확정 후 남는 tail-case(smzh AC-3):
//     결제 진행 중 탭닫힘/새로고침 → WS 즉시 소멸 → 응답 전이면 recordCardPayment 미실행 →
//     시도레코드 status='requested' 고아(단말은 승인됐을 수 있으나 payments 미기록).
//
//   ★스키마 무접촉(AC-6 동시성방지 선례 계승 — 신규 컬럼/테이블/enum 0 → DA CONSULT 불요):
//     · 'attention'(확인 필요)은 이미 status CHECK 에 존재(mig 20260731190000, prod 2026-08-01) — 신규 enum 아님.
//     · 스윕 = 기존 UPDATE RLS(cband_pa_update_own_clinic, 자기 clinic)로 'requested'→'attention' 승격.
//     · 재표시 = 기존 SELECT RLS(cband_pa_read_own_clinic) 순수 read. 신규 EF/cron/service_role/RLS 0.
//   ★멱등(AC-1): 스윕은 status UPDATE 만 — payments 를 만들지 않는다(이중기록 0). requested→attention 승격 시
//     L2 partial UNIQUE(WHERE status='requested')에서 자연 이탈 → 고아가 in-flight 잠금을 영구 점유하지 않음(안전).
//   ★scope(A안 정합): 로그인 없이도 도는 '자율 서버측 EF+cron' 스윕은 AC-0 DA CONSULT 게이트 대상(스키마무변이나
//     service_role PHI 접근경로/스케줄 인프라 신설=정책접촉) → 별건 유지. 본 구현은 그와 직교한 '기회주의 스윕'
//     (상세시트/관련 surface 진입 시 자기 clinic 스코프로 승격)으로 tail-case 를 소프트 회수(P2 비차단).
//   ★임계: CAT 단말 응답은 통상 수 초~1분. 진행중 결제 오승격 회피 위해 STALE=5분(보수적).
// ════════════════════════════════════════════════════════════════════════════

/** 고아('requested') 판정·표시 임계(분). 정상 결제(수 초~1분)를 오승격하지 않도록 보수적. */
export const CBAND_ORPHAN_STALE_MINUTES = 5 as const;

/** 상세시트 재표시용 시도 레코드 뷰(읽기 전용 subset). PCI/PII 원문 미포함(msg_trace/status/금액/시각만). */
export interface CbandAttemptView {
  id: string;
  msgTrace: string;
  status: AttemptStatus;
  tranType: TranType;
  amount: number;
  /** ISO8601(created_at). */
  createdAt: string;
  authNo: string | null;
  responseCode: string | null;
}

/** 재표시 항목 종류: 'attention'(확인 필요 확정) / 'stale_requested'(응답없이 오래 남은 고아). */
export type CbandRecapKind = 'attention' | 'stale_requested';

export interface CbandRecapItem {
  view: CbandAttemptView;
  kind: CbandRecapKind;
}

/**
 * ★AC-1/AC-2 순수 판정: '확인 필요'로 재표시할 시도만 선별(결정론·DB무관·테스트가능).
 *   · status==='attention' → 확정 재표시.
 *   · status==='requested' 이고 createdAt 이 staleMinutes 초과 → 고아('지연') 재표시.
 *   · approved/failed 및 최근(진행중일 수 있는) requested 는 제외(정상 흐름 무소음).
 *   최신순 정렬은 호출측(store)에서 수행 — 여기서는 입력 순서 보존.
 */
export function selectRecapAttempts(
  rows: CbandAttemptView[],
  nowMs: number,
  staleMinutes: number = CBAND_ORPHAN_STALE_MINUTES,
): CbandRecapItem[] {
  const cutoff = nowMs - staleMinutes * 60_000;
  const out: CbandRecapItem[] = [];
  for (const view of rows) {
    if (view.status === 'attention') {
      out.push({ view, kind: 'attention' });
    } else if (view.status === 'requested') {
      const t = Date.parse(view.createdAt);
      if (!Number.isNaN(t) && t < cutoff) out.push({ view, kind: 'stale_requested' });
    }
  }
  return out;
}

/** 스윕 대상 판정(순수) — 'requested' 이고 staleMinutes 초과. store(SQL)·테스트 공용 술어. */
export function isSweepableOrphan(
  row: Pick<CbandAttemptView, 'status' | 'createdAt'>,
  nowMs: number,
  staleMinutes: number = CBAND_ORPHAN_STALE_MINUTES,
): boolean {
  if (row.status !== 'requested') return false;
  const t = Date.parse(row.createdAt);
  return !Number.isNaN(t) && t < nowMs - staleMinutes * 60_000;
}

// ════════════════════════════════════════════════════════════════════════════
// ★T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY — 동시성 잠금 술어(순수·결정론·테스트가능)
//   RCA(prod 실증): 취소(0430) 성공 시도가 status='requested' 로 고착 → probeConcurrent 의
//   patientInProgress(status='requested' 단독, tran_type/payment_id/시각 무필터)가 in-flight 로 오인
//   → 취소 후 재결제가 '결제 진행 중'으로 영구 차단. 아래 순수 술어로 '진짜 in-flight' 만 잠근다.
//   ★불변식(AC-3/AC-4): 진짜 응답 전 in-flight(요청/확인필요·미수납·최근) 는 계속 차단(이중결제 방어 유지).
// ════════════════════════════════════════════════════════════════════════════

/** probeConcurrent 판정 입력 행(순수 함수용 subset). */
export interface CbandConcurrencyRow {
  status: AttemptStatus;
  tranType: TranType;
  authNo: string | null;
  paymentId: string | null;
  /** ISO8601(created_at). */
  createdAt: string;
}

/**
 * ★AC-1/AC-3/AC-6/AC-7 — 이 시도가 '결제 진행 중'(patient_in_progress) 하드잠금을 유발하는
 *   '진짜 in-flight' 인가(순수·결정론). 아래 4조건을 모두 만족해야만 잠금.
 *   · tranType===APPROVE  : 취소(0430)는 '결제 진행 중'이 아니다 → 취소 시도는 결코 재결제를 막지 않음(AC-1/AC-6).
 *   · status∈{requested,attention} : 응답 전 in-flight(requested) 또는 불확실(attention='확인 필요',
 *       C011/8003/8555/무응답)만. 이중결제 방어 장치는 유지(AC-6 '유지'). failed/approved 는 종료 → 해제.
 *   · paymentId==null     : 이미 수납(payments)이 성립한 시도는 '진행 중'이 아니다(취소 환불행 포함 → 제외, AC-1).
 *   · createdAt≥now-stale  : staleMinutes(기본 5분) 초과 시도는 자동 만료 → 잠금 해제(AC-7 5분 자동만료).
 */
export function isInFlightBlocking(
  row: CbandConcurrencyRow,
  nowMs: number,
  staleMinutes: number = CBAND_ORPHAN_STALE_MINUTES,
): boolean {
  if (row.tranType !== TRANTYPE_APPROVE) return false;
  if (row.status !== 'requested' && row.status !== 'attention') return false;
  if (row.paymentId != null) return false;
  const t = Date.parse(row.createdAt);
  return !Number.isNaN(t) && t >= nowMs - staleMinutes * 60_000;
}

/**
 * ★patient_completed(재결제 confirm 유도) 판정 — 취소(환불)로 상쇄되지 않은 '살아있는 완료 결제'가 있는가(순수).
 *   승인(approved·APPROVE·수납성립) 중, 그 AUTHNO 로 링크된 취소(CANCEL, auth_no 동일)가 없는 건만.
 *   → 결제→취소 후 재결제 시 '이미 결제된 환자' soft 안내가 뜨지 않고 매끄럽게 진행(AC-1 정합, 시나리오1).
 *   미취소 완료 건은 기존대로 confirm 유도(시나리오3 — 정책 무변경).
 */
export function hasLiveCompletedPayment(rows: CbandConcurrencyRow[]): boolean {
  const cancelledAuthNos = new Set(
    rows.filter((r) => r.tranType === TRANTYPE_CANCEL && r.authNo).map((r) => r.authNo),
  );
  return rows.some(
    (r) =>
      r.tranType === TRANTYPE_APPROVE &&
      r.status === 'approved' &&
      r.paymentId != null &&
      !(r.authNo && cancelledAuthNos.has(r.authNo)),
  );
}

/**
 * ★T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS AC-7 — 차단 안내에 표시할
 *   '차단 원인이 된 진행중 시도'의 MSG_TRACE 선별(순수·결정론·DB무관·테스트가능).
 *   차단(patient_in_progress)을 유발한 in-flight 후보 = APPROVE ∧ status∈{requested,attention}
 *   ∧ stale(기본 5분) 이내. listRecentAttempts(최신순 가정) 중 가장 최근 후보의 msgTrace 반환.
 *   후보가 없으면 null → 호출측은 '번호 없이 안내'(AC-7 단서). ★새 phantom 번호는 절대 반환하지 않음(AC-1/3).
 *   ※ CbandAttemptView 는 paymentId 미포함 → '미수납' 판정을 status(requested/attention)로 근사한다.
 *     이는 L2 partial UNIQUE(WHERE status='requested') 차단 의미와 정합(수납 성립 시 status 는 이미 이탈).
 */
export function resolveBlockingMsgTrace(
  rows: CbandAttemptView[],
  nowMs: number,
  staleMinutes: number = CBAND_ORPHAN_STALE_MINUTES,
): string | null {
  const cutoff = nowMs - staleMinutes * 60_000;
  for (const r of rows) {
    if (r.tranType !== TRANTYPE_APPROVE) continue;
    if (r.status !== 'requested' && r.status !== 'attention') continue;
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t) || t < cutoff) continue;
    return r.msgTrace;
  }
  return null;
}

/**
 * 시도 레코드 저장소(주입). 실 구현은 supabaseAttemptStore(cband_payment_attempts 테이블, DDL 게이트).
 * 상태머신은 이 인터페이스만 알면 되므로 unit 테스트에서 in-memory 스텁 주입 가능.
 */
export interface AttemptStore {
  /**
   * ★insert-first: 요청 송신 '전' 시도 레코드를 저장. MSG_TRACE 중복 시 throw(교차세션 유일성 DB unique).
   * ★3-way canon: attempt row 의 id 를 반환한다 — 승인 성공 시 payments.payment_attempt_id(FK, CAT-origin 판별자)로 착지.
   */
  insertAttempt(rec: AttemptRecord): Promise<{ id: string }>;
  /** 응답 확정 후 상태·AUTHNO·응답코드·raw_response 갱신(멱등 — MSG_TRACE 키). */
  updateAttempt(msgTrace: string, patch: Partial<AttemptRecord>): Promise<void>;
  /**
   * 승인 성공 시 수납(payments) 정본 기록.
   * ★3-way canon(external_* 착지·dead-column-free): external_approval_no=AUTHNO + external_tid=TID +
   *   payment_attempt_id=attemptId(FK). pos_provider/pos_transaction_id 는 prod 부재(dead) — 사용 금지.
   *   external_trxid 는 NULL 유지(RedPay 예약키). accounting_date=승인일자(BINDING#3).
   *   payment_attempt_id partial UNIQUE 가 이중수납 2차 방어(중복 승인콜백 = 멱등 skip).
   */
  recordCardPayment(rec: AttemptRecord & { authNo: string; attemptId: string }): Promise<void>;
  /**
   * ★AC-6-2 동시결제 서버 재확인(순수 read) — 동일 환자(check_in) 진행중/완료 + 동일 단말(MERNO) 진행중 재조회.
   *   optional: 구현 없으면 precheckConcurrentPayment 는 degrade-open(하드백스톱=insert-first L2 partial UNIQUE 유효).
   */
  probeConcurrent?(q: { clinicId: string; checkInId: string | null; merno: string | null }): Promise<OpenPaymentProbe>;
  /**
   * ★AC-2 상세시트 재진입 재표시(순수 read) — 특정 체크인의 최근 코밴 시도 레코드를 최신순 반환.
   *   기존 SELECT RLS(cband_pa_read_own_clinic)만 소비(스키마 무변). 구현 없으면 재표시 생략(degrade).
   */
  listRecentAttempts?(q: { clinicId: string; checkInId: string; limit?: number }): Promise<CbandAttemptView[]>;
  /**
   * ★AC-1 기회주의 스윕 — 자기 clinic 의 오래된 고아('requested', staleMinutes 초과)를 'attention' 승격.
   *   기존 UPDATE RLS(cband_pa_update_own_clinic)만 소비(스키마 무변). payments 미생성(이중기록 0·멱등).
   *   실패는 상위가 삼킴(재표시/시트를 막지 않음). 반환 = 승격 건수.
   */
  sweepStaleRequested?(q: { clinicId: string; checkInId?: string; staleMinutes?: number }): Promise<{ swept: number }>;
  /**
   * ★T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY AC-8 수동 종료 처리 — 실장이 단말 영수증 대조 후
   *   '확인 필요'(attention) 시도를 직접 terminal 로 해제(잠금 해제 → 재결제 가능). 기존 UPDATE RLS·스키마 무변.
   *   ★근거게이팅: payment_id IS NOT NULL(수납/환불 성립) → 'approved'(실제 승인이었음), 아니면 'failed'
   *     (미성립 종료). 어느 쪽이든 'requested'/'attention' 이탈 → L2 partial UNIQUE·probe 에서 자연 해제.
   *   구현 없으면 UI 는 버튼 미노출(degrade). 반환 = 해제된 terminal status(관측용).
   */
  releaseAttempt?(id: string): Promise<{ status: 'approved' | 'failed' }>;
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
  /**
   * ★T-20260806-foot-PLANA-PKG-PAY-EXPAND — 패키지 CAT 결제 착지 대상(비-null → package_payments 행 착지).
   *   approve/cancel 헬퍼가 그대로 전달(Omit 대상 아님). recordCardPayment 이 이 값으로 착지 테이블을 분기한다.
   */
  packageId?: string | null;
  /**
   * ★T-20260810-foot-CONSULTROOM-PLANA-PAY-BTN-BESIDE-CREATE(AC-2/AC-4) — 다건 미수 일괄 분개 대상.
   *   비어있지 않으면 aggregate 모드(단일 승인 → target 별 package_payments 원자 분개). approve/cancel 헬퍼가 그대로 전달.
   */
  paymentTargets?: PkgPayTarget[] | null;
  /** 취소(0430) 시 원거래 승인번호. */
  originalAuthNo?: string;
  originalAuthDate?: string;
  /**
   * ★할부 개월수 — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT.
   *   승인: 선택 개월수(일시불=undefined/0). 취소: 원거래 승인의 installment 그대로(취소 HALBU=원거래 동일값).
   */
  installmentMonths?: number | null;
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
  /** ★승인 거래일자(TRANDATE, YYMMDD) — BINDING#3(paid_at=승인시각) 근거. payments 착지는 held 마이그. */
  approvalDate: string | null;
  /** ★승인 거래시각(TRANTIME, HHMMSS) — BINDING#3 근거. */
  approvalTime: string | null;
  /** ★AC-6-1 서버 동시성잠금(L2 partial UNIQUE) 발화로 개시 차단됨(송신 0·과금 0). */
  blocked?: boolean;
  blockReason?: ConcurrencyReason | null;
  /**
   * ★T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS AC-7 — 차단 시(blocked=true)
   *   안내에 표시할 '차단 원인이 된 진행중 시도'의 실 MSG_TRACE. 원인 시도를 특정할 수 없으면 null(번호 없이 안내).
   *   ★차단 시 msgTrace 는 이 값(또는 '')로 세팅 — 새 phantom 번호는 어떤 경우에도 표시되지 않는다(AC-1/AC-3).
   */
  blockingMsgTrace?: string | null;
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
    // ★HALBU 가변 전송 — 승인=선택개월 / 취소=원거래 동일값(실측 MSG-iyn7). formatHalbu 가 "00"/"02"~"12" 조립.
    installmentMonths: input.installmentMonths,
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
    packageId: input.packageId ?? null,  // ★PKG-PAY-EXPAND: 비-null → recordCardPayment 이 package_payments 로 착지
    paymentTargets: input.paymentTargets ?? null,  // ★CONSULTROOM-PAY-BTN-BESIDE(AC-2/AC-4): 비어있지 않으면 aggregate 분개 모드
    originalAuthNo: input.originalAuthNo ?? null,
    installmentMonths: input.installmentMonths ?? null,  // ★payments.installment(int) 착지 — spec ②③ 요청 개월수 canonical
    isSimulation: isSimulationAmount(input.amount),  // ★C6 테스트금액(1001~1006) 격리
    status: 'requested',
  };

  // 1) ★insert-first — 반드시 송신 '전'에 저장(응답 유실 대비 MSG_TRACE 확보).
  //    저장 실패 시 송신하지 않는다(추적 불가 상태로 과금하지 않음).
  //    ★3-way canon: attempt id 확보 → 승인 시 payments.payment_attempt_id(FK, CAT-origin 판별자)로 착지.
  //    ★AC-6-1: 동일 환자 in-flight 잠금(L2 partial UNIQUE) 발화 시 CbandConcurrentPaymentError →
  //             송신하지 않고 '확인 필요' 정지로 반환(두 실장 동시결제 하드백스톱, 과금 0).
  let attemptId: string;
  try {
    attemptId = (await store.insertAttempt(baseRec)).id;
  } catch (e) {
    if (!(e instanceof CbandConcurrentPaymentError)) {
      throw e; // 그 외 저장오류(DB down 등) = 기존 동작(상위 catch → 안전측 정지).
    }
    // ★T-20260804-foot-CBAND-CANCEL-PAYLOCK-RELEASE-REPAY [증분-5/증분-6 · AC-10/AC-11] — 취소(0430)는
    //   환자단위 '결제 진행 중' 잠금과 무관해야 한다(잠금 목적=중복 승인 방지 ≠ 취소). 승인 직후 취소 시
    //   원 승인 attempt 가 terminal 미전이(updateAttempt 사일런트 실패 잔여)로 'requested' 고착 → L2 partial
    //   UNIQUE(check_in 스코프·tran_type 무관)가 취소 insert 를 오차단(patient_in_progress). 취소 경로에 한해
    //   고착(수납/환불 성립) 행을 heal(→approved/failed) 후 1회 재삽입 → 취소가 결제잠금에 막히지 않음(완전분리
    //   defense-in-depth). ★결제(0210) 경로는 무변경 — 진짜 in-flight 는 계속 하드차단(AC-3, 과잉해제 0).
    //   ※ AC-10 1차 근본해결(승인응답 시 terminal 전이·probe 정밀화)의 백스톱이다. updateAttempt 재구현 안 함.
    let healedId: string | null = null;
    if (input.tranType === TRANTYPE_CANCEL && store.sweepStaleRequested && input.checkInId) {
      try {
        await store.sweepStaleRequested({ clinicId: input.clinicId, checkInId: input.checkInId });
        healedId = (await store.insertAttempt(baseRec)).id;
      } catch (e2) {
        if (!(e2 instanceof CbandConcurrentPaymentError)) throw e2;
        // 재삽입도 충돌 = 진짜 in-flight(응답 전·미수납) 결제가 실제 존재 → 안전측 차단(과잉해제 금지).
      }
    }
    if (healedId === null) {
      // ★T-20260804-foot-CBAND-BLOCKED-SEND-PHANTOM-MSGTRACE-SUPPRESS AC-1/AC-3/AC-7 —
      //   차단(patient_in_progress)됐을 때 이 요청의 새 MSG_TRACE(방금 makeTrace 로 생성됐으나 송신·INSERT
      //   되지 않은 phantom)를 절대 결과로 노출하지 않는다. 대신 '차단 원인이 된 진행중 시도'의 실 MSG_TRACE
      //   (예: 이번 사례 658182408832)를 조회해 표시 → 실장이 그 번호로 단말기 조회해 실제 상태 확인 가능.
      //   조회 실패/원인 미특정 시 null → 번호 없이 안내(가짜 새 번호 생성/표시 금지 불변).
      let blockingMsgTrace: string | null = null;
      if (store.listRecentAttempts && input.checkInId) {
        try {
          const recent = await store.listRecentAttempts({
            clinicId: input.clinicId, checkInId: input.checkInId, limit: 10,
          });
          blockingMsgTrace = resolveBlockingMsgTrace(recent, Date.now());
        } catch {
          // 조회 실패 = degrade(번호 없이 안내). 하드백스톱(차단 자체)은 유지.
        }
      }
      return {
        classification: 'ATTENTION',
        // ★AC-1/AC-3: phantom 신규 번호 대신 차단 원인 번호(없으면 빈값) — 새 번호 노출 0.
        msgTrace: blockingMsgTrace ?? '',
        blockingMsgTrace,
        response: null, needsCheck: true,
        blocked: true, blockReason: e.reason, authNo: null,
        approvalDate: null, approvalTime: null,
        userMessage: blockingMsgTrace
          ? `이 환자의 카드 결제가 이미 진행 중입니다(추적번호 ${blockingMsgTrace}). 중복 결제를 막기 위해 요청을 보내지 않았습니다. 이 번호로 단말기 [승인내역조회]에서 실제 상태를 확인해 주세요. (확인 필요)`
          : '이 환자의 카드 결제가 이미 진행 중입니다. 중복 결제를 막기 위해 요청을 보내지 않았습니다. 진행 중인 결제를 확인해 주세요. (확인 필요)',
      };
    }
    attemptId = healedId; // heal 성공 → 재삽입 attempt id 확정(definite assignment).
  }

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
      approvalDate: null, approvalTime: null,
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
      rawResponse: resp,   // ★K2: raw(정규화) 를 attempt.raw_response 로 보존(payments 미착지).
    });
    return {
      classification: cls, msgTrace, response: resp, userMessage, needsCheck: true, authNo: null,
      approvalDate: resp?.tranDate ?? null, approvalTime: resp?.tranTime ?? null,
    };
  }

  if (cls === 'APPROVED') {
    const authNo = resp?.authNo ?? '';
    await store.updateAttempt(msgTrace, {
      status: 'approved', authNo, responseCode: resp?.responseCode ?? null,
      merno: resp?.merno ?? undefined,   // ★FIX-2: 승인 응답에서 파싱한 MERNO 를 시도 레코드에 각인(부재 시 skip).
      rawResponse: resp,   // ★K2: raw(정규화) 를 attempt.raw_response 로 보존(payments 미착지).
    });
    // 승인 성공 → payments 정본 수납기록.
    //   ★3-way canon(external_* 착지·dead-column-free, zpas DA-20260731-FOOT-CBAND-CAT-3WAY-CANON):
    //     AUTHNO→external_approval_no, TID→external_tid, CAT-origin→payment_attempt_id(FK). pos_*/pg_* 는 prod 부재(금지).
    //     external_trxid 는 NULL 유지(RedPay 예약키) → RedPay 매처가 external_approval_no/external_tid 로 R↔P 매칭·흡수(③ DEDUP).
    //   ★BINDING#3 매출일자 앵커 = 승인시각(TRANDATE/TRANTIME) → payments.accounting_date. INSERT/감지시각 금지.
    //   취소(0430)의 '성공'은 수납취소 반영이므로 승인 수납기록과 구분(store 내부 tranType 분기).
    await store.recordCardPayment({
      ...baseRec, status: 'approved', authNo, attemptId,
      responseCode: resp?.responseCode ?? null,
      rawResponse: resp,
      approvalDate: resp?.tranDate ?? null,
      approvalTime: resp?.tranTime ?? null,
    });
    return {
      classification: cls, msgTrace, response: resp, userMessage, needsCheck: false, authNo,
      approvalDate: resp?.tranDate ?? null, approvalTime: resp?.tranTime ?? null,
    };
  }

  // FAIL — 과금 미발생 확정(재시도 안전).
  await store.updateAttempt(msgTrace, {
    status: 'failed', responseCode: resp?.responseCode ?? null,
    rawResponse: resp,   // ★K2: raw(정규화) 를 attempt.raw_response 로 보존(payments 미착지).
  });
  return {
    classification: cls, msgTrace, response: resp, userMessage, needsCheck: false, authNo: null,
    approvalDate: resp?.tranDate ?? null, approvalTime: resp?.tranTime ?? null,
  };
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
