// T-20260525-foot-MESSAGING-V1: 풋센터 권한 매트릭스
// admin/manager/director 전용 메시지 설정 포함

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
  | 'messaging'      // T-20260525-foot-MESSAGING-V1: 통합 설정 > 메시지 (admin/manager/director 전용)
  | 'manual_sms_send';  // T-20260606-foot-CTXMENU-SMS-SEND: 대시보드 우클릭 [문자] 수동 1:1 발송 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원 확대

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
  closing:      ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  stats:        ['admin', 'manager', 'director', 'part_lead', 'tm'],
  register:     ['admin', 'manager'],
  messaging:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],  // T-20260525-foot-MESSAGING-V1 + T-20260525-foot-ROLE-PERM-CUSTOM 3차: coordinator/therapist 추가
  // T-20260606-foot-CTXMENU-SMS-SEND §6 admin/manager 한정 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 김주연 총괄 re-scope("전직원 권한 풀어줘") 전직원 확대(supersede).
  // tm 제외: AC6(STAFF-ROLE-TM-ADD) 미포함 + EF send-notification allowedRoles 패리티 유지.
  manual_sms_send: [...ALL_STAFF_ROLES],
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}
