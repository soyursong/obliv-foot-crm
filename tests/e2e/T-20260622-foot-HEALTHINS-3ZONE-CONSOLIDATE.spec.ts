/**
 * T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE — 반전 재작성 (SUPERSEDED by T-20260724-foot-NHIS-MANUAL-CAPTURE)
 *
 * 원 스펙은 "API 자동조회(EF fetch) 단일 진입점 + 2구역/외부링크 제거" 아키텍처를 못박았다.
 * T-20260724 pivot 으로 그 전제가 반전됨:
 *   - EF 자동조회 死호출 제거(공단 API blocked) → 포털 딥링크 + 수기 붙여넣기 캡처.
 *   - 외부 딥링크(medicare.nhis)는 "제거 대상"에서 "핵심 경로"로 반전(캡처 UI 내 재도입).
 *   - resolveNhisErrorMessage(EF 에러코드 변환) 제거.
 * 본 스펙은 반전된 불변식만 회귀 가드한다(3구역 자동산정 연쇄는 원 스펙에서 계승 — 여전히 유효).
 * (원 스펙이 읽던 NhisLookupPanel.tsx 는 폐기됨 → 참조 제거.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');

// ──────────────────────────────────────────────────────────────────────
// 반전 1: EF 자동조회 → 포털 딥링크 + 수기 캡처 (死호출 제거)
// ──────────────────────────────────────────────────────────────────────
test.describe('반전1: EF 자동조회 제거 → 포털 딥링크 + 수기 캡처', () => {
  test('EF fetch(functions/v1/nhis-lookup) 死호출 제거', () => {
    expect(hookSrc).not.toContain('functions/v1/nhis-lookup');
  });

  test('EF 에러코드 변환기(resolveNhisErrorMessage) 제거', () => {
    expect(hookSrc).not.toContain('resolveNhisErrorMessage');
  });

  test('딥링크(medicare.nhis)는 반전되어 핵심 경로로 재도입 — window.open', () => {
    expect(hookSrc).toContain('medicare.nhis.or.kr');
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
  });

  test('단일 choke point 유지: 두 트리거가 performLookup 로 수렴', () => {
    expect(chartSrc).toMatch(/const \{ performLookup: nhisPerformLookup \} = nhis;/);
    // 셀프접수 자동 effect 는 잔존하되 silent → no-op (평행경로 ② 무력화)
    expect(chartSrc).toMatch(/void nhisPerformLookup\(false, \{ silent: true \}\)/);
    expect(hookSrc).toMatch(/if \(silent\) return;/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 계승(여전히 유효): 3구역 자동산정 연쇄 — 트리거 소스 전환에도 끊김 0
// ──────────────────────────────────────────────────────────────────────
test.describe('계승: 3구역 자동산정 연쇄 유지', () => {
  test('등급 확정 → insuranceGradeRefreshKey++ → 3구역(Chart2InsuranceCalcPanel) 재트리거', () => {
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });

  test('결과 노출·확정 지점 = InsuranceGradeSelect 유지', () => {
    expect(chartSrc).toContain('<InsuranceGradeSelect');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 반전 2: 폐기된 2구역 패널(NhisLookupPanel) 참조 소거
// ──────────────────────────────────────────────────────────────────────
test.describe('반전2: NhisLookupPanel 폐기', () => {
  test('차트에 NhisLookupPanel import/JSX 없음 (폐기됨)', () => {
    expect(chartSrc).not.toMatch(/import\s*\{[^}]*NhisLookupPanel/);
    expect(chartSrc).not.toContain('<NhisLookupPanel');
  });

  test('대체: 인라인 캡처 패널(NhisCapturePanel)로 재구성', () => {
    expect(chartSrc).toContain('<NhisCapturePanel');
  });
});
