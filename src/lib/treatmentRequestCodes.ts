/**
 * treatmentRequestCodes — 2번차트 '치료신청' 5항목 코드 SSOT
 * T-20260701-foot-CHART2-TREATREQ-SPLIT (AC-7)
 *
 * ⭐ 이 파일이 치료신청/치료유형 코드 문자열의 유일 정의처다.
 *   자매 티켓 T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN(치료사 capability)도
 *   배정 join key 를 여기서 import 한다 — 코드는 한 곳에서 한 번만 정의(중복 정의 금지).
 *
 * ── 5항목 = 2개 의미 축(DA CONSULT-REPLY §7 + 후속 lpro 확정 — 하나로 뭉치지 말 것) ──
 *   treatment 축 [배정 필터 O] — chart_treatment_requests(axis='treatment') + package_sessions.session_type 공유 어휘:
 *       · 내성(PD)   = ['podologue']                         (既존 session_type)
 *       · 각질(RB)   = ['ribbon']                            (본 티켓 session_type CHECK 신규 확장)
 *       · 무좀PC+NL  = ['preconditioning', 'unheated_laser'] (既존 코드 조합: PC=preconditioning, NL=unheated_laser)
 *                       ✅ DA lpro(MSG-20260701-142200) 확정 = 치료유형 축(배정 참여, preconditioning capability).
 *                       신규 enum 신설 0 — 既존 session_type 2코드 조합.
 *   exam 축 [배정 필터 X, 리스트업만] — chart_treatment_requests 미저장:
 *       · 피검사    = check_in_services.blood_test_requested(bool) SSOT + request_blood_test_for_customer RPC
 *       · KOH균검사 = check_in_services.koh_requested(bool)        SSOT + request_koh_for_customer      RPC
 *       (DA lpro AC-4: 기존 플래그가 단일 SSOT. chart_treatment_requests 에 exam 행 쓰지 말 것 = 연동 끊김·중복 방지.)
 *
 * ⚠ 배정 필터(AC-5)는 '5항목'이 아니라 request_axis='treatment' subset(내성/각질/무좀)만 좁힌다.
 *
 * ── request_code 컬럼은 CHECK 없는 자유텍스트(session_type 어휘 공유 규약) ──
 *   배정 join 이 capability(session_type 어휘)와 성립하려면 treatment 코드가 session_type 문자열이어야 한다.
 *   ⇒ podologue/ribbon/preconditioning/unheated_laser 전부 session_type 정본 어휘.
 */

export type RequestAxis = 'treatment' | 'exam';

/** exam 축이 위임하는 既존 리스트업 엔티티(check_in_services 플래그). chart_treatment_requests 미저장. */
export type ExistingExamEntity = 'blood_flag' | 'koh_flag' | null;

export interface TreatmentRequestItem {
  /** 안정적 UI 키(체크박스 testid). */
  key: string;
  /** 화면 라벨 */
  label: string;
  /** 의미 축 */
  axis: RequestAxis;
  /**
   * DB request_code(들). 한 체크박스가 복수 치료유형 코드를 함의할 수 있다(무좀=PC+NL).
   *  · treatment: chart_treatment_requests 에 code 당 1행(체크=전 코드 present, 해제=전 코드 delete).
   *  · exam(existingEntity != null): [] — 既존 플래그로 위임(본 테이블 미저장).
   */
  codes: string[];
  /**
   * exam 축이 既존 플래그로 write 되는가.
   *  · 'blood_flag'/'koh_flag' → 既존 RPC 위임(chart_treatment_requests 미저장).
   *  · null → codes 를 chart_treatment_requests 에 저장(treatment 축).
   */
  existingEntity: ExistingExamEntity;
}

/** 치료신청 박스 표시 순서(현장 IMG_8740 구성 참고). */
export const TREATMENT_REQUEST_ITEMS: readonly TreatmentRequestItem[] = [
  { key: 'podologue_pd',   label: '내성(PD)',    axis: 'treatment', codes: ['podologue'],                       existingEntity: null },
  { key: 'ribbon_rb',      label: '각질(RB)',    axis: 'treatment', codes: ['ribbon'],                          existingEntity: null },
  { key: 'blood_test',     label: '피검사',      axis: 'exam',      codes: [],                                  existingEntity: 'blood_flag' },
  { key: 'koh_fungal_test',label: 'KOH균검사',   axis: 'exam',      codes: [],                                  existingEntity: 'koh_flag' },
  { key: 'athlete_foot',   label: '무좀PC+NL',   axis: 'treatment', codes: ['preconditioning', 'unheated_laser'], existingEntity: null },
] as const;

/**
 * 배정 필터(AC-5)에 참여하는 치료유형 코드 = axis='treatment' 항목의 codes 합집합.
 *   THERAPIST-SKILL capability(session_type 어휘)와 join. = {podologue, ribbon, preconditioning, unheated_laser}.
 */
export const TREATMENT_AXIS_CODES: readonly string[] = [
  ...new Set(
    TREATMENT_REQUEST_ITEMS
      .filter((i) => i.axis === 'treatment')
      .flatMap((i) => i.codes),
  ),
];

/** key → item 조회 */
export const TREATMENT_REQUEST_BY_KEY: Record<string, TreatmentRequestItem> =
  Object.fromEntries(TREATMENT_REQUEST_ITEMS.map((i) => [i.key, i]));

/**
 * package_sessions.session_type → 치료신청 treatment 코드 매핑(재진 패키지 파생 스냅샷용, AC-3).
 *   패키지가 보유한 시술유형 중 치료신청 5항목과 겹치는 것만 자동반영한다.
 *   podologue(포돌로게)=내성(PD). laser/iv/trial/reborn 은 치료신청 항목 아님 → 미반영.
 *   ribbon 은 아직 패키지 시술유형 컬럼이 아니므로(향후 확장) 파생 대상 없음.
 */
export const PACKAGE_SESSION_TYPE_TO_REQUEST_CODE: Record<string, string> = {
  podologue: 'podologue',
  ribbon: 'ribbon',
};
