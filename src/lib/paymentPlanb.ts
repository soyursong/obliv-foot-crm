/**
 * paymentPlanb.ts — 레드페이 플랜B(비대기형 결제) FE 클라이언트 라이브러리
 * ────────────────────────────────────────────────────────────────────────
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어)
 *
 * 역할: 신규 결제페이지(PaymentPlanb route)가 소비하는 순수 클라이언트 로직.
 *   ① 기능 플래그(isPaymentPlanbEnabled) — 신규 route 노출 제어(기본 OFF).
 *   ② pending_payment 선점 write(createPendingPayment) — status=open, expected_amount,
 *      expires_at/locked_until 은 정책 단일소스(redpayPlanbTtl.ts) 로 app-set.
 *   ③ 선점 상태 조회(fetchPendingPaymentStatus) — FE 폴링(usePlanbClaimStatus)의 데이터소스.
 *
 * ★ 대원칙(§2): 기존 결제 화면·수기입력 흐름 절대 무접촉. 본 모듈·신규 route 로만 분기.
 * ★ 매출 무접점(§550 Model A): pending_payment 은 예정(선점)일 뿐 payments write 안 함.
 *   실 매출은 기존 payments 파이프 계승(매칭 워커/폴러 소관).
 */

import { supabase } from '@/lib/supabase';
import {
  REDPAY_PLANB_TTL,
  computeExpiresAt,
  computeLockedUntil,
  REDPAY_PLANB_AUTO_RECORD_NOTICE,
} from '@/lib/redpayPlanbTtl';
import {
  resolvePlanbEntryBranch,
  type PatientPlanbContext,
  type PlanbEntryBranch,
} from '@/lib/planbEntryBranch';

// §4-4(D절) 순수 판정 re-export — 소비측(팝업/훅)이 paymentPlanb 단일 진입점으로 사용.
export { resolvePlanbEntryBranch };
export type { PatientPlanbContext, PlanbEntryBranch };

// ── 기능 플래그 ──────────────────────────────────────────────────────────────
//   Vite 런타임(browser) import.meta.env + Node(process.env, 테스트) 이중 조회 —
//   rxAllowlist.ts 컨벤션 계승. 'on'|'1'|'true' 만 활성, 그 외/미설정 = OFF(기본).
const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

/** 신규 비대기형 결제페이지(플랜B) 노출 여부. 기본 OFF — 기능플래그 ON 시에만 신규 route 노출. */
export function isPaymentPlanbEnabled(): boolean {
  const raw = (viteEnv.VITE_PAYMENT_PLANB ?? procEnv.VITE_PAYMENT_PLANB ?? '')
    .toString()
    .trim()
    .toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

// ── 타입 ────────────────────────────────────────────────────────────────────
export type PendingPaymentStatus = 'open' | 'matched' | 'expired' | 'failed' | 'cancelled';

export interface PendingPaymentRow {
  id: string;
  status: PendingPaymentStatus;
  expected_amount: number;
  matched_raw_txid: string | null;
  matched_at: string | null;
  expires_at: string;
  locked_until: string | null;
  created_at: string;
}

export interface CreatePendingPaymentInput {
  clinicId: string;
  customerId: string;
  checkInId: string;
  expectedAmount: number;
  createdBy?: string | null;
}

export interface CreatePendingPaymentResult {
  ok: boolean;
  id?: string;
  /** 같은 환자 open 선점 중복(부분유니크 위반) 등 사용자 안내가 필요한 사유. */
  reason?: 'duplicate_open' | 'invalid_amount' | 'db_error';
  message?: string;
}

// ── 선점 write (status=open) — expires_at/locked_until 을 SSOT 로 app-set ────────
/**
 * pending_payment 선점행 생성. 정책 단일소스(redpayPlanbTtl.ts) 로 TTL 을 app-set —
 *   expires_at = created_at + 5분(자동연결), locked_until = created_at + 6분(선점잠금).
 * 부분유니크(clinic_id,customer_id) WHERE status='open' 위반 시 duplicate_open 반환(throw 아님).
 */
export async function createPendingPayment(
  input: CreatePendingPaymentInput,
): Promise<CreatePendingPaymentResult> {
  const amount = Math.trunc(Number(input.expectedAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_amount', message: '결제 예상 금액이 올바르지 않습니다.' };
  }

  // created_at 을 app 이 확정 → 동일 기준으로 expires_at/locked_until 파생(DEFAULT fallback 미의존).
  const now = new Date();
  const createdAtIso = now.toISOString();
  const expiresAtIso = computeExpiresAt(now).toISOString();
  const lockedUntilIso = computeLockedUntil(now).toISOString();

  const { data, error } = await supabase
    .from('pending_payment')
    .insert({
      clinic_id: input.clinicId,
      customer_id: input.customerId,
      check_in_id: input.checkInId,
      expected_amount: amount,
      status: 'open',
      created_by: input.createdBy ?? null,
      created_at: createdAtIso,
      updated_at: createdAtIso,
      expires_at: expiresAtIso,
      locked_until: lockedUntilIso,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation → open 중복선점(부분유니크). 사용자 안내로 전환.
    if (error.code === '23505') {
      return {
        ok: false,
        reason: 'duplicate_open',
        message: '이미 진행 중인 결제 선점이 있습니다. 기존 결제 완료 또는 만료 후 다시 시도하세요.',
      };
    }
    return { ok: false, reason: 'db_error', message: error.message };
  }
  return { ok: true, id: data.id as string };
}

// ══════════════════════════════════════════════════════════════════════════════
// §4-4 (D절) 중복방지 — 클릭시 서버 재조회 (D-2) · 팝업 3분기 데이터소스 (D-3) · 배지 데이터 (D-5)
//   T-20260730-foot-REDPAY-PLANB-V2-ADDENDUM-SPEC — 최필경 총괄 v2 지시서 §4-4(D절).
//
//   ★ D-2: [카드 수납예정등록] 클릭 순간 그 환자의 '현재 서버 상태'를 재조회한다.
//     화면 렌더 상태(stale, 실장 A가 10분 전 열어둔 화면)로 판단하지 않는다 — CRM 은 브라우저이므로
//     배지/렌더는 새로고침한 사람에게만 유효 → 중복방지 수단이 못 됨. 서버 재조회가 유일 판정근거.
//   ★ D-3: 재조회 결과 → resolvePlanbEntryBranch(순수, planbEntryBranch.ts)로 3분기 라벨.
//   ★ D-4(동시 클릭 경합): '같은 환자 open 선점 2건' 자체는 이미 DB partial UNIQUE index
//     pending_payment_open_uq (clinic_id, customer_id) WHERE status='open' 가 원자 차단한다
//     (createPendingPayment 가 23505 → duplicate_open 로 이미 포착). 본 재조회는 그 하드가드 앞단의
//     '안내(경고+확인)' UX 이며 방지의 실주체가 아니다(재조회↔INSERT 사이 TOCTOU 는 index 가 닫음).
//     → 신규 DDL 불요(no-DDL): 기존 index 가 D-4 요구(같은환자+대기중 2건 차단, 동시클릭 포함)의 상위집합.
//   ★ D-5: '등록 담당자'는 pending_payment.created_by 재사용(신규 컬럼 불요, ADDITIVE 불요).
//   ★ 배지 위치·팝업 형태(D-5·D-3 UI)는 총괄 색박스 스샷(F-4) 후 확정 — 본 모듈은 '데이터·로직'만 제공.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * D-2 서버 재조회 — [카드 수납예정등록] 클릭 순간 호출. 화면 stale 무시, 서버가 판정근거.
 *   ① open 선점(clinic+customer) — 부분유니크로 ≤1건.
 *   ② 이 방문(check_in_id)의 활성 수납(status='active') — 취소·삭제 제외(유령수납 배제, CHECK-IN 결제이력과 정합).
 *   조회 실패는 throw — 호출측(팝업)이 '재조회 실패 → 등록 보류' fail-closed 로 처리(중복 위험 회피).
 *   ★매출 무접점: payments 는 read-only(status='active' 조회만) — 본 함수는 어떤 write 도 하지 않음(§550 Model A).
 */
export async function fetchPatientPlanbContext(
  clinicId: string,
  customerId: string,
  checkInId: string,
): Promise<PatientPlanbContext> {
  const [openRes, paidRes] = await Promise.all([
    supabase
      .from('pending_payment')
      .select('id, expected_amount, created_by, created_at')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('payments')
      .select('amount, created_at, external_approval_no')
      .eq('check_in_id', checkInId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ]);

  if (openRes.error) throw openRes.error;
  if (paidRes.error) throw paidRes.error;

  const open = (openRes.data ?? [])[0] ?? null;
  return {
    openPending: open
      ? {
          id: open.id as string,
          expected_amount: open.expected_amount as number,
          created_by: (open.created_by as string | null) ?? null,
          created_at: open.created_at as string,
        }
      : null,
    paidPayments: (paidRes.data ?? []).map((p) => ({
      amount: p.amount as number,
      created_at: p.created_at as string,
      external_approval_no: (p.external_approval_no as string | null) ?? null,
    })),
  };
}

// ── 선점 상태 조회 (폴링 데이터소스) ──────────────────────────────────────────
export async function fetchPendingPaymentStatus(id: string): Promise<PendingPaymentRow | null> {
  const { data, error } = await supabase
    .from('pending_payment')
    .select('id, status, expected_amount, matched_raw_txid, matched_at, expires_at, locked_until, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PendingPaymentRow | null) ?? null;
}

// ── 수신 대기 취소 (OPT3 §1 — 팝업 '수신대기 취소') ──────────────────────────
/**
 * T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD #1 — 수신 대기중인 선점(status='open')을 수동 취소.
 *   status='open' → 'cancelled' 전이(행 보존, DELETE 아님 — 미배정 유입지표 정합 유지).
 *   rows-affected 가드: WHERE status='open' 로 이미 매칭/만료/취소된 건은 no-op(=0 → notOpen).
 *   ★매출 무접점: pending_payment 만 전이(payments write 없음, §550 Model A).
 */
export interface CancelPendingPaymentResult {
  ok: boolean;
  /** open 이 아니어서 취소되지 않음(이미 매칭/만료/취소됨). */
  notOpen?: boolean;
  reason?: 'not_open' | 'db_error';
  message?: string;
}

export async function cancelPendingPayment(id: string): Promise<CancelPendingPaymentResult> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('pending_payment')
    .update({ status: 'cancelled', updated_at: nowIso })
    .eq('id', id)
    .eq('status', 'open') // rows-affected 가드 — open 만 취소 대상.
    .select('id');
  if (error) return { ok: false, reason: 'db_error', message: error.message };
  if ((data?.length ?? 0) === 0) {
    return { ok: false, notOpen: true, reason: 'not_open', message: '이미 처리(매칭·만료·취소)된 건입니다.' };
  }
  return { ok: true };
}

// ── 미결제 배지 상태 (OPT3 §④ — 기존 [미결제] 배지 확장 데이터소스) ──────────────
/**
 * 특정 체크인의 플랜B 선점 배지 상태 — '수납 대기 · {금액}원' / '수납 완료' 노출용.
 *   최신 open|matched 선점 1건을 조회(취소·만료는 배지 대상 아님 → 기존 미결제 배지로 폴백).
 *   · open    → 수납 대기(expected_amount 표시).
 *   · matched → 수납 완료.
 *   · 없음    → null (기존 결제완료/미결제 배지 로직 그대로).
 */
export interface CheckInPlanbBadge {
  status: 'open' | 'matched';
  expectedAmount: number;
}

export async function fetchCheckInPlanbBadge(checkInId: string): Promise<CheckInPlanbBadge | null> {
  const { data, error } = await supabase
    .from('pending_payment')
    .select('status, expected_amount, created_at')
    .eq('check_in_id', checkInId)
    .in('status', ['open', 'matched'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const status = (data as { status: string }).status;
  if (status !== 'open' && status !== 'matched') return null;
  return {
    status: status as 'open' | 'matched',
    expectedAmount: Number((data as { expected_amount: number }).expected_amount) || 0,
  };
}

// ── 수신 대기 목록 (OPT3 §6 — pending_payment where status=open) ─────────────────
export interface OpenPendingListRow {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  check_in_id: string | null;
  expected_amount: number;
  created_at: string;
  expires_at: string;
}

/**
 * status='open' 수신 대기 선점 목록 — OPT3 §6 소형 리스트 뷰 데이터소스.
 *   clinicId 지정 시 해당 클리닉만. 최신순. 저비용 read(기존 스키마 재사용).
 */
export async function listOpenPendingPayments(clinicId?: string | null): Promise<OpenPendingListRow[]> {
  let q = supabase
    .from('pending_payment')
    .select('id, clinic_id, customer_id, check_in_id, expected_amount, created_at, expires_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(100);
  if (clinicId) q = q.eq('clinic_id', clinicId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OpenPendingListRow[];
}

// ── 직원 안내 문구 / TTL re-export (page 편의) ────────────────────────────────
export { REDPAY_PLANB_TTL, REDPAY_PLANB_AUTO_RECORD_NOTICE };

/** 선점이 종료(자동매칭 성공/만료/실패/취소) 상태인지 — 폴링 종료 판정. */
export function isTerminalStatus(status: PendingPaymentStatus): boolean {
  return status === 'matched' || status === 'expired' || status === 'failed' || status === 'cancelled';
}
