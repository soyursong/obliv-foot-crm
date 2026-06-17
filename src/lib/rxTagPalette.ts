// rxTagPalette — 묶음처방(prescription_sets) 태그 색상 canonical 팔레트 (FE-enforced enum, SSOT)
// T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER (초안 7색) → T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL (10색 어두운톤)
//
// data-architect CONSULT GO(MSG-20260615-005324-wrkc) Q2 (a): tag_color 는 표지(presentation) 토큰.
//   DB CHECK 미부여 → canonical 팔레트는 여기(FE)에서 강제. hex 자유저장 금지(파편화 방지).
//   저장형 = tailwind 토큰명(slate/teal/...). 렌더 시 이 맵으로 명시적 class 문자열 해석.
//   ⚠ tailwind JIT 는 동적 문자열(`bg-${x}-700`)을 못 본다 → 반드시 리터럴 class 로 명시(아래 chip).
//
// T-20260617 OVERHAUL gate#4 (planner draft 승인, MSG-20260617-203322-i7wc):
//   문지은 대표원장: "색상 지금보다 더 다양하게, 10가지 정도, 눈이 피로하지 않은 어두운 톤."
//   → 10색 = slate/stone/red/orange/amber/emerald/teal/sky/indigo/fuchsia (*-700/800 base).
//   chip = 어두운 라운드박스(bg-{c}-700 + text-{c}-50 + border-{c}-800) — 라운드박스 안에 이름(흰톤 글씨).
//   (reporter 스크린샷 시각확인=review 단계 §5-3, 톤 미세조정 그때. 10 hue 세트는 확정.)

export const RX_TAG_COLORS = [
  { value: 'slate',   label: '회색',   dot: 'bg-slate-700',   chip: 'bg-slate-700 text-slate-50 border-slate-800' },
  { value: 'stone',   label: '모래',   dot: 'bg-stone-700',   chip: 'bg-stone-700 text-stone-50 border-stone-800' },
  { value: 'red',     label: '빨강',   dot: 'bg-red-700',     chip: 'bg-red-700 text-red-50 border-red-800' },
  { value: 'orange',  label: '주황',   dot: 'bg-orange-700',  chip: 'bg-orange-700 text-orange-50 border-orange-800' },
  { value: 'amber',   label: '호박',   dot: 'bg-amber-700',   chip: 'bg-amber-700 text-amber-50 border-amber-800' },
  { value: 'emerald', label: '초록',   dot: 'bg-emerald-700', chip: 'bg-emerald-700 text-emerald-50 border-emerald-800' },
  { value: 'teal',    label: '청록',   dot: 'bg-teal-700',    chip: 'bg-teal-700 text-teal-50 border-teal-800' },
  { value: 'sky',     label: '하늘',   dot: 'bg-sky-700',     chip: 'bg-sky-700 text-sky-50 border-sky-800' },
  { value: 'indigo',  label: '남색',   dot: 'bg-indigo-700',  chip: 'bg-indigo-700 text-indigo-50 border-indigo-800' },
  { value: 'fuchsia', label: '자홍',   dot: 'bg-fuchsia-700', chip: 'bg-fuchsia-700 text-fuchsia-50 border-fuchsia-800' },
] as const;

export type RxTagColor = typeof RX_TAG_COLORS[number]['value'];

export const DEFAULT_RX_TAG_COLOR: RxTagColor = 'slate';

// 레거시 토큰 호환 — TAG-QUICKTRIGGER 7색(초안) 중 본 팔레트에서 빠지거나 톤이 바뀐 토큰을
//   기존 저장값 그대로 렌더하기 위한 어두운톤 매핑(회귀 0). 신규 선택지에는 노출 안 함(picker=RX_TAG_COLORS).
const LEGACY_CHIP: Record<string, string> = {
  purple: 'bg-purple-700 text-purple-50 border-purple-800',
  rose:   'bg-rose-700 text-rose-50 border-rose-800',
};
const LEGACY_DOT: Record<string, string> = {
  purple: 'bg-purple-700',
  rose:   'bg-rose-700',
};

const FALLBACK_CHIP = 'bg-slate-700 text-slate-50 border-slate-800';
const FALLBACK_DOT = 'bg-slate-700';

/** 저장된 tag_color 토큰 → 칩(배경+글씨+테두리) class. 미지(레거시/오타) 값은 slate 폴백(렌더 안전). */
export function tagChipClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_CHIP;
  return (
    RX_TAG_COLORS.find((c) => c.value === color)?.chip ??
    LEGACY_CHIP[color] ??
    FALLBACK_CHIP
  );
}

/** 저장된 tag_color 토큰 → 점(dot) class. */
export function tagDotClass(color: string | null | undefined): string {
  if (!color) return FALLBACK_DOT;
  return (
    RX_TAG_COLORS.find((c) => c.value === color)?.dot ??
    LEGACY_DOT[color] ??
    FALLBACK_DOT
  );
}

/** canonical 팔레트 토큰인지 검증(FE enforce). */
export function isValidTagColor(color: string | null | undefined): color is RxTagColor {
  return !!color && RX_TAG_COLORS.some((c) => c.value === color);
}
