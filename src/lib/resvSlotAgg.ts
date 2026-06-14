// T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC1: 예약 시간대 슬롯 집계 공유 유틸.
//   RESVCAL-DISPLAY-REWORK item2 슬롯집계 로직(Reservations.tsx 의 resvKind + {n,r,h} 카운트)을
//   단일 소스로 추출 — 주간 캘린더(Reservations.tsx)와 예약상세팝업 시간대 패널이 공유.
//   ⚠️ 중복 구현 금지(planner 지시): 시간대별 초/재/힐러 카운트는 반드시 이 모듈을 통한다.

/** 예약 유형 분류 키. 힐러(healer_flag)는 visit_type 과 직교 → 우선 분류. */
export type ResvKind = 'new' | 'returning' | 'healer' | 'other';

/** 분류 입력에 필요한 최소 구조(타입 결합도 최소화).
 *  visit_type 은 string 으로 수용 — 'experience'(선체험) 등 new/returning 외 값은 'other'로 분류(원본 동작 동일).
 *  T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): is_healer_intent(영속) 추가 — 분류 SSOT. */
export interface ResvKindInput {
  /** 힐러 의도(영속) — 예약 팝업 토글/차트 차감 흐름으로 설정. 체크인 후에도 유지(분류 SSOT). */
  is_healer_intent?: boolean | null;
  /** 힐러 플래그(1회성) — 체크인 시 Dashboard HL-blink 후 소모. 레거시 호환용 fallback. */
  healer_flag?: boolean | null;
  visit_type: string;
}

/**
 * 예약 유형 분류: 힐러(is_healer_intent 영속 || healer_flag 레거시) 우선 → 초진/재진 → 기타.
 * RESVCAL-DISPLAY-REWORK item3 / Reservations.tsx resvKind 와 동일 규칙(단일 소스).
 * T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): is_healer_intent 우선 — 캘린더 직접예약·체크인 후에도
 *   힐러 분류 유지. healer_flag 는 소모형이라 단독 의존 시 체크인 후 분류 누락(=HL N 칩 미표기) 근본원인이었음.
 */
export function resvKind(r: ResvKindInput): ResvKind {
  if (r.is_healer_intent || r.healer_flag) return 'healer';
  if (r.visit_type === 'new') return 'new';
  if (r.visit_type === 'returning') return 'returning';
  return 'other';
}

/** 시간대별 유형 카운트. n=초진 / r=재진 / h=힐러 / o=기타. */
export interface SlotKindCount {
  /** 초진(new) */
  n: number;
  /** 재진(returning) */
  r: number;
  /** 힐러(healer) */
  h: number;
  /** 기타(other) */
  o: number;
  /**
   * 총건수. RESVCAL-FOLLOWUP-5FIX(nji4 superseded): 힐러(HL) 합산 포함.
   * 김주연 총괄 확정 규칙 — 총계 표기 시 초+재+힐러+기타 전부 합산.
   */
  total: number;
}

/** 집계 입력에 필요한 최소 구조. */
export interface SlotAggInput extends ResvKindInput {
  reservation_time: string; // 'HH:mm:ss' 또는 'HH:mm'
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'noshow';
}

/** 시간 문자열을 'HH:mm' 슬롯 키로 정규화. */
export function toSlotKey(time: string): string {
  return time.slice(0, 5);
}

/**
 * 특정 일자 예약 목록을 시간대(HH:mm) 슬롯별로 초/재/힐러/기타 카운트 집계.
 * - 취소(cancelled)는 제외(RESVCAL item1/2 규칙 일관).
 * - 반환은 시간 오름차순 정렬된 배열.
 * @param rows 한 일자(또는 임의 범위)의 예약 행 목록
 */
export function aggregateByTimeSlot(rows: SlotAggInput[]): Array<{ time: string; counts: SlotKindCount }> {
  const map = new Map<string, SlotKindCount>();
  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const key = toSlotKey(row.reservation_time);
    const cur = map.get(key) ?? { n: 0, r: 0, h: 0, o: 0, total: 0 };
    const kind = resvKind(row);
    if (kind === 'new') cur.n += 1;
    else if (kind === 'returning') cur.r += 1;
    else if (kind === 'healer') cur.h += 1;
    else cur.o += 1;
    cur.total += 1; // HL 합산 포함(FOLLOWUP-5FIX)
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([time, counts]) => ({ time, counts }));
}
