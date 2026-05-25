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
  | 'messaging';  // T-20260525-foot-MESSAGING-V1: 통합 설정 > 메시지 (admin/manager/director 전용)

const PERM_MATRIX: Record<PermKey, UserRole[]> = {
  dashboard:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  reservations: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  customers:    ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'],
  closing:      ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead'],
  stats:        ['admin', 'manager', 'director', 'part_lead'],
  register:     ['admin', 'manager'],
  messaging:    ['admin', 'manager', 'director'],  // T-20260525-foot-MESSAGING-V1
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}
