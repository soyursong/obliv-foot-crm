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
// manual_override = 수기입력 폴백 진입으로 자동매칭 제외(T-20260730-...-MANUALPAY-PREEMPT-EXCLUDE).
export type PendingPaymentStatus =
  | 'open' | 'matched' | 'expired' | 'failed' | 'cancelled' | 'manual_override';

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

// ── 수기입력 폴백 진입 시 선점표 매칭제외 (이중기록 봉인) ──────────────────────
/**
 * 담당자가 [수기 입력하러 가기]로 수기입력 폴백에 진입하면 연관 선점표를 웹훅 자동매칭(match-cron)에서
 * 즉시 제외한다. status → 'manual_override' + excluded_at set.
 * T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE (AC1/AC2/AC3).
 *
 * ★ 제외 시점 = [수기 입력하러 가기] 버튼 클릭 즉시(AC3 확정). 근거:
 *   ① 아키텍처 제약: 실제 수기 '저장 완료'는 기존 결제화면(/admin)에서 일어나며 대원칙 §2(기존 UI 무접촉)로
 *      그 시점을 후킹할 수 없음 → 플랜B 페이지에서 안전하게 후킹 가능한 유일 지점 = 버튼 클릭.
 *   ② 안전측: 클릭 즉시 제외하면 클릭~저장 사이 창의 자동매칭까지 선제 봉인(이중기록 위험 0).
 *   ③ 엣지(클릭만 하고 저장 안 함): 그 결제는 자동기록되지 않고 미배정으로 남음 → 담당자가 수기로 마무리.
 *      누락은 수기로 복구 가능(안전), 이중은 정산 오염(위험) → 안전한 누락측을 택한다.
 *
 * 전이 대상 = open/expired/failed(자동매칭 가능/폴백 상태). 'matched'는 제외 대상 아님
 *   (이미 자동기록 성공 = 수기 재입력 시 이중 → matched 화면엔 버튼 자체가 미노출, 방어적으로도 덮어쓰지 않음).
 * 감사: manual_override 는 cancelled(직원 의도취소)·expired(단순 만료)와 구분되는 신규 상태.
 * match EF 는 status='open' 만 매칭하므로 manual_override(비-open)는 기존 필터로 자동 제외됨(EF 로직 무변경).
 */
export interface ExcludePendingResult {
  ok: boolean;
  /** true = 이번 호출로 매칭제외 전이 성공. false = 대상 아님(이미 matched/cancelled/manual_override 등). */
  excluded: boolean;
  message?: string;
}

export async function excludePendingFromMatch(id: string): Promise<ExcludePendingResult> {
  if (!id) return { ok: false, excluded: false, message: '선점 ID가 없습니다.' };
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('pending_payment')
    .update({ status: 'manual_override', excluded_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .in('status', ['open', 'expired', 'failed']) // matched/cancelled/manual_override 는 덮어쓰지 않음
    .select('id');
  if (error) return { ok: false, excluded: false, message: error.message };
  return { ok: true, excluded: (data?.length ?? 0) > 0 };
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

// ── 직원 안내 문구 / TTL re-export (page 편의) ────────────────────────────────
export { REDPAY_PLANB_TTL, REDPAY_PLANB_AUTO_RECORD_NOTICE };

/** 선점이 종료(자동매칭 성공/만료/실패/취소/수기제외) 상태인지 — 폴링 종료 판정. */
export function isTerminalStatus(status: PendingPaymentStatus): boolean {
  return (
    status === 'matched' ||
    status === 'expired' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'manual_override'
  );
}
