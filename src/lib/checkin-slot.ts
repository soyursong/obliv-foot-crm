import type { CheckIn, CheckInStatus } from './types';
import { STATUS_KO } from './status';

/**
 * T-20260601-foot-DASH-HSCROLL-CHART-LOC #3 — 현재 배정된 슬롯(방) 이름.
 *
 * 위치 기준 = 배정 슬롯 이름(check_in의 room name/label). 치료단계/칸반 컬럼이 아님.
 * 현재 status에 대응하는 room 필드를 우선 반환하고, 없으면 배정된 임의 room을 fallback.
 * 슬롯 미배정 상태(대기열 등)면 null.
 *
 * read-only — 기존 컬럼(consultation_room/treatment_room/laser_room/examination_room) 조회만.
 * 스키마 변경·비즈로직 변경 없음.
 */
function nonEmpty(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export function getAssignedSlotName(ci: CheckIn): string | null {
  switch (ci.status) {
    case 'consultation':
    case 'consult_waiting':
      return nonEmpty(ci.consultation_room);
    case 'examination':
    case 'exam_waiting':
      return nonEmpty(ci.examination_room);
    case 'treatment_waiting':
      // T-20260609-foot-WAITROOM-BADGE-STALE — 치료대기 = 아직 치료실 미입실(대기열).
      // treatment_room 컬럼에 직전 치료실 입실(preconditioning) 잔존값이 남아도
      // (Dashboard 일반 드롭 분기가 transition 시 treatment_room을 clear하지 않음)
      // 대기 단계에서는 방 배정 뱃지를 노출하지 않는다 → 잔존 오표시 제거.
      // 이미 stale된 기존 row도 status 기반 파생이라 즉시 교정됨(write-side clear 불필요).
      // cf. getCurrentLocationLabel(IN_ROOM_STATUSES) 동일 원칙.
      return null;
    case 'laser':
    case 'laser_waiting':
    case 'preconditioning':
    case 'healer_waiting':
      return nonEmpty(ci.laser_room);
    default:
      // 기타 단계(registered/payment_waiting/done 등): 배정된 방이 있으면 표시
      return (
        nonEmpty(ci.laser_room) ??
        nonEmpty(ci.treatment_room) ??
        nonEmpty(ci.consultation_room) ??
        nonEmpty(ci.examination_room)
      );
  }
}

/**
 * T-20260609-foot-CALLLIST-HEALER-POSITION item2·3 — '원장님 진료콜 명단' 현재 위치 라벨.
 *
 * 단계 인식(stage-aware). 위치 기준 = 환자의 실제 check_in.status 단계.
 *  - 대기/비입실 단계(접수중·상담대기·진료대기·치료대기·레이저대기·힐러대기·수납대기 등):
 *    단계 라벨만 반환(치료대기 → '치료대기'). **방 이름을 붙이지 않는다** →
 *    치료대기 환자가 '방배정'된 것으로 잘못 표시되던 오표시(item3)를 제거.
 *    (getAssignedSlotName은 대기 단계에서도 *_room 컬럼 잔존값을 그대로 반환 → 방배정 오표시 원인.)
 *  - 입실 단계(상담·원장실·치료실·레이저): 배정 방이 있으면 '단계 · 방이름', 없으면 단계만.
 *
 * status에서 파생 → realtime fetchCheckIns로 status가 바뀌면 위치도 즉시 갱신(item2 stale 제거).
 * read-only(기존 컬럼 조회만). 스키마·비즈로직 변경 없음.
 *
 * ⚠️ 칸반 카드(Dashboard SortableCheckInCard)는 컬럼 자체가 단계를 알려주므로 기존 방-이름
 * 배지(getAssignedSlotName)를 그대로 유지한다. 이 함수는 명단 위젯(컬럼 맥락 없음) 전용.
 */
const IN_ROOM_STATUSES: CheckInStatus[] = [
  'consultation',    // 상담실 입실
  'examination',     // 원장실 입실
  'preconditioning', // 치료실 입실
  'laser',           // 레이저실 입실
];

export function getCurrentLocationLabel(ci: CheckIn): string {
  const stage = STATUS_KO[ci.status] ?? '대기';
  if (IN_ROOM_STATUSES.includes(ci.status)) {
    const room = getAssignedSlotName(ci);
    return room ? `${stage} · ${room}` : stage;
  }
  return stage;
}
