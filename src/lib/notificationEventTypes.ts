/**
 * 예약 자동발송 reserved event_type — SSOT.
 * AdminSettings ③ 템플릿 관리 · SendSmsDialog(대시보드 [문자]) 공용.
 *
 * reserved 4종은 시스템 자동발송 슬러그(이름·삭제 불가). 그 외 event_type 은
 * 사용자 정의(custom) 템플릿이며 자유 추가/수정/삭제(soft-delete) 대상.
 *   (T-20260609-foot-MSG-TEMPLATE-CRUD)
 */
export const RESERVED_EVENT_TYPES = [
  'resv_confirm',
  'resv_reminder_d1',
  'resv_reminder_morning',
  'noshow',
] as const;

export type ReservedEventType = (typeof RESERVED_EVENT_TYPES)[number];

/** event_type 이 시스템 예약 슬러그인가 (= 자동발송용, 삭제 불가). */
export const isReservedEventType = (et: string): boolean =>
  (RESERVED_EVENT_TYPES as readonly string[]).includes(et);
