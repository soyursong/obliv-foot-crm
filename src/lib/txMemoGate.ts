// T-20260822-foot-CLOSING-TXMEMO-SOFTPOPUP
//   회차 차감 소프트 팝업(비강제)용 판정 헬퍼.
//   "차감 대상 고객의 당일(영업일, KST) 특이사항(치료메모)이 비어있는가?" 를
//   customer_treatment_memos 의 **존재여부만** read-only 로 판정한다(내용 미read).
//
//   AC0 canonical 소스(부모 티켓 T-20260822-foot-CLOSING-TXMEMO-MISSING-ALERT 확정):
//     특이사항 = customer_treatment_memos (customer×영업일 grain).
//     customers.special_notes / customer_special_notes 는 person-grain 이라 '방문일별 미작성'
//     판정 구조적 불가 → REJECT. 재조사 불요.
//   AC4(write-path 0): 이 헬퍼는 read-only(SELECT count) 만 수행. INSERT/write 신설 없음.
//     기존 clinic-scoped RLS(clinic_isolation_ctm_select) 내에서만 조회.
//   memo_type 판정범위 = [치료메모, 특이사항] 2종. 진료메모(의사측)는 제외(planner 확정).
import { supabase } from './supabase';
import { todaySeoulISODate } from './format';

/** 팝업 판정에 포함하는 메모유형(진료메모=의사측 제외). */
export const TXMEMO_GATE_MEMO_TYPES = ['치료메모', '특이사항'] as const;

/**
 * 당일(영업일, KST) 해당 고객의 특이사항(치료메모)이 이미 존재하는지 read-only 판정.
 *   존재하면 true → 팝업 미노출(차감 바로 진행).
 *   없으면 false → 호출측이 소프트 팝업 노출.
 *
 * ★비강제 안전(fail-open): customerId 부재/판정 오류/RLS 0-row 등 '확정 불가' 상황은
 *   true(=존재) 로 간주하여 팝업을 억제한다. 판정 실패가 차감 흐름을 막지 않도록(무회귀 최우선).
 *
 * @param customerId 차감 귀속 고객
 * @param clinicId   (옵션) clinic 필터. 미지정 시 RLS(current_user_clinic_id) 로 격리.
 */
export async function hasTodayTreatmentMemo(
  customerId: string | null | undefined,
  clinicId?: string | null,
): Promise<boolean> {
  if (!customerId) return true; // 판정 불가 → 팝업 억제(무회귀 우선)
  const today = todaySeoulISODate();
  let q = supabase
    .from('customer_treatment_memos')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .in('memo_type', TXMEMO_GATE_MEMO_TYPES as unknown as string[])
    .gte('created_at', `${today}T00:00:00+09:00`)
    .lte('created_at', `${today}T23:59:59+09:00`);
  if (clinicId) q = q.eq('clinic_id', clinicId);
  const { count, error } = await q;
  if (error) return true; // 조회 실패 → 팝업 억제(무회귀 우선)
  return (count ?? 0) > 0;
}
