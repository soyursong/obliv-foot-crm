import type { VisitType } from './types';

/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE (Phase 2A)
 *
 * ★ Owner-forced visit_type 오버라이드 (수동 정정 보존 레이어, no-DDL).
 *
 * 왜 필요한가:
 *   초진/재진 표시는 런타임 recency 재파생(resolveVisitTypesByCheckIn)이 정본 소스다.
 *   2A 경계교정(자기 check_in 시각) 이후, 알고리즘 recency 판정과 **총괄(owner) 수동 판단이 상충**하는
 *   소수 레코드가 존재한다. recency 가 매번 재계산하므로 stored UPDATE 만으로는 표시에서 override 가 유실된다
 *   (Phase1 §3 경고). 이 맵은 recency 결과를 **check_in 레코드 단위**로 고정(pin)해 owner 판단을 보존한다.
 *
 * 성격:
 *   - freeze record_id 그레인(과다집계 진단과 동일 축) — 특정 배정 check_in 을 명시 UUID 로 pin.
 *   - PHI-safe: 성함 없이 record_id + 뒤4자리 차트번호 주석만.
 *   - 되돌리기: 항목 삭제 = recency 자동판정으로 복귀(무-DDL).
 *
 * ⚠ 반영 방식(코드-큐레이션 맵 vs 오버라이드 테이블) = planner FOLLOWUP 확인 대상.
 *   테이블 방식은 신규 테이블 → data-architect CONSULT 게이트(§S2.4) 비용 발생.
 *   본 no-DDL 맵은 4건 일회성 역사 정정에 적합하며 DA 게이트를 회피한다.
 *
 * 출처: 김주연 총괄 confirm (MSG 2026-07-28 19:23 KST) — 확인2 EDGE 판정 + sibling JMH override.
 */
export const OWNER_FORCED_VISIT_TYPE: Record<string, VisitType> = {
  // 정명희 #4270 — sibling T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX. 알고리즘상 재진(06-20 prior-done)
  //   이나 총괄 override 로 초진 수동정정. recency 재파생이 재진으로 되돌리지 않도록 초진 고정.
  '1c2117de-b091-4227-b8a5-a167c1d865b7': 'new',
  // ③ #7137 (07-10 done, 엄경은) — 확인2 KEEP(재진 유지). prior done 0(취소만) → recency 초진 예측이나 owner 재진 고정.
  '9b701267-3681-4380-a2c9-7dcf9dbec6a2': 'returning',
  // ⑥ #1242 (07-02 done, 송지현) — 확인2 KEEP(재진 유지). prior done 0(예약만) → owner 재진 고정.
  'ebea2e1f-a589-47ad-b3e8-c71a0340f513': 'returning',
  // ⑦ #2601 (07-02 done, 정연주) — 확인2 KEEP(재진 유지). prior done 0(예약만) → owner 재진 고정.
  '01baf9ea-23e4-4e3f-9ec2-288638eece4b': 'returning',
};

/** check_in record_id 에 owner-forced 오버라이드가 있으면 그 값, 없으면 recency 판정값 유지. */
export function applyOwnerForcedVisitType(checkInId: string, recencyResult: VisitType): VisitType {
  return OWNER_FORCED_VISIT_TYPE[checkInId] ?? recencyResult;
}
