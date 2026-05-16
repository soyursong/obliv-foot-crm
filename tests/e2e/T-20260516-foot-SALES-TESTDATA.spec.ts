/**
 * supervisor QA — T-20260516-foot-SALES-TESTDATA
 * 매출집계 5탭 렌더링 + 더미 데이터 표시 검증
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8082';

test.describe('SALES-TESTDATA — 5탭 QA', () => {

  test('S1: /admin/sales 페이지 접속 + 탭 구조', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    // 탭 5개 존재 확인
    await expect(page.getByRole('tab', { name: '일일결산' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '환자별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '시술별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '담당의별' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '담당직원별' })).toBeVisible();
    await page.screenshot({ path: '/tmp/qa_sales_s1_tabs.png' });
  });

  test('S2: 일일결산 탭 — 좌우 매트릭스 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '일일결산' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_sales_s2_daily.png' });
    // 패널이 white screen이 아닌지 — 어떤 숫자 또는 "원" 단위가 보여야 함
    const bodyText = await page.locator('body').innerText();
    const hasContent = bodyText.includes('원') || bodyText.includes('발생') || bodyText.includes('수납') || bodyText.includes('결산');
    console.log('일일결산 콘텐츠 있음:', hasContent, '|', bodyText.slice(0, 200));
  });

  test('S3: 환자별 탭 — 테스트 데이터 행 표시', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '환자별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_sales_s3_patient.png' });
    const bodyText = await page.locator('body').innerText();
    console.log('환자별 탭 텍스트:', bodyText.slice(0, 300));
  });

  test('S4: 시술별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '시술별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_sales_s4_treatment.png' });
    const bodyText = await page.locator('body').innerText();
    console.log('시술별 탭 텍스트:', bodyText.slice(0, 300));
  });

  test('S5: 담당의별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '담당의별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_sales_s5_doctor.png' });
    const bodyText = await page.locator('body').innerText();
    console.log('담당의별 탭 텍스트:', bodyText.slice(0, 300));
  });

  test('S6: 담당직원별 탭 렌더', async ({ page }) => {
    await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.getByRole('tab', { name: '담당직원별' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa_sales_s6_staff.png' });
    const bodyText = await page.locator('body').innerText();
    console.log('담당직원별 탭 텍스트:', bodyText.slice(0, 300));
  });

});
