// quickRxColors — 빠른처방(quick_rx_buttons) 태그 색상 canonical 팔레트 (FE-enforced enum, SSOT)
// T-20260616-foot-RXSET-QUICKRX-UI-REFINE-5FIX (AC-4, 문지은 대표원장)
//
// 현장 요청: 빠른처방 생성 화면의 이모지/아이콘 제거 → "차분한 모노톤·튀지 않는 색상" 태그로 교체.
//   처방세트명을 선택한 색상의 라운드 태그(pill/chip) 안에 표시(예: "무좀세트" → 하늘색 태그).
//   형광·고채도 금지 → -50/-100 배경 + -700 글씨 위주의 저채도 톤만 큐레이션.
//
// 영속화(db_change=false): 신규 컬럼 없이 기존 quick_rx_buttons.icon(text) 컬럼을 색상 토큰 저장에
//   재활용한다. (아이콘 기능 자체가 제거되므로 icon 컬럼의 의미를 색상 토큰으로 전환.)
//   레거시 행은 icon 값이 'pill' 등 아이콘 식별자 → 색상 토큰과 불일치 → tagChipClass 폴백(slate)로
//   안전 렌더. 저장형 = tailwind 토큰명(sky/slate/...). 렌더 시 이 맵으로 명시적 리터럴 class 해석.
//   ⚠ tailwind JIT 는 동적 문자열(`bg-${x}-100`)을 못 본다 → 반드시 리터럴 class 로 명시(아래).

export const QUICK_RX_COLORS = [
  { value: 'sky',     label: '하늘',   dot: 'bg-sky-400',     chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'slate',   label: '슬레이트', dot: 'bg-slate-400',  chip: 'bg-slate-100 text-slate-700 border-slate-300' },
  { value: 'sage',    label: '세이지',  dot: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'stone',   label: '스톤',   dot: 'bg-stone-400',   chip: 'bg-stone-100 text-stone-700 border-stone-300' },
  { value: 'indigo',  label: '인디고',  dot: 'bg-indigo-300',  chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { value: 'rose',    label: '로즈',   dot: 'bg-rose-300',    chip: 'bg-rose-50 text-rose-700 border-rose-200' },
] as const;

export type QuickRxColor = typeof QUICK_RX_COLORS[number]['value'];

export const DEFAULT_QUICK_RX_COLOR: QuickRxColor = 'sky';

const FALLBACK_CHIP = 'bg-slate-100 text-slate-700 border-slate-300';
const FALLBACK_DOT = 'bg-slate-400';

/** 저장된 색상 토큰 → 칩(배경+글씨+테두리) class. 미지(레거시 아이콘값/오타)는 slate 폴백(렌더 안전). */
export function quickRxChipClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_CHIP;
  return QUICK_RX_COLORS.find((c) => c.value === color)?.chip ?? FALLBACK_CHIP;
}

/** 저장된 색상 토큰 → 점(dot) class. */
export function quickRxDotClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_DOT;
  return QUICK_RX_COLORS.find((c) => c.value === color)?.dot ?? FALLBACK_DOT;
}

/** canonical 팔레트 토큰인지 검증(FE enforce). 레거시 아이콘값(pill 등)은 false. */
export function isValidQuickRxColor(color: string | null | undefined): color is QuickRxColor {
  return !!color && QUICK_RX_COLORS.some((c) => c.value === color);
}

/** 레거시 아이콘 식별자/빈값을 기본 색상으로 정규화(편집 진입 시 안전 초기값). */
export function normalizeQuickRxColor(color: string | null | undefined): QuickRxColor {
  return isValidQuickRxColor(color) ? color : DEFAULT_QUICK_RX_COLOR;
}
