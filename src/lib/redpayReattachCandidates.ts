// redpayReattachCandidates — 승인번호-NULL 수기수납 재부착 후보검색/확정 클라이언트 배선
// ════════════════════════════════════════════════════════════════════════════════
// T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY
//
// EF(redpay-reattach-candidates) 얇은 래퍼. 판정·write 권한은 전부 서버(service_role EF)에 있고,
// 클라이언트는 조회(list) 트리거 + 담당자 confirm 트리거만 담당한다(민감 write 를 클라에 두지 않음).
//   · list    = 후보검색만(read-only). "이 수기 기록이 이 결제일 수 있습니다" 후보카드용.
//   · confirm = 담당자가 고른 raw 로 '기존 수기행'에 승인번호 채움(신규행 생성 없음).
//
// ★대원칙: 자동연결 절대 금지 — list 응답이 후보 1건이어도 자동으로 confirm 하지 않는다(사람 클릭 게이트).
import { supabase } from './supabase';
import { EDGE_FUNCTIONS } from './externalServices';

/** 후보 raw 1건(담당자 표시용). */
export interface ReattachCandidate {
  raw_id: string;
  approval_no: string | null;
  approved_at: string | null;
  amount: number | null;
  external_trxid: string | null;
  tid: string | null;
}

/** Case B 수기수납 1건 + 그 후보 목록. */
export interface ReattachReceipt {
  payment_id: string;
  amount: number | null;
  accounting_date: string | null;
  created_at: string | null;
  candidate_count: number;
  candidates: ReattachCandidate[];
}

export interface ReattachListResult {
  ok: boolean;
  receipts: ReattachReceipt[];
  error?: string;
}

export interface ReattachConfirmResult {
  ok: boolean;
  matched: boolean;
  reason?: string;
  approvalNo?: string | null;
  error?: string;
}

/**
 * Case B 수기수납 + 후보 raw 목록 조회(read-only). 후보검색만 — payment write 0.
 * @param clinicId  대상 clinic.
 * @param range     선택 일자 범위(일마감 특정일 조회). 미지정 시 최근 조회창.
 */
export async function listReattachCandidates(
  clinicId: string,
  range?: { from?: string; to?: string },
): Promise<ReattachListResult> {
  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.REDPAY_REATTACH_CANDIDATES, {
      body: { action: 'list', clinic_id: clinicId, date_from: range?.from, date_to: range?.to },
    });
    if (error) {
      console.warn('[reattach-candidates] list EF 오류:', error.message);
      return { ok: false, receipts: [], error: error.message };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return { ok: r.ok === true, receipts: (r.receipts as ReattachReceipt[]) ?? [] };
  } catch (e) {
    console.warn('[reattach-candidates] list 예외:', e instanceof Error ? e.message : String(e));
    return { ok: false, receipts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 담당자 확정 — 고른 raw 로 '기존 수기행'에 승인번호를 채운다(서버가 claim-first + 기존행 UPDATE).
 * ★사람 클릭으로만 호출(자동 호출 금지). 신규 payment 행 생성 없음.
 */
export async function confirmReattach(
  paymentId: string,
  rawId: string,
): Promise<ReattachConfirmResult> {
  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.REDPAY_REATTACH_CANDIDATES, {
      body: { action: 'confirm', payment_id: paymentId, raw_id: rawId },
    });
    if (error) {
      console.warn('[reattach-candidates] confirm EF 오류:', error.message);
      return { ok: false, matched: false, error: error.message };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      ok: r.ok === true,
      matched: r.matched === true,
      reason: r.reason as string | undefined,
      approvalNo: (r.approval_no as string | null | undefined) ?? null,
    };
  } catch (e) {
    console.warn('[reattach-candidates] confirm 예외:', e instanceof Error ? e.message : String(e));
    return { ok: false, matched: false, error: e instanceof Error ? e.message : String(e) };
  }
}
