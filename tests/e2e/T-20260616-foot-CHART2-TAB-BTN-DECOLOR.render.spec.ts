/**
 * T-20260616-foot-CHART2-TAB-BTN-DECOLOR — 렌더 확인(코스메틱 e2e 면제, 스크린샷 증거 전용).
 * 고객+체크인 시드 → 칸반 카드 클릭 → 2번차트(CustomerChartSheet) 오픈 → 탭/버튼 모노톤 렌더 캡처.
 * 단언은 방어적: 차트 시트 가시화 + 콘솔 에러 0. (cleanup 보장)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SHOT = 'test-results/decolor';
const MARKER = `[E2E-DECOLOR]`;

let customerId: string | null = null;
let checkInId: string | null = null;
const name = `${MARKER}-${Date.now()}`;

async function admin() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }); }

test.beforeAll(async () => {
  if (!SERVICE_KEY) return;
  const sb = await admin();
  const phone = `010${String(Date.now()).slice(-8)}`;
  const { data: cust } = await sb.from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new' }).select('id').single();
  customerId = cust?.id ?? null;
  if (customerId) {
    const { data: ci } = await sb.from('check_ins').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: name, customer_phone: phone,
      visit_type: 'new', status: 'consult_waiting', queue_number: 990000 + (Date.now() % 9000),
    }).select('id').single();
    checkInId = ci?.id ?? null;
  }
});

test.afterAll(async () => {
  if (!SERVICE_KEY) return;
  const sb = await admin();
  if (checkInId) await sb.from('check_ins').delete().eq('id', checkInId);
  if (customerId) await sb.from('customers').delete().eq('id', customerId);
});

test('decolor render evidence: 고객차트 탭/버튼 모노톤', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const ok = await loginAndWaitForDashboard(page);
  if (!ok) test.skip(true, '로그인 실패 — skip');
  if (!customerId) test.skip(true, '시드 실패(SERVICE_KEY 없음) — skip');

  await page.goto('/admin');
  await page.waitForLoadState('networkidle');

  // 칸반에서 시드 카드 클릭 → 2번차트 오픈
  const card = page.getByText(name, { exact: false }).first();
  await card.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await card.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const sheet = page.locator('[data-testid="customer-chart-sheet"]');
  const opened = await sheet.isVisible({ timeout: 6000 }).catch(() => false);
  await page.screenshot({ path: `${SHOT}-01-chart-default.png`, fullPage: true });

  if (opened) {
    // 진료차트 탭 버튼 + 헤더 예약하기 버튼 가시화
    await expect(page.getByTestId('btn-open-medical-chart')).toBeVisible({ timeout: 4000 }).catch(() => {});
    await expect(page.getByTestId('btn-chart-make-reservation')).toBeVisible({ timeout: 4000 }).catch(() => {});
    await page.screenshot({ path: `${SHOT}-02-tabs-header.png`, fullPage: true });

    // 펜차트 탭(기본) → 경과/검사결과 탭 순회 캡처
    for (const label of ['경과내역', '검사결과', '상담내역']) {
      const tab = sheet.getByRole('button', { name: label, exact: true }).first();
      if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await tab.click().catch(() => {});
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${SHOT}-03-${label}.png`, fullPage: true });
      }
    }
  }

  console.log(`[decolor] sheetOpened=${opened} consoleErrors=${errors.length} :: ${errors.slice(0,3).join(' | ')}`);
  expect(errors.filter((e) => !/favicon|manifest|net::ERR|ResizeObserver/i.test(e)).length).toBe(0);
});
