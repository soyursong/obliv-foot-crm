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
  // T-20260615-foot-THEME-MONO-REFINE-3AREA AC3: 치료사 part 색을 teal→green 으로 정정.
  // 부모 THEME-MONOCHROME-RECOLOR 가 teal-* 전역을 warm-monochrome(brown/olive) 램프로 스윕하면서
  // teal 기반이던 치료사 의미색까지 brown 으로 침범. 출근자 칩(staffRoleCardClass.therapist=green)과
  // 어긋남 → green 계열로 통일(녹색 원복). green/emerald 는 부모가 의미색 carve-out 으로 미스윕.
  { code: 'therapist', label: '치료사', color: 'green' },
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
  // T-20260615-foot-THEME-MONO-REFINE-3AREA AC3: teal→green (출근자 칩 green 정합 + brown 침범 정정)
  therapist: 'bg-green-100 text-green-700',
};

export function partBadgeClass(code: string): string {
  return PART_BADGE_CLASS[code] ?? 'bg-slate-100 text-slate-700';
}

/**
 * 파트 박스(인수인계 카드 섹션 컨테이너) tailwind 클래스 (bg + border).
 * T-20260630-foot-HANDOVER-BOX-COMPACT-MONO: 김주연 총괄(동일 reporter) 자기-override.
 *   직전 T-20260609-foot-HANDOVER-PARTBOX-COLOR(박스 배경 파트색 rose/amber/teal/indigo)을
 *   policy_superseded → 전 파트 동일 모노톤(중립 단색)으로 회귀. 박스 배경/테두리에서
 *   파트 색 구분을 제거하고, 파트 색 구분자는 상단 배지(PART_BADGE_CLASS)로 단일화.
 *   → PART_BADGE_CLASS / NAMECARD 이름칩 색은 불변(범위 밖).
 * 모노톤 단색: bg-slate-50 + border-slate-200 (배지·메모·체크리스트 텍스트 대비 유지, AC4).
 * 정적 단일 클래스라 Tailwind JIT purge 안전 + 동적 클래스 없음.
 */
export const PART_BOX_MONO_CLASS = 'bg-slate-50 border-slate-200';

export function partBoxClass(_code: string): string {
  // 모든 파트 동일 모노톤(파트별 분기 제거). _code 시그니처는 호출부 호환 위해 유지.
  return PART_BOX_MONO_CLASS;
}

export type CalendarView = 'month' | 'week' | 'day';
