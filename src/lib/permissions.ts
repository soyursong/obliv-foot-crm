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
  | 'manual_sms_send';  // T-20260606-foot-CTXMENU-SMS-SEND: 대시보드 우클릭 [문자] 수동 1:1 발송 (admin/manager 한정)

const PERM_MATRIX: Record<PermKey, UserRole[]> = {
  dashboard:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  reservations: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  customers:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  closing:      ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  stats:        ['admin', 'manager', 'director', 'part_lead'],
  register:     ['admin', 'manager'],
  messaging:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'],  // T-20260525-foot-MESSAGING-V1 + T-20260525-foot-ROLE-PERM-CUSTOM 3차: coordinator/therapist 추가
  // T-20260606-foot-CTXMENU-SMS-SEND §6 현장 확정 + planner GO: 실발송 액션은 admin/manager 한정(기본값 확정).
  manual_sms_send: ['admin', 'manager'],
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}
