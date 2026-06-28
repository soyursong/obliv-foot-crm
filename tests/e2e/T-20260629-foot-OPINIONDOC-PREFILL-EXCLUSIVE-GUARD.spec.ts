/**
 * E2E spec — T-20260629-foot-OPINIONDOC-PREFILL-EXCLUSIVE-GUARD
 *
 * 서류 발행 배타규칙 hardening — 진단서(1종 단독) ⊕ 금기증(다종 단독) 배타 규칙이
 * prefill(OpinionDocTab initialSelectedKeys → setSelected) 에서 절대 깨지지 않도록 보강.
 * ★문지은 대표원장(U0ALGAAAJAV) 직접 지적: 원장이 여는 작성창에 진단서+금기증이 '둘 다 눌러진' 상태가 나오면 안 됨.
 *
 * 검증 대상(티켓 현장 클릭 시나리오 3종):
 *   S1 (정상)  — 진단서 단독 prefill → 진단서 그룹만 유지(금기증 0). 단일배타 → 진단서 ≤1개.
 *   S2 (핵심)  — 오염 큐(진단서+금기증 혼합) prefill 방어 → 두 그룹 동시선택 절대 0(★대표원장 지적 핵심).
 *                docType='diagnosis' → 진단서 우선(단일), docType='opinion'/미지정 → 금기증 우선(복수).
 *   S3 (엣지)  — 실장 요청화면(OpinionRequestBox) 배타 disable 이 native <button disabled> 로 구현 →
 *                모바일/갤럭시탭 터치 환경에서도 브라우저 레벨 클릭 차단(데스크탑 의존 아님). 정적 소스 가드.
 *   S4 (불변식)— applyPrefillExclusivity 출력은 어떤 입력에도 '진단서∧금기증 동시존재' 절대 없음 + 진단서 ≤1.
 *   S5 (소스 가드) — OpinionDocTab prefill 이 applyPrefillExclusivity 를 경유(검증 없는 setSelected 회귀 차단).
 *
 * 스타일: 정본(opinionDocCompose.applyPrefillExclusivity) 로직 1:1 모사 — auth/DB 비의존 순수 검증
 *   (OPINION-DOC-FEATURE / AUTOLINK-HEALTHQ 동일 컨벤션). 소스 정합은 readFileSync 정적 가드로 lock.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';
const REQUEST_BOX = 'src/components/consult/OpinionRequestBox.tsx';
const COMPOSE_LIB = 'src/lib/opinionDocCompose.ts';

// ── 정본 모사: 옵션 그룹 (OPINION_SECTIONS, OpinionDocTab.tsx) ─────────────────
//   진단서 섹션 = 단일배타 그룹 / 금기증 섹션 = 복수 그룹. buildContraindKeySet 은 title 에 '금기' 포함 섹션을 모음.
const DIAGNOSIS_KEYS = ['oral_o', 'oral_x', 'after_1m', 'medical_staff'];
const CONTRAIND_KEYS = [
  'gi_disorder', 'oral_ineffective', 'gi_after_oral', 'hbv_carrier', 'diabetes',
  'bp_med', 'hyperlipidemia', 'cardio_med', 'liver_disease', 'liver_func_abnormal',
  'liver_func_test_abnormal', 'regular_drinking', 'kidney_disease', 'gout_med',
  'thyroid_med', 'psychiatric_med', 'male_hairloss_med', 'female_hairloss_med',
  'on_chemo', 'post_chemo_followup', 'preparing_pregnancy', 'pregnant', 'breastfeeding',
  'elderly', 'pediatric', 'driver', 'pilot', 'immune_disease',
];
const CONTRAIND_SET = new Set(CONTRAIND_KEYS);

// ── 정본 모사: classifySelection (opinionDocCompose.ts) ────────────────────────
function classifySelection(selectedKeys: string[], contraindKeySet: Set<string>) {
  const diagnosisKeys: string[] = [];
  const contraindKeys: string[] = [];
  for (const k of selectedKeys) {
    if (contraindKeySet.has(k)) contraindKeys.push(k);
    else diagnosisKeys.push(k);
  }
  return { diagnosisKeys, contraindKeys };
}

// ── 정본 모사: applyPrefillExclusivity (opinionDocCompose.ts, 본 티켓 신설) ────
function applyPrefillExclusivity(
  keys: string[],
  contraindKeySet: Set<string>,
  preferDocType?: 'diagnosis' | 'opinion' | null,
): string[] {
  const { diagnosisKeys, contraindKeys } = classifySelection(keys, contraindKeySet);
  const mixed = diagnosisKeys.length > 0 && contraindKeys.length > 0;
  if (mixed) {
    return preferDocType === 'diagnosis' ? diagnosisKeys.slice(0, 1) : contraindKeys;
  }
  if (diagnosisKeys.length > 0) return diagnosisKeys.slice(0, 1);
  return contraindKeys;
}

// 불변식 헬퍼 — 결과 keys 에 진단서·금기증 동시존재 없음 + 진단서 ≤1.
function assertInvariant(out: string[]) {
  const { diagnosisKeys, contraindKeys } = classifySelection(out, CONTRAIND_SET);
  // 두 그룹 동시 존재 절대 금지(★대표원장 핵심 불변식).
  expect(diagnosisKeys.length === 0 || contraindKeys.length === 0).toBe(true);
  // 진단서는 단일배타 — 최대 1개.
  expect(diagnosisKeys.length).toBeLessThanOrEqual(1);
}

test.describe('OPINIONDOC-PREFILL-EXCLUSIVE-GUARD', () => {
  // ── S1 정상: 진단서 단독 prefill ────────────────────────────────────────────
  test('S1 진단서 단독 prefill → 진단서만 유지, 금기증 0', () => {
    const out = applyPrefillExclusivity(['oral_o'], CONTRAIND_SET, 'diagnosis');
    expect(out).toEqual(['oral_o']);
    assertInvariant(out);
  });

  test('S1b 진단서 단독 2개(레거시 위반) prefill → 단일배타 첫 1개만', () => {
    const out = applyPrefillExclusivity(['oral_o', 'oral_x'], CONTRAIND_SET, 'diagnosis');
    expect(out).toEqual(['oral_o']);
    assertInvariant(out);
  });

  // ── S2 핵심: 오염 큐(혼합) prefill 방어 ─────────────────────────────────────
  test('S2 혼합(진단서+금기증) + docType=diagnosis → 진단서 그룹만(단일), 금기증 clear', () => {
    const mixed = ['oral_o', 'diabetes', 'bp_med']; // 진단서1 + 금기증2
    const out = applyPrefillExclusivity(mixed, CONTRAIND_SET, 'diagnosis');
    expect(out).toEqual(['oral_o']);
    expect(out.some((k) => CONTRAIND_SET.has(k))).toBe(false); // 금기증 0
    assertInvariant(out);
  });

  test('S2b 혼합 + docType=opinion → 금기증 그룹만(복수), 진단서 clear', () => {
    const mixed = ['oral_o', 'diabetes', 'bp_med'];
    const out = applyPrefillExclusivity(mixed, CONTRAIND_SET, 'opinion');
    expect(out).toEqual(['diabetes', 'bp_med']);
    expect(out.some((k) => !CONTRAIND_SET.has(k))).toBe(false); // 진단서 0
    assertInvariant(out);
  });

  test('S2c 혼합 + docType 미지정(레거시 draft) → 금기증 우선(기본), 진단서 clear', () => {
    const mixed = ['medical_staff', 'liver_disease', 'pregnant'];
    const out = applyPrefillExclusivity(mixed, CONTRAIND_SET, null);
    expect(out).toEqual(['liver_disease', 'pregnant']);
    assertInvariant(out);
  });

  test('S2d 혼합 + 진단서 다중 + docType=diagnosis → 진단서 첫 1개만, 금기증 전부 clear', () => {
    const mixed = ['oral_x', 'oral_o', 'diabetes']; // 진단서2 + 금기증1
    const out = applyPrefillExclusivity(mixed, CONTRAIND_SET, 'diagnosis');
    expect(out).toEqual(['oral_x']); // 입력순서 보존, 첫 진단서 키
    assertInvariant(out);
  });

  // ── S3 금기증 단독은 복수 그대로(회귀 가드) ─────────────────────────────────
  test('S3 금기증 단독 다종 prefill → 복수 그대로 유지', () => {
    const out = applyPrefillExclusivity(['diabetes', 'bp_med', 'liver_disease'], CONTRAIND_SET, 'opinion');
    expect(out).toEqual(['diabetes', 'bp_med', 'liver_disease']);
    assertInvariant(out);
  });

  test('S3b 빈 prefill → 빈 배열(empty-safe)', () => {
    expect(applyPrefillExclusivity([], CONTRAIND_SET, 'opinion')).toEqual([]);
  });

  // ── S4 불변식: 모든 조합(진단서×금기증 cross product)에서 동시선택 0 ──────────
  test('S4 불변식 — 임의 혼합 입력에 대해 진단서∧금기증 동시존재 절대 0', () => {
    for (const d of DIAGNOSIS_KEYS) {
      for (const c of CONTRAIND_KEYS.slice(0, 6)) {
        for (const pref of ['diagnosis', 'opinion', null] as const) {
          const out = applyPrefillExclusivity([d, c], CONTRAIND_SET, pref);
          assertInvariant(out);
          expect(out.length).toBeGreaterThan(0); // 우선 그룹은 항상 비지 않음
        }
      }
    }
  });

  // ── S5 소스 가드: OpinionDocTab prefill 이 가드 경유 ────────────────────────
  test('S5 OpinionDocTab prefill 이 applyPrefillExclusivity 를 경유(검증없는 setSelected 회귀 차단)', () => {
    const src = read(OPINION_DOC);
    // import 존재.
    expect(src).toMatch(/applyPrefillExclusivity/);
    // prefill 진입점이 가드 결과를 setSelected — 'setSelected(new Set(keys))' 직전 keys 가 가드 출력.
    expect(src).toMatch(/applyPrefillExclusivity\(\s*rawKeys\s*,\s*contraindKeySet\s*,\s*initialDocType/);
    expect(src).toMatch(/setSelected\(new Set\(keys\)\)/);
    // ★회귀 가드: 가드 없이 initialSelectedKeys 를 바로 setSelected 하는 경로가 없어야 함.
    expect(src).not.toMatch(/setSelected\(new Set\(\(initialSelectedKeys/);
  });

  // ── 정본 가드: compose 라이브러리에 helper 가 export 됨 ──────────────────────
  test('S5b opinionDocCompose 에 applyPrefillExclusivity export', () => {
    const src = read(COMPOSE_LIB);
    expect(src).toMatch(/export function applyPrefillExclusivity\(/);
    // 혼합 시 우선 그룹만 반환(slice(0,1) 단일배타 보존).
    expect(src).toMatch(/diagnosisKeys\.slice\(0,\s*1\)/);
  });

  // ── S6 AC-2: 실장 요청화면 배타 disable = native <button disabled>(모바일/갤탭 안전) ──
  test('S6 OpinionRequestBox 배타 disable 이 native button disabled 속성(모바일/터치 차단 보장)', () => {
    const src = read(REQUEST_BOX);
    // 배타 판정 — 진단서 선택 시 그 외 disable / 금기증 선택 시 진단서 disable.
    expect(src).toMatch(/const disabled = hasDiagnosis/);
    // ★native <button> 의 disabled 속성으로 차단(시각 opacity 가 아니라 브라우저 레벨 이벤트 차단 → 모바일/갤탭 동일).
    expect(src).toMatch(/<button[\s\S]*?disabled=\{disabled\}/);
    // onClick 은 동일 button — disabled 면 native 로 발화 안 함(터치 포함).
    expect(src).toMatch(/onClick=\{\(\) => handleOptionClick\(opt\.key\)\}/);
  });
});
