import type { CheckInStatus, StaffRole, StatusFlag, UserRole, VisitType } from './types';

export const STATUS_KO: Record<CheckInStatus, string> = {
  registered: '접수',
  receiving: '접수중',
  consult_waiting: '상담대기',
  consultation: '상담',
  exam_waiting: '진료대기',
  examination: '원장실',
  treatment_waiting: '치료대기',
  preconditioning: '치료실',
  laser_waiting: '레이저대기',
  healer_waiting: '힐러대기',
  laser: '레이저',
  payment_waiting: '수납대기',
  done: '완료',
  cancelled: '취소',
  checklist: '체크리스트', // deprecated
};

// ── 신규 환자 11단계 (4/30 대표 확정: 선상담 → 선진료 → 관리 → 레이저 → 수납)
export const NEW_PATIENT_STAGES: CheckInStatus[] = [
  'registered',          // 예약/접수
  'consult_waiting',     // 상담대기
  'consultation',        // 상담
  'exam_waiting',        // 진료대기
  'examination',         // 원장실
  'treatment_waiting',   // 치료대기
  'preconditioning',     // 치료실
  'laser_waiting',       // 레이저대기
  'healer_waiting',      // 힐러대기
  'laser',               // 레이저
  'payment_waiting',     // 수납대기
  'done',                // 완료
];

// ── 재진 환자 6단계 (치료대기부터 시작)
export const RETURNING_PATIENT_STAGES: CheckInStatus[] = [
  'treatment_waiting',   // 치료대기
  'preconditioning',     // 치료실
  'laser_waiting',       // 레이저대기
  'healer_waiting',      // 힐러대기
  'laser',               // 레이저
  'payment_waiting',     // 수납대기
  'done',                // 완료
];

// ── 체험 환자 (초진 동선과 동일)
export const EXPERIENCE_PATIENT_STAGES: CheckInStatus[] = NEW_PATIENT_STAGES;

export function stagesFor(visitType: VisitType): CheckInStatus[] {
  if (visitType === 'returning') return RETURNING_PATIENT_STAGES;
  return NEW_PATIENT_STAGES; // 'new' | 'experience'
}

export const VISIT_TYPE_KO: Record<VisitType, string> = {
  new: '초진',
  returning: '재진',
  experience: '예약없이 방문',
};

/** 상태별 배지 색상 (Tailwind classes) — 대기실·일일이력 등 공통 사용 */
export const STATUS_COLOR: Record<CheckInStatus, string> = {
  registered: 'bg-gray-100 text-gray-700',
  receiving: 'bg-slate-100 text-slate-700',
  consult_waiting: 'bg-indigo-100 text-indigo-800',
  consultation: 'bg-indigo-500 text-white',
  exam_waiting: 'bg-blue-100 text-blue-800',
  examination: 'bg-blue-500 text-white',
  treatment_waiting: 'bg-teal-100 text-teal-800',
  preconditioning: 'bg-teal-400 text-white',
  laser_waiting: 'bg-rose-100 text-rose-700',
  healer_waiting: 'bg-violet-100 text-violet-700',
  laser: 'bg-emerald-500 text-white',
  payment_waiting: 'bg-amber-100 text-amber-800',
  done: 'bg-gray-200 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
  checklist: 'bg-yellow-100 text-yellow-800', // deprecated
};

/** 방문유형별 배지 색상 — 초진(파란) / 재진(초록) / 체험(amber, 배지 미표시) */
export const VISIT_TYPE_COLOR: Record<VisitType, string> = {
  new: 'bg-blue-100 text-blue-700',
  returning: 'bg-emerald-100 text-emerald-700',
  experience: 'bg-amber-100 text-amber-700',
};

/** 호출/진행 중 상태 (대기실 화면에서 "진행 중" 그룹으로 표시) */
export const CALLED_STATUSES: CheckInStatus[] = [
  'examination',
  'consultation',
  'preconditioning',
  'laser',
];

/** 직원 직책 한글 라벨 (staff 테이블 role) */
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  director: '원장',
  consultant: '상담실장',
  coordinator: '코디네이터',
  therapist: '치료사',
  technician: '장비명', // AC-11 T-20260515-foot-SPACE-ASSIGN-REVAMP: 관리사→장비명
};

/** 직원 직책 표시 순서 */
export const STAFF_ROLE_ORDER: StaffRole[] = [
  'director',
  'consultant',
  'coordinator',
  'therapist',
  'technician',
];

/**
 * 직원 역할별 이름 칩 색상 (bg + text + border) — T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR.
 * 인수인계 "오늘 출근 명단" 칩 배경을 역할별로 구분한다.
 * handover.ts PART_BADGE_CLASS 패턴 그대로 정적 매핑(JIT purge 안전, 동적 클래스 금지).
 *   상담(consultant) → 하늘 / 코디(coordinator) → 노랑 / 치료(therapist) → 초록
 *   그 외 역할(director·technician 등) → 중립 fallback.
 */
export const STAFF_ROLE_CARD_CLASS: Record<string, string> = {
  consultant: 'bg-sky-100 text-sky-800 border-sky-300',
  coordinator: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  therapist: 'bg-green-100 text-green-800 border-green-300',
};

/** 역할별 이름 칩 클래스 조회 (미매칭 역할 → 중립색 fallback) */
export function staffRoleCardClass(role: string): string {
  return STAFF_ROLE_CARD_CLASS[role] ?? 'bg-slate-100 text-slate-700 border-slate-300';
}

/** 계정 역할 한글 라벨 (user_profiles role — StaffRole 상위집합) */
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  admin: '관리자',
  manager: '매니저',
  director: '원장',
  part_lead: '파트장',
  consultant: '상담실장',
  coordinator: '코디네이터',
  therapist: '치료사',
  technician: '장비명', // AC-11 T-20260515-foot-SPACE-ASSIGN-REVAMP
  tm: 'TM',
  staff: '스태프',
};

/** 역할 라벨 조회 (DB string → 한글, 미매칭 시 원문 반환) */
export function roleLabel(role: string): string {
  return (USER_ROLE_LABEL as Record<string, string>)[role] ?? role;
}

// ── 상태 플래그 (T-20260502-foot-STATUS-COLOR-FLAG) ───────────────────────────

/** 9가지 상태 플래그 목록 (메뉴 표시 순서) */
export const STATUS_FLAGS: StatusFlag[] = [
  'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'dark_gray',
];

/** 플래그 한글 메뉴명 */
export const STATUS_FLAG_LABEL: Record<StatusFlag, string> = {
  white:     '정상',
  red:       '취소/부도',
  orange:    'CP(데스크)',
  yellow:    'HL',
  green:     '선체험',
  blue:      'CP(치료실)',
  purple:    '진료필요',
  pink:      '진료완료',
  brown:     '후상담',
  dark_gray: '수납완료',
};

/** 플래그 동그라미 아이콘 색상 (Tailwind) */
export const STATUS_FLAG_DOT: Record<StatusFlag, string> = {
  white:     'bg-white border border-gray-300',
  red:       'bg-red-500',
  orange:    'bg-orange-400',
  yellow:    'bg-yellow-400',
  green:     'bg-green-500',
  blue:      'bg-blue-500',
  purple:    'bg-purple-500',
  pink:      'bg-pink-400',
  brown:     'bg-amber-800',
  dark_gray: 'bg-gray-600',
};

/** 플래그별 카드 배경+테두리 색상 (Tailwind). white/null → 기본 흰색 */
export const STATUS_FLAG_CARD_BG: Record<StatusFlag, string> = {
  white:     '',
  red:       'bg-red-50 border-red-300',
  orange:    'bg-orange-50 border-orange-300',
  yellow:    'bg-yellow-50 border-yellow-300',
  green:     'bg-green-50 border-green-300',
  blue:      'bg-blue-50 border-blue-300',
  purple:    'bg-purple-50 border-purple-300',
  pink:      'bg-pink-50 border-pink-300',
  brown:     'bg-amber-50 border-amber-800',
  dark_gray: 'bg-gray-200 border-gray-400',
};

/** 결제 수단 한글 라벨 */
export const METHOD_KO: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  // T-20260524-foot-PKG-LABEL-AMOUNT AC-3: 기존 레코드도 "패키지"로 표시 (DB value 'membership' 유지)
  membership: '패키지',
};
