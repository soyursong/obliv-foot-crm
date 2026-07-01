/**
 * E2E spec — T-20260701-foot-STAFFREQ-DOCTYPE-DUP-RULE
 *
 * 실장 요청서(2번차트 > 상담내역 > '소견서 & 진단서 요청' = OpinionRequestBox)의 중복선택 규칙을
 * 상단 서류종류(docType) 버튼 기준으로 게이트한다. (A안, 김주연 총괄 U0ATDB587PV 확정, slack ts 1782890262.523009)
 *
 * 결정 축 = 상단 docType 버튼([소견서]/[진단서]) — 이 버튼 상태가 화면 전체 선택 규칙을 게이트한다.
 *   AC-1 [소견서] docType → 소견서 항목 복수 + 금기증 복수(라이브 무회귀). = 전역 복수(자유 토글).
 *   AC-2 [진단서] docType → 진단서 항목 + 금기증 항목 통틀어 딱 1개(라디오식). 새 선택 시 직전 선택 자동 해제.
 *   AC-3 [REDEFINED · policy_superseded] DOCREQ-DIAGCERT-CONTRA-MUTEX(3b66735b)의 '금기증 복수 항상 허용'은
 *        이제 [소견서] docType 에서만 유지. [진단서] docType 에선 금기증 포함 전역 라디오로 조여짐.
 *        ★기존 배타 상태머신(opinionDocCompose.ts)은 삭제하지 않고 원장 작성창(OpinionDocTab) 용으로 보존 —
 *          실장 요청 박스의 '선택 규칙'만 docType 게이트로 재정의.
 *   AC-4 실장 요청서 선택 → 원장 참고/작성창 핸드오프가 규칙 적용 후에도 정상 동작(제출 payload 규칙 반영).
 *   AC-5 authoring 경계 불변 — 실장 요청서는 '선택·요청'만. 소견/진단 본문 작성·발행은 원장 전용.
 *
 * 스타일: 정본(OpinionRequestBox) 선택 규칙 1:1 모사 + readFileSync 정적 소스 가드
 *   (DOCREQ-DIAGCERT-CONTRA-MUTEX / OPINIONDOC-PREFILL-EXCLUSIVE-GUARD 동일 컨벤션 — auth/DB 비의존 순수 검증).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const REQUEST_BOX = 'src/components/consult/OpinionRequestBox.tsx';
const COMPOSE_LIB = 'src/lib/opinionDocCompose.ts';
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';

// ── 정본 모사: 옵션 key (OPINION_SECTIONS, OpinionDocTab.tsx) ─────────────────
//   진단서 섹션 키 / 금기증 섹션 키 — A안에선 섹션 구분이 선택 규칙을 좌우하지 않음(docType 이 게이트).
const DIAGNOSIS_KEYS = ['oral_o', 'oral_x', 'after_1m', 'medical_staff'];
const CONTRAIND_KEYS = [
  'gi_disorder', 'oral_ineffective', 'gi_after_oral', 'hbv_carrier', 'diabetes',
  'bp_med', 'hyperlipidemia', 'cardio_med', 'liver_disease', 'liver_func_abnormal',
  'liver_func_test_abnormal', 'regular_drinking', 'kidney_disease', 'gout_med',
  'thyroid_med', 'psychiatric_med', 'male_hairloss_med', 'female_hairloss_med',
  'on_chemo', 'post_chemo_followup', 'preparing_pregnancy', 'pregnant', 'breastfeeding',
  'elderly', 'pediatric', 'driver', 'pilot', 'immune_disease',
];

type DocType = 'opinion' | 'diagnosis';

// ── 정본 모사: docType 게이트 선택 규칙 (OpinionRequestBox.handleOptionClick) ──
//   [진단서] = 전역 라디오(재클릭 해제 / 새 클릭은 그 1개만) · [소견서] = 전역 복수(자유 토글).
function clickOption(selected: Set<string>, key: string, docType: DocType): Set<string> {
  const next = new Set(selected);
  if (docType === 'diagnosis') {
    if (next.has(key)) next.delete(key);
    else { next.clear(); next.add(key); }
  } else {
    if (next.has(key)) next.delete(key);
    else next.add(key);
  }
  return next;
}

// ── 정본 모사: 서류종류 전환 가드 (OpinionRequestBox.handleDocTypeChange) ──
//   [진단서]로 전환 시 이전 복수 선택이 남아 있으면 라디오 불변식(≤1)으로 첫 1개만 유지.
function changeDocType(selected: Set<string>, next: DocType): Set<string> {
  if (next === 'diagnosis' && selected.size > 1) return new Set([[...selected][0]]);
  return new Set(selected);
}

// ── 정본 모사: 제출 시점 가드 (OpinionRequestBox.handleRequest cleanKeys) ──
function cleanKeys(selected: Set<string>, docType: DocType): string[] {
  return docType === 'diagnosis' ? [...selected].slice(0, 1) : [...selected];
}

// ── S1 (AC-1) — [소견서] docType: 소견서 항목 복수 유지 ─────────────────────────
test('S1 [소견서] docType — 진단서섹션 항목 여러 개 동시 선택 유지(복수)', () => {
  let sel = new Set<string>();
  for (const k of ['oral_o', 'oral_x', 'medical_staff']) sel = clickOption(sel, k, 'opinion');
  expect([...sel].sort()).toEqual(['medical_staff', 'oral_o', 'oral_x'].sort());
  expect(sel.size).toBe(3);
});

// ── S1b (AC-1/AC-3) — [소견서] docType: 금기증 복수 유지(라이브 무회귀) ──────────
test('S1b [소견서] docType — 금기증 항목 복수 유지(무회귀) + 소견서·금기증 혼합 복수 유지', () => {
  let sel = new Set<string>();
  for (const k of ['diabetes', 'bp_med', 'hyperlipidemia']) sel = clickOption(sel, k, 'opinion');
  expect(sel.size).toBe(3); // 금기증 복수 무회귀

  // 소견서 항목 + 금기증 항목 혼합 복수(시나리오 3) — 모두 유지.
  sel = clickOption(sel, 'oral_o', 'opinion');
  expect(sel.has('oral_o')).toBe(true);
  expect(sel.size).toBe(4);

  // 제출 payload 도 복수 그대로(핸드오프 AC-4).
  expect(cleanKeys(sel, 'opinion').sort()).toEqual([...sel].sort());
});

// ── S2 (AC-2) — [진단서] docType: 진단서+금기증 통틀어 딱 1개(라디오) ────────────
test('S2 [진단서] docType — 진단서·금기증 통틀어 전역 라디오(딱 1개)', () => {
  let sel = new Set<string>();
  // 진단서 항목 X → Y : X 자동 해제, Y 만.
  sel = clickOption(sel, 'oral_x', 'diagnosis');
  sel = clickOption(sel, 'after_1m', 'diagnosis');
  expect([...sel]).toEqual(['after_1m']);

  // 이어서 금기증 항목 Z → Y 자동 해제, Z 만(진단서·금기증 통틀어 1개).
  sel = clickOption(sel, 'diabetes', 'diagnosis');
  expect([...sel]).toEqual(['diabetes']);
  expect(sel.size).toBe(1);

  // 금기증 → 금기증 도 라디오(1개).
  sel = clickOption(sel, 'bp_med', 'diagnosis');
  expect([...sel]).toEqual(['bp_med']);

  // 같은 항목 재클릭 = 해제.
  sel = clickOption(sel, 'bp_med', 'diagnosis');
  expect(sel.size).toBe(0);
});

// ── S3 (AC-2/AC-4) — [진단서] 제출 payload 는 항상 ≤1 ───────────────────────────
test('S3 [진단서] docType — 제출 cleanKeys 는 전역 라디오 불변식(≤1)', () => {
  // 방어적: 어떤 경로로든 2개 이상 섞여도 제출은 첫 1개만.
  const sel = new Set<string>(['oral_x', 'diabetes']);
  expect(cleanKeys(sel, 'diagnosis').length).toBeLessThanOrEqual(1);
});

// ── S4 (docType 전환 가드) — 소견서 복수 → 진단서 전환 시 ≤1 로 조여짐 ──────────
test('S4 서류종류 전환 — [소견서] 복수 선택 후 [진단서] 전환 시 첫 1개만 유지', () => {
  let sel = new Set<string>();
  for (const k of ['diabetes', 'bp_med', 'oral_o']) sel = clickOption(sel, k, 'opinion');
  expect(sel.size).toBe(3);

  // [진단서] 전환 → 라디오 불변식.
  sel = changeDocType(sel, 'diagnosis');
  expect(sel.size).toBe(1);
  expect(sel.has('diabetes')).toBe(true); // 첫 선택 유지

  // 다시 [소견서] 전환 → 선택 유지(복수 허용이므로 손대지 않음).
  const back = changeDocType(sel, 'opinion');
  expect(back.size).toBe(1);
});

// ── 정적 소스 가드 ─────────────────────────────────────────────────────────────
test('SRC-1 OpinionRequestBox — docType 게이트 선택 규칙(라디오/복수)이 소스에 존재', () => {
  const src = read(REQUEST_BOX);
  expect(src).toContain('isDiagnosisMode');
  expect(src).toContain('handleDocTypeChange');
  // 라디오(clear→add) 분기 + 복수(toggle) 분기 공존.
  expect(src).toMatch(/isDiagnosisMode[\s\S]*next\.clear\(\)/);
  // 제출 가드도 docType 분기.
  expect(src).toMatch(/const cleanKeys = isDiagnosisMode \? \[\.\.\.selected\]\.slice\(0, 1\) : \[\.\.\.selected\]/);
  // 티켓 근거 주석.
  expect(src).toContain('STAFFREQ-DOCTYPE-DUP-RULE');
});

test('SRC-2 회귀보호 — 공유 배타 엔진(opinionDocCompose)·원장 작성창(OpinionDocTab)은 무회귀', () => {
  // AC-3: 기존 배타 상태머신은 삭제하지 않고 원장 작성창용으로 보존.
  const lib = read(COMPOSE_LIB);
  expect(lib).toContain('applyPrefillExclusivity');
  expect(lib).toContain('classifySelection');
  const doc = read(OPINION_DOC);
  // 원장 작성창 prefill 배타 가드 무회귀.
  expect(doc).toContain('applyPrefillExclusivity');
  // 실장 요청 박스는 더 이상 공유 엔진의 배타 헬퍼를 선택 규칙에 쓰지 않음(docType 게이트로 자체 분기).
  const box = read(REQUEST_BOX);
  expect(box).not.toContain('applyPrefillExclusivity');
});

test('SRC-3 authoring 경계 불변(AC-5) — 실장 박스는 draft 요청만(발행/본문작성 UI 없음)', () => {
  const src = read(REQUEST_BOX);
  // 발행 요청(draft) 버튼만 존재.
  expect(src).toContain('발행 요청');
  // 본문 작성/발행(publish) 직접 호출 없음.
  expect(src).not.toContain('publishMut');
  expect(src).not.toContain('composeOpinionDoc');
});
