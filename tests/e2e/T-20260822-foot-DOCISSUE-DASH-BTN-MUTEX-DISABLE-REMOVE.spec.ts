/**
 * E2E spec — T-20260822-foot-DOCISSUE-DASH-BTN-MUTEX-DISABLE-REMOVE
 *
 * 진료대시보드 서류발행(소견서/진단서) 팝업 — 문서유형 버튼 MUTEX-DISABLE 제거 → 자동전환(radio-switch).
 * ★문지은 대표원장(U0ALGAAAJAV) 답변 B(자동 전환 방식) 확정(MSG-20260822-104343-pifs, §8 충돌 게이트 confirm 완료):
 *   - 버튼은 전부 클릭 가능(비활성 제거).
 *   - 다른 서류 버튼 클릭 시 이전 선택 자동 해제 → 단일 docType 무결성 유지.
 *   - applyPrefillExclusivity 불변식 보존(무결성은 disable 아닌 자동전환으로 확보).
 *   - (a) 완전폐기(동시선택 허용·06-29 회귀)는 기각.
 *
 * 검증(티켓 완료조건 = 정상 발급 회귀0: 진단서↔금기증 혼합 logic-broken 재발 없음):
 *   S1 (버튼 전부 클릭 가능)   — MUTEX-DISABLE 제거: OpinionDocTab 옵션버튼에 `const disabled = hasDiagnosis`·
 *                                `disabled={disabled}` 부재(정적 소스 가드).
 *   S2 (자동전환·진단서→금기증) — 진단서 선택 중 금기증 클릭 → 진단서 자동해제, 금기증만.
 *   S3 (자동전환·금기증→진단서) — 금기증 복수 선택 중 진단서 클릭 → 금기증 전부 자동해제, 진단서 단독.
 *   S4 (금기증끼리 복수 유지)   — 금기증↔금기증은 자동해제 없이 복수 토글(진단서 미침투).
 *   S5 (불변식)               — 임의 클릭 순서 cross-product 에서 진단서∧금기증 동시존재 절대 0 + 진단서 ≤1.
 *   S6 (prefill 불변식 보존)   — applyPrefillExclusivity 는 무변경(06-29 e0b29357/2a725649 불변식 유지).
 *   S7 (소스 가드)            — handleOptionClick 자동전환 배선 존재 + prefill 이 applyPrefillExclusivity 경유.
 *   S8 (별개 축 보존)         — issuedBy 공백 disabled 가드(issuerMatchesSigning: doctorId !== '') 무회귀.
 *
 * 스타일: 정본(OpinionDocTab.handleOptionClick / opinionDocCompose) 로직 1:1 모사 + readFileSync 정적 소스 가드.
 *   auth/DB 비의존 순수 검증(DOCREQ-DIAGCERT-CONTRA-MUTEX / OPINIONDOC-PREFILL-EXCLUSIVE-GUARD 동일 컨벤션).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';
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

// ── 정본 모사: applyPrefillExclusivity (opinionDocCompose.ts) — 불변식 보존 검증용 ──
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

// ── 정본 모사: handleOptionClick (T-20260822 자동전환/radio-switch 반영) ──────────
//   금기증 클릭 → (진단서=비-금기증 선택 자동해제) + 금기증 토글(복수).
//   진단서 클릭 → 이미 선택이면 해제, 아니면 그 1개만(금기증 포함 다른 선택 전부 해제 = 단일배타).
function clickOption(prev: Set<string>, optKey: string, contraindKeySet: Set<string>): Set<string> {
  const isContraind = contraindKeySet.has(optKey);
  const next = new Set(prev);
  if (isContraind) {
    for (const k of [...next]) if (!contraindKeySet.has(k)) next.delete(k);
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

test.describe('DOCISSUE-DASH-BTN-MUTEX-DISABLE-REMOVE — 자동전환(radio-switch) + 혼합 0', () => {
  // ── S1: 버튼 전부 클릭 가능(MUTEX-DISABLE 제거) ──────────────────────────────
  test('S1 옵션버튼 MUTEX-DISABLE 제거 — 배타 disable 판정·disabled 바인딩 부재', () => {
    const src = read(OPINION_DOC);
    // 이전 배타 disable 판정(옵션버튼)이 되살아나지 않도록 lock.
    expect(src).not.toMatch(/const disabled = hasDiagnosis/);
    // renderOptBtn 옵션버튼에 disabled 바인딩 부재(전부 클릭 가능).
    expect(src).not.toMatch(/onClick=\{\(\) => handleOptionClick\(opt\)\}[\s\S]{0,120}disabled=\{disabled\}/);
    // 옵션버튼 title 이 disable 안내문(단일선택입니다/함께 선택할 수 없습니다)을 더 이상 노출하지 않음.
    expect(src).not.toContain('진단서(표준)는 단일선택입니다');
    expect(src).not.toContain('금기증을 선택 중입니다. 진단서(표준)는 함께 선택할 수 없습니다');
  });

  // ── S2: 자동전환 — 진단서 선택 중 금기증 클릭 ────────────────────────────────
  test('S2 진단서 선택 중 → 금기증 클릭 = 진단서 자동해제(혼합 0)', () => {
    let sel = new Set(['oral_o']);
    sel = clickOption(sel, 'diabetes', CONTRAIND_SET);
    expect([...sel]).toEqual(['diabetes']);
    assertInvariant([...sel]);
  });

  // ── S3: 자동전환 — 금기증 복수 선택 중 진단서 클릭 ───────────────────────────
  test('S3 금기증 복수 중 → 진단서 클릭 = 금기증 전부 자동해제, 진단서 단독', () => {
    let sel = new Set(['diabetes', 'bp_med', 'pregnant']);
    sel = clickOption(sel, 'medical_staff', CONTRAIND_SET);
    expect([...sel]).toEqual(['medical_staff']);
    assertInvariant([...sel]);
  });

  // ── S4: 금기증끼리 복수 유지(진단서 미침투) ──────────────────────────────────
  test('S4 금기증↔금기증 = 자동해제 없이 복수 토글', () => {
    let sel = new Set<string>();
    sel = clickOption(sel, 'diabetes', CONTRAIND_SET);
    sel = clickOption(sel, 'bp_med', CONTRAIND_SET);
    sel = clickOption(sel, 'liver_disease', CONTRAIND_SET);
    expect([...sel].sort()).toEqual(['bp_med', 'diabetes', 'liver_disease'].sort());
    // 재클릭 = 개별 해제(복수 유지).
    sel = clickOption(sel, 'bp_med', CONTRAIND_SET);
    expect([...sel].sort()).toEqual(['diabetes', 'liver_disease'].sort());
    assertInvariant([...sel]);
  });

  // ── S5: 불변식 — 임의 클릭 순서 cross-product 에서 혼합 0 ────────────────────
  test('S5 임의 클릭 순서(진단서×금기증×진단서) → 진단서∧금기증 동시존재 절대 0 + 진단서 ≤1', () => {
    for (const d1 of DIAGNOSIS_KEYS) {
      for (const c of CONTRAIND_KEYS.slice(0, 8)) {
        for (const d2 of DIAGNOSIS_KEYS) {
          let sel = new Set<string>();
          sel = clickOption(sel, d1, CONTRAIND_SET);   // 진단서
          assertInvariant([...sel]);
          sel = clickOption(sel, c, CONTRAIND_SET);    // 금기증 → 진단서 자동해제
          assertInvariant([...sel]);
          sel = clickOption(sel, d2, CONTRAIND_SET);   // 진단서 → 금기증 자동해제
          assertInvariant([...sel]);
          expect([...sel]).toEqual([d2]);
        }
      }
    }
  });

  // ── S6: prefill 불변식 보존(06-29 e0b29357/2a725649 불변식 유지) ─────────────
  test('S6 applyPrefillExclusivity 불변식 무변경 — 혼합 방어 + 정상 무변경', () => {
    // 혼합 prefill 방어: docType=diagnosis → 진단서 단독 / opinion·null → 금기증 복수.
    expect(applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'diagnosis')).toEqual(['oral_o']);
    expect(applyPrefillExclusivity(['oral_o', 'diabetes', 'bp_med'], CONTRAIND_SET, 'opinion')).toEqual(['diabetes', 'bp_med']);
    expect(applyPrefillExclusivity(['medical_staff', 'liver_disease', 'pregnant'], CONTRAIND_SET, null)).toEqual(['liver_disease', 'pregnant']);
    // 정상 prefill 무변경(회귀 0).
    expect(applyPrefillExclusivity(['oral_o'], CONTRAIND_SET, 'diagnosis')).toEqual(['oral_o']);
    expect(applyPrefillExclusivity(['diabetes', 'bp_med', 'pregnant'], CONTRAIND_SET, 'opinion')).toEqual(['diabetes', 'bp_med', 'pregnant']);
  });

  // ── S7: 소스 가드 — 자동전환 배선 + prefill 배타 엔진 경유 ────────────────────
  test('S7 handleOptionClick 자동전환 배선 + prefill applyPrefillExclusivity 경유', () => {
    const src = read(OPINION_DOC);
    // 금기증 클릭 시 진단서(비-금기증) 자동해제 배선(radio-switch).
    expect(src).toMatch(/for \(const k of \[\.\.\.next\]\) if \(!contraindKeySet\.has\(k\)\) next\.delete\(k\)/);
    // 진단서 단일배타(clear→add) 분기 유지.
    expect(src).toMatch(/next\.clear\(\);\s*\n\s*next\.add\(opt\.key\)/);
    // prefill 이 배타 엔진 경유(검증없는 setSelected 회귀 차단) — 불변식 보존.
    expect(src).toMatch(/applyPrefillExclusivity\(\s*rawKeys\s*,\s*contraindKeySet\s*,\s*initialDocType/);
    expect(src).toMatch(/setSelected\(new Set\(keys\)\)/);
  });

  // ── S7b: 엔진(opinionDocCompose) 배타 helper 무회귀 ──────────────────────────
  test('S7b opinionDocCompose 배타 helper export 무회귀(불변식 SSOT)', () => {
    const src = read(COMPOSE_LIB);
    expect(src).toMatch(/export function applyPrefillExclusivity\(/);
    expect(src).toMatch(/export function classifySelection\(/);
    expect(src).toMatch(/diagnosisKeys\.slice\(0,\s*1\)/);
  });

  // ── S8: 별개 축 보존 — issuedBy 공백 disabled 가드(T-20260820 ISSUEDBY-EMPTY) 무회귀 ──
  test('S8 발행 issuedBy 공백 disabled 가드(issuerMatchesSigning: doctorId !== "") 보존', () => {
    const src = read(OPINION_DOC);
    // 발행자 미선택('') 이면 서명의 일치 실패 → 발행 disabled(별개 축, 이번 변경 무접촉).
    expect(src).toMatch(/issuerMatchesSigning = !hasSigningInfo \|\| \(doctorId !== '' && signingIds\.has\(doctorId\)\)/);
    // 발행 버튼 disabled 에 issuerMatchesSigning 축이 남아있음.
    expect(src).toMatch(/disabled=\{!canPublish[\s\S]{0,80}!issuerMatchesSigning\)\}/);
  });
});
