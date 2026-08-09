// T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2
// packages 헤더 급여(가)/비급여(비) 회차 split 순수 로직.
//   DA SSOT: da_decision_foot_penchart_autorecord_visitlog_2chart_20260809.md (PRIMARY A)
//   · covered_sessions / noncovered_sessions = packages 헤더 grain nullable 컬럼(스태프 판매시 수동입력).
//   · VG1(dispositive): package_sessions = per-deduction(소진시점) 생성 → 미소진 회차 row 부재 →
//     per-session flag 표현 불가 → packages 헤더 2컬럼이 유일 canonical.
//   · VG2: 둘 다 입력 시 합=total. 하나라도 NULL=미분류(통과). DB partial CHECK 와 동형.
//   · VG3(firewall): 본 값은 매출 산식과 무접점(매출 급여/비급여 = service_charges only).

/**
 * VG2 자기검증(app-level).
 *  - 둘 중 하나라도 null(미입력) → 미분류 → 유효(NULL 저장).
 *  - 둘 다 입력 → covered + noncovered === total 이어야 유효.
 * DB CHECK(packages_insurance_split_sum_chk)와 동형:
 *   covered IS NULL OR noncovered IS NULL OR covered + noncovered = total_sessions
 */
export function isInsuranceSplitValid(
  covered: number | null,
  noncovered: number | null,
  total: number,
): boolean {
  if (covered == null || noncovered == null) return true;
  return covered + noncovered === total;
}

/** 둘 다 입력되었는가(합 검증 대상인가). */
export function isInsuranceSplitBothEntered(
  covered: number | null,
  noncovered: number | null,
): boolean {
  return covered != null && noncovered != null;
}

/**
 * 펜차트 회차 분해 표시 문자열. 예: 12회 (비11/가1).
 * 미분류(하나라도 null)면 null 반환(분해 표시 생략 → 총 회차만 표시).
 * ⚠표시(REWORK 편집형 폼 착지)는 본 데이터 leg 범위 밖 — 여기서는 순수 포맷만 제공.
 */
export function formatInsuranceSplit(
  covered: number | null,
  noncovered: number | null,
  total: number,
): string | null {
  if (!isInsuranceSplitBothEntered(covered, noncovered)) return null;
  return `${total}회 (비${noncovered}/가${covered})`;
}
