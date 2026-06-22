/**
 * T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE — 건강보험 조회 3구역 정리
 *
 * planner NEW-TASK (MSG-20260622-202554-tzka · 김주연 총괄, 마감 6/26, A안 confirm):
 *   A. 1구역(좌측 '건보 조회' 버튼) = 자격조회 단일 진입점.
 *      클릭 동작을 2구역('건보공단 실시간 자격조회') 로직과 동일화(nhis.performLookup).
 *      API 미연동 현행 = 2구역과 동일 안내 + 외부링크. 셀프접수 동의 = 자동조회 트리거(scaffold).
 *   B. 3구역('급여 진료비 자동산정') = 1구역 자격조회 결과 반환 시 급여 금액 연쇄 자동계산.
 *      트리거 소스 2구역→1구역 전환돼도 끊김 0 (회귀 핵심: onGradeUpdated → insuranceGradeRefreshKey++).
 *   C. 2구역 버튼 제거(hideTrigger) + 결과뷰 유지(A안 confirm).
 *
 * 구현 방식: 자격조회 로직을 useNhisLookup 훅으로 분리 → 1구역(트리거)·2구역(결과뷰)이 동일 controller 공유.
 *
 * 본 spec 은 (1) NHIS 에러메시지 순수함수(API 미연동 → 안내문) 검증,
 * (2) 소스 wiring 정적 검증(1구역 트리거 일원화 / 2구역 hideTrigger+controller / 3구역 연쇄 /
 *     셀프접수 동의 트리거 scaffold)으로 현장 클릭 시나리오 3건을 회귀 가드한다.
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
// 시나리오 1 (일부): API 미연동 현행 — 자격조회 시도 시 미연동 안내 + 외부링크 fallback
//   (1구역·2구역이 공유하는 동일 로직이므로 1구역 클릭 결과 = 2구역 안내와 동일)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: API 미연동 안내 (1·2구역 동일 로직)', () => {
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
// 시나리오3/C. 2구역 버튼 제거 + 결과뷰 유지 + 트리거 소스 전환 회귀
// ──────────────────────────────────────────────────────────────────────
test.describe('C. 2구역 버튼 제거 + 결과뷰 유지', () => {
  test('2구역 NhisLookupPanel = controller 주입 + hideTrigger (트리거 일원화)', () => {
    expect(chartSrc).toMatch(/<NhisLookupPanel[\s\S]*?controller=\{nhis\}[\s\S]*?hideTrigger[\s\S]*?\/>/);
  });

  test('패널: hideTrigger 면 자격조회/갱신 트리거 버튼 숨김, 결과뷰는 유지', () => {
    // hideTrigger 가 false 일 때만 트리거 버튼 블록 렌더
    expect(panelSrc).toMatch(/\{!hideTrigger && \(/);
    // 결과 표시(자격등급/본인부담률)는 hideTrigger 와 무관하게 유지
    expect(panelSrc).toContain('자격등급');
    expect(panelSrc).toContain('본인부담률');
  });

  test('패널: controller 주입 시 외부 상태 우선 사용 (1구역과 동일 상태 공유)', () => {
    expect(panelSrc).toMatch(/controller \?\? internal/);
  });

  test('회귀: 기존 사용처(CheckInDetailSheet)는 controller/hideTrigger 미사용 = 내부 훅+버튼 그대로', () => {
    const checkInSrc = readSrc('components/CheckInDetailSheet.tsx');
    // CheckInDetailSheet 의 NhisLookupPanel 사용에는 hideTrigger 가 없어야 함(기존 동작 보존)
    const usages = checkInSrc.match(/<NhisLookupPanel[\s\S]*?\/>/g) ?? [];
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) {
      expect(u).not.toContain('hideTrigger');
      expect(u).not.toContain('controller=');
    }
  });
});
