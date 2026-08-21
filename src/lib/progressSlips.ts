/**
 * T-20260821-foot-PROGANALYSIS-BATCH-EXTRACT-LINK-DIRECTIVE (Phase-2 §4/§5)
 * 경과분석 배치 슬립 상태머신 클라이언트 배선 유틸.
 *
 * SSOT = DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA (후보 B: 전용 progress_analysis_slips 테이블).
 *   정본 decision: agents/docs/da_replies/da_decision_foot_proganalysis_slip_schema_extract_link_20260822.md
 *   스키마 마이그: supabase/migrations/20260822010000_foot_progress_analysis_slips_schema.sql (prod apply 완료·POSTCHECK PASS).
 *
 * 상태머신(§5, 슬립 1장 = 예약 1건 = 경과지 1장, durable):
 *   pending_extract(추출대상)  : 6배수 도래 예약 → 리스트 노출·인풋 추출 대상.
 *   awaiting_upload(업로드대기) : 결과 이미지 연결됨(그 예약ID 1:1 결속). 6회차 마감 판정 전.
 *   confirmed(확정)            : 6회차 당일 체크인 완료. (전이 실배선 = 마감 배치 = §6 reporter confirm 後 별도.)
 *
 * ★결속키(§4·Q2-2) = reservation_id UNIQUE(plain). resolve 는 fail-closed(under-bind ≫ mis-bind):
 *   - 슬립 생성: reservation_id 로만 upsert(멱등, 중복 무시).
 *   - 이미지→슬립 결속: (customer_id, visit_date) 후보가 정확히 1건일 때만 결속. 0건/다건 = 결속 보류(이미지는 첨부됨).
 *   이름·날짜 추측 결속 금지(fuzzy 금지). §6 노쇼 자동폐기(soft-delete·확정복귀) 트리거는 본 범위 밖.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** 슬립 상태 슬러그(DB canonical — CHECK IN(...)). 한글 표시명은 아래 매핑(NFD 재발 회피). */
export type SlipState = 'pending_extract' | 'awaiting_upload' | 'confirmed';

export const SLIP_STATE = {
  PENDING_EXTRACT: 'pending_extract',
  AWAITING_UPLOAD: 'awaiting_upload',
  CONFIRMED: 'confirmed',
} as const;

/** 슬러그 → 한글 표시명(FE 매핑). */
export function slipStateLabel(state: SlipState | null | undefined): string {
  switch (state) {
    case 'pending_extract':
      return '추출대상';
    case 'awaiting_upload':
      return '업로드대기';
    case 'confirmed':
      return '확정';
    default:
      return '준비 전';
  }
}

/** 슬러그 → 배지 색(teal-emerald 계열 톤). */
export function slipStateBadgeClass(state: SlipState | null | undefined): string {
  switch (state) {
    case 'pending_extract':
      return 'border-neutral-300 bg-neutral-100 text-neutral-600';
    case 'awaiting_upload':
      return 'border-amber-300 bg-amber-100 text-amber-800';
    case 'confirmed':
      return 'border-emerald-300 bg-emerald-100 text-emerald-800';
    default:
      return 'border-neutral-200 bg-neutral-50 text-neutral-400';
  }
}

export interface EnsureSlipInput {
  clinicId: string;
  customerId: string;
  reservationId: string;
  chartNo: string | null;
  sessionOrdinal: number;
  visitDate: string; // 'YYYY-MM-DD' (6배수 도래일 = 다음 예약일)
  actorId?: string | null;
}

/**
 * 추출대상 슬립 멱등 생성(§5 [추출대상]). reservation_id UNIQUE 결속키로 upsert — 이미 있으면 no-op.
 * 인풋 추출('경과분석지 준비') 시점에 호출. best-effort(실패해도 추출 자체는 진행).
 * @returns 생성/기존 슬립 id, 또는 실패 시 null.
 */
export async function ensureSlip(
  supabase: SupabaseClient,
  input: EnsureSlipInput,
): Promise<string | null> {
  if (!input.clinicId || !input.customerId || !input.reservationId || !input.visitDate) return null;
  try {
    const { data, error } = await supabase
      .from('progress_analysis_slips')
      .upsert(
        {
          clinic_id: input.clinicId,
          customer_id: input.customerId,
          reservation_id: input.reservationId,
          chart_no: input.chartNo ?? '',
          session_ordinal: input.sessionOrdinal,
          visit_date: input.visitDate,
          state: SLIP_STATE.PENDING_EXTRACT,
          created_by: input.actorId ?? null,
        },
        { onConflict: 'reservation_id', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) return String((data[0] as { id: string }).id);
    // ignoreDuplicates → no-op(기존 슬립). id 재조회.
    const { data: existing } = await supabase
      .from('progress_analysis_slips')
      .select('id')
      .eq('reservation_id', input.reservationId)
      .maybeSingle();
    return existing ? String((existing as { id: string }).id) : null;
  } catch {
    return null; // best-effort — 슬립 생성 실패가 추출/업로드를 막지 않음.
  }
}

/**
 * 예약ID 배치로 슬립 상태 조회(§5 상태 컬럼). reservation_id → state 맵.
 * 슬립 미존재 예약 = 맵에 없음(FE 에서 '준비 전' 표시).
 */
export async function fetchSlipStatesByReservation(
  supabase: SupabaseClient,
  clinicId: string,
  reservationIds: string[],
): Promise<Map<string, SlipState>> {
  const out = new Map<string, SlipState>();
  const ids = [...new Set(reservationIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return out;
  // .in() URL 한계 회피 — 200개씩 청크.
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from('progress_analysis_slips')
      .select('reservation_id, state')
      .eq('clinic_id', clinicId)
      .in('reservation_id', slice);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ reservation_id: string; state: SlipState }>) {
      if (row.reservation_id) out.set(String(row.reservation_id), row.state);
    }
  }
  return out;
}

export interface LinkImageToSlipInput {
  clinicId: string;
  customerId: string;
  visitDate: string;   // 'YYYY-MM-DD'
  contentHash: string; // 대상 이미지 특정
}

export interface LinkImageResult {
  bound: boolean;
  slipId: string | null;
  reason: 'bound' | 'no_slip' | 'ambiguous' | 'error';
}

/**
 * 결과 이미지 → 슬립 1:1 결속(§4). fail-closed:
 *   후보 슬립 = (clinic_id, customer_id, visit_date) 정확히 1건일 때만 결속(그 슬립의 reservation_id = 1:1 결속키).
 *   0건/다건 = 결속 보류(이미지는 이미 첨부됨 — under-bind ≫ mis-bind).
 * 결속 시: progress_result_images.slip_id 세팅 + 슬립 state pending_extract → awaiting_upload(확정/업로드대기는 유지).
 */
export async function linkImageToSlipByVisit(
  supabase: SupabaseClient,
  input: LinkImageToSlipInput,
): Promise<LinkImageResult> {
  const { clinicId, customerId, visitDate, contentHash } = input;
  if (!clinicId || !customerId || !visitDate || !contentHash) {
    return { bound: false, slipId: null, reason: 'error' };
  }
  try {
    // 후보 슬립(fail-closed): customer + 방문일 정확히 1건.
    const { data: slips, error: slipErr } = await supabase
      .from('progress_analysis_slips')
      .select('id, state')
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .eq('visit_date', visitDate)
      .limit(2);
    if (slipErr) throw slipErr;
    const list = (slips ?? []) as Array<{ id: string; state: SlipState }>;
    if (list.length === 0) return { bound: false, slipId: null, reason: 'no_slip' };
    if (list.length > 1) return { bound: false, slipId: null, reason: 'ambiguous' };

    const slip = list[0];
    // 이미지에 slip_id 결속(해당 content_hash 이미지 특정).
    const { error: imgErr } = await supabase
      .from('progress_result_images')
      .update({ slip_id: slip.id })
      .eq('clinic_id', clinicId)
      .eq('customer_id', customerId)
      .eq('visit_date', visitDate)
      .eq('content_hash', contentHash);
    if (imgErr) throw imgErr;

    // 슬립 상태 전이(추출대상 → 업로드대기). 확정/이미 업로드대기 = 유지(하강 금지).
    if (slip.state === SLIP_STATE.PENDING_EXTRACT) {
      const { error: stErr } = await supabase
        .from('progress_analysis_slips')
        .update({ state: SLIP_STATE.AWAITING_UPLOAD })
        .eq('id', slip.id)
        .eq('state', SLIP_STATE.PENDING_EXTRACT); // 낙관적 가드(경쟁 안전).
      if (stErr) throw stErr;
    }
    return { bound: true, slipId: slip.id, reason: 'bound' };
  } catch {
    return { bound: false, slipId: null, reason: 'error' };
  }
}
