// changePaymentMethodToCard — 기존 수납(현금/이체) → '카드' 결제수단 정정 controlled in-place write-path
// ════════════════════════════════════════════════════════════════════════════════
// T-20260730-foot-PAYEDIT-METHOD-TO-CARD-DUALPATH
//   SSOT(DA GO_WARN·census-gated):
//     agents/docs/da_replies/da_decision_foot_payedit_method_to_card_dualpath_20260807.md
//   현장 확정(김다인 U0ALGF9QSS0, 2026-08-10): 단일 수납 수정 뷰에서
//     ① 단말 자동승인 → 안 되면 ② 수기입력(승인번호 직접) — 동일 화면 fallback.
//   카드사(발급사) 별도 저장 불필요(A안) → 승인번호(external_approval_no) 재사용 = db_change=false.
//
// ── 이중경로 ────────────────────────────────────────────────────────────────────
//   ① 자동(changeMethodToCardAuto): method='card' 전환(controlled UPDATE) 후 redpay-reverse-match EF 트리거.
//      이미 도착한 미매칭 VAN(카드단말) raw 를 서버(EF·service_role)가 원자 링크 → external_trxid/회계일 서버 stamp.
//      ★클라이언트는 external_trxid 를 절대 stamp 하지 않는다(DA Q2-1 REJECT). reconcile-lane 에 위임.
//   ② 수기(changeMethodToCardManual): 승인번호(external_approval_no) 직접 입력 → controlled in-place UPDATE.
//      external_trxid 는 NULL 유지(fabricate 금지·phantom VAN 금지, DA Q2-3).
//
// ── money-path 가드 (supervisor code-gate full 대상) ─────────────────────────────
//   · rows-affected == 1 assert (blanket raw UPDATE 금지 — cross-CRM write rows-affected 표준).
//   · status='active' 행만 정정 (취소·삭제·유령 행 제외).
//   · external_trxid IS NOT NULL(VAN 앵커) 행 = 정정 차단 (DA Q2-2 — reconcile reversal 별건).
//   · accounting_date 가 확정(closed) 마감일 → 차단(fail-closed, restatement/매출일 이동 방지 — closed-date WARN).
//   · created_at / accounting_date 미변경 (now() 합성 금지, DA Q2-3 — 매출일 drift 방지).
//   · 스키마 무변경(기존 컬럼만 UPDATE) → db_change=false.
import { supabase } from './supabase';
import { triggerReverseMatch, type ReverseMatchTriggerResult } from './redpayReverseMatch';

export interface ChangeMethodToCardInput {
  paymentId: string;
  /** 정정 후 금액(수정 모달에서 함께 편집 — 미변경 시 기존값 그대로 전달). */
  amount: number;
  /** 할부 개월(0=일시불). */
  installment?: number;
  /** ② 수기입력 경로 전용: 카드 승인번호(external_approval_no 재사용). 자동경로는 미지정(null). */
  approvalNo?: string | null;
}

export type ChangeMethodBlockReason =
  | 'not_found'
  | 'not_active'
  | 'van_anchored'   // external_trxid 존재 → 카드단말 승인 연결됨(reconcile reversal 별건)
  | 'period_closed'  // 확정 마감일 → 정정 차단(restatement 방지)
  | 'row_guard'      // rows-affected != 1
  | 'invalid_input'
  | 'db_error';

export interface ChangeMethodToCardResult {
  ok: boolean;
  blocked?: ChangeMethodBlockReason;
  message?: string;
  /** ① 자동 경로에서만 — reverse-match 트리거 관측 결과(matched=true면 VAN 자동 연결됨). */
  autoMatch?: ReverseMatchTriggerResult;
}

interface CurrentPaymentRow {
  id: string;
  clinic_id: string | null;
  method: string;
  status: string | null;
  external_trxid: string | null;
  accounting_date: string | null;
}

type GuardOk = { ok: true; row: CurrentPaymentRow };
type GuardBlocked = { ok: false; blocked: ChangeMethodBlockReason; message: string };

/**
 * 정정 대상 payment 로드 + money-path 가드. 통과 시 현재 행을 반환한다.
 * (읽기 전용 — 실제 write 는 applyToCard 에서 rows-affected 가드와 함께 수행)
 */
async function loadAndGuard(paymentId: string): Promise<GuardOk | GuardBlocked> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, clinic_id, method, status, external_trxid, accounting_date')
    .eq('id', paymentId)
    .maybeSingle();
  if (error) return { ok: false, blocked: 'db_error', message: error.message };
  const row = (data as CurrentPaymentRow | null) ?? null;
  if (!row) return { ok: false, blocked: 'not_found', message: '수납 정보를 찾을 수 없습니다.' };

  if ((row.status ?? 'active') !== 'active') {
    return { ok: false, blocked: 'not_active', message: '취소·삭제된 수납은 결제수단을 바꿀 수 없습니다.' };
  }
  // external_trxid 존재 = VAN 카드단말 승인이 이미 연결된 행 → 결제수단 정정 금지(DA Q2-2).
  if (row.external_trxid) {
    return {
      ok: false,
      blocked: 'van_anchored',
      message: '카드 단말 승인이 연결된 수납은 이 화면에서 결제수단을 바꿀 수 없습니다.',
    };
  }
  // 확정(closed) 마감일 가드 — 매출일 이동(restatement) 방지. fail-closed.
  if (row.accounting_date && row.clinic_id) {
    const { data: dc, error: dcErr } = await supabase
      .from('daily_closings')
      .select('status')
      .eq('clinic_id', row.clinic_id)
      .eq('close_date', row.accounting_date)
      .maybeSingle();
    if (dcErr) return { ok: false, blocked: 'db_error', message: dcErr.message };
    if ((dc as { status?: string } | null)?.status === 'closed') {
      return {
        ok: false,
        blocked: 'period_closed',
        message: '이미 마감 확정된 날짜의 수납입니다. 일마감 확정편집에서 정정하세요.',
      };
    }
  }
  return { ok: true, row };
}

/** 카드 전환 UPDATE payload. ★external_trxid 는 절대 포함하지 않는다(NULL 유지). accounting_date/created_at 미변경. */
function cardPatch(input: ChangeMethodToCardInput): Record<string, unknown> {
  const inst = input.installment && input.installment > 0 ? input.installment : null;
  const patch: Record<string, unknown> = { method: 'card', amount: input.amount, installment: inst };
  // ② 수기: 승인번호 재사용(external_approval_no). 자동경로(approvalNo 미지정)는 건드리지 않음(서버 EF 가 stamp).
  const trimmed = input.approvalNo?.trim();
  if (trimmed) patch.external_approval_no = trimmed;
  return patch;
}

/** controlled in-place UPDATE — active 행만 대상, rows-affected == 1 강제. */
async function applyToCard(
  paymentId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | GuardBlocked> {
  const { data, error } = await supabase
    .from('payments')
    .update(patch)
    .eq('id', paymentId)
    .eq('status', 'active') // rows-affected 가드 — active 1건만.
    .select('id');
  if (error) return { ok: false, blocked: 'db_error', message: error.message };
  if ((data?.length ?? 0) !== 1) {
    return { ok: false, blocked: 'row_guard', message: '정정 대상 수납이 1건이 아닙니다(변경 없음).' };
  }
  return { ok: true };
}

/**
 * ② 수기입력 — 승인번호(external_approval_no) 직접 입력 → controlled in-place UPDATE.
 *   external_trxid 는 NULL 유지(fabricate 금지). 카드사 별도 저장 없음(A안·db_change=false).
 */
export async function changeMethodToCardManual(
  input: ChangeMethodToCardInput,
): Promise<ChangeMethodToCardResult> {
  if (!(input.amount > 0)) {
    return { ok: false, blocked: 'invalid_input', message: '금액이 올바르지 않습니다.' };
  }
  if (!input.approvalNo || input.approvalNo.trim() === '') {
    return { ok: false, blocked: 'invalid_input', message: '카드 승인번호를 입력하세요.' };
  }
  const g = await loadAndGuard(input.paymentId);
  if (!g.ok) return g;
  const r = await applyToCard(input.paymentId, cardPatch(input));
  if (!r.ok) return r;
  return { ok: true };
}

/**
 * ① 단말 자동승인 — 카드 전환(controlled UPDATE) 후 redpay-reverse-match EF 트리거.
 *   승인번호/external_trxid 는 클라이언트가 세팅하지 않고, 서버(EF)가 이미 도착한 미매칭 VAN raw 를 원자 링크한다.
 *   autoMatch.matched=false 면 아직 미연결 → 호출측이 동일 화면에서 ② 수기입력 fallback 을 노출한다.
 */
export async function changeMethodToCardAuto(
  input: ChangeMethodToCardInput,
): Promise<ChangeMethodToCardResult> {
  if (!(input.amount > 0)) {
    return { ok: false, blocked: 'invalid_input', message: '금액이 올바르지 않습니다.' };
  }
  const g = await loadAndGuard(input.paymentId);
  if (!g.ok) return g;
  // 자동: 승인번호 없이 카드 전환(external_approval_no/external_trxid 미세팅 — 서버 EF 가 stamp).
  const r = await applyToCard(input.paymentId, cardPatch({ ...input, approvalNo: null }));
  if (!r.ok) return r;
  // reconcile-lane 위임 — 이미 도착한 미매칭 VAN raw 1건 원자 링크(throw 안 함, 관측 결과만 반환).
  const autoMatch = await triggerReverseMatch(input.paymentId);
  return { ok: true, autoMatch };
}
