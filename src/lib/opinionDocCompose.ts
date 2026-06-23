/**
 * 서류 상용구 조합 — 작성창(원장 OpinionEditorDialog) 합성 계층.
 *
 * 출처: T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (item2 UI 와이어링)
 *       조합로직 MD `140854_F0BCDEE2D8W_서류상용구_조합로직_20260623.md`
 *
 * 본 파일은 Phase 1a 엔진(contraindicationCombine.ts)을 **그대로 호출**하는 순수 합성 계층이다.
 *   - classifySelection : 선택 key 를 진단서(단일배타) / 금기증(복수) 그룹으로 분리
 *   - 플레이스홀더 검출  : 선택된 원문에 실제로 마커가 있을 때만 부가 UI 노출 (data-driven)
 *   - composeOpinionDoc : MD §B 치환순서(① 간염 B(C) → ② 날짜 → ③ 경구약X 사유) 엄수 + 조합
 *
 * ⛔ §B-3 임신중 조갑진균증 `[양측 조갑진균증으로 인한]` = **scope 제외**(MSG-3pcz, 현행 유지·변경 없음).
 *    → 본 파일은 임신중 대괄호를 **검출/치환/제거하지 않는다**(리터럴 보존).
 *
 * UI(작성창)는 selectedKeys·hepatitisType·oralXReason·dateISO 를 controlled state 로 들고,
 *   이 함수의 출력을 editor(textarea) SSOT 로 주입한다(원장 수기수정 우선 = AC-4).
 *   ★ 대괄호 `[ ]` 최종 미표기(MSG-t285) — 경구약X 사유 치환 시 괄호 제거(파란글씨 span 은 출력/인쇄 item3).
 */

import {
  buildContraindTemplates,
  combineDiagnoses,
  substituteHepatitisType,
  type ContraindTemplate,
  type HepatitisType,
  type OpinionSourceSection,
} from '@/lib/contraindicationCombine';

// ── 플레이스홀더 마커 (MD §1/§2) ──────────────────────────────────────────────
/** MD §1 날짜 플레이스홀더 리터럴. */
export const DATE_PLACEHOLDER = '[날짜]';
/** MD §2-2 간염 타입 치환 마커. */
export const HEPATITIS_MARKER = 'B(C)';
/**
 * MD §2-1 경구약X 사유 괄호 검출 — 대괄호 안에 '경구약 복용중' 을 포함하는 구간.
 *   예) `[고혈압, 당뇨, 고지혈증으로 인한 경구약 복용중]`
 *   ⛔ 임신중 `[양측 조갑진균증으로 인한]` 은 '경구약 복용중' 미포함 → 매칭 안 됨(scope 제외 보장).
 */
export const ORAL_X_REASON_RE = /\[[^[\]]*경구약 복용중[^[\]]*\]/;
/** §B-2 LOCK(MSG-3pcz) — 경구약X 사유 기본/placeholder 텍스트. */
export const ORAL_X_DEFAULT_REASON = '고혈압, 당뇨, 고지혈증으로 인한 경구약 복용중';

export interface OpinionGroupSection {
  title: string;
  options: { key: string; label: string; phrase: string }[];
}

/**
 * 섹션 제목으로 금기증(복수선택·조합 대상) 여부 판정.
 * MD §3 조합 알고리즘은 **금기증**에만 적용. 진단서(표준)는 단일선택.
 */
export function isContraindSection(title: string | null | undefined): boolean {
  return (title ?? '').includes('금기');
}

/** 선택된 key → 금기증 그룹 여부 맵 (섹션 분류). 미등록 key 는 false(진단서/단일 취급). */
export function buildContraindKeySet(
  sections: OpinionGroupSection[] | OpinionSourceSection[] | null | undefined,
): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(sections)) return set;
  for (const s of sections) {
    if (!isContraindSection((s as { title?: string })?.title)) continue;
    const opts = (s as { options?: { key?: string }[] })?.options;
    if (!Array.isArray(opts)) continue;
    for (const o of opts) if (o?.key) set.add(o.key);
  }
  return set;
}

export interface SelectionGroups {
  /** 진단서(표준) 단일배타 그룹에서 선택된 key (정상 운영 시 0~1개). */
  diagnosisKeys: string[];
  /** 금기증 복수선택 그룹에서 선택된 key. */
  contraindKeys: string[];
}

/** 선택 key 를 진단서/금기증 그룹으로 분리. 입력 순서 보존(조합은 엔진이 우선순위로 재정렬). */
export function classifySelection(
  selectedKeys: string[],
  contraindKeySet: Set<string>,
): SelectionGroups {
  const diagnosisKeys: string[] = [];
  const contraindKeys: string[] = [];
  for (const k of selectedKeys) {
    if (contraindKeySet.has(k)) contraindKeys.push(k);
    else diagnosisKeys.push(k);
  }
  return { diagnosisKeys, contraindKeys };
}

/** 선택된 원문 모음 (검출용). 누락 key 는 빈 문자열 스킵. */
function selectedBodies(
  selectedKeys: string[],
  templates: Record<string, ContraindTemplate>,
): string[] {
  return selectedKeys.map((k) => templates[k]?.body ?? '').filter(Boolean);
}

/** MD §2-2 — 선택된 원문 중 간염 `B(C)` 마커가 있으면 간염타입 드롭다운 필요. */
export function needsHepatitisType(
  selectedKeys: string[],
  templates: Record<string, ContraindTemplate>,
): boolean {
  return selectedBodies(selectedKeys, templates).some((b) => b.includes(HEPATITIS_MARKER));
}

/** MD §2-1 — 선택된 원문 중 경구약X 사유 괄호가 있으면 사유 텍스트박스 필요. */
export function needsOralXReason(
  selectedKeys: string[],
  templates: Record<string, ContraindTemplate>,
): boolean {
  return selectedBodies(selectedKeys, templates).some((b) => ORAL_X_REASON_RE.test(b));
}

/** MD §1 — 선택된 원문 중 `[날짜]` 플레이스홀더가 있으면 날짜 입력 필요. */
export function needsDate(
  selectedKeys: string[],
  templates: Record<string, ContraindTemplate>,
): boolean {
  return selectedBodies(selectedKeys, templates).some((b) => b.includes(DATE_PLACEHOLDER));
}

/**
 * MD §1 — `YYYY-MM-DD` → `YYYY년 MM월 DD일`. 형식 불량/빈 값이면 원문 보존(치환 안 함).
 */
export function formatKoreanDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!m) return null;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

/** MD §1 — 본문 내 모든 `[날짜]` 를 한국어 날짜로 치환. 날짜 미지정/불량이면 원문 그대로. */
export function substituteDatePlaceholder(text: string, iso: string | null | undefined): string {
  const formatted = formatKoreanDate(iso);
  if (!formatted) return text;
  return text.split(DATE_PLACEHOLDER).join(formatted);
}

/**
 * MD §2-1 — 경구약X 사유 괄호를 입력값으로 치환 + **대괄호 제거**(MSG-t285 '대괄호는 없음').
 *   reason 이 비면 치환하지 않음(원문 괄호 보존 — 입력 유도).
 */
export function substituteOralXReason(text: string, reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) return text;
  return text.replace(ORAL_X_REASON_RE, r);
}

export interface ComposeInput {
  /** form_templates(opinion_doc).field_map.sections 우선, 없으면 하드코드 폴백 — 호출측이 결정해 전달. */
  sections: OpinionGroupSection[] | OpinionSourceSection[];
  selectedKeys: string[];
  /** 간염 타입(B/C). null = 미선택(치환 안 함). */
  hepatitisType?: HepatitisType | null;
  /** 경구약X 사유(직원/원장 입력). 빈 값이면 원문 괄호 보존. */
  oralXReason?: string | null;
  /** 날짜 `YYYY-MM-DD`. 빈/불량이면 `[날짜]` 보존. */
  dateISO?: string | null;
}

/**
 * 작성창 본문 합성 — MD §B 치환순서 엄수 + §3 조합.
 *
 *   ① 간염 `B(C)` 치환 (조합 **前**, 원문 body 단계 — MD §3-5)
 *   ② 금기증 복수선택 조합(combineDiagnoses) + 진단서 단일 원문
 *   ③ 날짜 `[날짜]` → 한국어 날짜
 *   ④ 경구약X 사유 치환(괄호 제거)
 *   ⑤ 임신중 조갑진균증 괄호 = **무처리**(scope 제외, 리터럴 보존)
 *
 * @returns editor 초기 본문(원장 수기수정 SSOT 의 출발점)
 */
export function composeOpinionDoc(input: ComposeInput): string {
  const { sections, selectedKeys, hepatitisType, oralXReason, dateISO } = input;

  // 원문 맵 — 진단서/금기증 모든 옵션 포함(priority 미등재 진단서는 fallback). 엔진과 동일 키공간.
  let templates = buildContraindTemplates(sections as OpinionSourceSection[]);

  // ① 간염 B(C) 치환 — 조합 前, body 단계에 먼저 적용(MD §3-5).
  if (hepatitisType) {
    const subbed: Record<string, ContraindTemplate> = {};
    for (const [k, t] of Object.entries(templates)) {
      subbed[k] = { ...t, body: substituteHepatitisType(t.body, hepatitisType) };
    }
    templates = subbed;
  }

  // 존재하는 key 만 (방어적 — combineDiagnoses 는 누락 key 에 throw).
  const present = selectedKeys.filter((k) => !!templates[k]);
  const contraindKeySet = buildContraindKeySet(sections as OpinionGroupSection[]);
  const { diagnosisKeys, contraindKeys } = classifySelection(present, contraindKeySet);

  const parts: string[] = [];
  // ② 진단서(단일배타) — 정상 운영 시 0~1개. 방어적으로 각 원문 그대로.
  for (const k of diagnosisKeys) {
    const body = templates[k]?.body ?? '';
    if (body) parts.push(body);
  }
  // ② 금기증 복수선택 조합(0/1/2+ 는 엔진이 처리).
  const combined = combineDiagnoses(contraindKeys, templates);
  if (combined) parts.push(combined);

  let text = parts.join('\n');

  // ③ 날짜 치환.
  text = substituteDatePlaceholder(text, dateISO);
  // ④ 경구약X 사유 치환(괄호 제거).
  text = substituteOralXReason(text, oralXReason);
  // ⑤ 임신중 조갑진균증 = 무처리(scope 제외).

  return text;
}
