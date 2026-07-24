/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — freeze 대상셋 (SSOT, 공용 모듈)
 *
 * 인벤토리(READ-ONLY) 결과로 확정된 대상셋. Cross-CRM Data-Correction 백필 SOP:
 *   - 단일 count 아님, row 전량 enumerate + freeze (UUID 명시)
 *   - 멱등성 사전조회로 기존재 5건 제외 → 실 백필 대상 = 3건
 *
 * ⚠ seller 결정: 김규리 staff 2행(admin d26717cb / therapist 3a0c6774) 중 therapist(3a0c6774)
 *   잠정 채택 — DA/planner CONSULT 확정 전 apply 금지(seller_pending=true).
 */

// 풋화장품 service SSOT
export const SVC = {
  CTB: { id: 'e17ba3a3-4842-4097-87bc-0778a64d2755', name: 'Care Toe Band (CTB)', price: 15000 },
  SHAMPOO: { id: '89095450-223f-4863-89a9-c7f32f62809d', name: '풋샴푸 (200ml)', price: 42000 },
};

// staff SSOT (UUID = staff.id, PII/secret 아님 — gitleaks generic-api-key 오탐 억제)
export const STAFF = {
  임별: '7c24cd3b-8e52-4c72-9652-e14f75151514',       // therapist, active // gitleaks:allow
  조선미: '8d244cee-partial',                          // (기존재건 seller — 백필 대상 아님)
  김규리_therapist: '3a0c6774-2bd9-4018-bb38-ef6fab75d04b', // therapist (잠정 채택) // gitleaks:allow
  김규리_admin: 'd26717cb-2088-4cde-84d0-8fcd98367bbf',     // admin (미채택) // gitleaks:allow
};

/**
 * 실 백필 대상 = 3건 (멱등성 사전조회로 기존재 5건 제외).
 * 각 대상은 해당일 기존 check_ins 에 화장품 라인 append (parent check_in 신규생성 없음).
 */
export const BACKFILL_TARGETS = [
  {
    n: 3, name: '김정숙', chart: 'F-4872', sale_date: '2026-07-18',
    customer_id: 'f98676b2-2bbe-4050-ac5b-803c41e28e55',
    check_in_id: 'f6ca21d1-a672-4cd4-b407-588e5940c327',
    service: SVC.SHAMPOO, seller_staff_id: STAFF.임별, seller_name: '임별', seller_pending: false,
  },
  {
    n: 5, name: '이영수', chart: 'F-4550', sale_date: '2026-07-18',
    customer_id: 'b3b7eac9-5974-4056-9fa5-1f174be3c31a',
    check_in_id: '85766c3b-88ed-4998-b636-a103fc3aed7e',
    service: SVC.CTB, seller_staff_id: STAFF.김규리_therapist, seller_name: '김규리(therapist)', seller_pending: true,
  },
  {
    n: 6, name: '김미성', chart: 'F-5016', sale_date: '2026-07-22',
    customer_id: 'e4abf027-9e67-4af8-962b-502d80ad5ca1',
    check_in_id: '39a3361f-7887-4d04-8032-ed041e8169da',
    service: SVC.CTB, seller_staff_id: STAFF.김규리_therapist, seller_name: '김규리(therapist)', seller_pending: true,
  },
];

// 기존재(멱등 제외) — 이미 check_in_services 에 존재, seller_staff_id=NULL (therapist 폴백 집계중)
export const ALREADY_PRESENT = [
  { n: 1, name: '허유희(DB)/하유희(ticket)', chart: 'F-4696', date: '2026-07-21', fallback_therapist: '8d244cee(조선미)', fallback_matches_seller: true },
  { n: 2, name: '황보경서(DB)/황보경시(ticket)', chart: 'F-4582', date: '2026-07-15', fallback_therapist: '7c24cd3b(임별)', fallback_matches_seller: true },
  { n: 4, name: '이동권', chart: 'F-4923', date: '2026-07-21', fallback_therapist: '8d244cee(조선미)', fallback_matches_seller: true },
  { n: 7, name: '백연재', chart: 'F-4906', date: '2026-07-22', fallback_therapist: '3a0c6774(김규리 therapist)', fallback_matches_seller: true },
  { n: 8, name: '김현수', chart: 'F-4789', date: '2026-07-23', fallback_therapist: '8c21c9ab(최다혜, inactive)', fallback_matches_seller: false /* ticket seller=김규리 ≠ 폴백 최다혜 → 현재 오귀속 */ },
];
