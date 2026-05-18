/**
 * E2E Spec: T-20260517-foot-CHECKIN-2STEP
 * 셀프체크인 방문유형·유입경로 2단계 구조 개편
 *
 * AC-1: 방문유형 1단계 — [예약하고 왔어요] / [예약 없이 방문했어요] 2버튼 표시
 * AC-2: 방문유형 2단계 — 예약 고객 초진/재진 선택
 * AC-3: 워크인 안내 팝업 표시 + [확인 후 접수하기] 버튼
 * AC-4: 체험(experience) 유형 셀프체크인 노출 제거
 * AC-5: 유입경로 대분류 5종 표시
 * AC-5b: SNS 선택 시에만 소분류 4종 노출
 * AC-5c: 소개자 이름·전화번호 입력란 없음
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const CHECKIN_URL = `${BASE_URL}/checkin/jongno-foot`;

// ── AC-1: 방문유형 1단계 — 예약여부 2버튼 ─────────────────────────────────────

test('AC-1: 방문유형 1단계 — 예약하고 왔어요/예약 없이 방문했어요 2버튼 표시', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  // 1단계 2버튼 존재
  await expect(page.getByRole('button', { name: '예약하고 왔어요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '예약 없이 방문했어요' })).toBeVisible();
});

test('AC-1: 기존 3종(초진/재진/체험) 평면 선택 제거 — 방문유형 라벨이 1단계 버튼에 없음', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  // '예약하고 왔어요' 클릭 전에는 2단계(초진/재진) 버튼 없어야 함
  const visitNewBtn = page.getByRole('button', { name: '초진' });
  const visitReturnBtn = page.getByRole('button', { name: '재진' });
  await expect(visitNewBtn).not.toBeVisible();
  await expect(visitReturnBtn).not.toBeVisible();
});

// ── AC-2: 방문유형 2단계 — 예약 고객 초진/재진 선택 ────────────────────────────

test('AC-2: 예약하고 왔어요 클릭 시 초진/재진 2단계 버튼 표시', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  // 1단계: 예약 선택
  await page.getByRole('button', { name: '예약하고 왔어요' }).click();

  // 2단계 버튼 노출 확인
  await expect(page.getByText('처음 방문입니다').or(page.getByText('초진'))).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('재방문입니다').or(page.getByText('재진'))).toBeVisible({ timeout: 3000 });
});

test('AC-2: 초진 선택 시 초진 버튼 활성 상태', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '예약하고 왔어요' }).click();

  // 초진 - 처음 방문입니다 버튼 클릭
  const newBtn = page.locator('button').filter({ hasText: '초진' }).first();
  await expect(newBtn).toBeVisible({ timeout: 3000 });
  await newBtn.click();

  // 클릭 후 버튼 활성화(스타일 변경) — 비활성화 상태가 아님
  await expect(newBtn).not.toBeDisabled();
});

// ── AC-3: 워크인 안내 팝업 ─────────────────────────────────────────────────────

test('AC-3: 예약 없이 방문했어요 클릭 시 안내 팝업 표시', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();

  // 팝업 내용 확인
  await expect(page.getByText('당일 예약 상황에 따라')).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('데스크에 문의해주세요')).toBeVisible({ timeout: 3000 });

  // 확인 버튼 존재
  await expect(page.getByRole('button', { name: '확인 후 접수하기' })).toBeVisible();
});

test('AC-3: 확인 후 접수하기 클릭 시 팝업 닫힘 + 접수 가능 상태', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '예약 없이 방문했어요' }).click();
  await expect(page.getByRole('button', { name: '확인 후 접수하기' })).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: '확인 후 접수하기' }).click();

  // 팝업 사라짐
  await expect(page.getByText('당일 예약 상황에 따라')).not.toBeVisible({ timeout: 3000 });
});

// ── AC-4: 체험(experience) 노출 제거 ──────────────────────────────────────────

test('AC-4: 셀프체크인 화면에 체험(experience) 선택지 없음', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  // '체험' 텍스트 없음 확인
  await expect(page.getByRole('button', { name: '체험' })).not.toBeVisible();
  await expect(page.getByText('experience')).not.toBeVisible();
});

// ── AC-5: 유입경로 대분류 5종 ─────────────────────────────────────────────────

test('AC-5: 유입경로 대분류 5종 버튼 표시 — SNS/검색/지인소개/제휴/기타', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await expect(page.getByRole('button', { name: 'SNS' })).toBeVisible();
  await expect(page.getByRole('button', { name: '검색' })).toBeVisible();
  await expect(page.getByRole('button', { name: '지인소개' })).toBeVisible();
  await expect(page.getByRole('button', { name: '제휴' })).toBeVisible();
  await expect(page.getByRole('button', { name: '기타' })).toBeVisible();
});

test('AC-5: 검색 선택 시 추가 소분류 없이 즉시 완료 (SNS 소분류 미노출)', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '검색' }).click();

  // SNS 소분류 버튼들 미노출
  await expect(page.getByRole('button', { name: '인스타그램' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '유튜브' })).not.toBeVisible();
});

// ── AC-5b: SNS 소분류 노출 ─────────────────────────────────────────────────────

test('AC-5b: SNS 클릭 시 소분류 4종 노출 — 인스타그램/페이스북/유튜브/블로그카페', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'SNS' }).click();

  // 2단계 소분류 표시
  await expect(page.getByRole('button', { name: '인스타그램' })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('button', { name: '페이스북' })).toBeVisible();
  await expect(page.getByRole('button', { name: '유튜브' })).toBeVisible();
  await expect(page.getByRole('button', { name: '블로그/카페' })).toBeVisible();
});

test('AC-5b: SNS → 인스타그램 선택 후 canSubmit 조건 충족', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  // 이름 입력
  await page.getByPlaceholder('홍길동').fill('테스트');

  // 전화번호 숫자패드 입력
  for (const digit of ['0', '1', '0', '1', '2', '3', '4', '5', '6', '7', '8']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }

  // 방문유형 2단계
  await page.getByRole('button', { name: '예약하고 왔어요' }).click();
  const newBtn = page.locator('button').filter({ hasText: '초진' }).first();
  await newBtn.click();

  // 유입경로 SNS → 인스타그램
  await page.getByRole('button', { name: 'SNS' }).click();
  await page.getByRole('button', { name: '인스타그램' }).click();

  // 접수하기 버튼 활성화
  await expect(page.getByRole('button', { name: '접수하기' })).toBeEnabled({ timeout: 3000 });
});

// ── AC-5c: 소개자 정보 입력란 없음 ─────────────────────────────────────────────

test('AC-5c: 지인소개 선택 시 소개자 이름·전화번호 입력란 없음', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: '지인소개' }).click();

  // 소개자 관련 입력 필드 없음
  await expect(page.getByPlaceholder('소개자 이름')).not.toBeVisible();
  await expect(page.getByPlaceholder('소개자 연락처')).not.toBeVisible();
  await expect(page.getByLabel('소개자')).not.toBeVisible();

  // SNS 소분류도 미노출
  await expect(page.getByRole('button', { name: '인스타그램' })).not.toBeVisible();
});

// ── 회귀 — 셀프체크인 기본 렌더링 ─────────────────────────────────────────────

test('회귀: 셀프체크인 페이지 기본 렌더링 (페이지 로드 + 성함 입력 필드)', async ({ page }) => {
  await page.goto(CHECKIN_URL);
  await expect(page.getByText('셀프 접수').or(page.getByText('Self Check-In'))).toBeVisible({ timeout: 15000 });
  await expect(page.getByPlaceholder('홍길동')).toBeVisible();
  await expect(page.getByRole('button', { name: '접수하기' })).toBeDisabled();
});
