/**
 * T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE — 건강보험 조회 3구역 정리
 *
 * REOPEN (2026-06-23 김주연 총괄 정정 "아예 이 구역을 없애달라고 한거야" — SUPERSEDES A안):
 *   A. 1구역(좌측 '건보 조회' 버튼) = 자격조회 단일 진입점(nhis.performLookup). 유지.
 *      성공 시 등급은 우측 InsuranceGradeSelect 반영 + 3구역 연쇄. 실패/미연동은 1구역 동선 인라인 최소 노출.
 *      셀프접수 동의 = 자동조회 트리거(scaffold).
 *   B. 3구역('급여 진료비 자동산정') = 1구역 자격조회 결과 반환 시 급여 금액 연쇄 자동계산.
 *      트리거 소스 2구역→1구역 전환돼도 끊김 0 (회귀 핵심: onGradeUpdated → insuranceGradeRefreshKey++).
 *   C/시나리오4. 2구역('건보공단 실시간 자격조회' 패널 + '외부조회' 링크) 전체 섹션 = 차트에서 제거.
 *      (이전 A안의 '버튼만 제거·결과뷰 유지'는 폐기.)
 *
 * 구현 방식: 자격조회 로직은 useNhisLookup 훅 공유. 차트(1구역)는 controller 로 훅을 직접 보유하고
 *   2구역 패널 렌더는 제거. NhisLookupPanel 자체는 기존 CheckInDetailSheet 사용처를 위해 잔존(내부 훅 모드).
 *
 * 본 spec 은 (1) NHIS 에러메시지 순수함수(API 미연동 → 안내문) 검증,
 * (2) 소스 wiring 정적 검증(1구역 트리거 일원화 / 2구역 전체 제거 / 3구역 연쇄 /
 *     셀프접수 동의 트리거 scaffold)으로 현장 클릭 시나리오 4건을 회귀 가드한다.
 * (DB/브라우저 불필요 — supervisor 실QA 는 갤탭 실기기 별도.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveNhisErrorMessage } from '../../src/hooks/useNhisLookup';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}

const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const panelSrc = readSrc('components/insurance/NhisLookupPanel.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');
const selfCheckInSrc = readSrc('pages/SelfCheckIn.tsx');

// ──────────────────────────────────────────────────────────────────────
// 시나리오 1 (일부): API 미연동 현행 — 1구역 자격조회 시도 시 미연동 안내(에러 메시지)
//   (메시지는 1구역 동선 인라인으로 노출. 2구역 결과뷰는 제거됨.)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: API 미연동 안내 (1구역 트리거)', () => {
  test('NHIS_NOT_CONFIGURED → "API가 아직 연동되지 않았습니다" 안내', () => {
    const msg = resolveNhisErrorMessage('NHIS_NOT_CONFIGURED');
    expect(msg).toContain('연동되지 않았');
    expect(msg).toContain('외부 조회 링크');
  });

  test('RRN_MISSING → 주민번호 입력 안내', () => {
    expect(resolveNhisErrorMessage('RRN_MISSING')).toContain('주민등록번호');
  });

  test('미정의 코드 → 일시 불가 + 외부링크 fallback', () => {
    const msg = resolveNhisErrorMessage(undefined);
    expect(msg).toContain('외부 조회 링크');
  });
});

// ──────────────────────────────────────────────────────────────────────
// A. 1구역 = 자격조회 단일 진입점
// ──────────────────────────────────────────────────────────────────────
test.describe('A. 1구역 자격조회 단일 진입점', () => {
  test('1구역 "조회" 버튼은 window.open 외부링크가 아니라 실시간 자격조회(nhisPerformLookup) 트리거', () => {
    // 좌측 '건보 조회' 행에서 더 이상 외부URL을 새창으로 열지 않는다.
    expect(chartSrc).not.toContain(
      "window.open('https://medicare.nhis.or.kr/portal/refer/selectReferInq.do', '_blank')",
    );
    // 1구역 버튼 클릭이 공유 트리거를 호출한다.
    expect(chartSrc).toMatch(/onClick=\{\s*\(\)\s*=>\s*\{\s*void nhisPerformLookup\(false\);\s*\}\s*\}/);
  });

  test('공유 자격조회 훅(useNhisLookup) 도입 + 1구역에서 controller 생성', () => {
    expect(chartSrc).toContain("import { useNhisLookup } from '@/hooks/useNhisLookup'");
    expect(chartSrc).toMatch(/const nhis = useNhisLookup\(/);
    expect(chartSrc).toMatch(/const \{ performLookup: nhisPerformLookup \} = nhis;/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오2: 셀프접수 동의 = 자동조회 트리거 (scaffold)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오2: 셀프접수 동의 = 자동조회 트리거', () => {
  test('hira_consent=true 진입/전환 시 1구역 자격조회 자동 트리거 (silent) effect 존재', () => {
    expect(chartSrc).toContain('hiraAutoTriggeredRef');
    // 동의(true) 일 때만, 고객당 1회, silent 로 트리거
    expect(chartSrc).toMatch(/void nhisPerformLookup\(false, \{ silent: true \}\)/);
    // effect 의존성에 hira_consent 포함 → 동의 토글 시 재발화
    expect(chartSrc).toMatch(/\[customer\?\.id, customer\?\.hira_consent, nhisPerformLookup\]/);
  });

  test('셀프접수(SelfCheckIn) 동의 저장부에 자동조회 scaffold 마커', () => {
    expect(selfCheckInSrc).toContain('T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE');
    expect(selfCheckInSrc).toContain('hira_consent');
  });

  test('동의 게이트 우회 옵션(bypassConsentGate) — 토글 직후 stale prop 대응', () => {
    expect(hookSrc).toContain('bypassConsentGate');
  });
});

// ──────────────────────────────────────────────────────────────────────
// B. 3구역 = 자격조회 결과 → 급여 자동산정 연쇄 (트리거 소스 전환에도 끊김 0)
// ──────────────────────────────────────────────────────────────────────
test.describe('B. 3구역 자동산정 연쇄 유지', () => {
  test('조회 성공 → onGradeUpdated → insuranceGradeRefreshKey++ (3구역 Chart2InsuranceCalcPanel 재트리거)', () => {
    // 훅 onGradeUpdated 콜백이 등급 갱신 시 호출됨
    expect(hookSrc).toMatch(/onGradeUpdated\?\.\(\)/);
    // 차트에서 onGradeUpdated 가 refreshKey 를 증가시켜 3구역 연쇄
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    // 3구역 패널은 refreshTrigger 로 동일 키 구독 (연쇄 유지)
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });

  test('nhis 훅의 onGradeUpdated 가 nhisOnGradeUpdated(차트 연쇄 콜백)에 연결', () => {
    expect(chartSrc).toMatch(/\{ onGradeUpdated: nhisOnGradeUpdated \}/);
    expect(chartSrc).toMatch(/const nhisOnGradeUpdated = useCallback\(/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오4/C. 2구역('건보공단 실시간 자격조회' 패널 + 외부조회 링크) 전체 섹션 제거
//   (재정의 — SUPERSEDES A안: 버튼만이 아니라 구역 UI 전체를 차트에서 제거)
// ──────────────────────────────────────────────────────────────────────
test.describe('C/시나리오4. 2구역 전체 섹션 제거', () => {
  test('차트에서 NhisLookupPanel import/렌더가 모두 제거됨 (2구역 패널 없음)', () => {
    // import 문 제거 (주석 언급은 허용 — 실제 import/JSX 만 가드)
    expect(chartSrc).not.toMatch(/import\s*\{[^}]*NhisLookupPanel/);
    // JSX 렌더 제거
    expect(chartSrc).not.toContain('<NhisLookupPanel');
  });

  test('차트에서 2구역 외부조회 링크(요양기관 정보마당 medicare.nhis) 제거', () => {
    // 외부 자격조회 링크 URL 완전 제거
    expect(chartSrc).not.toContain('medicare.nhis.or.kr');
    // 외부조회 버튼(ExternalLink 아이콘 JSX) 제거
    expect(chartSrc).not.toMatch(/<ExternalLink/);
  });

  test('결과 노출 지점은 InsuranceGradeSelect(자격등급)로 유지 — 결과뷰 없이도 등급 노출', () => {
    // 2구역 결과뷰는 사라지되, 자격등급 노출/입력 컴포넌트는 유지(스펙 C: 최소 노출 + 3구역 입력원).
    expect(chartSrc).toContain('<InsuranceGradeSelect');
  });

  test('1구역 동선 인라인 에러 노출 — nhis.error 를 좌측 건보조회 행에 표시 (2구역 결과뷰 대체)', () => {
    expect(chartSrc).toMatch(/\{nhis\.error && \(/);
    expect(chartSrc).toMatch(/nhis\.error\.message/);
  });

  test('회귀: NhisLookupPanel 자체는 잔존하고 기존 사용처(CheckInDetailSheet)는 내부 훅+버튼 그대로', () => {
    const checkInSrc = readSrc('components/CheckInDetailSheet.tsx');
    // CheckInDetailSheet 는 여전히 NhisLookupPanel 을 내부 훅 모드(트리거 버튼 포함)로 사용
    const usages = checkInSrc.match(/<NhisLookupPanel[\s\S]*?\/>/g) ?? [];
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) {
      expect(u).not.toContain('hideTrigger');
      expect(u).not.toContain('controller=');
    }
    // 패널은 내부 훅 모드에서 트리거 버튼 + 결과뷰(자격등급/본인부담률)를 유지
    expect(panelSrc).toMatch(/\{!hideTrigger && \(/);
    expect(panelSrc).toContain('자격등급');
    expect(panelSrc).toContain('본인부담률');
  });
});
