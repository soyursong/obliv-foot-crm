/**
 * T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-2 / AC-3)
 * 결과 이미지 → **예약(appointment) 1:1 링킹** 결정적 해석 (fail-closed).
 *
 * SSOT = progress_analysis_slips (DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA, prod-applied).
 *   결속키(Q2-2) = slips.reservation_id UNIQUE(=appointment_id). 후보 슬립 특정 축 = (clinic_id, chart_no, session_ordinal, visit_date).
 *
 * 매칭 키(파일명 파싱값) = 차트번호 + 회차(N) + 날짜 **3조합**. 이름·날짜 추측연결 절대 금지(reporter 3중 강조).
 * fail-closed 결정트리(AC-3): 확신(정확히 1건·미연결) 없으면 자동연결 안 함 → '원장 확인 대기' 보류.
 *   under-bind ≫ mis-bind. 임의 덮어쓰기(중복) 금지.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedResultFilename } from './progressResultFilename';

/** 매칭 상태(AC-3 결정트리). matched 외 전부 '원장 확인 대기' 보류(빨강). */
export type ApptMatchStatus =
  | 'matched'      // 정확히 1건 슬립 + 미연결 → 예약(reservation_id) 1:1 링킹 가능
  | 'parse_fail'   // 파일명 계약 위반(AC-6) → 보류
  | 'no_match'     // (차트+회차+날짜) 슬립 0건 → 보류(추측연결 금지)
  | 'ambiguous'    // 후보 슬립 2건↑ → 보류(mis-bind 방지)
  | 'duplicate';   // 이미 연결(활성 이미지 존재 or 슬립 확정) → 보류(임의 덮어쓰기 금지)

export interface SlipLite {
  id: string;
  reservation_id: string;
  customer_id: string;
  chart_no: string;
  state: string;
  /** 활성(미삭제) 연결 이미지 존재 여부(중복 판정). */
  hasActiveImage: boolean;
}

/** 후보 슬립 특정 키(chart_no|session_ordinal|visit_date). 정규화 chart_no 사용. */
export function slipMatchKey(chartNo: string, sessionOrdinal: number, visitDate: string): string {
  return `${chartNo}|${sessionOrdinal}|${visitDate}`;
}

export interface ResolveApptResult {
  status: ApptMatchStatus;
  slipId: string | null;
  reservationId: string | null;
  customerId: string | null;
  detail: string;
}

/**
 * 결정적·fail-closed 해석. slipsByKey = slipMatchKey → SlipLite[] (동일 키 다건이면 배열).
 * 자동연결은 오직 (정확히 1건 ∧ 미연결 ∧ 슬립 미확정)일 때만.
 */
export function resolveApptMatch(
  parsed: ParsedResultFilename,
  slipsByKey: Map<string, SlipLite[]>,
): ResolveApptResult {
  if (!parsed.ok || parsed.sessionOrdinal == null || !parsed.visitDate) {
    return { status: 'parse_fail', slipId: null, reservationId: null, customerId: null, detail: parsed.reason ?? '파일명 파싱 실패' };
  }
  const key = slipMatchKey(parsed.chartNo, parsed.sessionOrdinal, parsed.visitDate);
  const candidates = slipsByKey.get(key) ?? [];

  if (candidates.length === 0) {
    return {
      status: 'no_match',
      slipId: null,
      reservationId: null,
      customerId: null,
      detail: `일치 예약 없음 (차트 ${parsed.chartNoRaw} · ${parsed.sessionOrdinal}회차 · ${parsed.visitDate}) — 원장 확인 대기`,
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      slipId: null,
      reservationId: null,
      customerId: null,
      detail: `후보 예약 ${candidates.length}건 (차트 ${parsed.chartNoRaw} · ${parsed.sessionOrdinal}회차 · ${parsed.visitDate}) — 원장 확인 대기`,
    };
  }

  const slip = candidates[0];
  // 중복(AC-3): 이미 활성 이미지가 붙었거나 슬립이 확정 상태면 임의 덮어쓰기 금지 → 보류.
  if (slip.hasActiveImage || slip.state === 'confirmed') {
    return {
      status: 'duplicate',
      slipId: slip.id,
      reservationId: slip.reservation_id,
      customerId: slip.customer_id,
      detail: `이미 연결된 예약 (차트 ${parsed.chartNoRaw} · ${parsed.sessionOrdinal}회차) — 중복, 원장 확인 대기`,
    };
  }

  return {
    status: 'matched',
    slipId: slip.id,
    reservationId: slip.reservation_id,
    customerId: slip.customer_id,
    detail: `예약 연결 (차트 ${parsed.chartNoRaw} · ${parsed.sessionOrdinal}회차 · ${parsed.visitDate})`,
  };
}

/**
 * 파싱된 파일들의 후보 슬립을 배치 조회 → slipMatchKey 맵 구성(활성 이미지 존재 여부 포함).
 * chart_no 로 좁혀 조회 후 (session_ordinal, visit_date) exact 필터(클라이언트) — .in() URL 한계 회피.
 */
export async function fetchCandidateSlips(
  supabase: SupabaseClient,
  clinicId: string,
  parsedList: ParsedResultFilename[],
): Promise<Map<string, SlipLite[]>> {
  const out = new Map<string, SlipLite[]>();
  if (!clinicId) return out;
  const chartNos = Array.from(
    new Set(parsedList.filter((p) => p.ok && p.chartNo).map((p) => p.chartNo)),
  );
  if (chartNos.length === 0) return out;

  const rows: Array<{ id: string; reservation_id: string; customer_id: string; state: string; chart_no: string; session_ordinal: number; visit_date: string }> = [];
  for (let i = 0; i < chartNos.length; i += 200) {
    const slice = chartNos.slice(i, i + 200);
    const { data, error } = await supabase
      .from('progress_analysis_slips')
      .select('id, reservation_id, customer_id, state, chart_no, session_ordinal, visit_date')
      .eq('clinic_id', clinicId)
      .in('chart_no', slice);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
  }
  if (rows.length === 0) return out;

  // 활성 연결 이미지(중복 판정) — slip_id 배치 조회.
  const slipIds = Array.from(new Set(rows.map((r) => r.id)));
  const activeImgSlipIds = new Set<string>();
  for (let i = 0; i < slipIds.length; i += 200) {
    const slice = slipIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('progress_result_images')
      .select('slip_id')
      .in('slip_id', slice)
      .is('deleted_at', null);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ slip_id: string | null }>) {
      if (r.slip_id) activeImgSlipIds.add(String(r.slip_id));
    }
  }

  for (const r of rows) {
    const key = slipMatchKey(String(r.chart_no), Number(r.session_ordinal), String(r.visit_date));
    const arr = out.get(key) ?? [];
    arr.push({
      id: String(r.id),
      reservation_id: String(r.reservation_id),
      customer_id: String(r.customer_id),
      chart_no: String(r.chart_no),
      state: String(r.state),
      hasActiveImage: activeImgSlipIds.has(String(r.id)),
    });
    out.set(key, arr);
  }
  return out;
}
