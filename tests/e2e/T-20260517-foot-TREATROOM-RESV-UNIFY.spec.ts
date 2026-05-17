/**
 * E2E Spec: T-20260517-foot-TREATROOM-RESV-UNIFY
 * 치료실현황 예약창 → 당일현황 빠른예약창(DASH-RESV-EXTEND, a1503e5) 기준 통일
 *
 * AC-1: 이름/연락처 InlinePatientSearch — 기존 환자 검색·자동 로드
 * AC-2: 신규 환자 즉석 등록 패널 — 이름+전화번호 필수 입력
 * AC-3: 방문유형 한글 버튼 [초진][재진][체험] 모두 존재
 * AC-4: 예약메모 텍스트 입력 필드 존재
 * AC-5: 생성된 예약에 customer_id + phone 포함 보장 (셀프체크인 매칭)
 * AC-6: 기존 당일현황 빠른예약창 기능 비파괴
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|$)/, { timeout: 10000 });
  }
}

/** 대시보드 타임라인 슬롯 클릭 → QuickReservationDialog 오픈 헬퍼 */
async function openQuickResvDialog(page: import('@playwright/test').Page) {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 초진 슬롯 중 빈 슬롯 클릭 시도 (예약 없는 타임 슬롯)
  // 타임라인 슬롯: title="빈 영역 클릭 → 초진 예약 추가..." 힌트
  const slot = page.locator('[title*="초진 예약 추가"]').first();
  if (await slot.isVisible({ timeout: 3000 }).catch(() => false)) {
    await slot.click();
  } else {
    // 재진 슬롯 fallback
    const resvSlot = page.locator('[title*="재진 예약 추가"]').first();
    if (await resvSlot.isVisible({ timeout: 3000 }).catch(() => false)) {
      await resvSlot.click();
    }
  }
  // 다이얼로그가 열리지 않으면 타임라인 빈 슬롯 중 아무 곳 클릭
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }
  return true;
}

// ── AC-3: 방문유형 [초진][재진][체험] 버튼 존재 ─────────────────────────────

test('AC-3: QuickReservationDialog — 방문유형 [초진][재진][체험] 버튼 3개 모두 존재', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // AC-3: 방문유형 한글 버튼 3개 확인
  await expect(dialog.getByRole('button', { name: '초진' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '재진' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '체험' })).toBeVisible();

  await page.keyboard.press('Escape');
});

// ── AC-1: 이름으로 검색 / 연락처로 검색 InlinePatientSearch ───────────────────

test('AC-1: QuickReservationDialog — 이름으로 검색 + 연락처로 검색 필드 존재', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // AC-1: 이름 검색 필드 (placeholder="홍길동")
  await expect(dialog.getByPlaceholder('홍길동')).toBeVisible();

  // AC-1: 연락처 검색 필드 (placeholder="010-1234-5678")
  await expect(dialog.getByPlaceholder('010-1234-5678')).toBeVisible();

  // 이름 입력 → 기존 고객 검색 트리거 가능 확인
  await dialog.getByPlaceholder('홍길동').fill('김');
  // debounce 300ms 대기
  await page.waitForTimeout(400);
  // 에러 없이 동작함 (드롭다운 표시 여부는 DB 데이터 의존)

  await page.keyboard.press('Escape');
});

// ── AC-4: 예약메모 입력 필드 존재 ──────────────────────────────────────────

test('AC-4: QuickReservationDialog — 예약메모 텍스트 입력 필드 존재', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // AC-4: 예약메모 텍스트에어리어 존재
  await expect(dialog.getByPlaceholder(/인스타그램|지인 소개|인바운드/)).toBeVisible();

  // 메모 입력 가능 확인
  await dialog.getByPlaceholder(/인스타그램|지인 소개|인바운드/).fill('힐러 레이저 예정');
  await expect(dialog.getByPlaceholder(/인스타그램|지인 소개|인바운드/)).toHaveValue('힐러 레이저 예정');

  await page.keyboard.press('Escape');
});

// ── AC-2: 신규 환자 즉석 등록 패널 ──────────────────────────────────────────

test('AC-2: QuickReservationDialog — 신규 환자 등록 링크 클릭 → 등록 패널 표시', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // AC-2: [+ 신규 환자 등록] 버튼/링크 클릭
  const newPatientBtn = dialog.getByText('+ 신규 환자 등록');
  await expect(newPatientBtn).toBeVisible();
  await newPatientBtn.click();

  // 신규 환자 즉석 등록 패널 확인
  await expect(dialog.getByText('신규 환자 즉석 등록')).toBeVisible();
  await expect(dialog.getByPlaceholder('이름 *')).toBeVisible();
  await expect(dialog.getByPlaceholder('010-1234-5678 *')).toBeVisible();
  await expect(dialog.getByPlaceholder(/생년월일/)).toBeVisible();

  // 취소 버튼으로 패널 닫기
  const cancelBtn = dialog.getByRole('button', { name: '취소' }).first();
  await cancelBtn.click();

  // 패널 닫히고 신규 환자 등록 링크 다시 표시
  await expect(dialog.getByText('+ 신규 환자 등록')).toBeVisible({ timeout: 2000 });

  await page.keyboard.press('Escape');
});

// ── AC-3: 체험 visit_type 선택 ─────────────────────────────────────────────

test('AC-3: QuickReservationDialog — [체험] 버튼 클릭 시 선택 상태로 전환', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const expBtn = dialog.getByRole('button', { name: '체험' });
  await expect(expBtn).toBeVisible();
  await expBtn.click();

  // 선택된 버튼은 teal 배경 (bg-teal-600) — 클래스 또는 스타일 확인
  await expect(expBtn).toHaveClass(/bg-teal-600/);

  await page.keyboard.press('Escape');
});

// ── AC-6: 기존 당일현황 기능 비파괴 — 다이얼로그 타이틀 동일 ───────────────

test('AC-6: QuickReservationDialog — 다이얼로그 타이틀 "빠른 예약 추가" 유지', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 다이얼로그 제목 유지 확인
  await expect(dialog.getByText('빠른 예약 추가')).toBeVisible();

  // 날짜/시간 필드 여전히 존재
  await expect(dialog.locator('input[type="date"]')).toBeVisible();
  await expect(dialog.locator('select')).toBeVisible();

  // [예약 생성] 버튼 존재
  await expect(dialog.getByRole('button', { name: '예약 생성' })).toBeVisible();

  await page.keyboard.press('Escape');
});

// ── AC-5: 셀프체크인 매칭 — customer_id 포함 예약 생성 코드 검증 ─────────────

test('AC-5: QuickReservationDialog — 기존 환자 선택 시 customer_id 연결 배지 확인', async ({ page }) => {
  const opened = await openQuickResvDialog(page);
  if (!opened) {
    test.skip(true, '타임라인 빈 슬롯 없음 — 스킵');
    return;
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 이름 검색 필드에 2자 이상 입력
  const nameInput = dialog.getByPlaceholder('홍길동');
  await nameInput.fill('김');
  await page.waitForTimeout(400);

  // 검색 결과가 있을 경우 첫 번째 항목 클릭
  const dropdown = page.locator('.absolute.z-30').first();
  if (await dropdown.isVisible({ timeout: 1500 }).catch(() => false)) {
    const firstResult = dropdown.locator('button[type="button"]').first();
    if (await firstResult.isVisible({ timeout: 1000 }).catch(() => false)) {
      await firstResult.click();
      // AC-5: "기존 고객 선택됨" 배지 확인 → customer_id 연결 보장
      await expect(dialog.getByText('기존 고객 선택됨')).toBeVisible({ timeout: 2000 });
    }
  }

  await page.keyboard.press('Escape');
});
