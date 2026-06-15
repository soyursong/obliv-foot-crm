/**
 * E2E spec — T-20260606-foot-CALENDAR-COLLAPSE-ROTATE
 * 달력 접기 시 캘린더 날짜 글씨(요일/날짜)가 회전·뒤집히는 버그 회귀 방지.
 * (문지은 대표원장 6/6: "달력을 접으면 안의 글씨가 전부 회전돼서 뒤집혀 보인다. 기능은 정상, 시각만 깨짐")
 *
 * 원인: CalendarNoticePanel PC 접힘(pc-cal-bar) 상태의 세로 날짜 strip 이
 *   writing-mode:vertical-rl + transform:rotate(180deg) 로 구현됨.
 *   한글(CJK)은 vertical-rl 만으로 세로 표기되나 rotate(180deg)가 글씨를 통째로 뒤집음.
 * 수정(Option B): w-10(2.5rem) 폭이 좁아 세로 날짜 표시 실익이 없으므로
 *   날짜 span(pc-cal-date-vertical) 자체를 제거하고 펼치기 버튼(pc-cal-expand)만 남김.
 *
 * AC-1: 달력 접힘 후 회전 텍스트(pc-cal-date-vertical)가 더 이상 존재하지 않음.
 *       접힘 strip(pc-cal-bar)에는 펼치기 버튼만 노출.
 *       펼치기(expand) 회귀 — 다시 펼쳐도 미니캘린더 요일/날짜 정상 렌더.
 *
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260606-foot-CALENDAR-COLLAPSE-ROTATE — 달력 접기 글씨 회전 버그', () => {
  test('AC-1: PC 달력 접힘 strip 에 회전 날짜 텍스트가 없고 펼치기 버튼만 노출', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED 이후: 달력은 디폴트로 접힘 상태로 시작.
    //   (이전엔 펼침이 기본 → pc-cal-toggle 클릭으로 접었으나, 이제 진입 시 이미 접힘 strip 노출)
    const bar = page.getByTestId('pc-cal-bar');
    await expect(bar).toBeVisible();

    // 핵심 단언(Option B): 회전되던 세로 날짜 텍스트가 더 이상 존재하지 않음
    await expect(page.getByTestId('pc-cal-date-vertical')).toHaveCount(0);

    // 접힘 strip 에는 펼치기 버튼만 노출
    await expect(page.getByTestId('pc-cal-expand')).toBeVisible();
  });

  test('AC-1(회귀): 펼치기 → 미니캘린더 요일 헤더 정상 방향 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 디폴트 접힘 → 바로 펼치기 (T-20260615-foot-CALENDAR-DEFAULT-COLLAPSED)
    await expect(page.getByTestId('pc-cal-bar')).toBeVisible();

    await page.getByTestId('pc-cal-expand').click();

    // 펼쳐진 미니캘린더 헤더(달력) 노출 + 요일 헤더(일~토) 정상
    await expect(page.getByText('달력').first()).toBeVisible();
    const sunHeader = page.getByText('일', { exact: true }).first();
    await expect(sunHeader).toBeVisible();

    // 요일 헤더 텍스트가 회전/뒤집힘 없이 정상 방향
    const headerTransform = await sunHeader.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(headerTransform).not.toContain('matrix(-1, 0, 0, -1');
    expect(headerTransform.toLowerCase()).not.toContain('rotate(180');
  });
});
