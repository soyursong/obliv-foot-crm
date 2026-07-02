// T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC1: 예약 시간대 슬롯 집계 공유 유틸.
//   RESVCAL-DISPLAY-REWORK item2 슬롯집계 로직(Reservations.tsx 의 resvKind + {n,r,h} 카운트)을
//   단일 소스로 추출 — 주간 캘린더(Reservations.tsx)와 예약상세팝업 시간대 패널이 공유.
//   ⚠️ 중복 구현 금지(planner 지시): 시간대별 초/재/힐러 카운트는 반드시 이 모듈을 통한다.

/** 예약 유형 분류 키. 힐러(healer_flag)는 visit_type 과 직교 → 우선 분류. */
export type ResvKind = 'new' | 'returning' | 'healer' | 'other';

/**
 * T-20260701-foot-RESVAXIS-HEALER-RIBBON: 리본(각질) 분류 SSOT.
 *   힐러(is_healer_intent 플래그)와 달리, 리본은 간략메모(brief_note) 텍스트의 [발각질케어] 칩으로 식별한다.
 *   초/재/힐러 유형(resvKind)과 *직교* — 재진+발각질 예약은 재진에도 리본에도 각각 잡힌다(독립 카운터).
 *   ⚠️ 중복 구현 금지: 예약격자 헤더 리본 카운트는 반드시 이 predicate 를 통한다(힐러 시맨틱과 동일 원칙).
 */
export const RIBBON_BRIEF_KEYWORD = '발각질'; // 간략메모 칩 '발각질케어' 및 자유입력 변형 포괄
/**
 * 격자 헤더 배지 '전체(full)' 라벨.
 * T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR: RESVAXIS-HEALER-RIBBON field_soak_recheck 해소 —
 *   김주연 총괄이 '리본(발각질)'로 확정 → 기본값 '발각질' → '리본(발각질)' 1줄 교체(soak recheck close).
 */
export const RIBBON_BADGE_LABEL = '리본(발각질)';

/**
 * T-20260702-foot-RESVAXIS-YAXIS-4SEG-ABBR: 세로축 4분류 축약 표기(시간칸 밑 '초-재-힐-리').
 *   전체(full) 라벨 = 초진/재진/힐러/리본(발각질). 축약(abbr) = 초/재/힐/리. 순서·정합 SSOT.
 *   ⚠️ 시간칸 헤더처럼 폭이 좁은 곳은 abbr, 여유 있는 곳(요일 헤더 등)은 full 사용.
 */
export const KIND_AXIS_LABELS = {
  /** 초진(new) */
  new: { full: '초진', abbr: '초' },
  /** 재진(returning) */
  returning: { full: '재진', abbr: '재' },
  /** 힐러(healer) */
  healer: { full: '힐러', abbr: '힐' },
  /** 리본(발각질) — 간략메모 [발각질케어] 칩 기준 */
  ribbon: { full: RIBBON_BADGE_LABEL, abbr: '리' },
} as const;

/** 간략메모(brief_note)가 리본(발각질케어) 칩인지 판정. 취소 제외 등 상위 규칙은 호출측이 적용. */
export function isRibbonBrief(brief_note?: string | null): boolean {
  return !!brief_note && brief_note.includes(RIBBON_BRIEF_KEYWORD);
}

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
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';
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

/**
 * summarizeKinds 반환 — 유효합계(n/r/h/o/total) + 상태 버킷(취소·노쇼) 별도 카운트.
 * T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW: 김주연 총괄 (A)안 확정 — '제외(excluded)'는
 *   풋센터 예약 시스템에 없는 분류 → 완전 제거. 상태 버킷은 취소·노쇼 2종만.
 *   ⚠️ 이중 산식 금지: 유효합계(n/r/h/o/total)는 종전 의미 *불변*(노쇼 포함·취소 제외) → TIMETABLE-VISITCOUNT
 *      소비자(.n/.r/.h)는 영향 없음. cancelled/noshow 는 분모 변경 없는 *순수 부가* 버킷.
 */
export interface KindSummary extends SlotKindCount {
  /** 취소(status='cancelled') 별도 버킷 — 유효합계(total)에서 *제외*된 건수. */
  cancelled: number;
  /** 노쇼(status='no_show') 별도 버킷 — 유효합계(total)에 *포함*되며 별도 노출용 카운트(parent 81행 결정: 노쇼 포함). */
  noshow: number;
}

/**
 * 일자(또는 임의 범위) 예약 목록을 시간대 무관 유형 합계로 집계.
 * - 산식 = resvKind 단일 소스 재사용(이중 산식 금지). aggregateByTimeSlot 과 동일 분류·취소제외 규칙.
 * - n=초진(new) / r=재진(returning, 비힐러) / h=힐러(HL) / o=기타(선체험 등).
 * - 표기 컨벤션(T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT, T-20260623-foot-TIMETABLE-VISITCOUNT-STATUSBAR-4ITEM 공용):
 *     초진 = n · 재진 = r + h · 재진 세부 HL = h(힐러) · PD = r(비힐러 재진).
 *   이 함수가 두 surface(예약관리 내려받기 · 통합시간표 헤더 카운트)의 단일 산식이다.
 * - 상태 버킷(cancelled/noshow): 유효합계 분모는 불변. 취소는 합계에서 빠지고 노쇼는 포함(별도 카운트만).
 * @param rows 한 일자(또는 임의 범위)의 예약 행 목록. status 'cancelled' 는 유효합계에서 제외.
 */
export function summarizeKinds(rows: Array<ResvKindInput & { status?: string | null }>): KindSummary {
  const acc: KindSummary = { n: 0, r: 0, h: 0, o: 0, total: 0, cancelled: 0, noshow: 0 };
  for (const row of rows) {
    // 취소(cancelled): 유효합계 제외 + 별도 버킷 카운트.
    if (row.status === 'cancelled') {
      acc.cancelled += 1;
      continue;
    }
    // 노쇼(noshow): 유효합계 포함(분모 불변) + 별도 버킷 카운트.
    if (row.status === 'no_show') acc.noshow += 1;
    const kind = resvKind(row);
    if (kind === 'new') acc.n += 1;
    else if (kind === 'returning') acc.r += 1;
    else if (kind === 'healer') acc.h += 1;
    else acc.o += 1;
    acc.total += 1;
  }
  return acc;
}
