/**
 * 인수인계 게시판 — T-20260605-foot-HANDOVER-BOARD
 *
 * 파트(역할) 코드는 여기서 enum 상수로 관리한다 (AC-1: 추후 증감 가능).
 * DB(handover_notes.part_code)는 text 컬럼이라 신규 파트 추가 시 이 배열만 늘리면 된다.
 */

export interface HandoverChecklistItem {
  id: string;
  handover_id: string;
  label: string;
  is_checked: boolean;
  sort_order: number;
  created_at: string;
}

export interface HandoverNote {
  id: string;
  clinic_id: string;
  part_code: string;
  target_date: string; // YYYY-MM-DD
  author_id: string | null;
  author_name: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  // 조인 결과 (비영속)
  handover_checklist_items?: HandoverChecklistItem[];
}

export interface PartOption {
  code: string;
  label: string;
  /** 캘린더 배지/탭 색상 (tailwind 클래스 키) */
  color: string;
}

/** AC-1: 상담실장 / 코디 / 치료사 3파트. code 는 DB part_code 에 저장. */
export const PART_OPTIONS: PartOption[] = [
  { code: 'consultant_lead', label: '상담실장', color: 'rose' },
  { code: 'coordinator', label: '코디', color: 'amber' },
  { code: 'therapist', label: '치료사', color: 'teal' },
];

export function partLabel(code: string): string {
  return PART_OPTIONS.find((p) => p.code === code)?.label ?? code;
}

export function partColor(code: string): string {
  return PART_OPTIONS.find((p) => p.code === code)?.color ?? 'slate';
}

/** 파트 배지 tailwind 클래스 (bg + text). 동적 클래스 안전화를 위해 정적 매핑 사용. */
export const PART_BADGE_CLASS: Record<string, string> = {
  consultant_lead: 'bg-rose-100 text-rose-700',
  coordinator: 'bg-amber-100 text-amber-700',
  therapist: 'bg-teal-100 text-teal-700',
};

export function partBadgeClass(code: string): string {
  return PART_BADGE_CLASS[code] ?? 'bg-slate-100 text-slate-700';
}

export type CalendarView = 'month' | 'week' | 'day';
