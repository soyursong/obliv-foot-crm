// T-20260525-foot-MESSAGING-V1: 풋센터 권한 매트릭스
// 메시지 설정: T-20260611-foot-MSGSETTINGS-STAFF-ACCESS 로 전직원(8역할, tm 제외) 개방

export type UserRole =
  | 'admin'
  | 'manager'
  | 'director'      // 원장
  | 'consultant'
  | 'coordinator'
  | 'therapist'
  | 'part_lead'
  | 'staff'
  | string;

export type PermKey =
  | 'dashboard'
  | 'reservations'
  | 'customers'
  | 'closing'
  | 'stats'
  | 'register'
  | 'messaging'      // T-20260525-foot-MESSAGING-V1: 통합 설정 > 메시지 → T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: 전직원(8역할) 개방, tm 제외
  | 'manual_sms_send'   // T-20260606-foot-CTXMENU-SMS-SEND: 대시보드 우클릭 [문자] 수동 1:1 발송 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원 확대
  | 'customer_export';  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 고객 리스트 내보내기(CSV). PII(전화·생년월일) 포함 → admin/manager 한정.

// T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원(8역할) 집합 SSOT.
// FE PERM_MATRIX.manual_sms_send 와 EF send-notification allowedRoles(manual_send) 가
// 동일 집합이어야 함(AC-5 role 패리티). EF는 Deno 환경이라 import 불가 → 동일 배열을 명시 복제.
export const ALL_STAFF_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff',
];

// T-20260610-foot-STAFF-ROLE-TM-ADD AC6 (박민지 팀장 C안): TM → dashboard/reservations/customers/stats 만 허용.
//   ⚠️ ALL_STAFF_ROLES 에는 tm 을 넣지 않는다 — ALL_STAFF_ROLES 는 manual_sms_send 의 EF(send-notification)
//   allowedRoles 와 role 패리티를 이루는 SSOT 이고, tm 은 SMS 발송 권한(AC6 미포함, 임의 권한 부여 금지)이
//   없어야 한다. 따라서 tm 은 아래 4개 키에만 명시적으로 추가한다(설정/일마감/메시지/매출 등 미명시 메뉴 차단 = 최소권한).
const PERM_MATRIX: Record<PermKey, UserRole[]> = {
  dashboard:    [...ALL_STAFF_ROLES, 'tm'],
  reservations: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'tm'],
  customers:    [...ALL_STAFF_ROLES, 'tm'],
  // T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN(policy_correction_jnz7 — 김주연 총괄 직접 정정): 일마감=직원 업무(daily closing workflow, /closing Closing.tsx → daily_closings/closing_manual). 전직원(8역할, tm 제외) OPEN.
  //   ★이전 값(coordinator/therapist 회수)은 '일마감'을 '매출집계'로 오분류 → 정정. 매출집계(실장별·치료사별 성과)는 별도 /sales(payments 직접쿼리, PERM 없음·route admin/manager EXCL) — 이 키와 무관.★
  //   ⚠️ AdminLayout nav + App.tsx route 와 3-gate 동일 집합 SSOT(한쪽만 바꾸면 NAV-BOUNCE). ★tm 제외★(STAFF-ROLE-TM-ADD 최소권한) → ALL_STAFF_ROLES 재사용으로 구조 보장.
  closing:      [...ALL_STAFF_ROLES],
  stats:        ['admin', 'manager', 'director', 'part_lead', 'tm'],
  register:     ['admin', 'manager'],
  // T-20260525-foot-MESSAGING-V1 + ROLE-PERM-CUSTOM 3차(coordinator/therapist) → T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: part_lead/staff 추가 = 전직원(8역할).
  //   ★tm 제외★: 박민지 팀장 C안(AC6, STAFF-ROLE-TM-ADD) tm=4메뉴 최소권한 고정 → messaging 미포함. ALL_STAFF_ROLES(tm 미포함) 재사용으로 구조적 보장.
  //   ⚠️ App.tsx settings RoleGuard 와 동일 집합 SSOT — 한쪽만 바꾸지 말 것.
  messaging:    [...ALL_STAFF_ROLES],
  // T-20260606-foot-CTXMENU-SMS-SEND §6 admin/manager 한정 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 김주연 총괄 re-scope("전직원 권한 풀어줘") 전직원 확대(supersede).
  // tm 제외: AC6(STAFF-ROLE-TM-ADD) 미포함 + EF send-notification allowedRoles 패리티 유지.
  manual_sms_send: [...ALL_STAFF_ROLES],
  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 고객 리스트 내보내기(CSV).
  //   내보내기 컬럼에 전화·생년월일 등 PII 포함 → 최소권한 원칙으로 admin/manager 한정(노출·실행 동시 게이팅).
  //   ★rrn(주민번호)은 어떤 권한이든 export 컬럼에서 영구 제외(customerCsv.ts 헤더에 부재).★
  customer_export: ['admin', 'manager'],
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}
