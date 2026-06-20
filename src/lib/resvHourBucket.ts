// T-20260620-foot-RESVCAL-HOURLY-GROUPING: 예약 캘린더 정시(HH:00) 단위 그룹핑 — 표시 레이어 전용 유틸.
//   김주연 총괄: "10시/11시/12시 등 시간단위로 묶자. 10시반 예약 고객도 10시 타임으로. 최대한 짧아지게."
//
//   ⚠️ 데이터 불변 원칙: 실제 예약 저장시각(예: 10:30)·예약 입력 슬롯 로직(slot_interval·slotMaxFor·
//   createReservationCanonical)은 무변경. 본 모듈은 "어떤 30분 슬롯들이 한 정시 그룹으로 묶이는가"의
//   display 매핑만 책임진다. 카드 클릭/상세/저장에는 항상 실제 reservation_time 을 그대로 사용한다.
//
//   RESVCAL-COMPACT-HALFSIZE(셀/카드 px 압축)와 동일 압축 목표·다른 축(additive). 본건은 그 위에
//   "30분 라인 제거 + 정시 버킷" 시간축 압축을 얹는다.

/** 시간 문자열('HH:mm' 또는 'HH:mm:ss')의 정시 키('HH') 추출. */
export function toHourKey(time: string): string {
  return time.slice(0, 2);
}

/** 정시 키('HH') → 표시 라벨('HH:00'). 반시(HH:30) 슬롯도 이 라벨 그룹에 흡수된다. */
export function hourLabel(hour: string): string {
  return `${hour}:00`;
}

/** 한 정시 그룹. memberSlots = 이 그룹에 흡수되는 실제 30분(또는 slot_interval) 슬롯들(오름차순). */
export interface HourBucket {
  /** 정시 키 'HH' (그룹 식별·정렬용) */
  hour: string;
  /** 시간축 표시 라벨 'HH:00' (data-slot-time / testid 토큰) */
  label: string;
  /** 이 정시 그룹에 묶이는 실제 슬롯 키('HH:mm') 목록 — 흡수 대상(예: ['10:00','10:30']) */
  memberSlots: string[];
}

/**
 * 그리드 시각 목록(gridSlots, 예: ['09:00','09:30','10:00',...])을 정시(HH) 그룹으로 묶는다.
 * - slot_interval 이 이미 60분이면 각 그룹 memberSlots 는 1개 → 사실상 no-op(안전).
 * - 영업시간이 09:30 시작이면 '09' 그룹 memberSlots=['09:30'], 라벨은 '09:00'(9시 그룹).
 * - 반환은 정시 오름차순. 예약 누락 0: gridSlots 의 모든 슬롯이 정확히 한 그룹에 1회 귀속.
 */
export function buildHourBuckets(gridSlots: string[]): HourBucket[] {
  const map = new Map<string, string[]>();
  for (const t of gridSlots) {
    const h = toHourKey(t);
    const arr = map.get(h);
    if (arr) arr.push(t);
    else map.set(h, [t]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([hour, memberSlots]) => ({
      hour,
      label: hourLabel(hour),
      memberSlots: [...memberSlots].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }));
}
