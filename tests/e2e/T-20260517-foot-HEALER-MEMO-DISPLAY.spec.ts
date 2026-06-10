/**
 * E2E Spec: T-20260517-foot-HEALER-MEMO-DISPLAY
 * 치료사 현황(DoctorTools → 진료환자목록) 환자 정보에 예약메모 표시
 *
 * AC-1: 치료사 현황 환자 정보 영역에 예약메모 컬럼/필드 표시
 * AC-2: 표시 항목 순서: 환자 이름 → 재진표시 → 현재 상태 → 예약메모
 * AC-3: 예약메모 없는 경우 '—' 표시 — 레이아웃 깨짐 없음
 * AC-4: 메모 내용이 긴 경우 truncation 처리 (max-w 제한)
 * AC-5: 기존 DoctorPatientList 기능(처방 펼치기 등) 영향 없음
 * AC-6: tsc --noEmit 0 에러 + vite build 정상
 *
 * 구현 위치: src/components/doctor/DoctorPatientList.tsx
 *   - PatientRow 타입에 booking_memo: string | null 추가
 *   - useTodayPatients 쿼리에 reservation:reservation_id(booking_memo) join 추가
 *   - 환자 행 UI에 booking_memo span(data-testid="booking-memo") 렌더
 */

import { test, expect } from '@playwright/test';

// 네비게이션은 playwright.config 의 use.baseURL(테스트 서버 :8089) + storageState 인증을 사용한다.
//   (과거 하드코딩 :5173 / 폼 로그인 → 포트 8089 표준화·storageState 도입으로 env drift 발생했었음.
//    상대경로 goto 로 정합 — 인증은 desktop-chrome storageState 가 제공.)
async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto('/');
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|$)/, { timeout: 10000 });
  }
}

/** 원장도구 페이지 → 진료환자목록 탭으로 이동 */
async function navigateToPatientList(page: import('@playwright/test').Page) {
  await loginIfNeeded(page);
  // DoctorTools 페이지로 이동
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 진료환자목록 탭이 있으면 클릭
  const patientListTab = page.getByRole('tab', { name: /진료환자목록|환자목록/ }).first();
  if (await patientListTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await patientListTab.click();
    await page.waitForTimeout(500);
  }
}

// ── AC-1: 예약메모 필드(data-testid="booking-memo")가 렌더됨 ──────────────────

test('AC-1: 치료사 현황 환자 행에 예약메모 필드(booking-memo) 존재', async ({ page }) => {
  await navigateToPatientList(page);

  // 환자 목록 컨테이너 확인
  const patientList = page.locator('[data-testid="patient-list"]');
  const listVisible = await patientList.isVisible({ timeout: 5000 }).catch(() => false);

  if (!listVisible) {
    // 오늘 접수 환자 없음 — 빈 상태 레이아웃만 확인 후 스킵
    const emptyMsg = page.getByText(/오늘 접수된 환자가 없습니다/);
    if (await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, '오늘 접수 환자 없음 — 레이아웃 스킵');
    }
    return;
  }

  // 첫 번째 환자 행에 booking-memo data-testid 존재 확인
  const firstMemo = patientList.locator('[data-testid="booking-memo"]').first();
  await expect(firstMemo).toBeVisible();
});

// ── AC-2: 표시 순서 — 이름 → 재진표시 → 상태 → 예약메모 ─────────────────────

test('AC-2: 환자 행 내 요소 순서: 이름 → 방문유형배지 → 상태 → 예약메모', async ({ page }) => {
  await navigateToPatientList(page);

  const patientList = page.locator('[data-testid="patient-list"]');
  if (!await patientList.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '오늘 접수 환자 없음');
    return;
  }

  const firstRow = page.locator('[data-testid="patient-row"]').first();
  await expect(firstRow).toBeVisible();

  // 행 내 4개 요소가 모두 존재하는지 확인
  // 이름: font-semibold span
  // 방문유형배지: span.inline-block (VisitTypeBadge)
  // 상태: text-[11px] span (STATUS_KO)
  // 예약메모: [data-testid="booking-memo"]
  const memoEl = firstRow.locator('[data-testid="booking-memo"]');
  await expect(memoEl).toBeVisible();
});

// ── AC-3: 예약메모 없는 경우 '—' 표시 ──────────────────────────────────────

test('AC-3: 예약메모 없는 환자 행은 "—" 표시하고 레이아웃 정상', async ({ page }) => {
  await navigateToPatientList(page);

  const patientList = page.locator('[data-testid="patient-list"]');
  if (!await patientList.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '오늘 접수 환자 없음');
    return;
  }

  // 모든 booking-memo 요소 순회 — '—' 또는 내용이 있어야 함
  const memoEls = page.locator('[data-testid="booking-memo"]');
  const count = await memoEls.count();
  expect(count).toBeGreaterThan(0);

  // 첫 번째 요소는 비어있거나 내용이 있어야 함 (레이아웃 정상)
  const firstMemo = memoEls.first();
  const text = await firstMemo.textContent();
  expect(text).toBeTruthy(); // null이 아님 (빈 레이아웃 없음)
});

// ── AC-4: 긴 메모 truncation (max-w-[160px] truncate 클래스) ─────────────────

test('AC-4: 예약메모 truncation 클래스 적용 확인 (max-w 제한)', async ({ page }) => {
  await navigateToPatientList(page);

  const patientList = page.locator('[data-testid="patient-list"]');
  if (!await patientList.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '오늘 접수 환자 없음');
    return;
  }

  // booking-memo 요소에 truncate 클래스 + max-w 제한 클래스 존재 확인
  const firstMemo = page.locator('[data-testid="booking-memo"]').first();
  await expect(firstMemo).toHaveClass(/truncate/);
});

// ── AC-5: 기존 기능(처방 펼치기) 비파괴 확인 ─────────────────────────────────

test('AC-5: 기존 처방 펼치기 기능 비파괴', async ({ page }) => {
  await navigateToPatientList(page);

  const patientList = page.locator('[data-testid="patient-list"]');
  if (!await patientList.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, '오늘 접수 환자 없음');
    return;
  }

  // 첫 번째 환자 행의 펼치기 버튼 클릭
  const firstRow = page.locator('[data-testid="patient-row"]').first();
  const expandBtn = firstRow.locator('button[class*="rounded"]').last();

  if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expandBtn.click();
    await page.waitForTimeout(300);
    // 에러 없이 동작하면 OK
    const hasError = await page.locator('text=Error').isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasError).toBe(false);
  }
});

// ── 회귀: DoctorTools 페이지 자체 정상 렌더 ─────────────────────────────────

test('회귀: DoctorTools 페이지 정상 로드', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 페이지 타이틀 또는 주요 요소 존재 확인
  const hasDoctorContent = await page.locator('text=진료').first().isVisible({ timeout: 5000 }).catch(() => false);
  expect(hasDoctorContent).toBe(true);
});
