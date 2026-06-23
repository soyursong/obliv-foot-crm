// pastHistory.ts — 의사 진료차트 '과거력' 탭 순수 로직 (T-20260623-foot-DOCCHART-PASTHX-TAB)
//
// 환자가 미리 작성한 발건강 질문지(health_q_results.form_data) 의 medical_history(string[])·medications(string[])
// 를 읽어 과거력 라인(혈압/당뇨/고지혈증, 간질환/신질환, 항암/보행장애)을 (-/+) 로 자동 도출(prefill 초안)한다.
//
// ★ 자동 prefill 은 '초안'일 뿐 — 실장(manager) 더블체크·확정 게이트가 SSOT (티켓 AC-2/AC-3).
// ★ 매핑 라벨은 OpinionDocTab.tsx 의 HEALTHQ_AUTOCHECK_MAP 과 동일 의미를 미러링한다.
//   (런타임 결합 회피 위해 자체 보유 — 라벨 drift 는 E2E spec 의 정적 미러 가드가 잡는다.)
//   질문지 라벨(HealthQMobilePage MEDICAL_HISTORY_OPTIONS / MEDICATION_OPTIONS) 변경 시 동기화 필수.
//
// AC-1: read-only 자동 prefill. 신질환·보행장애는 현 질문지에 옵션 없음 → 항상 '-' 기본(실장 수동, §확인-2 b안).

export type PastHxState = '+' | '-';

/** 과거력 라인 키 — 라인별 (-/+) 상태 영속화 단위 (patient_past_history.lines jsonb) */
export interface PastHxLines {
  bp: PastHxState;            // 혈압
  diabetes: PastHxState;      // 당뇨
  hyperlipidemia: PastHxState; // 고지혈증
  liver: PastHxState;         // 간질환
  renal: PastHxState;         // 신질환 (질문지 소스 없음 → 수동)
  chemo: PastHxState;         // 항암
  gait: PastHxState;          // 보행장애 (질문지 소스 없음 → 수동)
}

/** 항목 라벨 + 자동 도출 가능 여부 */
export const PAST_HX_ITEMS: { key: keyof PastHxLines; label: string; autoSource: boolean }[] = [
  { key: 'bp', label: '혈압', autoSource: true },
  { key: 'diabetes', label: '당뇨', autoSource: true },
  { key: 'hyperlipidemia', label: '고지혈증', autoSource: true },
  { key: 'liver', label: '간질환', autoSource: true },
  { key: 'renal', label: '신질환', autoSource: false },
  { key: 'chemo', label: '항암', autoSource: true },
  { key: 'gait', label: '보행장애', autoSource: false },
];

export const PAST_HX_ITEM_LABEL: Record<keyof PastHxLines, string> = PAST_HX_ITEMS.reduce(
  (acc, it) => { acc[it.key] = it.label; return acc; },
  {} as Record<keyof PastHxLines, string>,
);

/**
 * 표시 그룹 — 현장 원문 포맷 미러:
 *   혈압/당뇨/고지혈증 (-/+/-)
 *   간질환/신질환 (-/-) 항암/보행장애 (+/-)
 * row[0] = 1줄, row[1] = 2줄(두 그룹을 공백으로 연결).
 */
export const PAST_HX_ROWS: (keyof PastHxLines)[][][] = [
  [['bp', 'diabetes', 'hyperlipidemia']],
  [['liver', 'renal'], ['chemo', 'gait']],
];

/** 발건강 질문지 medical_history/medications 라벨 → 과거력 라인 자동 도출 규칙.
 *  HEALTHQ_AUTOCHECK_MAP(OpinionDocTab) 의 bp_med/diabetes/hyperlipidemia/liver_disease/on_chemo 와 의미 일치. */
export const HEALTHQ_PASTHX_MAP: Partial<Record<keyof PastHxLines, { medical_history?: string[]; medications?: string[] }>> = {
  bp:             { medications: ['혈압약'] },
  diabetes:       { medical_history: ['당뇨'] },
  hyperlipidemia: { medical_history: ['고지혈증'], medications: ['콜레스테롤약'] },
  liver:          { medical_history: ['간질환'] },
  chemo:          { medications: ['항암제'] },
  // renal / gait: 현 질문지 옵션 없음 → 자동 도출 제외(항상 '-').
};

/** 전 라인 '-' 기본값 (질문지 없음/매칭 0). */
export function emptyPastHxLines(): PastHxLines {
  return { bp: '-', diabetes: '-', hyperlipidemia: '-', liver: '-', renal: '-', chemo: '-', gait: '-' };
}

function toStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/**
 * 발건강 질문지 form_data → 과거력 라인 자동 도출(초안).
 * 질문지 없음(null) → 전 라인 '-' (수동 모드, 예외 없음).
 */
export function computePastHxFromHealthQ(formData: Record<string, unknown> | null | undefined): PastHxLines {
  const lines = emptyPastHxLines();
  if (!formData) return lines;
  const mh = toStrArr(formData['medical_history']);
  const meds = toStrArr(formData['medications']);
  for (const [key, rule] of Object.entries(HEALTHQ_PASTHX_MAP)) {
    const r = rule as { medical_history?: string[]; medications?: string[] };
    const hitMH = (r.medical_history ?? []).some((v) => mh.includes(v));
    const hitMed = (r.medications ?? []).some((v) => meds.includes(v));
    if (hitMH || hitMed) lines[key as keyof PastHxLines] = '+';
  }
  return lines;
}

/** DB jsonb(부분/누락 가능) → 안전한 PastHxLines 정규화. */
export function normalizePastHxLines(raw: unknown): PastHxLines {
  const base = emptyPastHxLines();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  for (const it of PAST_HX_ITEMS) {
    if (obj[it.key] === '+') base[it.key] = '+';
  }
  return base;
}

/**
 * 라인 → 표시 텍스트 (현장 원문 포맷):
 *   혈압/당뇨/고지혈증 (-/+/-)
 *   간질환/신질환 (-/-) 항암/보행장애 (+/-)
 */
export function formatPastHxText(lines: PastHxLines): string {
  const group = (keys: (keyof PastHxLines)[]) => {
    const labels = keys.map((k) => PAST_HX_ITEM_LABEL[k]).join('/');
    const states = keys.map((k) => lines[k]).join('/');
    return `${labels} (${states})`;
  };
  return PAST_HX_ROWS.map((row) => row.map(group).join(' ')).join('\n');
}
