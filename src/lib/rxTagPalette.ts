// rxTagPalette — 묶음처방(prescription_sets) 태그 색상 canonical 팔레트 (FE-enforced enum, SSOT)
// T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER
//
// data-architect CONSULT GO(MSG-20260615-005324-wrkc) Q2 (a): tag_color 는 표지(presentation) 토큰.
//   DB CHECK 미부여 → canonical 팔레트는 여기(FE)에서 강제. hex 자유저장 금지(파편화 방지).
//   저장형 = tailwind 토큰명(purple/teal/...). 렌더 시 이 맵으로 명시적 class 문자열 해석.
//   ⚠ tailwind JIT 는 동적 문자열(`bg-${x}-100`)을 못 본다 → 반드시 리터럴 class 로 명시(아래 chip).

export const RX_TAG_COLORS = [
  { value: 'purple',  label: '보라', dot: 'bg-purple-500',  chip: 'bg-purple-100 text-purple-800 border-purple-300' },
  { value: 'teal',    label: '청록', dot: 'bg-teal-500',    chip: 'bg-teal-100 text-teal-800 border-teal-300' },
  { value: 'rose',    label: '분홍', dot: 'bg-rose-500',    chip: 'bg-rose-100 text-rose-800 border-rose-300' },
  { value: 'amber',   label: '주황', dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800 border-amber-300' },
  { value: 'sky',     label: '하늘', dot: 'bg-sky-500',     chip: 'bg-sky-100 text-sky-800 border-sky-300' },
  { value: 'emerald', label: '초록', dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  { value: 'slate',   label: '회색', dot: 'bg-slate-500',   chip: 'bg-slate-100 text-slate-700 border-slate-300' },
] as const;

export type RxTagColor = typeof RX_TAG_COLORS[number]['value'];

export const DEFAULT_RX_TAG_COLOR: RxTagColor = 'purple';

const FALLBACK_CHIP = 'bg-slate-100 text-slate-700 border-slate-300';
const FALLBACK_DOT = 'bg-slate-400';

/** 저장된 tag_color 토큰 → 칩(배경+글씨+테두리) class. 미지(레거시/오타) 값은 slate 폴백(렌더 안전). */
export function tagChipClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_CHIP;
  return RX_TAG_COLORS.find((c) => c.value === color)?.chip ?? FALLBACK_CHIP;
}

/** 저장된 tag_color 토큰 → 점(dot) class. */
export function tagDotClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_DOT;
  return RX_TAG_COLORS.find((c) => c.value === color)?.dot ?? FALLBACK_DOT;
}

/** canonical 팔레트 토큰인지 검증(FE enforce). */
export function isValidTagColor(color: string | null | undefined): color is RxTagColor {
  return !!color && RX_TAG_COLORS.some((c) => c.value === color);
}
