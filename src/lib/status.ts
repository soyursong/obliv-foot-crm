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

export function stagesFor(visitType: VisitType): CheckInStatus[] {
  return visitType === 'new' ? NEW_PATIENT_STAGES : RETURNING_PATIENT_STAGES;
}

export const VISIT_TYPE_KO: Record<VisitType, string> = {
  new: '신규',
  returning: '재진',
  experience: '체험',
};
