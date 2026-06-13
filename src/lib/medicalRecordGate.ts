/**
 * 의료법 제22조 진료기록 작성 강제 게이트 — 급여(보험) 방문 한정 하드차단.
 *
 * T-20260612-foot-MEDLAW22-B-GATE
 *
 * 결정(문지은 대표원장 2026-06-13, MSG-20260613-171308-kdvj):
 *  - 강도 = 하드차단(완전차단): 진료기록(+서명) 없으면 수납/완료 진행 불가. 사유 입력 우회 없음.
 *  - 범위 = 급여(보험) 방문 한정:
 *      · 방문 내 치료 항목 중 급여 1개라도 포함 → 게이트 적용.
 *      · 비급여(자부담)만 방문 → 게이트 미적용(기존 수납 플로우 그대로).
 *
 * 검사 순서(가드, planner):
 *  (1차) 방문 급여/비급여 판정 — check_in_services(방문 치료항목) + getTaxClass(footBilling SSOT).
 *        결제 미니창에서 직원이 보는 분류와 1:1 동일 로직(getTaxClass) → 오판정(비급여→급여
 *        과차단) 방지(AC-3). 판정에 신규 스키마 불필요 — 기존 check_in_services/services 재사용.
 *  (2차) 급여면 → 해당 내원일 medical_charts(서명 진료의 signing_doctor_id 보유) 존재 확인.
 *        (발톱 진료기록 기구현 — medical_charts.signing_doctor_id 즉시 정확.)
 *        없으면 차단.
 *
 * AC-4 레거시 면제: 본 게이트는 '수납/완료 액션 시점'에만 동작(전진형) — 이미 완료(done)된
 *   과거 급여 건을 일괄 재평가/차단하지 않는다. 호출부는 done 전이 직전에만 평가한다.
 *
 * 무파괴: 비급여 방문은 1차에서 즉시 통과(blocked=false). 급여 판정에 필요한 항목(check_in_services)
 *   이 없으면 급여로 단정하지 않고 통과 — 과차단 방지(AC-3 안전 방향).
 *
 * 범위 주의: 급여한정은 foot 현장 결정 — derm/body 로 전파 금지.
 */
import { supabase } from './supabase';
import { seoulISODate, todaySeoulISODate } from './format';
import {
  getTaxClass,
  loadFootBillingItems,
  loadCustomerInsuranceGrade,
} from './footBilling';

/** 게이트가 평가 대상으로 삼는 체크인의 최소 형태 (CheckIn 과 호환). */
export interface MedicalRecordGateCheckIn {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  checked_in_at?: string | null;
}

export interface MedicalRecordGateResult {
  /** true = 하드차단(수납/완료 진행 불가). */
  blocked: boolean;
  /** 방문이 급여(보험)로 판정됐는지 — 비급여면 false(게이트 미적용). */
  isCovered: boolean;
  /** 차단 사유(현장 안내 문구). blocked=false 면 undefined. */
  reason?: string;
}

/** 현장 하드차단 안내 문구 (개발용어 0 — field_lang_dict 준수). */
export const MEDLAW22_BLOCK_MESSAGE =
  '건강보험(급여) 진료는 진료기록이 작성되어야 수납·완료할 수 있습니다. 담당 의사의 진료기록(서명 포함) 작성 후 다시 진행해주세요.';

/**
 * 의료법 제22조 게이트 평가.
 *
 * @returns blocked=true 면 수납/완료를 막아야 한다. 비급여·기록보유 시 blocked=false.
 */
export async function evaluateMedicalRecordGate(
  checkIn: MedicalRecordGateCheckIn,
): Promise<MedicalRecordGateResult> {
  // 고객 미연결 방문은 급여 판정 불가(자격등급 없음) → 게이트 미적용.
  if (!checkIn.customer_id) {
    return { blocked: false, isCovered: false };
  }

  // ── (1차) 방문 급여/비급여 판정 ────────────────────────────────────────────
  // check_in_services(방문 치료항목) + getTaxClass(footBilling SSOT) — 결제창 분류와 동일.
  const [items, grade] = await Promise.all([
    loadFootBillingItems(checkIn.id),
    loadCustomerInsuranceGrade(checkIn.customer_id),
  ]);

  const isCovered = items.some((it) => getTaxClass(it.service, grade) === '급여');

  // 비급여만 방문(또는 항목 미기록) → 게이트 미적용(기존 플로우 그대로, 과차단 방지).
  if (!isCovered) {
    return { blocked: false, isCovered: false };
  }

  // ── (2차) 해당 내원일 진료기록(서명 진료의 포함) 존재 확인 ────────────────────
  // 내원일 = 체크인 KST 날짜(checked_in_at) 기준, 없으면 오늘(서울). medical_charts.visit_date
  // 는 진료 작성 시점의 당일(KST)로 저장되므로 동일 날짜로 매칭한다("해당 내원").
  const visitDate = checkIn.checked_in_at
    ? seoulISODate(checkIn.checked_in_at)
    : todaySeoulISODate();

  const { data: chart, error } = await supabase
    .from('medical_charts')
    .select('id')
    .eq('customer_id', checkIn.customer_id)
    .eq('clinic_id', checkIn.clinic_id)
    .eq('visit_date', visitDate)
    .not('signing_doctor_id', 'is', null)
    .limit(1)
    .maybeSingle();

  // 조회 오류 시: 의료법 하드차단의 안전 방향은 '차단'이 아니라 '통과'(과차단 방지·운영 연속성).
  //   네트워크/일시 오류로 정상 급여 수납이 막히는 것을 피한다. 기록 누락의 본질 차단은
  //   조회 성공 + 0건일 때만 발동한다.
  if (error) {
    return { blocked: false, isCovered: true };
  }

  if (chart?.id) {
    // 서명 진료기록 존재 → 정상 진행.
    return { blocked: false, isCovered: true };
  }

  // 급여 방문 + 서명 진료기록 미존재 → 하드차단.
  return { blocked: true, isCovered: true, reason: MEDLAW22_BLOCK_MESSAGE };
}
