// T-20260710-foot-NO-HARDCODE-ENUM-GUARDRAIL
// localStorage / sessionStorage 키 + 크로스윈도우 신호 채널 이름 단일소스(SSOT).
//
// 이 값들은 (1) setItem/getItem/removeItem 과 (2) 'storage' 이벤트 비교
// (e.key === '...') 및 (3) BroadcastChannel 이름 으로 **동일 문자열이 여러 곳에서**
// 사용된다. 한 곳만 오타가 나면 저장은 되는데 수신부가 못 잡는 식의 조용한 동기화
// 파손으로 이어지고, 타입체크·빌드로는 걸리지 않는다. 그래서 단일소스로 고정한다.
// (동작 보존: 값은 기존 리터럴과 동일.)

/** 브라우저 스토리지 키 (탭 재로드/세션 지속 상태) */
export const STORAGE_KEYS = {
  /** 고객차트 저장 신호 — 다른 탭/창의 차트·체크인 시트가 재조회하도록 알림
   *  (setItem + 'storage' 이벤트 e.key 비교로 CustomerChartPage↔CheckInDetailSheet 크로스파일 공유) */
  CUSTOMER_REFRESH: 'foot_crm_customer_refresh',
  /** 대시보드 타임테이블 확대 배율 */
  DASH_ZOOM: 'foot-dash-zoom',
  /** 대시보드 그룹(칸반 열) 표시 순서 */
  DASH_GROUP_ORDER: 'foot-dash-group-order',
  /** 타임테이블 뷰모드 (시간축/치료사축) */
  TIMETABLE_VIEWMODE: 'foot-crm-timetable-viewmode',
  /** 치료사 접힘 상태 집합 */
  THERAPIST_FOLD: 'foot-crm-therapist-fold',
  /** 타임라인 접힘 여부 */
  TIMELINE_FOLDED: 'foot-crm-timeline-folded',
  /** 사이드바 접힘 여부 */
  SIDEBAR_COLLAPSED: 'foot-sidebar-collapsed',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * 크로스윈도우 신호 채널 이름. BroadcastChannel 이름 + localStorage 이벤트 키로
 * **동시 사용**되므로(채널 이름과 스토리지 키가 반드시 일치해야 함) 단일소스로 둔다.
 */
export const BROADCAST_CHANNELS = {
  /** 펜차트 저장 → 원본 창/편집 창 상호 갱신 신호 (CustomerChartPage↔PenChartTab 크로스파일) */
  PENCHART_UPDATE: 'penchart-update',
} as const;

export type BroadcastChannelName =
  (typeof BROADCAST_CHANNELS)[keyof typeof BROADCAST_CHANNELS];
