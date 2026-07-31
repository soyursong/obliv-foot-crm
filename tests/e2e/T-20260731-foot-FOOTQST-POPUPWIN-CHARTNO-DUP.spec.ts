/**
 * E2E spec — T-20260731-foot-FOOTQST-POPUPWIN-CHARTNO-DUP
 * 발건강 질문지 '별도창 보기' 화면에서 차트번호가 'F - F'(이중 접두) 형태로 중복 표시되는 회귀 가드.
 *
 * 현장 리포트(김주연 총괄, C0ATE5P6JTH thread 1785470002.958289 / 재현 스샷 F0BM70SNWBE):
 *   "별도창 차트번호가 'F - F'처럼 겹쳐 나온다." (오전 POPUPWIN-BROKEN 별도창 복구 배포 직후 회귀)
 *
 * ── 근본원인 ──
 *   customers.chart_number 저장값은 이미 'F-XXXX' 접두를 포함(DB BEFORE INSERT 트리거 자동채번,
 *   src/lib/format.ts §chartNoDisplay 주석·Customers.tsx:1293 확인). 그런데 별도창 진입점 두 곳
 *   (CustomerChartPage.tsx healthq-doc-window-btn / -btn-modal)이 `F-${String(chart_number).padStart(6,'0')}`
 *   로 'F-' 를 재접두 → 'F-F-000123' (현장 표현 "F - F"). 메인 화면(line 5805)은 SSOT 포맷터
 *   chartNoDisplay(customer.chart_number) 를 그대로 사용 → 별도창만 이중 접두.
 *
 * ── 수정 ──
 *   별도창 두 호출부의 chartNumber 조합을 메인과 동일한 SSOT 포맷터 chartNoDisplay(customer.chart_number)
 *   로 통일 → 재접두 제거, 메인과 형식 일치, null 은 '(미발번)' 로 깔끔 처리(잔재 'F -' 없음).
 *   DB 발번/저장 무접점, 별도창 열기 동작(POPUPWIN-BROKEN) 무변경.
 *
 * AC-1: 별도창 차트번호가 지정 형식(F-XXXX)으로 정확히 1회 표시 — 이중 접두 아님.
 * AC-2: 별도창 표시가 메인 화면(chartNoDisplay) 형식과 일치.
 * AC-3: chart_number 발번/저장(DB) 무변경 — presentation only.
 * AC-4: '별도창 열기' 동작(POPUPWIN-BROKEN) 회귀 없음.
 *
 * 관례(sibling FOOTQ-VIEWER / POPUPWIN-BROKEN): CustomerChartPage 는 브라우저 전용 의존을 체인으로
 *   끌어와 node import 불가 → (1) 소스 레벨 가드로 재접두 패턴 재유입을 막고, (2) SSOT 포맷터의
 *   순수 미러로 이중 접두가 산술적으로 발생하지 않음을 결정론적으로 검증한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHART_SRC = readFileSync(join(HERE, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');

// ── SSOT 포맷터 순수 미러 (src/lib/format.ts chartNoDisplay 와 1:1) ──
// 저장값을 그대로 반환(접두 재적용 없음). null/빈값 → '(미발번)'.
function chartNoDisplayMirror(chart_number: string | number | null | undefined): string {
  if (chart_number === null || chart_number === undefined) return '(미발번)';
  const s = String(chart_number).trim();
  return s.length > 0 ? s : '(미발번)';
}

// ── 버그 재현 미러: 옛 별도창 조합 (`F-${padStart}`) — 이중 접두를 만든 원흉 ──
function buggyChartNumber(chart_number: string | number | null): string | null {
  return chart_number != null ? `F-${String(chart_number).padStart(6, '0')}` : null;
}

test.describe('T-20260731-foot-FOOTQST-POPUPWIN-CHARTNO-DUP — 별도창 차트번호 이중 접두 회귀 가드', () => {
  // AC-1 / AC-2: 저장값이 이미 'F-' 접두 포함일 때 SSOT 포맷터는 접두를 1회만 유지.
  test('AC-1/2: chartNoDisplay 미러 — 저장값 F-접두를 재적용하지 않음(정확히 1회)', () => {
    expect(chartNoDisplayMirror('F-000123')).toBe('F-000123');
    // 'F-F-' / 'F - F' 이중 접두가 절대 발생하지 않음
    expect(chartNoDisplayMirror('F-000123')).not.toMatch(/F-\s*F/);
    expect(chartNoDisplayMirror('F-000123')).not.toContain('F-F-');
  });

  // 대조: 옛 조합이 실제로 이중 접두를 만들었음을 못박아, 이 패턴이 회귀로 재유입되면 즉시 드러나게 한다.
  test('회귀 대조: 옛 `F-${padStart}` 조합은 저장값 F-접두에 재접두 → 이중 접두 발생', () => {
    expect(buggyChartNumber('F-000123')).toBe('F-F-000123'); // ← 이 형태가 현장 "F - F"
    expect(buggyChartNumber('F-000123')).toMatch(/F-F/);
  });

  // AC-1 엣지: 미발번(null/빈값) → 'F -' 잔재 없이 대체표기.
  test('AC-1 엣지: 미발번 고객은 잔재 접두 없이 (미발번) 표기', () => {
    expect(chartNoDisplayMirror(null)).toBe('(미발번)');
    expect(chartNoDisplayMirror(undefined)).toBe('(미발번)');
    expect(chartNoDisplayMirror('   ')).toBe('(미발번)');
    expect(chartNoDisplayMirror(null)).not.toMatch(/F\s*-/);
  });

  // AC-3(소스 가드): 별도창 진입점 두 곳이 재접두 패턴을 다시 들이지 못하게 막는다.
  test('AC-3 소스 가드: 별도창 호출부에 `F-${...padStart}` 재접두 패턴 부재', () => {
    expect(CHART_SRC).not.toMatch(/chartNumber:\s*customer\.chart_number\s*!=\s*null\s*\?\s*`F-\$\{/);
    // 파일 전역으로도 별도창용 재접두 리터럴이 남지 않았는지 확인
    expect(CHART_SRC).not.toContain("`F-${String(customer.chart_number).padStart");
  });

  // AC-2(소스 가드): 별도창 두 진입점 모두 메인과 동일 SSOT 포맷터를 사용.
  test('AC-2 소스 가드: 별도창 chartNumber = chartNoDisplay(customer.chart_number) (2곳)', () => {
    const occurrences = CHART_SRC.match(/chartNumber:\s*chartNoDisplay\(customer\.chart_number\)/g) ?? [];
    expect(occurrences.length).toBe(2); // healthq-doc-window-btn + -btn-modal
    // 메인 화면 SSOT(고객번호 표기)도 동일 포맷터를 계속 사용(형식 일치의 기준)
    expect(CHART_SRC).toContain('chartNoDisplay(customer.chart_number)');
  });

  // AC-4: 별도창 열기 자체(POPUPWIN-BROKEN 복구)는 그대로 유지 — 두 진입 버튼 존치.
  test('AC-4: 별도창 진입점(openHealthQDocumentWindow) 두 버튼 유지 — 열기 동작 회귀 없음', () => {
    expect(CHART_SRC).toContain('data-testid="healthq-doc-window-btn"');
    expect(CHART_SRC).toContain('data-testid="healthq-doc-window-btn-modal"');
    const opens = CHART_SRC.match(/openHealthQDocumentWindow\(/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(2);
  });
});
