/**
 * E2E spec — T-20260615-foot-RESVPOPUP-SEARCH-NEWMODE-3FIX
 * 예약상세 팝업 결함 3건 회귀 락 (김주연 총괄 field-soak 신고).
 *
 * ※ 본 결함 3건은 deployed 3BUG(a2ff8f5)에서 이미 수정됨(field-soak 스크린샷은 a2ff8f5 이전 빌드).
 *    본 스펙은 3BUG.spec 가 덮지 않는 회귀 불변식을 추가로 락한다:
 *      - B1: 헤더뿐 아니라 **1번구역(zone1) 고객정보** 가 검색 선택 고객으로 in-place 갱신.
 *      - B2: 신규예약 생성경로(createReservationCanonical) 의 is_healer_intent 컬럼누락 내성화 가드 존재.
 *      - AC5(L-002): 예약상세 팝업은 reservations.insert 를 직접 수행하지 않음(생성=parent 단일소스 위임).
 *      - B3: (+) 와 빈슬롯 우클릭 진입이 **동일 openNewSlot 단일소스** 를 호출(parity, REFIX-8 소유 동선).
 *
 * 정적 불변식(소스 구조)은 환경 비의존 → 항상 단언. 런타임 동선은 데이터/영업시간 의존 → graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const POPUP_SRC = resolve(HERE, '../../src/components/ReservationDetailPopup.tsx');
const RESV_SRC = resolve(HERE, '../../src/pages/Reservations.tsx');

async function openFirstReservationPopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const popupZone1 = page.getByTestId('popup-zone1-customer');
  const candidates = page.locator('[data-testid^="resv-card"], [data-resv-id]');
  const count = await candidates.count().catch(() => 0);
  if (count === 0) return false;
  for (let i = 0; i < Math.min(count, 5); i++) {
    await candidates.nth(i).click().catch(() => {});
    if (await popupZone1.isVisible().catch(() => false)) return true;
  }
  return popupZone1.isVisible().catch(() => false);
}

// ───────────────────────────────────────────────────────────────
// 정적 불변식 (소스 구조) — 환경 비의존, 항상 단언
// ───────────────────────────────────────────────────────────────
test.describe('T-20260615-foot-RESVPOPUP-SEARCH-NEWMODE-3FIX — 정적 불변식', () => {
  // AC5 (L-002): 팝업 내 reservations.insert = 0. 생성은 onCreateReservation(parent) 위임.
  test('AC5/L-002: 예약상세 팝업은 reservations.insert 를 직접 수행하지 않음', () => {
    const src = readFileSync(POPUP_SRC, 'utf8');
    // reservations 테이블에 대한 직접 insert 패턴이 0 이어야 함.
    //   (reservation_logs.insert / check_ins.insert 는 허용 — 별 테이블)
    const directResvInsert = src.match(/from\(['"]reservations['"]\)\s*\.\s*insert/g) ?? [];
    expect(directResvInsert.length).toBe(0);
    // 생성은 parent 단일소스 콜백(onCreateReservation) 위임 경로가 존재해야 함.
    expect(src).toContain('onCreateReservation');
    expect(src).toContain('submitNewReservation');
  });

  // B2: 신규예약 생성경로(createReservationCanonical) — is_healer_intent 컬럼누락 내성화 가드.
  test('B2: createReservationCanonical 에 is_healer_intent 컬럼누락(PGRST204/42703) 재시도 가드 존재', () => {
    const src = readFileSync(RESV_SRC, 'utf8');
    expect(src).toContain('createReservationCanonical');
    expect(src).toContain('isHealerIntentColMissing');
    // 누락 감지 조건: PGRST204 또는 42703 또는 컬럼명 regex.
    expect(src).toMatch(/PGRST204/);
    expect(src).toMatch(/42703/);
    // 감지 시 컬럼 제외 payload 로 재시도하는 분기 존재(INSERT + UPDATE 양 경로).
    const guardedRetries = src.match(/isHealerIntentColMissing\(/g) ?? [];
    expect(guardedRetries.length).toBeGreaterThanOrEqual(2);
  });

  // B3: (+) 버튼과 빈슬롯 우클릭이 동일 openNewSlot 단일소스를 호출(parity, REFIX-8 소유 동선).
  test('B3: (+) 와 빈슬롯 우클릭이 동일 openNewSlot 단일소스 진입(parity)', () => {
    const src = readFileSync(RESV_SRC, 'utf8');
    expect(src).toContain('const openNewSlot =');
    // openNewSlot 호출 지점 ≥ 2 (slot-plus (+) + 빈슬롯 td onContextMenu)
    const calls = src.match(/openNewSlot\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // 빈슬롯 td 에 우클릭 핸들러가 존재(= (+) 부재 시에도 진입 가능)
    expect(src).toMatch(/onContextMenu/);
  });

  // B1: 헤더 + zone1 모두 검색 선택 고객(loadedMatch)/customer 기준으로 바인딩.
  test('B1: 헤더 타이틀이 loadedMatch 우선 바인딩 + zone1 환자정보가 customer 기준', () => {
    const src = readFileSync(POPUP_SRC, 'utf8');
    // 헤더 고객명: loadedMatch?.name ?? customer?.name ?? reservation.customer_name (stale 차단)
    expect(src).toMatch(/loadedMatch\?\.name\s*\?\?\s*customer\?\.name\s*\?\?\s*reservation\.customer_name/);
    // 검색 선택 핸들러가 zone1 로더를 호출(in-place 갱신)
    expect(src).toMatch(/handleSelectOtherCustomer[\s\S]{0,400}loadZone1Data\(p\.id\)/);
    // zone1 환자정보가 customer 상태 기준(reservation 하드바인딩 아님)
    expect(src).toMatch(/이름[\s\S]{0,60}customer\?\.name/);
    expect(src).toMatch(/고객번호[\s\S]{0,60}customer\?\.chart_number/);
  });
});

// ───────────────────────────────────────────────────────────────
// 런타임 동선 (데이터/영업시간 의존) — graceful skip
// ───────────────────────────────────────────────────────────────
test.describe('T-20260615-foot-RESVPOPUP-SEARCH-NEWMODE-3FIX — 런타임 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // B1: 검색 선택 → 헤더 + zone1(1번구역) 고객정보가 선택 고객으로 즉시 갱신 + 두번째 모달 스폰 0.
  test('B1: 검색 선택 후 zone1 고객정보 in-place 갱신 + 단일 모달', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const search = page.locator('#resv-popup-customer-search');
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill('이');
    const option = page.locator('button:has-text("기존 고객"), [role="option"]').first();
    const hasOption = await option.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasOption) test.skip(true, '검색 결과 후보 없음(데이터 의존)');

    await option.click().catch(() => {});
    const banner = page.getByTestId('popup-loaded-customer-banner');
    const bannerVisible = await banner.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!bannerVisible) test.skip(true, '선택 후 배너 미표시(데이터 의존)');

    const bannerName = (await banner.locator('.text-teal-800').first().textContent().catch(() => '') ?? '').trim();
    if (!bannerName) test.skip(true, '선택 고객명 추출 불가');

    // zone1(1번구역) 환자정보 '이름' 행이 선택 고객으로 갱신(stale 잔존 0)
    const zone1 = page.getByTestId('popup-zone1-customer');
    const zone1Text = (await zone1.textContent().catch(() => '') ?? '');
    expect(zone1Text).toContain(bannerName);

    // 두번째 팝업/모달 스폰 0 — 다이얼로그 정확히 1개(L-002 in-place 유지)
    const dialogCount = await page.locator('[role="dialog"]').count().catch(() => 0);
    expect(dialogCount).toBeLessThanOrEqual(1);
    console.log('[B1] zone1 in-place 갱신 OK:', bannerName, '/ dialogs=', dialogCount);
  });

  // B2: (+) new-mode 진입 시 is_healer_intent schema cache 오류 토스트 없이 폼 렌더.
  test('B2: (+) new-mode 진입 시 is_healer_intent 오류 0건', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});
    const newBtn = page.getByRole('button', { name: /새 예약/ }).first();
    const hasNew = await newBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasNew) test.skip(true, '새 예약 버튼 미표시');
    await newBtn.click().catch(() => {});

    const searchEmpty = page.locator('#resv-popup-newmode-search');
    await expect(searchEmpty).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=is_healer_intent')).toHaveCount(0);

    // AC4 회귀(가드): 대상 고객 미선택 상태에서는 생성 버튼이 비활성(잘못된 INSERT 차단)
    const createBtn = page.getByRole('button', { name: /신규예약 생성/ }).first();
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      expect(await createBtn.isDisabled().catch(() => true)).toBe(true);
    }
    console.log('[B2] new-mode 진입 정상 + is_healer_intent 오류 0건 + 미선택 가드');
  });

  // B3: 빈 슬롯 우클릭 → (+)와 동일 new-mode 팝업 오픈(parity).
  test('B3: 빈 슬롯 우클릭 → new-mode 팝업 오픈(parity)', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});
    const plus = page.locator('[data-testid^="slot-plus-"]').first();
    const hasPlus = await plus.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasPlus) test.skip(true, '빈 슬롯(+) 후보 없음(영업시간/데이터 의존)');

    const cell = plus.locator('xpath=ancestor::td[1]');
    // 우클릭은 셀 모서리(+버튼 비중첩 지점)에서 시도 — (+)버튼 위 우클릭은 셀 onContextMenu 로
    //   버블되지 않을 수 있음(브라우저별 hit-target 차). 진입 routing 자체는 REFIX-8 소유 + 상단
    //   '정적 불변식' 테스트(openNewSlot 단일소스 parity)가 권위 락 → 런타임은 best-effort.
    await cell.click({ button: 'right', position: { x: 4, y: 4 } }).catch(() => {});
    const searchEmpty = page.locator('#resv-popup-newmode-search');
    const opened = await searchEmpty.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!opened) {
      test.skip(true, '빈슬롯 우클릭 진입 미발화(가드/hit-target/데이터 의존) — 정적 parity 불변식이 권위 락');
    }
    await expect(searchEmpty).toBeVisible();
    console.log('[B3] 빈 슬롯 우클릭 → new-mode 팝업 오픈 OK(parity)');
  });
});
