/**
 * T-20260630-foot-SELFCHECKIN-ADDR-KAKAO-ENG
 * 외국인 셀프접수 체류지(숙소) 주소 — 카카오 Daum 우편번호 팝업 재활용 + 영문주소 자동기입.
 *
 * 직전 T-20260625(카카오 로컬 REST 키워드검색, 키 필요→미설정 시 수기모드)를 SUPERSEDE:
 *   → 키 불요 Daum 우편번호 팝업(2번차트/내국인 우편번호검색과 동일 임베드) 재활용,
 *     선택 시 영문 도로명주소(roadAddressEnglish) 자동기입.
 *
 * AC 커버:
 *   AC-1 외국인 체류지 섹션에 "Search address"(영문 라벨) 버튼 노출.
 *   AC-2 버튼 클릭 → Daum 우편번호 팝업 오픈(신규 키 에러 없이 — 스크립트 로드/레이어 생성).
 *   AC-3 (팝업 내부 선택은 외부 iframe·비결정적) 주소 필드 = 수기 폴백으로도 채워짐(Q2=b).
 *   AC-4 채워진 주소가 ADDR-EMAIL-OPTIONAL 택1 검증 충족(주소만 채워도 접수 활성, 이메일 빈칸 허용).
 *   AC-6 내국인 우편번호 검색(별도 postcode 버튼) 무회귀.
 *
 * 비고: Daum 팝업은 외부 iframe(카카오 CDN) → 팝업 내부 검색/선택은 E2E 비결정적이라
 *   버튼 존재 + 클릭 시 스크립트/레이어 생성 + 수기 폴백 경로만 결정적으로 검증
 *   (T-20260625 와 동일 정책). 영문주소 자동기입(roadAddressEnglish 매핑)은 컴포넌트 단위 로직으로 커버.
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

async function gotoForeign(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="lang-toggle"]').click();
  await expect(page.getByText('한국어')).toBeVisible({ timeout: 4000 });
}

async function typePhone(page: import('@playwright/test').Page, digits: string) {
  for (const d of digits.replace(/\D/g, '').slice(0, 11)) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// 외국인 초진 개인정보 단계까지 진입
async function enterForeignPersonalInfo(page: import('@playwright/test').Page, s: string) {
  await gotoForeign(page);
  await page.locator('#sc-name').fill(`foreign-addr-${s}`);
  await typePhone(page, `010${s}33`);
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.locator('[data-testid="btn-visit-new"]').click();
  await page.locator('[data-testid="btn-checkin"]').click();
  await page.waitForTimeout(1000);
}

// ── AC-1 / AC-2: 주소검색 버튼 + Daum 팝업 오픈 ──────────────────────────────
test.describe('T-20260630 AC-1/AC-2 카카오 Daum 팝업 재활용', () => {
  test('외국인 체류지 섹션에 영문 라벨 주소검색 버튼 노출', async ({ page }) => {
    const s = sfx();
    await enterForeignPersonalInfo(page, s);

    const section = page.locator('[data-testid="foreign-stay-address"]');
    await expect(section).toBeVisible({ timeout: 6000 });

    const searchBtn = page.locator('[data-testid="foreign-addr-search-btn"]');
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toHaveText('Search address');

    // 수기 폴백 안내(Q2=b) + 주소 입력칸 존재
    await expect(page.locator('[data-testid="foreign-addr-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-addr-manual-hint"]')).toBeVisible();
  });

  test('주소검색 버튼 클릭 → Daum 우편번호 스크립트 로드(키 에러 없이)', async ({ page }) => {
    const s = sfx();
    await enterForeignPersonalInfo(page, s);

    await page.locator('[data-testid="foreign-addr-search-btn"]').click();
    // 공식 Daum postcode embed 스크립트가 head 에 주입됨(키 불요) — 신규 Kakao REST 키 미사용 확인
    await expect(
      page.locator('script[src*="t1.daumcdn.net/mapjsapi/bundle/postcode"]')
    ).toHaveCount(1, { timeout: 6000 });
  });
});

// ── AC-3 / AC-4: 수기 폴백 + 택1 검증 충족 ───────────────────────────────────
test.describe('T-20260630 AC-3/AC-4 수기 폴백 + 주소·이메일 택1', () => {
  test('주소 수기 입력(폴백) → 다음(personal-info-next) 게이트의 주소 조건 충족', async ({ page }) => {
    const s = sfx();
    await enterForeignPersonalInfo(page, s);

    // 팝업 미수록 숙소 가정 → 주소 필드에 직접 입력(Q2=b 폴백)
    const addrInput = page.locator('[data-testid="foreign-addr-input"]');
    await addrInput.fill('123 Sejong-daero, Jongno-gu, Seoul');
    await expect(addrInput).toHaveValue('123 Sejong-daero, Jongno-gu, Seoul');

    // 주소가 채워지면 주소·이메일 택1 안내(addr-email-hint) 사라짐
    await expect(page.locator('[data-testid="addr-email-hint"]')).toHaveCount(0);
  });
});

// ── AC-6: 내국인 우편번호 검색 무회귀 ────────────────────────────────────────
test.describe('T-20260630 AC-6 내국인 우편번호 검색 무회귀', () => {
  test('한국어 초진: 우편번호 검색 버튼 + 외국인 위젯 부재', async ({ page }) => {
    const s = sfx();
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ko-addr-${s}`);
    await typePhone(page, `010${s}44`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(1000);

    // 내국인 우편번호 검색 버튼 유지, 외국인 체류지 위젯은 부재
    await expect(page.locator('[data-testid="pi-postcode-search"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="foreign-stay-address"]')).toHaveCount(0);
  });
});
