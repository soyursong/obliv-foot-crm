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
  /** 1회 투여량(한 번에 먹는 알 수) — 예: '1' */
  dosage?: string | null;
  /** 1일 투여횟수(하루 몇 번) — 예: 3 → '3회'. 처방 횟수칸 SSOT(PrescriptionItem.count). */
  count?: number | null;
  /** 투여일(총 투약일수) */
  days?: number | null;
  /** 용법(예: '1일 3회') — count 결측 시 1일 투여횟수 파싱 폴백 소스 */
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

/**
 * frequency 자유텍스트('1일 3회')에서 1일 투여횟수 정수만 파싱(case B 폴백).
 * count(처방 횟수칸) 결측 시에만 사용. 매칭 실패/비정수면 null(빈슬롯 skip).
 */
function parseFrequencyPerDay(frequency: string | null | undefined): number | null {
  const m = (frequency ?? '').match(/(\d+)\s*회/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 확정(처방완료) 인라인 요약 — T-20260610-foot-RX-TOKEN-FORMAT (부모: QUICKRX-DROPDOWN-LIST-REDESIGN AC-2)
//   reporter(문지은) 확정: '1/3/2' = "2일동안 하루3번 1알" → dosage/1일횟수/총일수.
//   포맷: `{name} {dosage}/{count|freq파싱}/{days} *` (다중 약 모두, items 배열 기준).
//     - 앞 토큰 = 1회 투여량(dosage)
//     - 가운데 토큰 = 1일 투여횟수(count; 결측 시 frequency '(\d+)회' 파싱 — case B 폴백)
//     - 뒤 토큰 = 총 투약일수(days)
//   - AC-2 graceful 결측: 결측 토큰은 '/'  슬롯에서 skip(빈 '//' 댕글링 없음).
//     값 전무 약은 `{name} *` 유지(회귀 0).
//   - 단일 약 가정 금지 — items 배열 전체를 map (QUICKRX-MULTI-DRUG 정합).
//   - presentation only · 순수 함수(렌더만, 부수효과·DB 변경 없음).
// ---------------------------------------------------------------------------
export function formatRxConfirmedSummary(
  items: RxTooltipItemLike[] | null | undefined,
): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      const name = (it?.name ?? '').trim() || '(이름 미입력)';
      // 토큰: 1회투여량(dosage) / 1일투여횟수(count → freq파싱 폴백) / 총투약일수(days).
      //   결측 토큰은 push 안 함 → join('/') 시 빈 슬롯('//') 미노출(AC-2).
      const tokens: string[] = [];
      const dosage = (it?.dosage ?? '').trim();
      if (dosage) tokens.push(dosage);
      const perDay =
        it?.count != null && Number.isFinite(it.count)
          ? it.count
          : parseFrequencyPerDay(it?.frequency);
      if (perDay != null) tokens.push(String(perDay));
      if (it?.days != null && Number.isFinite(it.days)) tokens.push(String(it.days));
      const dose = tokens.join('/');
      return dose ? `${name} ${dose} *` : `${name} *`;
    })
    .join(' ');
}
