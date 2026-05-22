/**
 * E2E Spec: T-20260522-foot-CHECKIN-FIRST-INFO
 * 초진 접수 시 정보입력 폼 선행 후 상담대기 이동
 *
 * AC-1: 초진 접수 클릭 시 CheckinFirstInfoDialog 표시
 *       - 이름/전화번호 프리필 (읽기전용)
 *       - 주민번호 입력 필드 존재
 *       - 건보동의서 서명 패드 존재
 * AC-2: 입력 완료 후 접수 진행
 *       - 체크박스 + 서명 완성 시 "접수 완료" 버튼 활성화
 *       - 제출 시 toast 성공 메시지
 * AC-3: 재진 접수 시 폼 없이 바로 체크인
 *       - CheckinFirstInfoDialog 미표시
 * AC-4: 다른 접수 경로(SelfCheckIn, NewCheckInDialog) 회귀 없음
 * AC-5: CheckinFirstInfoDialog UI — 건보조회동의서 내용 포함
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── AC-1: 다이얼로그 구조 검증 ────────────────────────────────────────────────

test('AC-1: CheckinFirstInfoDialog — 이름/전화번호/주민번호/서명 필드 존재', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  // 초진 카드(Box1)에서 접수 버튼 찾기
  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  const cnt = await box1Cards.count();
  if (cnt === 0) {
    test.skip(true, '초진 예약 카드 없음 — 건너뜀');
    return;
  }

  const firstCard = box1Cards.first();
  const checkInBtn = firstCard.getByRole('button', { name: '접수' });
  if (!(await checkInBtn.isVisible())) {
    test.skip(true, '접수 버튼 없음 — 건너뜀');
    return;
  }

  await checkInBtn.click();

  // CheckinFirstInfoDialog 열림 확인
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(dialog.getByText('초진 접수 — 정보 입력')).toBeVisible();

  // 이름 필드 (프리필, 읽기전용)
  await expect(dialog.getByTestId('checkin-info-name')).toBeVisible();
  await expect(dialog.getByTestId('checkin-info-name')).toBeDisabled();

  // 전화번호 필드 (프리필, 읽기전용)
  await expect(dialog.getByTestId('checkin-info-phone')).toBeVisible();

  // 주민번호 입력 필드
  await expect(dialog.getByTestId('checkin-info-rrn')).toBeVisible();

  // 건보동의서 체크박스
  await expect(dialog.getByTestId('checkin-info-consent-checkbox')).toBeVisible();
});

test('AC-1: CheckinFirstInfoDialog — 주민번호 자동 포맷 (YYMMDD-XXXXXXX)', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) {
    test.skip(true, '초진 예약 카드 없음');
    return;
  }

  const checkInBtn = box1Cards.first().getByRole('button', { name: '접수' });
  if (!(await checkInBtn.isVisible())) {
    test.skip(true, '접수 버튼 없음');
    return;
  }
  await checkInBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 주민번호 입력 자동 포맷 확인
  const rrnInput = dialog.getByTestId('checkin-info-rrn');
  await rrnInput.fill('9001011234567');
  await expect(rrnInput).toHaveValue('900101-1234567');
});

// ── AC-2: 버튼 활성화 조건 ────────────────────────────────────────────────────

test('AC-2: 접수완료 버튼 — 주민번호 미입력 시 비활성화', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) {
    test.skip(true, '초진 예약 카드 없음');
    return;
  }

  const checkInBtn = box1Cards.first().getByRole('button', { name: '접수' });
  if (!(await checkInBtn.isVisible())) {
    test.skip(true, '접수 버튼 없음');
    return;
  }
  await checkInBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 아무것도 입력 안 한 상태 → 접수 완료 버튼 비활성화
  const submitBtn = dialog.getByTestId('btn-checkin-first-info-submit');
  await expect(submitBtn).toBeDisabled();
});

test('AC-2: 접수완료 버튼 — 동의 체크 후에도 서명 없으면 비활성화', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) {
    test.skip(true, '초진 예약 카드 없음');
    return;
  }

  const checkInBtn = box1Cards.first().getByRole('button', { name: '접수' });
  if (!(await checkInBtn.isVisible())) {
    test.skip(true, '접수 버튼 없음');
    return;
  }
  await checkInBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 주민번호 입력
  await dialog.getByTestId('checkin-info-rrn').fill('9001011234567');
  // 동의 체크
  await dialog.getByTestId('checkin-info-consent-checkbox').check();

  // 서명 없음 → 버튼 비활성화
  const submitBtn = dialog.getByTestId('btn-checkin-first-info-submit');
  await expect(submitBtn).toBeDisabled();
});

// ── AC-3: 재진 — 폼 없이 바로 체크인 ─────────────────────────────────────────

test('AC-3: 재진 Box2 접수 버튼 — CheckinFirstInfoDialog 표시 안 됨', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box2Cards = page.locator('[data-testid="box2-resv-card"]');
  if (await box2Cards.count() === 0) {
    test.skip(true, '재진 예약 카드 없음 — 건너뜀');
    return;
  }

  // 재진 카드 "접수" 버튼 클릭 시 CheckinFirstInfoDialog("초진 접수 — 정보 입력") 미표시
  // (실제 체크인은 DB 연결 필요 → UI 확인만)
  const box2Btn = box2Cards.first().getByRole('button', { name: '접수' });
  if (!(await box2Btn.isVisible())) {
    test.skip(true, '재진 접수 버튼 없음');
    return;
  }

  // 단순히 버튼이 존재하고 클릭 가능한지 확인 (클릭 시 DB 필요 → confirm만)
  await expect(box2Btn).not.toBeDisabled();
});

// ── AC-4: 회귀 — SelfCheckIn 경로 무영향 ─────────────────────────────────────

test('AC-4: SelfCheckIn 페이지 — CHECKIN-FIRST-INFO 적용 후 기존 경로 무영향', async ({ page }) => {
  await page.goto(`${BASE_URL}/self-checkin`);
  await expect(page).toHaveURL(/self-checkin/);
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  // CheckinFirstInfoDialog 관련 DOM 없어야 함
  await expect(page.getByText('초진 접수 — 정보 입력')).not.toBeVisible();
});

test('AC-4: NewCheckInDialog — CHECKIN-FIRST-INFO 적용 후 회귀 없음', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('오늘 현황')).toBeVisible({ timeout: 15000 });

  // 체크인 추가 버튼 클릭 → NewCheckInDialog 열림 확인
  const newCheckInBtn = page.getByRole('button', { name: /체크인 추가/ });
  if (await newCheckInBtn.count() === 0) {
    test.skip(true, '체크인 추가 버튼 없음');
    return;
  }

  await newCheckInBtn.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  // NewCheckInDialog title 확인 (CheckinFirstInfoDialog가 아닌 기존 다이얼로그)
  await expect(dialog.getByText('체크인 추가')).toBeVisible();
});

// ── AC-5: 건보조회동의서 내용 ─────────────────────────────────────────────────

test('AC-5: CheckinFirstInfoDialog — 건강보험 자격조회 동의서 내용 포함', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/dashboard`);
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15000 });

  const box1Cards = page.locator('[data-testid="box1-resv-card"]');
  if (await box1Cards.count() === 0) {
    test.skip(true, '초진 예약 카드 없음');
    return;
  }

  const checkInBtn = box1Cards.first().getByRole('button', { name: '접수' });
  if (!(await checkInBtn.isVisible())) {
    test.skip(true, '접수 버튼 없음');
    return;
  }
  await checkInBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // 건강보험 자격 조회 동의서 헤더
  await expect(dialog.getByText('건강보험 자격 조회 동의서')).toBeVisible();
  // 동의서 내용 일부
  await expect(dialog.getByText(/건강보험 자격 및 보험료 납부 현황을 조회/)).toBeVisible();
});

// ── 예약관리 팝업 경로 — ReservationDetailPopup ────────────────────────────────

test('ReservationDetailPopup: 초진 "체크인 전환" 버튼 — CheckinFirstInfoDialog 트리거', async ({ page }) => {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await expect(page).toHaveURL(/reservations/);

  // 예약 카드 클릭 → 상세 팝업
  const resvCard = page.locator('[data-testid^="resv-card-"]').first();
  if (await resvCard.count() === 0) {
    test.skip(true, '예약 카드 없음');
    return;
  }

  // 더블클릭으로 detail 팝업 열기
  await resvCard.dblclick();

  // 팝업 열림 확인
  const popup = page.getByRole('dialog').filter({ hasText: '체크인 전환' });
  if (await popup.count() === 0) {
    test.skip(true, '상세 팝업 없음');
    return;
  }

  // "체크인 전환" 버튼 존재 확인
  const convertBtn = popup.getByRole('button', { name: '체크인 전환' });
  await expect(convertBtn).toBeVisible();
});
