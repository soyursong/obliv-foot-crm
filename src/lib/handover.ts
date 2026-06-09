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

/**
 * AC-1: 공통 / 상담실장 / 코디 / 치료사 4파트. code 는 DB part_code 에 저장.
 * '공통'(T-20260606-foot-HANDOVER-PART-COMMON) = 특정 역할에 속하지 않고 전 파트
 *   공통으로 전달할 인수인계용 작성 파트. 상담실장/코디/치료사와 동급의 작성 가능 파트다.
 *   '전체'(partFilter='all') 탭 = 통합 합산 뷰 → 공통 글도 자동 포함(별도 코드 불필요).
 *   part_code 는 DB text 컬럼(CHECK constraint 없음)이라 이 배열만 늘리면 됨(db_change 없음).
 *   배치: '전체(통합)' 다음 = 맨 앞(AC-5, 첨부 이미지 미확인 시 fallback).
 */
export const PART_OPTIONS: PartOption[] = [
  { code: '공통', label: '공통', color: 'indigo' },
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
  '공통': 'bg-indigo-100 text-indigo-700',
  consultant_lead: 'bg-rose-100 text-rose-700',
  coordinator: 'bg-amber-100 text-amber-700',
  therapist: 'bg-teal-100 text-teal-700',
};

export function partBadgeClass(code: string): string {
  return PART_BADGE_CLASS[code] ?? 'bg-slate-100 text-slate-700';
}

/**
 * 파트 박스(인수인계 카드 섹션 컨테이너) tailwind 클래스 (bg + border).
 * T-20260609-foot-HANDOVER-PARTBOX-COLOR: 배지(PART_BADGE_CLASS)에만 색이 있고
 *   박스 섹션엔 색이 없어(흰 배경) 김주연 총괄 지적 → 박스에도 파트 색 적용.
 * 색값 SSOT 재사용(신규 색 도입 금지): partColor/PART_BADGE_CLASS 와 동일 색계열
 *   (consultant_lead=rose / coordinator=amber / therapist=teal / 공통=indigo).
 * 박스는 배지보다 연한 톤(bg-*-50/border-*-200)으로 글자 가독성 유지.
 * 정적 매핑(literal class)이라 Tailwind JIT purge 안전.
 */
export const PART_BOX_CLASS: Record<string, string> = {
  '공통': 'bg-indigo-50 border-indigo-200',
  consultant_lead: 'bg-rose-50 border-rose-200',
  coordinator: 'bg-amber-50 border-amber-200',
  therapist: 'bg-teal-50 border-teal-200',
};

export function partBoxClass(code: string): string {
  return PART_BOX_CLASS[code] ?? 'bg-white border-slate-200';
}

export type CalendarView = 'month' | 'week' | 'day';
