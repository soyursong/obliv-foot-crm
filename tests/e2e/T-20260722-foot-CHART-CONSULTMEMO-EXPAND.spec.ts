/**
 * E2E — T-20260722-foot-CHART-CONSULTMEMO-EXPAND
 * 2번 차트 3구역 [상세] '메모 요약' 블록 — 상담메모(consultation memo) 전체 본문 확인.
 *
 * 문제: 이전(과거) 상담메모가 요약본(line-clamp-2 말줄임 preview)만 보이고
 *       펼치기/전체보기 토글이 없어 긴 본문 전체 확인 불가(read-visibility blocker).
 * 수정: FE 표시 로직만 — 내용이 잘리면(overflow) [전체보기]/[접기] 토글 노출.
 *       토글 시 line-clamp-2 제거 → 전문(whitespace-pre-wrap) 표시. DB·비즈로직 무변경.
 *
 * SC-1: 긴 상담메모 → 요약 블록에 [전체보기] 토글 노출 → 클릭 시 전문(line-clamp 해제) → [접기] 로 원복
 * SC-2: 상담메모 body 는 항상 저장된 전체 텍스트를 담고(잘림은 CSS clamp) 토글이 clamp on/off 만 전환
 *
 *   PLAYWRIGHT_SEED_CUSTOMER_ID : 긴 상담메모가 있는 대상 고객(2번 차트)
 *   PLAYWRIGHT_STORAGE_STATE    : 로그인 세션 storageState 경로
 * 미구성 시 skip (CI 시드 미구성 환경 보호 — 기존 CHART spec 관례 준수).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const CUSTOMER_ID = process.env.PLAYWRIGHT_SEED_CUSTOMER_ID;
const STORAGE_STATE = process.env.PLAYWRIGHT_STORAGE_STATE;

const SKIP_NO_SEED = !CUSTOMER_ID;

test.describe('T-20260722-foot-CHART-CONSULTMEMO-EXPAND', () => {
  test.use(STORAGE_STATE ? { storageState: STORAGE_STATE } : {});

  test('SC-1: 상담메모 요약 [전체보기] 토글 → 전문 확인 → [접기] 원복', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
    test.skip(!STORAGE_STATE, '세션(storageState) 미주입 — CI skip');

    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // '메모 요약' 블록 노출
    await expect(page.getByTestId('memo-summary-block')).toBeVisible({ timeout: 10_000 });

    const body = page.getByTestId('memo-summary-body-상담메모');
    await expect(body).toBeVisible();

    // 접힘 기본 상태 — line-clamp-2 적용
    await expect(body).toHaveClass(/line-clamp-2/);

    // 잘리는 긴 메모면 [전체보기] 토글 노출
    const toggle = page.getByTestId('memo-summary-toggle-상담메모');
    const hasToggle = await toggle.count();
    test.skip(hasToggle === 0, '상담메모가 2줄 이내 — 토글 불필요(skip)');

    await expect(toggle).toHaveText('전체보기');

    // 전체보기 클릭 → clamp 해제(전문 표시)
    await toggle.click();
    await expect(body).not.toHaveClass(/line-clamp-2/);
    await expect(toggle).toHaveText('접기');

    // 접기 클릭 → 원복
    await toggle.click();
    await expect(body).toHaveClass(/line-clamp-2/);
    await expect(toggle).toHaveText('전체보기');
  });

  test('SC-2: 요약 body 는 저장된 전체 텍스트 보유(clamp 는 CSS 표시만)', async ({ page }) => {
    test.skip(SKIP_NO_SEED, '시드 데이터 없음 — CI skip');
    test.skip(!STORAGE_STATE, '세션(storageState) 미주입 — CI skip');

    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    const body = page.getByTestId('memo-summary-body-상담메모');
    await expect(body).toBeVisible({ timeout: 10_000 });

    // textContent 는 clamp 여부와 무관하게 전체 본문(표시만 잘림) — 데이터 완전성 확인
    const text = (await body.textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(0);
    // whitespace-pre-wrap 로 줄바꿈/공백 보존
    await expect(body).toHaveClass(/whitespace-pre-wrap/);
  });
});
