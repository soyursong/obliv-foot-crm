import type { CheckInStatus, VisitType } from './types';

export const STATUS_KO: Record<CheckInStatus, string> = {
  registered: '접수',
  checklist: '체크리스트',
  exam_waiting: '진료대기',
  examination: '진료',
  consult_waiting: '상담대기',
  consultation: '상담',
  payment_waiting: '결제',
  treatment_waiting: '시술대기',
  preconditioning: '사전처치',
  laser: '레이저',
  done: '완료',
  cancelled: '취소',
};

export const NEW_PATIENT_STAGES: CheckInStatus[] = [
  'registered',
  'checklist',
  'exam_waiting',
  'examination',
  'consult_waiting',
  'consultation',
  'payment_waiting',
  'treatment_waiting',
  'preconditioning',
  'laser',
  'done',
];

export const RETURNING_PATIENT_STAGES: CheckInStatus[] = [
  'registered',
  'treatment_waiting',
  'preconditioning',
  'laser',
  'done',
];

export function stagesFor(visitType: VisitType): CheckInStatus[] {
  return visitType === 'new' ? NEW_PATIENT_STAGES : RETURNING_PATIENT_STAGES;
}

export const VISIT_TYPE_KO: Record<VisitType, string> = {
  new: '신규',
  returning: '재진',
  experience: '체험',
};

/** 상태별 배지 색상 (Tailwind classes) — 대기실·일일이력 등 공통 사용 */
export const STATUS_COLOR: Record<CheckInStatus, string> = {
  registered: 'bg-gray-100 text-gray-700',
  checklist: 'bg-yellow-100 text-yellow-800',
  exam_waiting: 'bg-blue-100 text-blue-800',
  examination: 'bg-blue-500 text-white',
  consult_waiting: 'bg-indigo-100 text-indigo-800',
  consultation: 'bg-indigo-500 text-white',
  payment_waiting: 'bg-amber-100 text-amber-800',
  treatment_waiting: 'bg-teal-100 text-teal-800',
  preconditioning: 'bg-teal-400 text-white',
  laser: 'bg-emerald-500 text-white',
  done: 'bg-gray-200 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
};

/** 방문유형별 배지 색상 */
export const VISIT_TYPE_COLOR: Record<VisitType, string> = {
  new: 'bg-teal-100 text-teal-700',
  returning: 'bg-emerald-100 text-emerald-700',
  experience: 'bg-amber-100 text-amber-700',
};

/** 호출/진행 중 상태 (대기실 화면에서 "진행 중" 그룹으로 표시) */
export const CALLED_STATUSES: CheckInStatus[] = [
  'examination',
  'consultation',
  'laser',
  'preconditioning',
];
