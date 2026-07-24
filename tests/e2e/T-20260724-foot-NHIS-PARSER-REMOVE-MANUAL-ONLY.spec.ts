/**
 * T-20260724-foot-NHIS-PARSER-REMOVE-MANUAL-ONLY — 붙여넣기 파서 롤백, 수기 선택 only
 *
 * 이은상 팀장 confirm=B ("어짜피 거의 수기 기반이라서 B가 나을 것 같아") — 배포된 붙여넣기
 * 자동파싱(파서) 방식을 롤백하고 수기 등급선택 only 로 되돌린다.
 *   데스크 동선: [건보조회] → 포털 딥링크 open + 감사 RPC → 데스크가 포털에서 자격여부 눈 확인 →
 *   우측 '건강보험 자격등급'(InsuranceGradeSelect)에서 등급 직접 선택 → [저장] → 재산정 연쇄.
 *
 * 파서(nhisParse)가 걸던 이름대조 STRONG 차단(거짓 "다른 환자" 경고) + 등급 자동입력이 제거된다.
 *   본 spec 은 소스 wiring 정적검증으로 (a) 파서경로 소멸 + (b) 수기 동선·재산정 연쇄·LOGIC-LOCK
 *   보존을 회귀 가드한다. (갤탭 실기기 클릭 QA 는 supervisor 종료게이트·이은상 팀장 field_soak 소관.)
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
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');
const panelSrc = readSrc('components/insurance/NhisCapturePanel.tsx');
const gradeSelectSrc = readSrc('components/insurance/InsuranceGradeSelect.tsx');

// ──────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 수기 동선 ([건보조회] → 포털 확인 → 등급 직접 선택 → 저장 → 재산정)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 수기 선택 동선 (딥링크 → 데스크 확인 → 직접 선택 → 저장)', () => {
  test('[건보조회] = 포털 딥링크 open + 안내 패널 노출 (EF 死호출 없음)', () => {
    // 단일 choke point 에서 포털 딥링크를 새 창으로 연다 (딥링크 유지)
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
    // EF fetch(functions/v1/nhis-lookup) 死호출 없음 (nhis-lookup EF 는 동결·호출 안 함)
    expect(hookSrc).not.toContain('functions/v1/nhis-lookup');
    // 버튼 클릭이 단일 트리거를 호출 + 안내 패널 렌더
    expect(chartSrc).toMatch(/onClick=\{\s*\(\)\s*=>\s*\{\s*void nhisPerformLookup\(false\);\s*\}\s*\}/);
    expect(chartSrc).toContain('<NhisCapturePanel');
    expect(chartSrc).toContain('import { NhisCapturePanel }');
  });

  test('안내 패널 = 포털 링크 + 수기 선택 안내 (붙여넣기 칸/파서 에코 없음)', () => {
    // 포털 링크 + 안내 텍스트 + 닫기(soft) 는 유지
    expect(panelSrc).toContain('data-testid="nhis-capture-portal-link"');
    expect(panelSrc).toContain('data-testid="nhis-capture-guide"');
    expect(panelSrc).toContain('data-testid="nhis-capture-close"');
    // 붙여넣기 칸·파서 에코·경고 UI 는 제거됨
    expect(panelSrc).not.toContain('nhis-capture-textarea');
    expect(panelSrc).not.toContain('onPaste');
    expect(panelSrc).not.toContain('nhis-capture-echo');
    expect(panelSrc).not.toContain('nhis-capture-warnings');
  });

  test('확정 = 사람이 등급 직접 선택 → [저장] → updateInsuranceGrade sink (source 사람선택)', () => {
    // InsuranceGradeSelect 는 9등급 버튼 그리드에서 사람이 클릭한 draftGrade 를 저장한다
    expect(gradeSelectSrc).toContain('setDraftGrade(g)');
    expect(gradeSelectSrc).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
    // save() 는 [저장] 버튼 onClick 에만 연결 — 자동 save 경로 없음
    expect(gradeSelectSrc).toMatch(/onClick=\{save\}/);
  });

  test('재산정 연쇄 유지 (updateInsuranceGrade → refreshTrigger, 회귀 0)', () => {
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 2: 거짓 "다른 환자" 경고 소멸 (파서·이름대조 STRONG 차단 제거)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오2: 파서·이름대조 STRONG 차단 제거 → 거짓 경고 소멸', () => {
  test('파서 모듈(nhisParse) 자체가 제거됨', () => {
    expect(existsSync(srcPath('lib/nhisParse.ts'))).toBe(false);
  });

  test('자동파싱·이름대조·등급 자동제안 경로가 소스에서 소멸', () => {
    // 훅: 파싱/제안/붙여넣기 컨트롤러 멤버 제거
    expect(hookSrc).not.toContain('nhisParse');
    expect(hookSrc).not.toContain('applyPaste');
    expect(hookSrc).not.toContain('parseAndEvaluate');
    // 거짓 "다른 환자" 경고를 만들던 이름대조 STRONG 차단 로직 토큰 부재
    // (name_mismatch 경고코드 = STRONG 차단의 실제 메커니즘, nhisParse 삭제로 소멸)
    expect(hookSrc).not.toContain('name_mismatch');
    expect(panelSrc).not.toContain('name_mismatch');
    expect(chartSrc).not.toContain('name_mismatch');
    // 차트: 파서 제안(suggested*) prop 전달 제거 → 수기 단일 경로
    expect(chartSrc).not.toContain('suggestedGrade=');
    expect(chartSrc).not.toContain('suggestionKey=');
    // InsuranceGradeSelect: suggested* prop·자동 프리필 effect 제거
    expect(gradeSelectSrc).not.toContain('suggestedGrade');
    expect(gradeSelectSrc).not.toContain('appliedSuggestionKey');
  });

  test('fail-safe 유지: 등급 write 는 오직 사람 [저장] 클릭 — 자동저장 없음', () => {
    // 등급 write(updateInsuranceGrade) 는 save() 안에만, save() 는 버튼 onClick 에만
    const saveMatches = gradeSelectSrc.match(/updateInsuranceGrade\(/g) ?? [];
    expect(saveMatches.length).toBe(1);
    // effect 로 등급을 저장하는 경로 없음(자동확정 금지 불변식)
    expect(gradeSelectSrc).not.toMatch(/useEffect\([\s\S]{0,600}updateInsuranceGrade/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// LOGIC-LOCK: 급여 계산·감사·EF 무접촉 보존
// ──────────────────────────────────────────────────────────────────────
test.describe('LOGIC-LOCK: calc/audit/EF 보존', () => {
  test('copayCalc.ts (급여 계산) 무접촉 — 파일 존재', () => {
    expect(existsSync(srcPath('lib/copayCalc.ts'))).toBe(true);
  });

  test('nhis-lookup EF 동결 — 파일 존재(제거 금지)', () => {
    const efPath = resolve(__root, '../../supabase/functions/nhis-lookup/index.ts');
    expect(existsSync(efPath)).toBe(true);
  });

  test('조회 개시 감사 RPC 유지 (prod 적용 완료, 재적용 불요)', () => {
    expect(hookSrc).toMatch(/supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/);
  });
});
