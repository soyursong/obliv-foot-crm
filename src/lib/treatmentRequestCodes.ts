/**
 * treatmentRequestCodes — 2번차트 '치료신청' 5항목 코드 SSOT
 * T-20260701-foot-CHART2-TREATREQ-SPLIT (AC-7)
 *
 * ⭐ 이 파일이 치료신청/치료유형 코드 문자열의 유일 정의처다.
 *   자매 티켓 T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN(치료사 capability)도
 *   배정 join key 를 여기서 import 한다 — 코드는 한 곳에서 한 번만 정의(중복 정의 금지).
 *
 * ── 5항목 = 2개 의미 축(DA CONSULT-REPLY §7, 하나로 뭉치지 말 것) ──
 *   treatment 축 [배정 필터 O]: 내성(PD)=podologue · 각질(RB)=ribbon
 *       → chart_treatment_requests(axis='treatment') + package_sessions.session_type 공유 어휘.
 *   exam 축 [배정 필터 X, 리스트업만]:
 *       · 피검사=blood_test / KOH균검사=koh_fungal_test
 *           → 既존 리스트업 엔티티(check_in_services.blood_test_requested/koh_requested +
 *             request_blood_test_for_customer/request_koh_for_customer RPC)에 write.
 *             chart_treatment_requests 에는 저장하지 않는다(중복 저장소 방지, DA AC-4).
 *       · 무좀PC+NL=athlete_foot_pc_nl (dev-foot 그라운딩: 처방 PC+네일락 NL 도메인, 치료사 시술 아님)
 *           → 既존 리스트업 엔티티 없음 → chart_treatment_requests(axis='exam') 로 흡수. 배정 불참.
 *
 * ⚠ 배정 필터(AC-5)는 '5항목'이 아니라 request_axis='treatment' subset 만 좁힌다.
 */

export type RequestAxis = 'treatment' | 'exam';

/** exam 축 중 既존 리스트업 엔티티(check_in_services 플래그)로 위임되는 코드. chart_treatment_requests 미저장. */
export type ExistingExamEntity = 'blood_flag' | 'koh_flag' | null;

export interface TreatmentRequestItem {
  /** DB request_code (SSOT 문자열) */
  code: string;
  /** 화면 라벨 */
  label: string;
  /** 의미 축 */
  axis: RequestAxis;
  /**
   * 이 항목이 既존 리스트업 엔티티(check_in_services 플래그)로 write 되는가.
   *  · 'blood_flag'/'koh_flag' → 既존 RPC 위임(chart_treatment_requests 미저장).
   *  · null → chart_treatment_requests 에 저장.
   */
  existingEntity: ExistingExamEntity;
}

/** 치료신청 박스 표시 순서(현장 IMG_8740 구성 참고). */
export const TREATMENT_REQUEST_ITEMS: readonly TreatmentRequestItem[] = [
  { code: 'podologue',          label: '내성(PD)',    axis: 'treatment', existingEntity: null },
  { code: 'ribbon',             label: '각질(RB)',    axis: 'treatment', existingEntity: null },
  { code: 'blood_test',         label: '피검사',      axis: 'exam',      existingEntity: 'blood_flag' },
  { code: 'koh_fungal_test',    label: 'KOH균검사',   axis: 'exam',      existingEntity: 'koh_flag' },
  { code: 'athlete_foot_pc_nl', label: '무좀PC+NL',   axis: 'exam',      existingEntity: null },
] as const;

/** 배정 필터(AC-5)에 참여하는 치료유형 코드 = axis='treatment'. THERAPIST-SKILL capability 와 join. */
export const TREATMENT_AXIS_CODES: readonly string[] = TREATMENT_REQUEST_ITEMS
  .filter((i) => i.axis === 'treatment')
  .map((i) => i.code);

/** code → item 조회 */
export const TREATMENT_REQUEST_BY_CODE: Record<string, TreatmentRequestItem> =
  Object.fromEntries(TREATMENT_REQUEST_ITEMS.map((i) => [i.code, i]));

/**
 * package_sessions.session_type → 치료신청 treatment 코드 매핑(재진 패키지 파생 스냅샷용, AC-3).
 *   패키지가 보유한 시술유형 중 치료신청 5항목과 겹치는 것만 자동반영한다.
 *   podologue(포돌로게)=내성(PD). laser/iv/preconditioning/trial/reborn 은 치료신청 항목 아님 → 미반영.
 *   ribbon 은 아직 패키지 시술유형이 아니므로(향후 확장) 파생 대상 없음.
 */
export const PACKAGE_SESSION_TYPE_TO_REQUEST_CODE: Record<string, string> = {
  podologue: 'podologue',
  ribbon: 'ribbon',
};
