/**
 * redpayPlanbUnapprovedCount.ts — '미승인 수납' 미처리 건수 (read-only 집계)
 * ────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-REDPAY-PLANB-AUTOCANCEL-UNAPPROVED-INBOX · AC-1 (read-only, DA 무관)
 * origin: 최필경 총괄 C0ATE5P6JTH, MSG-20260730-101115-w46b.
 *
 * ★ 불변식 (설계 대원칙 §2 / §550 Model A):
 *   · read-only — pending_payment.status/expires_at 만 센다.
 *   · payments / 매출 split / cue 귀속과 ★절대 무접점★ (payments JOIN 금지).
 *   · db_change 없음 — 신규 컬럼/테이블/VIEW/RPC 불요. 앱 count 쿼리만.
 *
 * ─ '미승인 수납' 정의 (AC-1) ──────────────────────────────────────────────
 *   현장 문구 '미승인 수납' = 카드 선점(pending_payment)이 승인(자동매칭)에 이르지 못하고
 *   보관창(late-webhook 자동연결 창)까지 닫혀 '사람이 처리해야 확정되는' 건.
 *
 *   레드페이 플랜B는 카드 전용(RedPay = 카드 단말 VAN)이므로 pending_payment 자체가
 *   ticket AC-1 필터의 payment_method='card' 를 구조적으로 만족한다("결제수단 파생 기준").
 *   pending_payment 에는 approval_number 컬럼이 없고, 매칭 성공 시에만 status='matched'
 *   (matched_raw_txid 세팅)가 되므로 status ∈ {expired, failed} = approval_number IS NULL 과 동치다.
 *
 *   ★ 컷오프 = expires_at + 보관창(REDPAY_PLANB_RETENTION_MIN=60분).
 *     ticket AC-1 은 created_at + 1h 를 예시로 들었으나(expires_at=created_at+5분이므로 실질 근사),
 *     본 집계는 자동취소 컷오프(AC-3: expires_at + 1h = OCCURREDAT RETENTION)와 '정확히 동일 기준'을 사용한다.
 *     이유: 보관창이 닫히기 전(late 웹훅으로 아직 matched 전이 가능) expired 를 세면 과대집계
 *     (redpayPlanbInflowMetric.ts 정정2 경고)이며, 배지↔자동취소 대상셋이 어긋난다.
 *     보관창 이후에만 세므로 배지 = '지금 바로 사람 처리(수동연결/자동취소)가 필요한 확정 미승인' 집합.
 *
 * ★ 정합 참고: 승인번호 실저장(APPROVALNO-STORAGE, ba582de4) 실측 결과 —
 *   raw.approval_no 100% 캡처 / payments.external_approval_no writeback 미구현(0%).
 *   → payments.external_approval_no IS NULL 필터는 현시점 무의미(전건 NULL)하므로 사용하지 않고,
 *     pending_payment status(=자동매칭 성공 여부)를 승인 대체 지표로 삼는다.
 */

import { supabase } from './supabase';
import { REDPAY_PLANB_TTL } from './redpayPlanbTtl';

/** 미승인(사람 처리 필요)으로 간주하는 pending_payment status 집합. matched/open/cancelled 제외. */
export const UNAPPROVED_STATUSES = ['expired', 'failed'] as const;
export type UnapprovedStatus = (typeof UNAPPROVED_STATUSES)[number];

/**
 * '보관창(1h) 닫힘' 컷오프 ISO 계산 (순수 함수, DB 무접점·테스트 대상).
 *   미승인 확정 ⟺ now >= expires_at + retention ⟺ expires_at <= now - retention.
 *   → 반환 cutoff 이전(expires_at < cutoff)인 expired/failed 만 미승인 확정.
 * @param nowMs 현재 시각(ms). 테스트 주입용. 기본 Date.now().
 */
export function unapprovedCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - REDPAY_PLANB_TTL.retentionMs).toISOString();
}

/**
 * 순수 판정 — 단일 pending_payment 행이 '미승인 확정'인지 (테스트 대상).
 *   status ∈ {expired, failed} AND expires_at <= now - retention.
 */
export function isUnapprovedFinal(
  row: { status: string; expires_at: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!UNAPPROVED_STATUSES.includes(row.status as UnapprovedStatus)) return false;
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= nowMs - REDPAY_PLANB_TTL.retentionMs;
}

/**
 * 클리닉 단위 '미승인 수납' 미처리 건수 (read-only, count-only).
 *   pending_payment WHERE status IN ('expired','failed')
 *     AND expires_at < (now - retention)   -- 보관창 닫힌 확정분만
 *   ★ payments 무접점. RLS(clinic scope) 적용. head:true 로 행 미전송(count 만).
 *
 * @param clinicId 대상 클리닉 (foot-local scope)
 * @param nowMs    현재 시각(ms). 테스트/재현 주입용. 기본 Date.now().
 * @returns 미승인 확정 건수 (>=0). 조회 실패 시 throw.
 */
export async function fetchUnapprovedPaymentCount(
  clinicId: string,
  nowMs: number = Date.now(),
): Promise<number> {
  const { count, error } = await supabase
    .from('pending_payment')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .in('status', UNAPPROVED_STATUSES as unknown as string[])
    // <= 경계 일치(isUnapprovedFinal 순수 판정과 동치): expires_at <= now - retention.
    .lte('expires_at', unapprovedCutoffIso(nowMs));

  if (error) throw error;
  return count ?? 0;
}
