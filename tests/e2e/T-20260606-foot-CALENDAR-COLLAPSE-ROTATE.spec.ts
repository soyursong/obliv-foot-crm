/**
 * E2E spec — T-20260606-foot-CALENDAR-COLLAPSE-ROTATE
 * 달력 접기 시 캘린더 날짜 글씨(요일/날짜)가 회전·뒤집히는 버그 회귀 방지.
 * (문지은 대표원장 6/6: "달력을 접으면 안의 글씨가 전부 회전돼서 뒤집혀 보인다. 기능은 정상, 시각만 깨짐")
 *
 * 원인: CalendarNoticePanel PC 접힘(pc-cal-bar) 상태의 세로 날짜 strip 이
 *   writing-mode:vertical-rl + transform:rotate(180deg) 로 구현됨.
 *   한글(CJK)은 vertical-rl 만으로 세로 정상 표기되므로 rotate(180deg)가 글씨를 통째로 뒤집음.
 * 수정: rotate(180deg) 제거 + text-orientation:upright (숫자·괄호까지 똑바로).
 *
 * AC-1: 달력 접힘 후 세로 날짜 strip 텍스트가 회전(rotate(180))/뒤집힘 없이 정상 방향 유지.
 *       펼치기(expand) 회귀 — 다시 펼쳐도 미니캘린더 요일/날짜 정상 렌더.
 *
 * 검증 방식: 실브라우저(desktop-chrome, PC 1280px) — getComputedStyle(transform)에
 *   180° 회전 행렬(matrix(-1, 0, 0, -1, ...))이 없음을 단언. writing-mode 는 정상 표기로 허용.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260606-foot-CALENDAR-COLLAPSE-ROTATE — 달력 접기 글씨 회전 버그', () => {
  test('AC-1: PC 달력 접으면 세로 날짜 strip 이 180° 회전(뒤집힘) 없이 정상 방향', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 펼침(기본) 상태: 달력 접기 토글 버튼 노출
    const collapseBtn = page.getByTestId('pc-cal-toggle');
    await expect(collapseBtn).toBeVisible();

    // 달력 접기
    await collapseBtn.click();

    // 접힘 strip 노출
    const bar = page.getByTestId('pc-cal-bar');
    await expect(bar).toBeVisible();

    // 세로 날짜 텍스트 — 날짜/요일 포함
    const dateStrip = page.getByTestId('pc-cal-date-vertical');
    await expect(dateStrip).toBeVisible();
    await expect(dateStrip).toContainText('월');
    await expect(dateStrip).toContainText('일');

    // 핵심 단언: transform 에 180° 회전 행렬이 없어야 함.
    //   rotate(180deg) === matrix(-1, 0, 0, -1, 0, 0). 정상 방향이면 'none' 또는 비회전 행렬.
    const transform = await dateStrip.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(transform).not.toContain('matrix(-1, 0, 0, -1');
    expect(transform.toLowerCase()).not.toContain('rotate(180');

    // writing-mode 는 세로 표기(vertical-rl)로 유지 — 회전 없이 위→아래로 읽힘
    const writingMode = await dateStrip.evaluate(
      (el) => getComputedStyle(el).writingMode,
    );
    expect(writingMode).toMatch(/vertical/);
  });

  test('AC-1(회귀): 펼치기 → 미니캘린더 요일 헤더 정상 방향 렌더', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });

    // 접기 → 펼치기 왕복
    await page.getByTestId('pc-cal-toggle').click();
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
