// checkInPackageLink — 2번차트 차감(치료 신청) 시 check_ins.package_id 링크 판정(순수 함수)
// Ticket: T-20260724-foot-CHART2-PKG-TXSELECT-STATE-LOSS
//
// RC: 2번차트 회차 차감 경로가 package_sessions.check_in_id 만 걸고 check_ins.package_id 를
//     비워둠(NULL). 치료테이블/접수 명단 카드(CheckInDetailSheet 등)는 check_ins.package_id 로
//     '연결됨'을 판정 → 화면 전환·재진입 시 선택(패키지)이 풀린 것처럼 보임(현장 "초기화" 증상).
//     DB증거(MSG-p5fj): 박병문 F-4995 / 이춘형 F-4851 둘 다 check_ins.package_id=NULL.
// FIX: PaymentDialog(결제 시 link)와 대칭으로, 차감이 '오늘 내원'에 귀속될 때 check_ins.package_id 링크.
//      기존 컬럼 재사용(no-DDL, db_change:false). 파괴적 변경 없음.
//
// 본 판정은 write 의 유일한 게이트 — CustomerChartPage.linkCheckInPackage 가 이 결과가 true 일 때만
// check_ins UPDATE 를 수행한다. 순수 함수라 클릭 시나리오(AC-1~4)를 결정적으로 검증 가능.

export interface CheckInPackageLinkInput {
  /** 현재 2번차트가 보유한 최근 내원(check_in) id */
  latestCheckInId: string | null | undefined;
  /** 그 내원의 현재 package_id (NULL=미연결) */
  latestCheckInPackageId: string | null | undefined;
  /** 차감이 귀속되는 내원 id — 차감일==최근 내원일(KST)일 때만 non-null (computeDeductCheckInId) */
  deductCheckInId: string | null | undefined;
  /** 차감(치료 신청) 대상 패키지 id */
  targetPackageId: string;
}

/**
 * check_ins.package_id 를 targetPackageId 로 링크해야 하는가?
 *
 * - deductCheckInId 없음(과거일 백데이트 차감 등) → false: 특정 내원에 귀속 불가하므로 링크 안함.
 * - 차감 귀속 내원 ≠ 現 2번차트 내원 → false: 現 내원 카드에만 반영(엉뚱한 내원 오염 금지).
 * - 이미 동일 패키지로 연결됨 → false: 멱등(중복 write 방지, AC-1/2/4 재진입 안정).
 * - 그 외 → true: 최신 선택으로 링크/갱신(다른 패키지 차감 시 갱신 = AC-3 의도적 재선택).
 *
 * 다른 환자는 별개 check_ins row(latestCheckInId 자체가 다름) → 상태 오염 없음(AC-3).
 */
export function shouldLinkCheckInPackage(input: CheckInPackageLinkInput): boolean {
  const { latestCheckInId, latestCheckInPackageId, deductCheckInId, targetPackageId } = input;
  if (!deductCheckInId) return false;
  if (latestCheckInId !== deductCheckInId) return false;
  if (latestCheckInPackageId === targetPackageId) return false;
  return true;
}
