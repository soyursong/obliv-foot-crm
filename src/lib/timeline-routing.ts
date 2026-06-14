import type { VisitType } from './types';

/**
 * T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY (Option A)
 *
 * 통합 시간표(Timeline)의 초진/재진 슬롯 분류 기준 visit_type.
 *
 * 매칭 체크인이 있으면 체크인의 visit_type(현장 접수 시점 분류)을 권위 기준으로 쓰고,
 * 체크인이 없으면(셀프접수 전) 예약의 visit_type으로 폴백한다.
 *
 * 배경: 초진 체크인(ci.visit_type='new')이 재진 예약(r.visit_type='returning')에
 *   매칭될 때, 기존 routing은 r.visit_type을 사용해 초진 환자를 재진 구역에 잘못 표시했다.
 *   워크인(예약 미매칭) 분기는 이미 ci.visit_type을 사용하므로, 매칭 분기도 동일 기준으로
 *   맞춰 매칭/워크인 routing을 일관화한다.
 *
 * 순수 함수 — DB 변경 없음(표시 routing only).
 */
export function timelineVisitType(
  ciVisitType: VisitType | null | undefined,
  resvVisitType: VisitType,
): VisitType {
  return ciVisitType ?? resvVisitType;
}
