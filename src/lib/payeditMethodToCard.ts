/**
 * payeditMethodToCard.ts — 기존 수납 method 현금/이체→카드 이중경로 오케스트레이션
 * ────────────────────────────────────────────────────────────────────────────
 * T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH
 *   SSOT: agents/docs/da_replies/da_decision_foot_payedit_method_to_card_dualpath_20260807.md
 *         (DA-20260807-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH, verdict=GO_WARN·census-gated)
 *
 * 역할(순수 클라이언트 오케스트레이션 — money-path write 는 프리미티브에 위임):
 *   ① 기능 플래그(isPayeditCardDualpathEnabled) — 이중경로 UI 노출 제어(기본 OFF, 현장 노출 격리).
 *   ② closed-date 게이트(fetchPaymentClosedPeriod) — 확정마감 기간 수납 method-edit 차단(fail-closed).
 *   ③ path① 자동승인(reconcileMethodToCardAuto) — controlled 카드 flip 후 redpay-reverse-match 재사용
 *      (VAN 앵커는 EF 서버측 원자 claim 에서만 부여 — naked external_trxid stamp 금지, DA §1 path①).
 *
 * ★대원칙 §2: 기존 결제/분할/현금이체/취소환불 흐름 무접촉. 플래그 OFF 시 종전 단순 flip 유지.
 * ★db_change=false: 기존 payments/daily_closings 컬럼만 read/update, 신규 DDL 0.
 */

import { supabase } from '@/lib/supabase';
import { updatePaymentMethodToCard } from '@/lib/manualPaymentWritePath';
import { triggerReverseMatch, type ReverseMatchTriggerResult } from '@/lib/redpayReverseMatch';

// ── 기능 플래그 ──────────────────────────────────────────────────────────────
//   paymentPlanb.ts 컨벤션 계승 — Vite(browser) + Node(process.env, 테스트) 이중 조회.
//   'on'|'1'|'true' 만 활성, 그 외/미설정 = OFF(기본).
const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

/** 현금/이체→카드 이중경로(단말 자동승인 + 수기입력) UI 노출 여부. 기본 OFF — QA 검증 후 현장 활성. */
export function isPayeditCardDualpathEnabled(): boolean {
  const raw = (viteEnv.VITE_PAYEDIT_CARD_DUALPATH ?? procEnv.VITE_PAYEDIT_CARD_DUALPATH ?? '')
    .toString()
    .trim()
    .toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

// ── closed-date 게이트 ───────────────────────────────────────────────────────
export interface PaymentClosedPeriod {
  /** 이 수납의 매출귀속일(accounting_date, KST 달력일). null=미상(방어). */
  accountingDate: string | null;
  /** 해당 clinic·accounting_date 의 일마감이 확정(closed) 상태인가. */
  closed: boolean;
}

/**
 * 수납의 매출귀속일(accounting_date)이 확정(closed) 마감 기간에 속하는지 조회한다.
 *   확정 기간 수납의 method-edit = 마감 4버킷 구성비 재분배(restatement 위험) → DA §4 closed-date WARN:
 *   마감취소(reopen) 선행 or 박민지 comp-gate 필요. 확정기간 편집은 이 게이트로 fail-closed 차단하고
 *   현장이 마감 재오픈 동선을 타도록 안내한다(db_change=false → RPC 확장으로 payments 편집 안 함).
 *
 * ★fail-closed: accountingDate 미상 또는 조회 오류 시 closed=true 로 간주(money-safe 보수).
 * @param clinicId  수납 소속 clinic.
 * @param accountingDate  payments.accounting_date(date 'YYYY-MM-DD'). null 이면 fail-closed.
 */
export async function fetchPaymentClosedPeriod(
  clinicId: string | null | undefined,
  accountingDate: string | null | undefined,
): Promise<PaymentClosedPeriod> {
  const acct = (accountingDate ?? '').trim() || null;
  if (!clinicId || !acct) {
    // 귀속일/clinic 미상 = 판정 불가 → fail-closed(편집 차단).
    return { accountingDate: acct, closed: true };
  }
  const { data, error } = await supabase
    .from('daily_closings')
    .select('status')
    .eq('clinic_id', clinicId)
    .eq('close_date', acct)
    .eq('status', 'closed')
    .maybeSingle();
  if (error) {
    // 조회 실패 = 판정 불가 → fail-closed(money-path 보수).
    console.warn('[payedit] closed-date 조회 실패(fail-closed 처리):', error.message);
    return { accountingDate: acct, closed: true };
  }
  return { accountingDate: acct, closed: !!data };
}

// ── path① 단말 자동승인(reconcile-lane 재사용) ────────────────────────────────
export interface ReconcileMethodToCardResult {
  /** 카드 flip(in-place UPDATE) 성공 여부 — 실패 시 reverse-match 미시도. */
  flipped: boolean;
  /** redpay-reverse-match 결과(카드 flip 성공 시에만 시도). null=미시도. */
  reverse: ReverseMatchTriggerResult | null;
}

/**
 * path① 단말 자동승인 = ① controlled 카드 flip(external_trxid NULL 유지·approvalNo 없음) →
 *   ② redpay-reverse-match EF 트리거(이미 도착한 미매칭 VAN 승인 raw 1건 자동연결).
 *   ★VAN 앵커(external_trxid/reconciled_at/accounting_date)는 EF 서버측 원자 claim(rows==1)에서만 부여
 *   → 클라이언트 naked external_trxid stamp 금지(DA §1 path① · §788-B single-writer 보존).
 *   ★record_planb_card_payment / reverse-match EF 는 '호출만' — body 재정의 없음(C19 무접촉).
 *
 * 결과 reverse.matched=false 여도 flip 은 유효(카드로 정정됨) — 웹훅 지연 시 워커/다음 저장에서 재매칭
 *   가능하며, 즉시 수기 승인번호 입력(path② fallback)으로 보완할 수 있다.
 */
export async function reconcileMethodToCardAuto(
  paymentId: string,
  installment?: number | null,
): Promise<ReconcileMethodToCardResult> {
  await updatePaymentMethodToCard({ paymentId, installment: installment ?? null });
  // 카드 flip 성공 → reverse-match 트리거(fire-and-forget 안전, throw 하지 않음).
  const reverse = await triggerReverseMatch(paymentId);
  return { flipped: true, reverse };
}
