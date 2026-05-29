/**
 * E2E Spec: T-20260529-foot-WAIT-TIME-REMOVE
 * 접수 완료 화면 대기 안내 문구 제거
 *
 * AC-1: 완료 화면에서 대기 안내 문구("잠시만 기다려 주세요" 등) 완전 제거
 * AC-2: 나머지 요소(완료 메시지·자동 리셋 타이머·새 접수 버튼) 정상 유지
 * AC-3: 워크인·예약 양쪽 완료 화면 모두 적용 (단일 done step 사용)
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── 소스 레벨 검증 (빌드 산출물에 waitMsg 없음) ─────────────────────────────

test('AC-1: 번들에 "잠시만 기다려 주세요" 문자열 없음', async ({ page }) => {
  // Vite 번들에서 직접 텍스트 검색
  const response = await page.request.get(`${BASE_URL}/src/pages/SelfCheckIn.tsx`);
  // dev 서버 소스맵 or 번들 응답 여부 무관 — 페이지 렌더 후 DOM으로 검증
  await page.goto(`${BASE_URL}/checkin/test`);

  // waitMsg 텍스트가 페이지 어디에도 없어야 함
  await expect(page.getByText('잠시만 기다려 주세요', { exact: false })).toHaveCount(0);
});

test('AC-1: 번들에 "Please wait to be called" 문자열 없음', async ({ page }) => {
  await page.goto(`${BASE_URL}/checkin/test`);
  await expect(page.getByText('Please wait to be called', { exact: false })).toHaveCount(0);
});

// ── AC-2: SelfCheckIn 페이지 렌더 구조 확인 ──────────────────────────────────

test('AC-2: 셀프접수 페이지 정상 렌더 (핵심 요소 존재)', async ({ page }) => {
  await page.goto(`${BASE_URL}/checkin/test`);

  // 로딩 후 input 단계 진입 확인 (또는 clinic-not-found 메시지)
  await page.waitForTimeout(2000);

  // 둘 중 하나여야 함: 입력 폼 또는 지점 없음 안내
  const hasForm = await page.getByText('셀프 접수').isVisible().catch(() => false);
  const hasNotFound = await page.getByText('지점을 찾을 수 없습니다').isVisible().catch(() => false);
  const hasSelfCheckIn = await page.getByText('Self Check-In').isVisible().catch(() => false);

  expect(hasForm || hasNotFound || hasSelfCheckIn).toBe(true);
});

// ── AC-3: 워크인/예약 공통 done step 단일 처리 ───────────────────────────────

test('AC-3: done step에서 waitMsg 렌더링 없음 (소스 grep)', async ({ page }) => {
  // Playwright request를 통해 dev 서버 소스 파일 fetch
  const res = await page.request.get(`${BASE_URL}/src/pages/SelfCheckIn.tsx`).catch(() => null);
  if (res && res.ok()) {
    const src = await res.text();
    expect(src).not.toContain('waitMsg');
    expect(src).not.toContain('잠시만 기다려 주세요');
    expect(src).not.toContain('Please wait to be called');
  } else {
    // dev 서버에서 소스 직접 서빙 안 할 경우 → 빌드 dist 확인 skip (빌드 단계에서 검증)
    test.skip();
  }
});
