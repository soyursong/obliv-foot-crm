// rxTooltip — 빠른처방 버튼 hover 약정보 툴팁 포맷(순수 함수, 무DB)
// T-20260609-foot-QUICKRX-HOVER-TOOLTIP-CANCEL ①
//
// useQuickRxButtonsBar 쿼리가 이미 prescription_sets.items 를 로드하므로 DB 추가호출 0.
// 버튼 hover 시 처방세트에 담긴 약 정보(약 이름/횟수/투여일/용법)를 렌더만 한다.
//
// 핵심 불변식:
//   - items 는 배열 → map(다중 약 자동 수용). 단일 약 가정 금지(QUICKRX-MULTI-DRUG 정합).
//   - 결측 필드(횟수/투여일/용법)는 줄에서 생략(빈 ' · ' 댕글링 없음).
//   - 순수 함수 — 입력 불변(렌더만), 부수효과 없음.

/** 툴팁 1줄에 필요한 최소 약 정보 형태(PrescriptionItem 부분집합) */
export interface RxTooltipItemLike {
  name?: string | null;
  /** 횟수 */
  count?: number | null;
  /** 투여일(일수) */
  days?: number | null;
  /** 용법(예: '1일 3회') */
  frequency?: string | null;
}

/** 약 1건 → 툴팁 1줄: { name, meta }. meta = 횟수 · 투여일 · 용법(있는 것만). */
export function rxItemTooltipLine(item: RxTooltipItemLike | null | undefined): {
  name: string;
  meta: string;
} {
  const name = (item?.name ?? '').trim() || '(이름 미입력)';
  const meta: string[] = [];
  if (item?.count != null && Number.isFinite(item.count)) meta.push(`${item.count}회`); // 횟수
  if (item?.days != null && Number.isFinite(item.days)) meta.push(`${item.days}일`); // 투여일
  const freq = (item?.frequency ?? '').trim();
  if (freq) meta.push(freq); // 용법
  return { name, meta: meta.join(' · ') };
}

/** 처방세트 items 배열 → 툴팁 줄 배열(다중 약). 빈 배열이면 []. */
export function rxItemsTooltipLines(
  items: RxTooltipItemLike[] | null | undefined,
): Array<{ name: string; meta: string }> {
  if (!Array.isArray(items)) return [];
  return items.map((it) => rxItemTooltipLine(it));
}

// ---------------------------------------------------------------------------
// 확정(처방완료) 인라인 요약 — T-20260609-foot-QUICKRX-DROPDOWN-LIST-REDESIGN AC-2
//   "이름 아래 처방완료 + 옆에 약물리스트 검은글씨 나열" 의 약물리스트 한 줄 포맷.
//   포맷: `{name} {frequency} * {name} {frequency} *` (다중 약 모두, items 배열 기준).
//   - frequency 결측 시 `{name} *` (댕글링 공백 없음).
//   - 단일 약 가정 금지 — items 배열 전체를 map (QUICKRX-MULTI-DRUG 정합).
//   - 순수 함수(렌더만, 부수효과 없음).
// ---------------------------------------------------------------------------
export function formatRxConfirmedSummary(
  items: RxTooltipItemLike[] | null | undefined,
): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      const name = (it?.name ?? '').trim() || '(이름 미입력)';
      const freq = (it?.frequency ?? '').trim();
      return freq ? `${name} ${freq} *` : `${name} *`;
    })
    .join(' ');
}
