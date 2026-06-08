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

const PERM_MATRIX: Record<PermKey, UserRole[]> = {
  dashboard:    [...ALL_STAFF_ROLES],
  reservations: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  customers:    [...ALL_STAFF_ROLES],
  closing:      ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  stats:        ['admin', 'manager', 'director', 'part_lead'],
  register:     ['admin', 'manager'],
  messaging:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],  // T-20260525-foot-MESSAGING-V1 + T-20260525-foot-ROLE-PERM-CUSTOM 3차: coordinator/therapist 추가
  // T-20260606-foot-CTXMENU-SMS-SEND §6 admin/manager 한정 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 김주연 총괄 re-scope("전직원 권한 풀어줘") 전직원 확대(supersede).
  manual_sms_send: [...ALL_STAFF_ROLES],
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}
