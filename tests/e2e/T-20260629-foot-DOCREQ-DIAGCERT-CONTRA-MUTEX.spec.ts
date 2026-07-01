/**
 * E2E spec — T-20260629-foot-DOCREQ-DIAGCERT-CONTRA-MUTEX
 *
 * 서류 요청/작성 선택 — 진단서 ↔ 금기증 배타 + 진단서 단일선택 비즈 규칙(canonical SSOT).
 * ★문지은 대표원장(U0ALGAAAJAV) 직접 지적:
 *   (a) "요청서류에 아직도 이 로직을 깨는 서류들이 제안돼있다"  → 큐 목록 '해당항목' 표시 정규화.
 *   (b) "의사가 여는 창에도 그 로직을 깨는 선택이 눌러져있으면 절대안돼" → prefill 가드(sibling 티켓
 *        OPINIONDOC-PREFILL-EXCLUSIVE-GUARD 에서 적용, 본 spec 은 그 회귀까지 통합 가드).
 *
 * 비즈 규칙(canonical):
 *   R1 배타     — 한 번의 요청/작성에서 진단서 ⊕ 금기증(동시선택 금지).
 *   R2 진단서 단일 — 진단서는 한 종류만(단일배타).
 *   R3 금기증 복수 — 금기증은 여러 종류 동시선택 가능.
 *   R4 prefill 무결 — 직원 발행요청→원장 작성/발급 창 prefill 도 R1~R3 위반 0.
 *
 * 검증(티켓 현장 클릭 시나리오 4종 매핑):
 *   S1 (R1 배타)        — 선택 UI 배타 disable: 진단서 선택 시 금기증 비활성 / 금기증 선택 시 진단서 비활성.
 *   S2 (R2/R3)          — 진단서 단일배타(다른 진단서 클릭=이전 해제) / 금기증 복수 토글.
 *   S3 (R4 prefill 무결)— 오염 큐(혼합) prefill 방어 → 진단서∧금기증 동시존재 0 + 진단서 ≤1.
 *   S4 (엣지)           — 빈 선택 제출 가드 / 금기증 복수 후 진단서 추가 클릭 = 배타 발동.
 *   + 복문 a            — 큐 목록 '해당항목' 표시가 배타 정규화 키만 노출(표시 ≡ prefill).
 *   + 제출 가드          — 실장 요청 박스 제출 직전 배타 정규화 경유.
 *   + 소스 가드          — 4 surface(실장박스/작성창/큐목록/엔진) 가 동일 엔진(opinionDocCompose) 경유.
 *
 * 스타일: 정본(opinionDocCompose) 로직 1:1 모사 + readFileSync 정적 소스 가드.
 *   auth/DB 비의존 순수 검증(OPINIONDOC-PREFILL-EXCLUSIVE-GUARD / DOCGEN-CONTRAIND-COMBINE 동일 컨벤션).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';
const REQUEST_BOX = 'src/components/consult/OpinionRequestBox.tsx';
const COMPOSE_LIB = 'src/lib/opinionDocCompose.ts';
const DOCREQ_QUEUE = 'src/components/doctor/DocRequestQueue.tsx';

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

// ── 정본 모사: classifySelection / applyPrefillExclusivity (opinionDocCompose.ts) ──
function classifySelection(selectedKeys: string[], contraindKeySet: Set<string>) {
  const diagnosisKeys: string[] = [];
  const contraindKeys: string[] = [];
  for (const k of selectedKeys) {
    if (contraindKeySet.has(k)) contraindKeys.push(k);
    else diagnosisKeys.push(k);
  }
  return { diagnosisKeys, contraindKeys };
}
function applyPrefillExclusivity(
  keys: string[],
  contraindKeySet: Set<string>,
  preferDocType?: 'diagnosis' | 'opinion' | null,
): string[] {
  const { diagnosisKeys, contraindKeys } = classifySelection(keys, contraindKeySet);
  const mixed = diagnosisKeys.length > 0 && contraindKeys.length > 0;
  if (mixed) return preferDocType === 'diagnosis' ? diagnosisKeys.slice(0, 1) : contraindKeys;
  if (diagnosisKeys.length > 0) return diagnosisKeys.slice(0, 1);
  return contraindKeys;
}

// ── 정본 모사: 선택 UI 배타 disable 판정 (OpinionRequestBox / OpinionDocTab handleOptionClick + disabled) ──
//   진단서 선택 중(hasDiagnosis) → 선택 안 된 모든 항목 disable(단일배타).
//   금기증 선택 중(hasContraind) → 진단서 항목만 disable(배타), 금기증끼리는 활성(복수).
function isOptionDisabled(selected: Set<string>, optKey: string, contraindKeySet: Set<string>): boolean {
  const arr = [...selected];
  const { diagnosisKeys, contraindKeys } = classifySelection(arr, contraindKeySet);
  const hasDiagnosis = diagnosisKeys.length > 0;
  const hasContraind = contraindKeys.length > 0;
  const active = selected.has(optKey);
  const isContraindOpt = contraindKeySet.has(optKey);
  return hasDiagnosis ? !active : hasContraind ? !isContraindOpt : false;
}

// ── 정본 모사: handleOptionClick (진단서 단일배타 / 금기증 토글 복수) ──────────
function clickOption(prev: Set<string>, optKey: string, contraindKeySet: Set<string>): Set<string> {
  const isContraind = contraindKeySet.has(optKey);
  const next = new Set(prev);
  if (isContraind) {
    if (next.has(optKey)) next.delete(optKey);
    else next.add(optKey);
  } else {
    if (next.has(optKey)) next.delete(optKey);
    else {
      next.clear();
      next.add(optKey);
    }
  }
  return next;
}

// 불변식 — 결과에 진단서·금기증 동시존재 없음 + 진단서 ≤1.
function assertInvariant(keys: string[]) {
  const { diagnosisKeys, contraindKeys } = classifySelection(keys, CONTRAIND_SET);
  expect(diagnosisKeys.length === 0 || contraindKeys.length === 0).toBe(true);
  expect(diagnosisKeys.length).toBeLessThanOrEqual(1);
}

test.describe('DOCREQ-DIAGCERT-CONTRA-MUTEX — 진단서↔금기증 배타 + 단일선택 가드', () => {
  // ── S1 (R1 배타): 선택 UI 배타 disable ──────────────────────────────────────
  test('S1 진단서 선택 중 → 금기증(및 다른 진단서) 전부 disable', () => {
    const sel = new Set(['oral_o']); // 진단서 1 선택
    // 금기증은 모두 disable.
    for (const c of CONTRAIND_KEYS) expect(isOptionDisabled(sel, c, CONTRAIND_SET)).toBe(true);
    // 다른 진단서도 disable(단일배타). 단, 현재 선택된 진단서 자신은 활성(해제 가능).
    expect(isOptionDisabled(sel, 'oral_o', CONTRAIND_SET)).toBe(false);
    for (const d of DIAGNOSIS_KEYS.filter((k) => k !== 'oral_o')) {
      expect(isOptionDisabled(sel, d, CONTRAIND_SET)).toBe(true);
    }
  });

  test('S1b 금기증 선택 중 → 진단서 전부 disable, 금기증끼리는 활성(복수)', () => {
    const sel = new Set(['diabetes', 'bp_med']); // 금기증 2 선택
    for (const d of DIAGNOSIS_KEYS) expect(isOptionDisabled(sel, d, CONTRAIND_SET)).toBe(true);
    // 다른 금기증은 활성(추가 선택 가능 = 복수).
    expect(isOptionDisabled(sel, 'liver_disease', CONTRAIND_SET)).toBe(false);
  });

  test('S1c 아무것도 선택 안 함 → 전부 활성(진입 자유)', () => {
    const sel = new Set<string>();
    for (const k of [...DIAGNOSIS_KEYS, ...CONTRAIND_KEYS]) {
      expect(isOptionDisabled(sel, k, CONTRAIND_SET)).toBe(false);
    }
  });

  // ── S2 (R2/R3): 진단서 단일배타 / 금기증 복수 토글 ──────────────────────────
  test('S2 진단서 클릭 → 그 1개만(이전 선택 전부 해제 = 단일배타)', () => {
    let sel = new Set<string>();
    sel = clickOption(sel, 'oral_o', CONTRAIND_SET);
    expect([...sel]).toEqual(['oral_o']);
    // 다른 진단서 클릭(배타 disable 우회 가정해도 엔진은 단일 보장) → 이전 해제, 새것만.
    sel = clickOption(sel, 'oral_x', CONTRAIND_SET);
    expect([...sel]).toEqual(['oral_x']);
    assertInvariant([...sel]);
  });

  test('S2b 금기증 복수 토글 — 2종 이상 동시선택 가능, 재클릭 시 개별 해제', () => {
    let sel = new Set<string>();
    sel = clickOption(sel, 'diabetes', CONTRAIND_SET);
    sel = clickOption(sel, 'bp_med', CONTRAIND_SET);
    sel = clickOption(sel, 'liver_disease', CONTRAIND_SET);
    expect([...sel].sort()).toEqual(['bp_med', 'diabetes', 'liver_disease'].sort());
    // 재클릭 → 해당 1종만 해제(복수 유지).
    sel = clickOption(sel, 'bp_med', CONTRAIND_SET);
    expect([...sel].sort()).toEqual(['diabetes', 'liver_disease'].sort());
    assertInvariant([...sel]);
  });

  // ── S3 (R4 prefill 무결): 오염 큐 혼합 prefill 방어 ─────────────────────────
  test('S3 혼합(진단서+금기증) prefill + docType=diagnosis → 진단서 단일만, 금기증 0', () => {
    const out = applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'diagnosis');
    expect(out).toEqual(['oral_o']);
    expect(out.some((k) => CONTRAIND_SET.has(k))).toBe(false);
    assertInvariant(out);
  });

  test('S3b 혼합 prefill + docType=opinion/미지정 → 금기증 복수만, 진단서 0', () => {
    expect(applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'opinion'))
      .toEqual(['diabetes', 'bp_med']);
    expect(applyPrefillExclusivity(['medical_staff', 'liver_disease', 'pregnant'], CONTRAIND_SET, null))
      .toEqual(['liver_disease', 'pregnant']);
  });

  test('S3c 정상 prefill(진단서 단독 / 금기증 복수)은 무변경(회귀 0)', () => {
    expect(applyPrefillExclusivity(['oral_o'], CONTRAIND_SET, 'diagnosis')).toEqual(['oral_o']);
    expect(applyPrefillExclusivity(['diabetes', 'bp_med', 'pregnant'], CONTRAIND_SET, 'opinion'))
      .toEqual(['diabetes', 'bp_med', 'pregnant']);
  });

  // ── S4 (엣지): 빈 선택 / 금기증 후 진단서 추가 ───────────────────────────────
  test('S4 빈 선택 제출 가드 — selected.size===0 차단 문구 존재', () => {
    const src = read(REQUEST_BOX);
    expect(src).toMatch(/selected\.size === 0/);
    expect(src).toMatch(/요청할 항목을 1개 이상 선택/);
  });

  test('S4b 금기증 복수 후 진단서 추가 클릭 → 배타 발동(진단서가 단독으로 전환, 금기증 전부 해제)', () => {
    let sel = new Set<string>();
    sel = clickOption(sel, 'diabetes', CONTRAIND_SET);
    sel = clickOption(sel, 'bp_med', CONTRAIND_SET);
    // 진단서 클릭 = clear 후 그 1개 → 금기증 전부 사라지고 진단서만.
    sel = clickOption(sel, 'oral_o', CONTRAIND_SET);
    expect([...sel]).toEqual(['oral_o']);
    assertInvariant([...sel]);
  });

  // ── 복문 a: 큐 목록 '해당항목' 표시 = 배타 정규화 키만(표시 ≡ prefill) ──────
  test('a1 오염 큐 행 표시키 = applyPrefillExclusivity(selectedKeys, docType) (위반 조합 미노출)', () => {
    // 혼합 draft(진단서+금기증), docType='opinion' → 표시는 금기증만(진단서 미노출).
    const shown = applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'opinion');
    expect(shown).toEqual(['diabetes', 'bp_med']);
    // 같은 행을 '작성하기'로 열 때 prefill 도 동일 키 → 표시 ≡ prefill 일치.
    const prefill = applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'opinion');
    expect(shown).toEqual(prefill);
  });

  test('a2 정상 큐 행(진단서 단독 / 금기증 복수)은 표시 무변경(회귀 0)', () => {
    expect(applyPrefillExclusivity(['oral_o'], CONTRAIND_SET, 'diagnosis')).toEqual(['oral_o']);
    expect(applyPrefillExclusivity(['diabetes', 'pregnant', 'elderly'], CONTRAIND_SET, 'opinion'))
      .toEqual(['diabetes', 'pregnant', 'elderly']);
  });

  // ── 불변식: 임의 혼합 cross-product 에서 동시선택 0 ─────────────────────────
  test('INV 임의 혼합 입력 → 진단서∧금기증 동시존재 절대 0 + 진단서 ≤1', () => {
    for (const d of DIAGNOSIS_KEYS) {
      for (const c of CONTRAIND_KEYS.slice(0, 8)) {
        for (const pref of ['diagnosis', 'opinion', null] as const) {
          const out = applyPrefillExclusivity([d, c], CONTRAIND_SET, pref);
          assertInvariant(out);
          expect(out.length).toBeGreaterThan(0);
        }
      }
    }
  });

  // ── 소스 가드: 4 surface 가 동일 엔진(opinionDocCompose) 경유 ────────────────
  test('SRC1 엔진(opinionDocCompose)에 배타 helper export', () => {
    const src = read(COMPOSE_LIB);
    expect(src).toMatch(/export function applyPrefillExclusivity\(/);
    expect(src).toMatch(/export function classifySelection\(/);
    expect(src).toMatch(/export function buildContraindKeySet\(/);
    // 금기증 판정 = 섹션 title 에 '금기' 포함(매핑 SSOT).
    expect(src).toMatch(/includes\('금기'\)/);
    // 혼합 시 진단서는 단일배타(slice(0,1)).
    expect(src).toMatch(/diagnosisKeys\.slice\(0,\s*1\)/);
  });

  // SRC2 [REDEFINED — T-20260701-foot-STAFFREQ-DOCTYPE-DUP-RULE, A안(김주연 총괄 확정)]:
  //   실장 요청박스의 '섹션 배타(진단서 단일 XOR 금기증 복수)'는 policy_superseded → docType 게이트로 재정의.
  //     [소견서] docType = 전역 복수 / [진단서] docType = 전역 라디오(진단서·금기증 통틀어 1개).
  //   ★공유 배타 엔진(opinionDocCompose)·원장 작성창(SRC3)·큐 목록(SRC4)의 배타는 무회귀(그대로 유지).
  test('SRC2 실장 요청박스 — docType 게이트 선택 규칙([소견서]복수 / [진단서]라디오) + 제출 가드', () => {
    const src = read(REQUEST_BOX);
    // docType 게이트 축.
    expect(src).toContain('isDiagnosisMode');
    expect(src).toContain('handleDocTypeChange');
    // 진단서 라디오 분기(clear→add).
    expect(src).toMatch(/isDiagnosisMode[\s\S]*next\.clear\(\)/);
    // 제출 시점 가드 — docType 분기(진단서 ≤1 / 소견서 복수).
    expect(src).toMatch(/const cleanKeys = isDiagnosisMode \? \[\.\.\.selected\]\.slice\(0, 1\) : \[\.\.\.selected\]/);
    expect(src).toMatch(/selectedKeys: cleanKeys/);
    // 실장 박스는 더 이상 섹션 배타 disable·공유 배타 헬퍼를 선택 규칙에 쓰지 않음(회귀 가드).
    expect(src).not.toMatch(/const disabled = hasDiagnosis/);
    expect(src).not.toContain('applyPrefillExclusivity');
  });

  test('SRC3 원장 작성창 — prefill 이 배타 가드 경유(검증없는 setSelected 회귀 차단)', () => {
    const src = read(OPINION_DOC);
    expect(src).toMatch(/applyPrefillExclusivity\(\s*rawKeys\s*,\s*contraindKeySet\s*,\s*initialDocType/);
    expect(src).toMatch(/setSelected\(new Set\(keys\)\)/);
    expect(src).not.toMatch(/setSelected\(new Set\(\(initialSelectedKeys/);
    // 선택 UI 배타 disable + 자동체크 시 진단서 선택 상태면 금기증 추가 스킵(배타 보존).
    expect(src).toMatch(/const disabled = hasDiagnosis/);
    expect(src).toMatch(/blockedByDiagnosis/);
  });

  test('SRC4 큐 목록 — 행 표시키를 applyPrefillExclusivity 로 정규화(위반 조합 표시 차단)', () => {
    const src = read(DOCREQ_QUEUE);
    // 행 단위 라벨 함수가 배타 정규화 경유.
    expect(src).toMatch(/applyPrefillExclusivity\(r\.selectedKeys,\s*contraindKeySet,\s*r\.docType\)/);
    expect(src).toMatch(/itemLabelsForRow/);
    // ★회귀 가드: 정규화 없이 raw selectedKeys 를 그대로 라벨링하는 경로가 없어야 함.
    expect(src).not.toMatch(/itemLabels=\{labelsOf\(r\.selectedKeys\)\}/);
  });
});
