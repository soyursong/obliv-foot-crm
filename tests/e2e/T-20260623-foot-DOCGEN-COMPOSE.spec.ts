/**
 * Unit spec — T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (item2 합성계층)
 *
 * 대상: src/lib/opinionDocCompose.ts 순수 합성 계층
 *   엔진(contraindicationCombine.ts) 위에서 작성창(OpinionEditorDialog) 본문을 합성한다.
 *   - classifySelection / buildContraindKeySet : 진단서(단일) vs 금기증(복수) 그룹 분리
 *   - needsHepatitisType/needsOralXReason/needsDate : data-driven 마커 검출(선택 원문에 실제 마커 있을 때만)
 *   - formatKoreanDate / substituteDatePlaceholder : `[날짜]` → `YYYY년 MM월 DD일`
 *   - substituteOralXReason : 경구약X 사유 치환 + 대괄호 제거(MSG-t285)
 *   - composeOpinionDoc : MD §B 치환순서(① B(C) → ② 날짜 → ③ 경구약X 사유) 엄수 + §3 조합
 *
 * ⛔ §B-3 임신중 조갑진균증 `[양측 조갑진균증으로 인한]` = scope 제외(MSG-3pcz) — 검출/치환/제거 안 함(리터럴 보존).
 *
 * auth/page 미사용 순수 함수 → playwright.config.ts `unit` 프로젝트 등록.
 */
import { test, expect } from '@playwright/test';
import {
  isContraindSection,
  buildContraindKeySet,
  classifySelection,
  needsHepatitisType,
  needsOralXReason,
  needsDate,
  formatKoreanDate,
  substituteDatePlaceholder,
  substituteOralXReason,
  composeOpinionDoc,
  DATE_PLACEHOLDER,
  ORAL_X_DEFAULT_REASON,
  type OpinionGroupSection,
} from '../../src/lib/opinionDocCompose';
import {
  buildContraindTemplates,
  CONTRAIND_LAST_SENTENCE,
  type OpinionSourceSection,
} from '../../src/lib/contraindicationCombine';

const LAST = CONTRAIND_LAST_SENTENCE;

// ── 픽스처 — 진단서(단일) + 금기증(복수) 혼합 섹션 ────────────────────────────
const BODY_고지혈증 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 고지혈증 약을 복용중으로 내원하심. ' +
  '레이저 치료와 도포제 치료의 병행이 필요할 것으로 보임.\n' +
  LAST;
const BODY_위장장애 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 위장장애로 내원하심. ' +
  '환자는 현재 만성적인 위장관 질환으로 약물 복용에 주의가 필요할 것으로 보임.\n' +
  LAST;
const BODY_간염 =
  '상기환자는 [날짜]에 내원하였고 B(C)형 간염 바이러스 보균자로 내원하심. ' +
  '환자는 B(C)형 보균 상태로 항진균제 복용에 주의가 필요할 것으로 보임.\n' +
  LAST;
// 경구약X 사유 괄호 포함(진단서, 단일선택)
const BODY_경구약X =
  `[${ORAL_X_DEFAULT_REASON}] 항진균제 경구 복용이 어려운 상태로 확인됩니다.`;
// 임신중(scope 제외) — '경구약 복용중' 미포함이라 oral-X 정규식에 안 걸림
const BODY_임신중 =
  '[양측 조갑진균증으로 인한] 외용제 치료가 필요한 상태로 확인됩니다.';

const SECTIONS: OpinionSourceSection[] = [
  {
    title: '진단서',
    options: [
      { key: 'oral_x', label: '경구약 X', phrase: BODY_경구약X },
      { key: 'pregnant', label: '임신중', phrase: BODY_임신중 },
    ],
  },
  {
    title: '금기증',
    options: [
      { key: 'hyperlipidemia', label: '고지혈증', phrase: BODY_고지혈증 },
      { key: 'gi_disorder', label: '위장장애', phrase: BODY_위장장애 },
      { key: 'hepatitis', label: '간염보균자', phrase: BODY_간염 },
    ],
  },
];
const TEMPLATES = buildContraindTemplates(SECTIONS);

// ─────────────────────────────────────────────────────────────────────────────
// 그룹 분류
// ─────────────────────────────────────────────────────────────────────────────
test('isContraindSection — 제목에 "금기" 포함 여부', () => {
  expect(isContraindSection('금기증')).toBe(true);
  expect(isContraindSection('진단서')).toBe(false);
  expect(isContraindSection(null)).toBe(false);
  expect(isContraindSection(undefined)).toBe(false);
});

test('buildContraindKeySet — 금기증 섹션 key 만 수집(진단서 제외)', () => {
  const set = buildContraindKeySet(SECTIONS as OpinionGroupSection[]);
  expect(set.has('hyperlipidemia')).toBe(true);
  expect(set.has('gi_disorder')).toBe(true);
  expect(set.has('hepatitis')).toBe(true);
  expect(set.has('oral_x')).toBe(false);   // 진단서
  expect(set.has('pregnant')).toBe(false); // 진단서
});

test('buildContraindKeySet — empty-safe(null/빈/옵션없음)', () => {
  expect(buildContraindKeySet(null).size).toBe(0);
  expect(buildContraindKeySet(undefined).size).toBe(0);
  expect(buildContraindKeySet([]).size).toBe(0);
  expect(buildContraindKeySet([{ title: '금기증', options: [] }]).size).toBe(0);
});

test('classifySelection — 진단서/금기증 분리(미등록 key=진단서 취급)', () => {
  const set = buildContraindKeySet(SECTIONS as OpinionGroupSection[]);
  const { diagnosisKeys, contraindKeys } = classifySelection(
    ['oral_x', 'hyperlipidemia', 'gi_disorder', 'unknown_key'],
    set,
  );
  expect(diagnosisKeys).toEqual(['oral_x', 'unknown_key']);
  expect(contraindKeys).toEqual(['hyperlipidemia', 'gi_disorder']);
});

// ─────────────────────────────────────────────────────────────────────────────
// data-driven 마커 검출 — 선택 원문에 실제 마커 있을 때만 true
// ─────────────────────────────────────────────────────────────────────────────
test('needsHepatitisType — 선택에 B(C) 마커 원문 포함 시만 true', () => {
  expect(needsHepatitisType(['hepatitis'], TEMPLATES)).toBe(true);
  expect(needsHepatitisType(['hyperlipidemia'], TEMPLATES)).toBe(false);
  expect(needsHepatitisType([], TEMPLATES)).toBe(false);
});

test('needsOralXReason — 경구약X 사유 괄호 포함 시만 true(임신중 제외)', () => {
  expect(needsOralXReason(['oral_x'], TEMPLATES)).toBe(true);
  expect(needsOralXReason(['pregnant'], TEMPLATES)).toBe(false); // §B-3 scope 제외 보장
  expect(needsOralXReason(['hyperlipidemia'], TEMPLATES)).toBe(false);
});

test('needsDate — [날짜] 플레이스홀더 포함 시만 true', () => {
  expect(needsDate(['hyperlipidemia'], TEMPLATES)).toBe(true);
  expect(needsDate(['oral_x'], TEMPLATES)).toBe(false); // 경구약X 원문엔 [날짜] 없음
});

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 포맷 / 치환
// ─────────────────────────────────────────────────────────────────────────────
test('formatKoreanDate — YYYY-MM-DD → 한국어, 불량/빈값 null', () => {
  expect(formatKoreanDate('2026-06-23')).toBe('2026년 06월 23일');
  expect(formatKoreanDate('')).toBe(null);
  expect(formatKoreanDate('2026/06/23')).toBe(null);
  expect(formatKoreanDate(null)).toBe(null);
  expect(formatKoreanDate(undefined)).toBe(null);
});

test('substituteDatePlaceholder — 모든 [날짜] 치환, 날짜 불량이면 원문 보존', () => {
  const text = '오늘 [날짜] 그리고 다시 [날짜].';
  expect(substituteDatePlaceholder(text, '2026-06-23')).toBe('오늘 2026년 06월 23일 그리고 다시 2026년 06월 23일.');
  expect(substituteDatePlaceholder(text, '')).toBe(text);       // 빈값 → 원문 보존
  expect(substituteDatePlaceholder(text, null)).toBe(text);
});

// ─────────────────────────────────────────────────────────────────────────────
// 경구약X 사유 치환 + 대괄호 제거(MSG-t285)
// ─────────────────────────────────────────────────────────────────────────────
test('substituteOralXReason — 괄호 안 사유 치환 + 대괄호 제거', () => {
  const out = substituteOralXReason(BODY_경구약X, '신부전으로 인한 경구약 복용중');
  expect(out.includes('[')).toBe(false);
  expect(out.includes(']')).toBe(false);
  expect(out.startsWith('신부전으로 인한 경구약 복용중 항진균제')).toBe(true);
});

test('substituteOralXReason — 빈 사유면 원문 괄호 보존(입력 유도)', () => {
  expect(substituteOralXReason(BODY_경구약X, '')).toBe(BODY_경구약X);
  expect(substituteOralXReason(BODY_경구약X, null)).toBe(BODY_경구약X);
});

// ─────────────────────────────────────────────────────────────────────────────
// composeOpinionDoc — 통합(치환순서 + 조합)
// ─────────────────────────────────────────────────────────────────────────────
test('compose: 선택 0개 → 빈 문자열', () => {
  expect(composeOpinionDoc({ sections: SECTIONS, selectedKeys: [] })).toBe('');
});

test('compose: 금기증 단일 → 원문 그대로(날짜 미지정 시 [날짜] 보존)', () => {
  const out = composeOpinionDoc({ sections: SECTIONS, selectedKeys: ['hyperlipidemia'] });
  expect(out).toBe(BODY_고지혈증);
  expect(out.includes(DATE_PLACEHOLDER)).toBe(true);
});

test('compose: 날짜 지정 → [날짜] 전부 치환', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['hyperlipidemia'],
    dateISO: '2026-06-23',
  });
  expect(out.includes(DATE_PLACEHOLDER)).toBe(false);
  expect(out.includes('2026년 06월 23일')).toBe(true);
});

test('compose: 금기증 2개 조합 — 향후문장 1회 + 마지막에 보존', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['gi_disorder', 'hyperlipidemia'], // 입력 순서 무관, priority 정렬
    dateISO: '2026-06-23',
  });
  expect(out.split(LAST).length - 1).toBe(1);
  expect(out.endsWith(LAST)).toBe(true);
  expect(out.includes(DATE_PLACEHOLDER)).toBe(false);
});

test('compose: 간염 B(C) 치환 — 조합 前 적용 → 잔존 0', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['hyperlipidemia', 'hepatitis'],
    hepatitisType: 'C',
    dateISO: '2026-06-23',
  });
  expect(out.includes('B(C)')).toBe(false);
  expect(out.includes('C형 보균 상태로')).toBe(true);
  expect(out.endsWith(LAST)).toBe(true);
});

test('compose: 진단서(경구약X) 단일 — 사유 치환 + 대괄호 제거', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['oral_x'],
    oralXReason: '신부전으로 인한 경구약 복용중',
  });
  expect(out.includes('[')).toBe(false);
  expect(out.includes('신부전으로 인한 경구약 복용중')).toBe(true);
});

test('compose: §B-3 임신중 — 대괄호 무처리(scope 제외, 리터럴 보존)', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['pregnant'],
    oralXReason: '아무거나', // 임신중 괄호는 절대 건드리지 않음
    dateISO: '2026-06-23',
  });
  expect(out.includes('[양측 조갑진균증으로 인한]')).toBe(true);
});

test('compose: 누락 key 방어 — 존재하지 않는 key 는 스킵(throw 없음)', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['hyperlipidemia', 'ghost_key'],
    dateISO: '2026-06-23',
  });
  expect(out.includes('고지혈증')).toBe(true);
  expect(out.endsWith(LAST)).toBe(true);
});

test('compose: §B 치환순서 통합 — 진단서 + 금기증 + 간염 + 날짜 동시', () => {
  const out = composeOpinionDoc({
    sections: SECTIONS,
    selectedKeys: ['oral_x', 'hyperlipidemia', 'hepatitis'],
    hepatitisType: 'B',
    oralXReason: '간질환으로 인한 경구약 복용중',
    dateISO: '2026-06-23',
  });
  // 진단서 본문(경구약X) 먼저 — 대괄호 제거됨
  expect(out.includes('간질환으로 인한 경구약 복용중')).toBe(true);
  expect(out.includes('[')).toBe(false);
  // 간염 B(C) → B형
  expect(out.includes('B(C)')).toBe(false);
  expect(out.includes('B형 보균 상태로')).toBe(true);
  // 날짜 치환
  expect(out.includes(DATE_PLACEHOLDER)).toBe(false);
  expect(out.includes('2026년 06월 23일')).toBe(true);
  // 향후문장(금기증) 마지막 보존
  expect(out.endsWith(LAST)).toBe(true);
});
