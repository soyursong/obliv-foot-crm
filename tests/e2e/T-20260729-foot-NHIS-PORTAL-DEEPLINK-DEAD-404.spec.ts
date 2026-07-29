/**
 * T-20260729-foot-NHIS-PORTAL-DEEPLINK-DEAD-404 — 폐기된 심층 딥링크 → 포털 홈 URL 교체
 *
 * RC: NHIS 딥링크(하드코딩 /portal/refer/selectReferInq.do 경로)가 공단 시스템 개선으로
 *   폐기 → soft-404(HTTP 200 + 에러본문). 앱은 정상 open 으로 인지하나 현장엔 404 →
 *   수기 자격조회 차단. 검증된 포털 홈 URL(https://medicare.nhis.or.kr)만 사용하도록 교체하고,
 *   포털 내 자격조회 메뉴 위치([자격확인] → [수진자 자격확인])를 안내 문구로 유도한다.
 *
 * 본 spec 은 소스 정적검증으로 (a) 하드코딩 딥링크 소멸 + 홈 URL 사용, (b) 안내 메뉴힌트 노출,
 *   (c) 버튼 title 의 dead 파서 잔재("붙여넣기") 제거, (d) MANUAL-ONLY canon(파서·자동확정 금지)
 *   보존을 회귀 가드한다. (갤탭 실기기 클릭 QA 는 supervisor 종료게이트·현장 field_soak 소관.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
const HOME_URL = 'https://medicare.nhis.or.kr';
const DEAD_PATH = 'selectReferInq.do';

const hookSrc = readSrc('hooks/useNhisLookup.ts');
const panelSrc = readSrc('components/insurance/NhisCapturePanel.tsx');
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const efSrc = readFileSync(
  resolve(__root, '../../supabase/functions/nhis-lookup/index.ts'),
  'utf-8',
);

// 소스에서 코드/문자열 리터럴만 추려 코멘트(수정 기록)에 남은 폐기경로를 오탐하지 않게 한다.
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */ 블록
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // // 라인 (URL 의 // 는 보존)
}

// ──────────────────────────────────────────────────────────────────────
// 시나리오 1: 하드코딩 심층 딥링크 소멸 → 검증된 포털 홈 URL 사용
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 폐기 딥링크 소멸 → 포털 홈 URL 교체', () => {
  test('FE 상수 NHIS_EXTERNAL_URL = 포털 홈 URL (심층경로 없음)', () => {
    expect(hookSrc).toMatch(
      /export const NHIS_EXTERNAL_URL = 'https:\/\/medicare\.nhis\.or\.kr';/,
    );
  });

  test('EF 상수 FALLBACK_URL = 포털 홈 URL (심층경로 없음)', () => {
    expect(efSrc).toMatch(
      /const FALLBACK_URL = 'https:\/\/medicare\.nhis\.or\.kr';/,
    );
  });

  test('live 코드/문자열에 폐기 딥링크(selectReferInq.do) 잔재 0건', () => {
    // 코멘트(수정 기록)는 허용, 실행경로 리터럴엔 없어야 함
    expect(stripComments(hookSrc)).not.toContain(DEAD_PATH);
    expect(stripComments(panelSrc)).not.toContain(DEAD_PATH);
    expect(stripComments(chartSrc)).not.toContain(DEAD_PATH);
    expect(stripComments(efSrc)).not.toContain(DEAD_PATH);
  });

  test('딥링크 open 은 홈 URL 상수를 그대로 사용 (하드코딩 URL 직접 open 금지)', () => {
    expect(hookSrc).toContain(HOME_URL);
    // window.open 은 상수 참조만 (하드코딩 http URL 을 직접 open 하지 않음)
    expect(hookSrc).not.toMatch(/window\.open\(\s*['"]https?:\/\//);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 2: 포털 내 자격조회 메뉴 위치 안내 + 버튼 title 파서 잔재 제거
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오2: 메뉴 위치 안내 + title 정정', () => {
  test('안내 패널 = 메뉴 힌트([자격확인] → [수진자 자격확인]) 노출', () => {
    expect(panelSrc).toContain('data-testid="nhis-capture-menu-hint"');
    expect(panelSrc).toContain('[자격확인]');
    expect(panelSrc).toContain('[수진자 자격확인]');
    // 기존 안내 문구·포털 링크는 유지
    expect(panelSrc).toContain('data-testid="nhis-capture-guide"');
    expect(panelSrc).toContain('data-testid="nhis-capture-portal-link"');
  });

  test('건보조회 버튼 title 정정 = 파서 잔재("붙여넣기") 제거', () => {
    expect(chartSrc).toContain('공단 포털 자격조회 열기 (등급은 우측 건강보험 자격등급에서 직접 선택)');
    // dead 파서 개념(붙여넣기) 문구 소멸
    expect(chartSrc).not.toContain('결과 붙여넣기');
    expect(chartSrc).not.toContain('붙여넣은 등급');
  });
});

// ──────────────────────────────────────────────────────────────────────
// LOGIC-LOCK: MANUAL-ONLY canon 보존 (파서 부활·등급 자동확정 금지)
// ──────────────────────────────────────────────────────────────────────
test.describe('LOGIC-LOCK: MANUAL-ONLY canon 보존', () => {
  test('파서 경로 부활 없음 (nhisParse/applyPaste 토큰 부재)', () => {
    expect(hookSrc).not.toContain('nhisParse');
    expect(hookSrc).not.toContain('applyPaste');
    expect(panelSrc).not.toContain('nhis-capture-textarea');
    expect(panelSrc).not.toContain('onPaste');
  });

  test('등급 자동확정 로직 추가 없음 (조회 개시 감사 RPC 는 유지)', () => {
    // 훅은 딥링크 open + 감사 개시 + 패널 토글까지만 — live 코드에 등급 write 경로 없음
    // (헤더 코멘트의 "updateInsuranceGrade sink 재사용" 문서 참조는 허용)
    expect(stripComments(hookSrc)).not.toContain('updateInsuranceGrade');
    expect(hookSrc).toMatch(
      /supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/,
    );
  });
});
