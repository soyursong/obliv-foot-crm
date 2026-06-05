/**
 * T-20260606-foot-CALENDAR-COLLAPSE-PARENS
 * 달력 접힘 시 괄호 문자 제거 — 문지은 대표원장 현장 피드백(6/6)
 *
 * AC-1: 접힘 상태 날짜 라벨에서 괄호 `(` `)` 문자 제거
 *        예) "6월 6일 (토)" → "6월 6일 토"  (괄호 안 텍스트는 유지, 괄호 기호만 제거)
 * AC-2: 펼침 상태 선택날짜 표기는 변경하지 않음 (괄호 유지)
 * AC-3: 접기→펼치기 토글 정상 동작
 *
 * 접힘 상태 라벨은 태블릿/모바일(≤768px) 접힘 바(mobile-cal-bar)에서 노출되므로
 * 모바일 뷰포트로 재현한다. (PC 접힘 바는 직전 ROTATE 티켓에서 날짜 span 제거 → 텍스트 없음)
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260606-foot-CALENDAR-COLLAPSE-PARENS — 접힘 상태 괄호 제거', () => {
  // ── 시나리오 1: 접힘 상태 괄호 미표시 ──────────────────────────────────────
  test('AC-1: 모바일 접힘 바 날짜 라벨에 괄호가 없음', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const calBar = page.getByTestId('mobile-cal-bar');
    await expect(calBar).toBeVisible();

    // 날짜 텍스트는 유지 (월/일 + 요일)
    await expect(calBar).toContainText('월');
    await expect(calBar).toContainText('일');

    // AC-1: 괄호 `(` `)` 문자가 라벨에 없어야 함
    const labelText = (await calBar.textContent()) ?? '';
    expect(labelText).not.toContain('(');
    expect(labelText).not.toContain(')');
  });

  // ── 시나리오 2: 접기/펼치기 토글 회귀 ──────────────────────────────────────
  test('AC-3: 접힘 바 탭 → 펼침 → 다시 접기 정상 동작', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    const calBar = page.getByTestId('mobile-cal-bar');
    await expect(calBar).toBeVisible();

    // 펼치기
    await calBar.click();
    await expect(page.getByTestId('mobile-cal-close')).toBeVisible();

    // 다시 접기
    await page.getByTestId('mobile-cal-close').click();
    await expect(page.getByTestId('mobile-cal-bar')).toBeVisible();

    // 접힘 바 라벨 괄호 없음 재확인
    const labelText = (await page.getByTestId('mobile-cal-bar').textContent()) ?? '';
    expect(labelText).not.toContain('(');
    expect(labelText).not.toContain(')');
  });
});
