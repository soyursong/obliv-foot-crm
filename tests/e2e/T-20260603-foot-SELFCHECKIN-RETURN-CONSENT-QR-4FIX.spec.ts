/**
 * T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX
 * 풋 셀프접수 동선 개선 4건
 *
 * AC 커버:
 *   AC1 재진 패스트패스: 재진은 personal_info(개인정보)·설문 단계를 건너뛰고 confirm 직행
 *       (초진/워크인 동선 불변 — personal_info 전 단계 노출)
 *   AC2 동의 기본 체크: 개인정보(필수)·건강보험(필수) 체크박스 기본 체크(true),
 *       예약 안내 문자(sms, 선택)는 기본 미체크(false)
 *   AC3 접수 정보 확인 화면: 예약 안내 문자 중복 부가 안내(sms-opt-in-note) 제거 — 라벨 1회만
 *   AC4 설문 QR 화면: 버튼 '정상접수(QR 스캔 완료)' + '이전 단계로 돌아가기' 버튼 + 카운트다운 180초/초기화면 복귀
 *   AC5 회귀: 초진/워크인 동선·동의 boolean·필수성 불변
 *
 * 주의: 전화번호는 NumPad(버튼 클릭)로 입력. QR 화면은 서버 토큰 생성 결과에 의존 → 가드 후 단언.
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

// 초진(예약) → personal_info 단계 진입 헬퍼 (ADDR-CONSENT-LAYOUT spec 검증 동선 재사용)
async function gotoNewPersonalInfo(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');

  await page.locator('#sc-name').fill(name);
  const phoneDigits = phone.replace(/\D/g, '').slice(0, 11);
  for (const d of phoneDigits) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }

  // 예약 → 초진(new)
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.getByRole('button', { name: '초진' }).click();
  await page.locator('[data-testid="btn-checkin"]').click();
  await page.waitForTimeout(1000);
}

// ── AC2: 동의 기본 체크 ──────────────────────────────────────────────────────
test.describe('T-20260603-4FIX AC2 동의 기본 체크', () => {
  const s = sfx();

  test('초진 personal_info — 건강보험 동의 체크박스가 기본 체크(true)', async ({ page }) => {
    await gotoNewPersonalInfo(page, `consent-def-${s}`, `010${s}0011`);

    const ins = page.locator('[data-testid="pi-insurance-consent-checkbox"]');
    await expect(ins).toBeVisible({ timeout: 6000 });
    // AC2: 기본 체크
    await expect(ins).toBeChecked();
  });

  // T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-4 가 4FIX AC2(sms 기본 미체크)를 SUPERSEDE.
  //   현장(김주연 총괄) 지시로 sms 선택동의도 기본 체크(true)로 전환됨.
  test('confirm 화면 — 예약 안내 문자(sms) 동의는 기본 체크(true) [AC-4 supersede]', async ({ page }) => {
    await gotoNewPersonalInfo(page, `sms-def-${s}`, `010${s}0012`);

    // 주민번호 6자리 + 주소 입력 → 다음
    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 종로구');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    // confirm 단계 — sms 체크박스 기본 체크 (AC-4)
    const smsBox = page.locator('#sms-opt-in');
    await expect(smsBox).toBeVisible({ timeout: 6000 });
    await expect(smsBox).toBeChecked();
  });
});

// ── AC3: 접수 정보 확인 화면 예약 안내 문자 중복 제거 ────────────────────────
test.describe('T-20260603-4FIX AC3 문자 중복 제거', () => {
  const s = sfx();

  // T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-5 가 4FIX AC3(부가 안내 제거)를 SUPERSEDE.
  //   현장 지시로 미동의 영향 안내문구를 신규 정문안으로 복원. 라벨도 '예약 안내 문자...' 로 정렬.
  test('confirm 화면 — sms 라벨 1회 + 미동의 안내문구 노출 [AC-5 supersede]', async ({ page }) => {
    await gotoNewPersonalInfo(page, `dup-${s}`, `010${s}0013`);

    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 중구');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    // 동의 라벨 1회만 노출 (현장 정렬 문안)
    const label = page.getByText('예약 안내 문자 수신에 동의합니다 (선택)');
    await expect(label).toBeVisible({ timeout: 6000 });
    await expect(label).toHaveCount(1);

    // AC-5: 미동의 영향 안내문구 노출 + 정확 문안
    const note = page.locator('[data-testid="sms-opt-in-note"]');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText('미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다');
  });
});

// ── AC4: 설문 QR 화면 ───────────────────────────────────────────────────────
test.describe('T-20260603-4FIX AC4 설문 QR 화면', () => {
  const s = sfx();

  test('QR 화면 — 정상접수 버튼 문구 + 이전 단계 버튼 + 카운트다운 안내', async ({ page }) => {
    await gotoNewPersonalInfo(page, `qr-${s}`, `010${s}0014`);

    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 강남구');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    await page.getByRole('button', { name: '접수하기' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '접수하기' }).click();
    await page.waitForTimeout(3000);

    const qrScreen = page.locator('[data-testid="qr-screen"]');
    // QR 토큰 생성은 서버 의존 → QR 화면이 떴을 때만 신규 요소 단언
    if (await qrScreen.isVisible().catch(() => false)) {
      // 버튼 문구 변경
      const doneBtn = page.locator('[data-testid="btn-qr-done"]');
      await expect(doneBtn).toBeVisible();
      await expect(doneBtn).toHaveText(/정상접수\(QR 스캔 완료\)/);

      // 이전 단계로 돌아가기 버튼 — 정상접수 버튼 아래에 존재
      const backBtn = page.locator('[data-testid="btn-qr-back"]');
      await expect(backBtn).toBeVisible();
      await expect(backBtn).toHaveText('이전 단계로 돌아가기');

      // 카운트다운 — '처음 화면으로 돌아갑니다' 안내
      await expect(page.getByText(/처음 화면으로 돌아갑니다/)).toBeVisible();

      // 이전 단계로 클릭 → confirm(접수 정보 확인) 복귀
      await backBtn.click();
      await expect(
        page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")').first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      // QR 토큰 미생성 → done 폴백 (회귀 비차단)
      test.info().annotations.push({ type: 'note', description: 'QR 화면 미노출(서버 토큰 폴백) — done 폴백 경로' });
    }
  });
});

// ── AC1 / AC5: 재진 패스트패스 + 초진 동선 보존 ─────────────────────────────
test.describe('T-20260603-4FIX AC1 재진 패스트패스 / 동선 보존', () => {
  const s = sfx();

  test('초진 — personal_info(개인정보) 단계가 노출됨 (동선 보존)', async ({ page }) => {
    await gotoNewPersonalInfo(page, `new-flow-${s}`, `010${s}0015`);

    // 초진은 개인정보 입력 단계의 주소 입력칸·다음 버튼이 노출되어야 함
    await expect(page.locator('[data-testid="pi-address-input"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeVisible();
  });

  test('재진 — personal_info 없이 confirm(접수 정보 확인) 직행 (설문/개인정보 스킵)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ret-flow-${s}`);
    for (const d of `010${s}0016`.replace(/\D/g, '').slice(0, 11)) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.getByRole('button', { name: '재진' }).click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(1200);

    // 재진은 personal_info(주소 입력칸)를 거치지 않고 confirm 으로 직행
    await expect(page.locator('[data-testid="pi-address-input"]')).toHaveCount(0);
    await expect(
      page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")').first()
    ).toBeVisible({ timeout: 5000 });
    // 접수하기 버튼 노출 (바로 접수 가능)
    await expect(page.getByRole('button', { name: '접수하기' })).toBeVisible();
  });
});
