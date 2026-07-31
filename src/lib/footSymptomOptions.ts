// ─── 발건강 설문지 '발 관련 증상' 라벨 SSOT ───
// T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS: 초진 관리기록지 '방문목적'에 발건강 설문지
//   '발 관련 증상' 전체를 additive 로 얹는다. 문구·순서 drift 방지를 위해 설문지(HealthQMobilePage)와
//   인쇄 서류(htmlFormTemplates·DocumentPrintPanel)가 이 단일 배열을 공유한다.
//   현장 확정 순서·텍스트 그대로 (MSG-175815-mlsv, 발건강질문지 5섹션 최종 확정본 1번 항목).

/** 발건강 설문지 1번 '발 관련 증상' 다중선택 옵션(현장 확정 순서). '기타'는 마지막. */
export const FOOT_SYMPTOM_OPTIONS: string[] = [
  '발톱 변색 및 변형',
  '내성발톱(파고드는 발톱)',
  '발가락 통증',
  '발냄새',
  '발건조 및 각질',
  '발 땀 많음',
  '가려움증',
  '발톱 끝 부서짐',
  '울퉁불퉁한 발톱',
  '기타',
];

/**
 * 초진 관리기록지 '방문목적'에 additive 로 추가할 증상 체크옵션.
 * SSOT(FOOT_SYMPTOM_OPTIONS)에서 '기타'를 제외한다 — '기타'는 P3(T-20260730-...-P3 item3)에서
 * 이미 방문목적 전용 기타칸(vp_other + vp_other_text)으로 배포됨 → 중복 생성 금지.
 * key = vp_sym{index} (설문지 순서 index 고정) → 인쇄 템플릿 {{vp_symN}} 플레이스홀더와 1:1.
 */
export const FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS: ReadonlyArray<{ key: string; label: string }> =
  FOOT_SYMPTOM_OPTIONS
    .filter((label) => label !== '기타')
    .map((label, i) => ({ key: `vp_sym${i}`, label }));
