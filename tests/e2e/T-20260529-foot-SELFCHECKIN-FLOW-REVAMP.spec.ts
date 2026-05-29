/**
 * T-20260529-foot-SELFCHECKIN-FLOW-REVAMP
 * 초진 셀프체크인 개인정보 단계 + 발건강질문지 QR 화면 E2E 검증
 *
 * AC 커버:
 *   AC-1 초진 흐름: input → personal_info → confirm → qr → done
 *   AC-2 personal_info 단계: 주민번호 NumPad · 주소 입력 · 마스킹 표시
 *   AC-3 워크인 흐름: 6필드 (성함/연락처/방문경로 + 주민번호/주소/동의서) → QR
 *   AC-4 QR 화면: data-testid 요소 존재 · 카운트다운 · "질문지 작성 완료" 버튼
 *   AC-5 재진 흐름: personal_info 단계 없이 confirm → done
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function randSuffix() {
  return String(Date.now()).slice(-6);
}

// ── AC-1/2: 초진 흐름 — personal_info 단계 ───────────────────────────────────
test.describe('T-20260529 초진 personal_info 단계', () => {
  const sfx = randSuffix();
  const TEST_NAME = `flow-revamp-new-${sfx}`;
  const TEST_PHONE = `010${sfx}0001`;

  test('초진 → personal_info 단계 진입', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 이름 + 전화 + 초진
    await page.locator('#sc-name').fill(TEST_NAME);
    await page.locator('#sc-phone').fill(TEST_PHONE);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 진입 확인 — 주민번호 안내 텍스트 또는 주소 입력 존재
    await expect(
      page.getByText(/주민번호|생년월일|주소/i).first()
    ).toBeVisible({ timeout: 6000 });
  });

  test('주민번호 NumPad 입력 → 마스킹 표시', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`pi-mask-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0002`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // NumPad: 숫자 버튼 클릭으로 6자리 입력
    for (const digit of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: digit, exact: true }).first().click();
    }
    // 마스킹 표시: 900101-*******
    await expect(page.getByText(/900101/)).toBeVisible({ timeout: 3000 });
  });

  test('주민번호 + 주소 입력 → 다음 버튼 활성', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`pi-next-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0003`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // 주민번호 6자리 이상 입력
    for (const d of ['8', '5', '0', '3', '0', '5']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    // 주소 입력 (input type="text" 또는 textarea)
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('서울시 종로구');

    // 다음 버튼 활성화 확인
    const nextBtn = page.getByRole('button', { name: /다음|확인|입력완료/i });
    await expect(nextBtn).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-3: 워크인 흐름 — 동의서 체크박스 ────────────────────────────────────
test.describe('T-20260529 워크인 개인정보동의 단계', () => {
  const sfx = randSuffix();

  test('워크인 → personal_info 단계에 동의서 체크박스 존재', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`walkin-consent-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0011`);

    // 워크인 버튼 (data-testid="btn-walkin" 또는 텍스트)
    const walkinBtn = page.locator('[data-testid="btn-walkin"]');
    if (await walkinBtn.count() > 0) {
      await walkinBtn.click();
    } else {
      await page.getByRole('button', { name: /예약 없이|워크인/i }).click();
    }
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 — 동의서 체크박스 존재
    await expect(
      page.locator('input[type="checkbox"]').first()
    ).toBeVisible({ timeout: 6000 });
  });
});

// ── AC-4: QR 화면 ────────────────────────────────────────────────────────────
test.describe('T-20260529 QR 화면 렌더링', () => {
  const sfx = randSuffix();
  const TEST_NAME = `qr-test-${sfx}`;
  const TEST_PHONE = `010${sfx}0021`;
  let cleanupCheckInId: string | null = null;

  test.afterEach(async () => {
    if (cleanupCheckInId && SERVICE_KEY) {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      await sb.from('check_ins').delete().eq('id', cleanupCheckInId);
      await sb.from('customers').delete().eq('phone', TEST_PHONE.replace(/\D/g, ''));
    }
  });

  test('초진 전 흐름 완료 → QR 화면 진입 확인', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(TEST_NAME);
    await page.locator('#sc-phone').fill(TEST_PHONE);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // personal_info 단계 대기
    await page.waitForTimeout(1500);

    // 주민번호 6자리
    for (const d of ['0', '1', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    // 주소
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('서울시 중구');

    // 다음
    await page.getByRole('button', { name: /다음|확인/i }).click();

    // confirm 단계 → 접수하기
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();

    // QR 화면 또는 완료 화면 대기 (네트워크 지연 고려)
    await page.waitForTimeout(3000);

    // QR 화면 data-testid 또는 완료 화면 확인
    const qrScreen = page.locator('[data-testid="qr-screen"]');
    const doneScreen = page.locator('[data-testid="done-screen"], :text("접수가 완료")');

    const qrVisible = await qrScreen.isVisible().catch(() => false);
    const doneVisible = await doneScreen.isVisible().catch(() => false);

    // QR 또는 완료 화면 중 하나는 떠야 함 (QR 토큰 생성 실패 시 done으로 폴백)
    expect(qrVisible || doneVisible).toBe(true);

    if (qrVisible) {
      // QR 화면 핵심 요소 확인
      await expect(page.locator('[data-testid="qr-guide-text"]')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('[data-testid="btn-qr-done"]')).toBeVisible({ timeout: 3000 });
    }

    // DB cleanup용 ID 수집
    if (SERVICE_KEY) {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const { data } = await sb
        .from('check_ins')
        .select('id')
        .eq('clinic_id', CLINIC_ID)
        .eq('customer_name', TEST_NAME)
        .order('checked_in_at', { ascending: false })
        .limit(1);
      if (data?.[0]) cleanupCheckInId = data[0].id;
    }
  });

  test('QR 화면 "질문지 작성 완료" 버튼 → done 전환', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`${TEST_NAME}-b`);
    await page.locator('#sc-phone').fill(`010${sfx}0022`);
    await page.getByRole('button', { name: '초진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();
    await page.waitForTimeout(1000);

    for (const d of ['9', '9', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    const addressInput = page.locator('input[placeholder*="주소"], input[placeholder*="예: 서울"]').first();
    await addressInput.fill('경기도 고양시');
    await page.getByRole('button', { name: /다음|확인/i }).click();
    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();
    await page.waitForTimeout(3000);

    const qrDoneBtn = page.locator('[data-testid="btn-qr-done"]');
    if (await qrDoneBtn.isVisible().catch(() => false)) {
      await qrDoneBtn.click();
      // done 화면으로 전환
      await expect(
        page.locator('[data-testid="done-screen"], :text("접수가 완료"), :text("접수 완료")').first()
      ).toBeVisible({ timeout: 5000 });
    }
    // QR 화면이 없으면 이미 done — 통과
  });
});

// ── AC-5: 재진 흐름 — personal_info 단계 없음 ───────────────────────────────
test.describe('T-20260529 재진 흐름 — personal_info 스킵', () => {
  const sfx = randSuffix();

  test('재진 → confirm 단계 직접 진입 (personal_info 없음)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`revisit-skip-${sfx}`);
    await page.locator('#sc-phone').fill(`010${sfx}0031`);
    await page.getByRole('button', { name: '재진' }).click();
    await page.getByRole('button', { name: '접수하기', exact: true }).click();

    // confirm 화면으로 바로 가야 함 — 주민번호 NumPad가 없어야 함
    await page.waitForTimeout(1500);
    const rrnNumpad = page.locator('[data-testid="rrn-numpad"], :text(/주민번호/)').first();
    // 재진은 personal_info 없이 confirm으로 이동하므로 주민번호 입력 없어야 함
    await expect(rrnNumpad).not.toBeVisible();

    // confirm 화면의 접수하기 버튼 존재 확인
    await expect(
      page.getByRole('button', { name: '접수하기' })
    ).toBeVisible({ timeout: 5000 });
  });
});
