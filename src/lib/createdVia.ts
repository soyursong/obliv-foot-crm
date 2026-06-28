// T-20260628-crm-RESV-CREATED-VIA-FILL §2 (dev-foot, co_assignee)
// 예약 생성경로(reservations.created_via) canonical SSOT — crm(롱레)과 단일 enum 공유.
// enum v1.1 9값 (cross_crm_data_contract §4-5, scalp=레퍼런스). ★별칭 금지: admin/phone/walk-in 직접 사용 X.
//   admin → manual, phone → inbound, walk-in → walkin (canonical 별칭만).

export const RESERVATION_CREATED_VIA = {
  /** 어드민/직원 수기 신규등록 (캘린더 직접예약·복사·차트 미니예약 등 FE 어드민 동선) */
  MANUAL: 'manual',
  /** 도파민 push (reservation-ingest-from-dopamine) */
  DOPAMINE: 'dopamine',
  /** AICC 인입 */
  AICC: 'aicc',
  /** 네이버 연동 */
  NAVER: 'naver',
  /** 메타 연동 */
  META: 'meta',
  /** 전화 인입 (인바운드 콜) */
  INBOUND: 'inbound',
  /** 셀프북 short_link 경유 (source_system NULL) */
  SELFBOOK: 'selfbook',
  /** 카카오 연동 */
  KAKAO: 'kakao',
  /** 현장 물리동선 진입 (워크인) */
  WALKIN: 'walkin',
} as const;

export type ReservationCreatedVia =
  (typeof RESERVATION_CREATED_VIA)[keyof typeof RESERVATION_CREATED_VIA];

/** CHECK constraint와 동기되는 9값 집합 (DB: reservations_created_via_check) */
export const RESERVATION_CREATED_VIA_VALUES: readonly ReservationCreatedVia[] =
  Object.values(RESERVATION_CREATED_VIA);
