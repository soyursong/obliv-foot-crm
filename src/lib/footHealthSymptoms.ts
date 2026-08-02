/**
 * SSOT — 발건강 설문지 '발 관련 증상' 목록 (현장 확정 순서·문구, MSG-175815-mlsv).
 *
 * 재사용처:
 *   - HealthQMobilePage : 발건강 설문지 1번 항목(발 관련 증상, 다중선택)
 *   - DocumentPrintPanel: 초진 관리기록지 '방문 목적' 체크그룹
 *
 * T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS:
 *   초진 관리기록지 방문목적을 이 목록과 100% 일치(순서·문구, AC-5)시키기 위해
 *   두 화면이 이 단일 배열을 공유 → 어휘 drift 방지.
 *   마지막 원소 '기타'는 자유 기입칸(vp_other_text, P3 배포분)과 연결.
 */
export const FOOT_SYMPTOM_OPTIONS = [
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
] as const;
