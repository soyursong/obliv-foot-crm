/**
 * T-20260806-foot-NHIS-LOOKUP-SOURCE-UNATTRIBUTED — 건보조회 딥링크 개시 시 source 초안 'hira_lookup' 프리셋
 *
 * Phase 1(T-20260724) 마지막 고리(N4) 미완: [건보조회] 딥링크를 112번 열었는데 등급 확정 시
 * insurance_grade_source 는 373:1(manual_input:hira_lookup) 로만 남았다. RC = InsuranceGradeSelect 가
 * 딥링크 조회 개시 상태(useNhisLookup.captureOpen)를 몰라 항상 'manual_input' 으로 폴백.
 *
 * FIX (prop 1개 + 초기값):
 *   A. InsuranceGradeSelect.Props 에 optional `lookupInProgress?: boolean` 추가 →
 *      draftSource 3폴백(:65 useState / :79 sync effect / :120 startEdit)을
 *      `lookupInProgress ? 'hira_lookup' : 'manual_input'` 프리셋으로 교체.
 *   B. CustomerChartPage 호출부에서 `lookupInProgress={nhis.captureOpen}` 전달.
 *
 * 강제 아님(프리셋): 라디오 4종·기존 source 값·수기 manual_input 우선. 파서 재도입 금지.
 * calc/RPC/감사 무접촉. 본 spec = 소스 wiring 정적검증 회귀 가드.
 *   (갤탭 실기기 클릭 QA = supervisor 종료게이트·이은상 팀장 field_soak 소관.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
function srcPath(rel: string): string {
  return resolve(__root, '../../src', rel);
}
const gradeSelectSrc = readSrc('components/insurance/InsuranceGradeSelect.tsx');
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');

// ──────────────────────────────────────────────────────────────────────
// FIX-A: InsuranceGradeSelect — lookupInProgress prop + draftSource 프리셋
// ──────────────────────────────────────────────────────────────────────
test.describe('FIX-A: lookupInProgress 프리셋 wiring', () => {
  test('Props 에 optional lookupInProgress?: boolean 선언', () => {
    expect(gradeSelectSrc).toMatch(/lookupInProgress\?:\s*boolean/);
    // 함수 파라미터 구조분해에 lookupInProgress 수신(default false 안전)
    expect(gradeSelectSrc).toMatch(/lookupInProgress\s*=\s*false/);
  });

  test('draftSource 3폴백이 hira_lookup 프리셋을 반영', () => {
    // 프리셋 표현식이 3회 등장 (:65 useState / :79 sync effect / :120 startEdit)
    const preset = gradeSelectSrc.match(/lookupInProgress\s*\?\s*'hira_lookup'\s*:\s*'manual_input'/g) ?? [];
    expect(preset.length).toBe(3);
  });

  test('출처 enum = hira_lookup — 미존재 값 nhis_lookup 사용 안 함', () => {
    // 정본 enum: manual_input | hira_lookup (nhis_lookup 은 미존재 값)
    expect(gradeSelectSrc).toContain("'hira_lookup'");
    expect(gradeSelectSrc).not.toContain('nhis_lookup');
    expect(chartSrc).not.toContain('nhis_lookup');
  });
});

// ──────────────────────────────────────────────────────────────────────
// FIX-B: CustomerChartPage — 호출부에서 captureOpen 전달
// ──────────────────────────────────────────────────────────────────────
test.describe('FIX-B: 딥링크 조회 개시 상태 전달', () => {
  test('InsuranceGradeSelect 호출부에 lookupInProgress={nhis.captureOpen}', () => {
    expect(chartSrc).toMatch(/lookupInProgress=\{nhis\.captureOpen\}/);
  });

  test('captureOpen 은 useNhisLookup 이 노출하는 boolean 상태', () => {
    expect(hookSrc).toMatch(/captureOpen:\s*boolean/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// DoD: 강제 아님(프리셋) — 기존값·수기 선택 우선, 회귀 0
// ──────────────────────────────────────────────────────────────────────
test.describe('DoD: 프리셋일 뿐 강제 아님 (기존값·라디오 선택 우선)', () => {
  test('기존 source 값이 있으면 유지 — 프리셋은 nullish 폴백에만 적용', () => {
    // `source ?? (lookupInProgress ? ...)` — source 가 존재하면 프리셋이 밀어내지 못함(DoD #4)
    const guarded = gradeSelectSrc.match(/source\s*\?\?\s*\(lookupInProgress\s*\?\s*'hira_lookup'\s*:\s*'manual_input'\)/g) ?? [];
    // sync effect(:79) + startEdit(:120) 두 지점에서 기존값 우선 폴백
    expect(guarded.length).toBe(2);
  });

  test('라디오 4종(source 선택) UI 보존 — 수기 선택으로 프리셋 덮어쓰기 가능', () => {
    expect(gradeSelectSrc).toContain('ALL_INSURANCE_GRADE_SOURCES');
    expect(gradeSelectSrc).toMatch(/setDraftSource/);
  });

  test('등급 write 는 오직 사람 [저장] 클릭 — 자동저장 없음(회귀 0)', () => {
    const saveMatches = gradeSelectSrc.match(/updateInsuranceGrade\(/g) ?? [];
    expect(saveMatches.length).toBe(1);
    expect(gradeSelectSrc).toMatch(/onClick=\{save\}/);
    // effect 로 등급을 저장하는 경로 없음(자동확정 금지 불변식)
    expect(gradeSelectSrc).not.toMatch(/useEffect\([\s\S]{0,600}updateInsuranceGrade/);
  });

  test('재산정 연쇄 유지 (insuranceGradeRefreshKey, 회귀 0)', () => {
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 무접촉: 파서 재도입 금지 + calc/RPC/감사 LOGIC-LOCK
// ──────────────────────────────────────────────────────────────────────
test.describe('무접촉: 파서 재도입 금지 + calc/RPC/감사 보존', () => {
  test('파서(nhisParse) 재도입 없음 — 의도적 롤백 유지', () => {
    expect(existsSync(srcPath('lib/nhisParse.ts'))).toBe(false);
    expect(gradeSelectSrc).not.toContain('nhisParse');
    expect(gradeSelectSrc).not.toContain('suggestedGrade');
    expect(hookSrc).not.toContain('nhisParse');
  });

  test('copayCalc.ts (급여 계산 LOGIC-LOCK) 무접촉 — 파일 존재', () => {
    expect(existsSync(srcPath('lib/copayCalc.ts'))).toBe(true);
  });

  test('performLookup 딥링크 + 감사 RPC 무접촉 — 정상 동작 유지', () => {
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
    expect(hookSrc).toMatch(/supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/);
  });

  test('update_insurance_grade write 경로 시그니처 불변 (source 그대로 전달)', () => {
    expect(gradeSelectSrc).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
  });
});
