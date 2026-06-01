import type { CheckIn } from './types';

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
      return nonEmpty(ci.treatment_room);
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
