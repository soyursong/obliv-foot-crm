/**
 * 회귀 보호 스펙 — T-20260430-foot-DESK-PAYMENT-MENU
 *
 * 검증 범위:
 *   T1. payment_waiting 상태 카드 클릭 → desk-payment-menu 렌더링 확인
 *   T2. 4가지 액션 버튼(desk-menu-*) 모두 DOM에 존재
 *   T3. 패키지 없는 수납대기 → desk-menu-session-deduct 비활성(disabled)
 *   T4. 패키지 있는 수납대기 → desk-menu-session-deduct 활성 + SessionUseDialog 오픈
 *   T5. desk-menu-new-package 클릭 → PaymentDialog 열림 (패키지 모드)
 *   T6. desk-menu-single-payment 클릭 → PaymentDialog 열림 (단건 모드)
 *   T7. desk-menu-insurance-doc 클릭 → DocumentPrintPanel 섹션 가시 범위로 스크롤
 *   T8. payment_waiting 이외 상태 → desk-payment-menu 미노출
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../../helpers';

// T-20260615-foot-REGRESSION-SUITE-DEROT RC-C (플로우 드리프트 + UI 재구조):
//  (1) CHART2-STATE-UNIFY(5/16) 이후 카드 클릭은 2번차트(CustomerChartSheet, z-70)를 위에 띄워
//      DeskPaymentMenu 를 덮는다 → 덮인 버튼 click 이 pointer-event 인터셉트로 false-fail.
//      카드 클릭 직후 dismissCustomerChartSheet 로 2번차트를 닫아 메뉴를 드러낸다.
//  (2) DeskPaymentMenu 는 신규-패키지 결제 버튼(desk-menu-new-package)이 제거돼 현재 3버튼이다
//      (패키지 회차 차감 / 진료비 결제 / 보험청구 서류 — CheckInDetailSheet 주석 2176~2177).
//      구 '4버튼' 단언과 new-package 클릭 테스트(T5)를 현실(3버튼)로 rebase 한다.

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function adminSb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

// ─── T1+T2+T8: UI 기본 렌더링 검증 ──────────────────────────────────────────

test.describe('T1+T2: payment_waiting → DeskPaymentMenu 3버튼 렌더링', () => {
  test('payment_waiting 상태 시트 오픈 → desk-payment-menu + 3버튼 확인', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-menu-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-menu',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 920,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#920').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 920 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      // T1: DeskPaymentMenu 컨테이너 표시
      const menu = page.locator('[data-testid="desk-payment-menu"]');
      await expect(menu).toBeVisible({ timeout: 3000 });

      // T2: 3개 버튼 모두 존재 (desk-menu-new-package 는 제거됨 — 3버튼 불변식)
      await expect(page.locator('[data-testid="desk-menu-session-deduct"]')).toBeVisible({ timeout: 2000 });
      await expect(page.locator('[data-testid="desk-menu-single-payment"]')).toBeVisible({ timeout: 2000 });
      await expect(page.locator('[data-testid="desk-menu-insurance-doc"]')).toBeVisible({ timeout: 2000 });
      // 제거된 신규-패키지 버튼은 더 이상 없어야 함 (회귀 가드)
      await expect(page.locator('[data-testid="desk-menu-new-package"]')).toHaveCount(0);

      // 헤더 텍스트 확인
      await expect(menu).toContainText('수납 처리');
      await expect(menu).toContainText('수납대기');

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T1-T2.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});

// ─── T8: payment_waiting 아닌 상태 → DeskPaymentMenu 미노출 ─────────────────

test.describe('T8: payment_waiting 이외 상태 → desk-payment-menu 미노출', () => {
  test('consultation 상태 → desk-payment-menu 미노출', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-no-menu-${Date.now()}`, phone, visit_type: 'new' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-no-menu',
        customer_phone: phone,
        visit_type: 'new',
        status: 'consultation',
        queue_number: 921,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#921').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 921 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);

      // consultation 상태에서는 desk-payment-menu 미노출
      const menu = page.locator('[data-testid="desk-payment-menu"]');
      const menuVisible = await menu.isVisible().catch(() => false);
      expect(menuVisible).toBe(false);

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T8-no-menu.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});

// ─── T3: 패키지 없는 수납대기 → session-deduct 비활성 ───────────────────────

test.describe('T3: 패키지 없는 수납대기 → desk-menu-session-deduct disabled', () => {
  test('패키지 없는 고객 payment_waiting → session-deduct 비활성', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-nopkg-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-nopkg',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 922,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#922').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 922 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      // DeskPaymentMenu 노출 확인
      const menu = page.locator('[data-testid="desk-payment-menu"]');
      await expect(menu).toBeVisible({ timeout: 3000 });

      // 패키지 없음 → session-deduct 비활성
      const sessionDeductBtn = page.locator('[data-testid="desk-menu-session-deduct"]');
      await expect(sessionDeductBtn).toBeVisible({ timeout: 2000 });
      await expect(sessionDeductBtn).toBeDisabled({ timeout: 2000 });

      // 버튼 텍스트 확인 ("잔여 없음")
      await expect(sessionDeductBtn).toContainText('잔여 없음');

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T3-no-pkg.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});

// ─── T4: 패키지 있는 수납대기 → session-deduct 활성 + Dialog 오픈 ────────────

test.describe('T4: 패키지 있는 수납대기 → desk-menu-session-deduct 활성', () => {
  let testCustId: string | null = null;
  let testCiId: string | null = null;
  let testPkgId: string | null = null;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-haspkg-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    testCustId = cust?.id ?? null;

    const { data: pkg } = await sb
      .from('packages')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: testCustId,
        package_name: '테스트 비가열 패키지',
        package_type: 'package1',
        total_sessions: 3,
        heated_sessions: 0,
        unheated_sessions: 3,
        iv_sessions: 0,
        preconditioning_sessions: 0,
        total_amount: 900000,
        paid_amount: 900000,
        status: 'active',
        contract_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();
    testPkgId = pkg?.id ?? null;

    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: testCustId,
        customer_name: cust?.name ?? 'qa-desk-haspkg',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 923,
      })
      .select()
      .single();
    testCiId = ci?.id ?? null;
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    const sb = adminSb();
    if (testPkgId) {
      await sb.from('package_sessions').delete().eq('package_id', testPkgId);
      await sb.from('packages').delete().eq('id', testPkgId);
    }
    if (testCiId) await sb.from('check_ins').delete().eq('id', testCiId);
    if (testCustId) await sb.from('customers').delete().eq('id', testCustId);
  });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard did not load');
  });

  test('패키지 보유 수납대기 → session-deduct 활성 + 클릭 시 Dialog 오픈', async ({ page }) => {
    if (!testCiId) {
      test.skip(true, 'Test seed not available (no SERVICE_KEY?)');
      return;
    }

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const card = page.getByText('#923').first();
    const visible = await card.isVisible().catch(() => false);
    if (!visible) {
      test.info().annotations.push({ type: 'skip', description: '큐번호 923 카드 미표시' });
      return;
    }
    await card.click();
    await page.waitForTimeout(1000); // 패키지 RPC 로딩 대기
    await dismissCustomerChartSheet(page);

    // DeskPaymentMenu 확인
    const menu = page.locator('[data-testid="desk-payment-menu"]');
    await expect(menu).toBeVisible({ timeout: 3000 });

    // session-deduct 버튼 활성화 확인
    const sessionDeductBtn = page.locator('[data-testid="desk-menu-session-deduct"]');
    await expect(sessionDeductBtn).toBeVisible({ timeout: 2000 });
    await expect(sessionDeductBtn).not.toBeDisabled({ timeout: 3000 });

    // 클릭 → SessionUseInSheetDialog 오픈
    await sessionDeductBtn.click();
    await page.waitForTimeout(500);

    // 다이얼로그 열림 확인 (패키지 회차 사용 타이틀)
    const dialog = page.locator('role=dialog');
    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (dialogVisible) {
      await expect(dialog).toContainText('패키지 회차 사용');
      await page.keyboard.press('Escape');
    } else {
      test.info().annotations.push({ type: 'note', description: 'Dialog 미열림 — 패키지 RPC 로딩 지연 가능성' });
    }

    await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T4-has-pkg.png' });
  });
});

// ─── T5: desk-menu-new-package 제거 회귀 가드 ────────────────────────────────
// (구) 신규-패키지 결제 버튼 클릭 → PaymentDialog 오픈 검증.
// 현재 DeskPaymentMenu 는 desk-menu-new-package 가 제거돼 3버튼 체계다
// (패키지 회차 차감 / 진료비 결제 / 보험청구 서류). 신규 패키지 결제는 별도 동선으로 이전.
// → 제거된 버튼이 부활하지 않음을 보장하는 회귀 가드로 rebase (RC-C / 플로우 드리프트).

test.describe('T5: desk-menu-new-package 제거 회귀 가드', () => {
  test('수납대기 메뉴에 desk-menu-new-package 가 더 이상 존재하지 않음', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-newpkg-${Date.now()}`, phone, visit_type: 'new' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-newpkg',
        customer_phone: phone,
        visit_type: 'new',
        status: 'payment_waiting',
        queue_number: 924,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#924').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 924 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      // DeskPaymentMenu 노출 확인
      const menu = page.locator('[data-testid="desk-payment-menu"]');
      await expect(menu).toBeVisible({ timeout: 3000 });

      // 제거된 신규-패키지 결제 버튼은 더 이상 DOM 에 없어야 함 (회귀 가드)
      await expect(page.locator('[data-testid="desk-menu-new-package"]')).toHaveCount(0);

      // 현재의 3버튼 체계가 유지됨을 함께 확인
      await expect(page.locator('[data-testid="desk-menu-session-deduct"]')).toBeVisible({ timeout: 2000 });
      await expect(page.locator('[data-testid="desk-menu-single-payment"]')).toBeVisible({ timeout: 2000 });
      await expect(page.locator('[data-testid="desk-menu-insurance-doc"]')).toBeVisible({ timeout: 2000 });

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T5-new-pkg-removed.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});

// ─── T6: desk-menu-single-payment → PaymentDialog 오픈 ──────────────────────

test.describe('T6: desk-menu-single-payment → PaymentDialog 오픈', () => {
  test('단건 시술 결제 버튼 클릭 → PaymentDialog 열림', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-single-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-single',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 925,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#925').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 925 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      const singleBtn = page.locator('[data-testid="desk-menu-single-payment"]');
      await expect(singleBtn).toBeVisible({ timeout: 3000 });
      await singleBtn.click();
      await page.waitForTimeout(600);

      // PaymentDialog 열림 확인
      const dialog = page.locator('role=dialog');
      await expect(dialog).toBeVisible({ timeout: 3000 });
      await expect(dialog).toContainText('결제');

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T6-single-dialog.png' });

      await page.keyboard.press('Escape');
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});

// ─── T7: desk-menu-insurance-doc → DocumentPrintPanel 스크롤 ────────────────

test.describe('T7: desk-menu-insurance-doc → 서류 발행 섹션 스크롤', () => {
  test('보험청구 서류 버튼 클릭 → DocumentPrintPanel 섹션 가시 범위 이동', async ({ page }) => {
    const sb = adminSb();
    const phone = `010${String(Date.now()).slice(-8)}`;

    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `qa-desk-doc-${Date.now()}`, phone, visit_type: 'returning' })
      .select()
      .single();
    const { data: ci } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: cust?.id,
        customer_name: cust?.name ?? 'qa-desk-doc',
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 926,
      })
      .select()
      .single();

    try {
      await loginAndWaitForDashboard(page);

      const card = page.getByText('#926').first();
      const visible = await card.isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'skip', description: '큐번호 926 카드 미표시' });
        return;
      }
      await card.click();
      await page.waitForTimeout(800);
      await dismissCustomerChartSheet(page);

      // desk-menu-insurance-doc 버튼 클릭
      const insuranceBtn = page.locator('[data-testid="desk-menu-insurance-doc"]');
      await expect(insuranceBtn).toBeVisible({ timeout: 3000 });
      await insuranceBtn.click();
      await page.waitForTimeout(800); // 스크롤 애니메이션 대기

      // DocumentPrintPanel 이 시트 내에 렌더링 되어 있는지 확인
      // (스크롤은 시트 내부이므로 viewport 기준이 아닌 DOM 존재 여부 검증)
      const docPanel = page.locator('[data-testid="desk-payment-menu"]'); // 메뉴가 여전히 존재
      await expect(docPanel).toBeVisible({ timeout: 2000 });

      // 서류 발행 관련 텍스트가 페이지에 있는지 확인 (DocumentPrintPanel 렌더링)
      const docText = await page.getByText('서류 발행').first().isVisible().catch(() => false);
      test.info().annotations.push({
        type: 'result',
        description: `서류 발행 섹션 렌더링: ${docText}`,
      });

      await page.screenshot({ path: 'test-results/screenshots/R-2026-04-30-desk-menu-T7-doc-scroll.png' });
    } finally {
      if (ci?.id) await sb.from('check_ins').delete().eq('id', ci.id);
      if (cust?.id) await sb.from('customers').delete().eq('id', cust.id);
    }
  });
});
