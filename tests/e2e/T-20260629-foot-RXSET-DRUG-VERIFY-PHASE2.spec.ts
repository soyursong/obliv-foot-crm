/**
 * E2E spec — T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2
 *
 * 부모(T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY)에서 1차 HIRA 코드축(상품명+코드) 검증 배지는 라이브.
 * 본 PHASE2 = 그 위의 정확도 보강분. 본 착수분(gate-clean carve)은:
 *   · AC-7 식약처(MFDS) 2차 성분축 code-wiring — 순수 정확대조 로직 + Edge Function 스캐폴드(키 부재 graceful degrade).
 *   · 순수 판정(compareIngredient/normalizeIngredientName/mergeIngredientAxis) = drugVerification.ts(외부 import 0).
 *   · async invoke(verifyDrugIngredient) = drugIngredientVerify.ts, 플래그 기본 OFF → 네트워크 호출 0(inert).
 *
 * ★게이트 유지(본 착수 비범위 — 후속 트랙):
 *   · AC-3 검증결과 영속 캐시 스키마 = ADDITIVE + data-architect CONSULT 선행(da_consult:pending) → 본 커밋 스키마 0.
 *   · AC-8 HIRA 명칭 인덱스 대량 적재 = dry-run+DA 게이트 → 본 커밋 대량적재 0.
 *   · AC-7 식약처 실호출 = 키(data.go.kr) 주입(supervisor Edge Secret) 후 활성 — 본 커밋은 code-wiring + graceful degrade.
 *
 * canon(부모 drug_identity_rule): 퍼지·용량표기 자동연결 금지 — 정확일치만 'matched'.
 * 형제 RXSET-* spec 동형 — 순수 판정 단위검증 + 정본 소스 정적 단언(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareIngredient,
  normalizeIngredientName,
  mergeIngredientAxis,
  computeDrugVerifyVerdict,
  type DrugVerifyVerdict,
} from '../../src/lib/drugVerification';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MODEL = 'src/lib/drugVerification.ts';
const INVOKE = 'src/lib/drugIngredientVerify.ts';
const EDGE = 'supabase/functions/mfds-ingredient-verify/index.ts';
const REGISTRY = 'src/lib/externalServices.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: 성분명 정규화 — canon(용량표기 미제거·퍼지 없음)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7: normalizeIngredientName — trim+공백축약+소문자 fold', () => {
  expect(normalizeIngredientName('  아목시실린   수화물 ')).toBe('아목시실린 수화물');
  expect(normalizeIngredientName('Amoxicillin')).toBe('amoxicillin');
  expect(normalizeIngredientName(null)).toBe('');
  expect(normalizeIngredientName(undefined)).toBe('');
});

test('AC-7: normalizeIngredientName — 용량/함량 표기 미제거(auto-merge 금지 정합)', () => {
  // 250mg 는 보존되어야 한다 → "아목시실린 250mg" ≠ "아목시실린".
  expect(normalizeIngredientName('아목시실린 250mg')).toBe('아목시실린 250mg');
  expect(normalizeIngredientName('아목시실린 250mg')).not.toBe(normalizeIngredientName('아목시실린'));
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: compareIngredient — 정확일치 판정(matched/mismatch/unverified)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7: compareIngredient — 정확일치 → matched(대소문자·공백 흡수)', () => {
  expect(compareIngredient('아목시실린', ['세파클러', '아목시실린'])).toBe('matched');
  expect(compareIngredient(' Amoxicillin ', ['amoxicillin'])).toBe('matched');
});

test('AC-7: compareIngredient — 불일치 → mismatch(공식목록은 있으나 정확일치 없음)', () => {
  expect(compareIngredient('아목시실린', ['세파클러'])).toBe('mismatch');
});

test('AC-7: compareIngredient — ★퍼지/용량표기 자동연결 금지(부분일치 mismatch)', () => {
  // 용량표기 다른 것을 같은 성분으로 자동연결하지 않는다 → mismatch.
  expect(compareIngredient('아목시실린 250mg', ['아목시실린'])).toBe('mismatch');
  expect(compareIngredient('아목시실린', ['아목시실린 500mg'])).toBe('mismatch');
  // 부분문자열이어도 정확일치 아니면 mismatch(퍼지 금지).
  expect(compareIngredient('세파', ['세파클러'])).toBe('mismatch');
});

test('AC-7: compareIngredient — 대조불가(내부/공식 부재) → unverified(비차단)', () => {
  expect(compareIngredient('', ['아목시실린'])).toBe('unverified');
  expect(compareIngredient(null, ['아목시실린'])).toBe('unverified');
  expect(compareIngredient('아목시실린', [])).toBe('unverified');
  expect(compareIngredient('아목시실린', null)).toBe('unverified');
  expect(compareIngredient('아목시실린', ['', null, undefined])).toBe('unverified');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: mergeIngredientAxis — 1차 status 불변, unverified 는 조용히 접기
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7: mergeIngredientAxis — 1차 status 절대 불변', () => {
  const base: DrugVerifyVerdict = { status: 'verified' };
  expect(mergeIngredientAxis(base, 'matched')).toEqual({ status: 'verified', ingredient: 'matched' });
  expect(mergeIngredientAxis(base, 'mismatch')).toEqual({ status: 'verified', ingredient: 'mismatch' });
  // 원본 불변(순수).
  expect(base).toEqual({ status: 'verified' });
});

test('AC-7: mergeIngredientAxis — unverified/누락 → 보조표기 생략(status 유지)', () => {
  const base: DrugVerifyVerdict = { status: 'unverified' };
  expect(mergeIngredientAxis(base, 'unverified')).toEqual({ status: 'unverified' });
  expect(mergeIngredientAxis(base, null)).toEqual({ status: 'unverified' });
  expect(mergeIngredientAxis(base, undefined)).toEqual({ status: 'unverified' });
  expect(mergeIngredientAxis(null, 'matched')).toBeNull();
});

test('AC-7: mergeIngredientAxis — 1차 판정과 조합(부모 computeDrugVerifyVerdict 정합)', () => {
  const v = computeDrugVerifyVerdict({ code_source: 'official', claim_code: '642900010' });
  expect(v).toEqual({ status: 'verified' });
  expect(mergeIngredientAxis(v, 'mismatch')).toEqual({ status: 'verified', ingredient: 'mismatch' });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: async invoke 레이어 — 플래그 기본 OFF(inert) + graceful degrade(정본 소스 단언)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7: drugIngredientVerify — 플래그 게이트 + graceful degrade 존재', () => {
  expect(existsSync(join(ROOT, INVOKE))).toBeTruthy();
  const src = read(INVOKE);
  // 플래그 기본 OFF → 활성화 전 네트워크 호출 0.
  expect(src).toContain('isIngredientVerifyEnabled');
  expect(src).toContain('VITE_MFDS_INGREDIENT_VERIFY');
  expect(src).toMatch(/if \(!isIngredientVerifyEnabled\(\)\) return 'unverified'/);
  // 어떤 실패도 'unverified' 로 흡수(비차단) — throw 로 처방 막지 않음.
  expect(src).toContain('catch');
  expect(src).toContain("return 'unverified'");
  // Edge Function 이름은 SSOT 레지스트리 참조(하드코딩 금지).
  expect(src).toContain('EDGE_FUNCTIONS.MFDS_INGREDIENT_VERIFY');
});

test('AC-7: externalServices — MFDS_INGREDIENT_VERIFY EF 이름 SSOT 등록', () => {
  const src = read(REGISTRY);
  expect(src).toMatch(/MFDS_INGREDIENT_VERIFY:\s*'mfds-ingredient-verify'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: Edge Function — 키 server-side(평문하드코딩 금지) + 미설정 graceful degrade
// ─────────────────────────────────────────────────────────────────────────────
test('AC-7: Edge Function — secret 미설정 시 graceful degrade(503 unverified)', () => {
  expect(existsSync(join(ROOT, EDGE))).toBeTruthy();
  const src = read(EDGE);
  // 키는 Deno.env(Edge Secret)에서만 — 클라이언트 노출·평문하드코딩 금지.
  expect(src).toContain("Deno.env.get('MFDS_API_KEY')");
  expect(src).toContain('MFDS_NOT_CONFIGURED');
  // 키/URL 미설정 → 비차단 unverified.
  expect(src).toMatch(/apiKey === ''\s*\|\|\s*apiUrl === ''/);
  expect(src).toContain("ingredient: 'unverified'");
  // JWT 인증 게이트.
  expect(src).toContain('UNAUTHORIZED');
  // 식약처 장애도 비차단(502 unverified).
  expect(src).toContain('MFDS_API_ERROR');
  // 타임아웃 가드(AbortController).
  expect(src).toContain('AbortController');
});

test('AC-7: Edge Function — 평문 API 키 하드코딩 부재(보안)', () => {
  const src = read(EDGE);
  // data.go.kr serviceKey 등 긴 하드코딩 시크릿 리터럴 부재(간이 가드).
  expect(src).not.toMatch(/serviceKey['"]\s*[:=]\s*['"][A-Za-z0-9%+/=]{20,}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 게이트 회귀 가드 — 본 커밋은 스키마/대량적재 0 (AC-3/AC-8 후속 트랙)
// ─────────────────────────────────────────────────────────────────────────────
test('gate: 순수 성분축은 신규 DB 스키마/enum 미도입(AC-3 캐시는 DA CONSULT 후속)', () => {
  const src = read(MODEL);
  // 순수 모듈 — supabase/DDL import 부재.
  expect(src).not.toContain("from './supabase'");
  expect(src).not.toContain('create table');
  // 성분축 canon 주석(용량표기 자동연결 금지) 명시.
  expect(src).toContain('용량표기 자동연결 금지');
});

test('gate: 부모 1차 코드축 모델 회귀 없음(verified/partial/unverified/pending 유지)', () => {
  const src = read(MODEL);
  for (const s of ['verified', 'partial', 'unverified', 'pending']) {
    expect(src).toContain(s);
  }
  // computeDrugVerifyVerdict(1차) 그대로 동작.
  expect(computeDrugVerifyVerdict({ code_source: 'custom', claim_code: 'LEGACY-1' })).toEqual({ status: 'unverified' });
});
