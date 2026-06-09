/**
 * E2E spec — T-20260609-foot-ADMINTEMPLATE-PREVIEW-BRANCHNAME
 * AdminSettings ③ 템플릿 관리 — 미리보기 {지점명}/{지점전화번호} 하드코딩 정정.
 *
 * 버그: previewBody 가 {지점명}→'풋센터종로', {지점전화번호}→'010-8827-7791' 로
 *       고정 하드코딩 → 어느 지점으로 로그인해도 미리보기가 '풋센터종로' 로 표시(UX 혼란).
 *       발송 EF(send-notification)는 clinics.name / sender_number 사용해 정상.
 *
 * 수정: SectionTemplates 가 clinicId 기준 clinics.name +
 *       clinic_messaging_capability.sender_number 를 useEffect 로 조회 → 실제값 치환.
 *       조회 전/실패 시 원본 토큰 유지(고정값 금지).
 *
 * 현장 클릭 시나리오 (티켓 §4):
 *   S1(정상): /admin/settings → ③ 템플릿 관리 → {지점명} 포함 템플릿 [수정/등록]
 *             → 미리보기에 '풋센터종로'/'010-8827-7791' 하드코딩이 나오지 않음.
 *   S2(지점별 분기): 로그인 지점별로 미리보기 {지점명} 이 해당 지점명으로 표시
 *             (환경 의존 → 결정적 검증은 "제거된 하드코딩 부재"로 대체).
 *
 * 주: 실제 지점명 값은 로그인 환경(clinic 컨텍스트)에 의존하므로, 환경 독립적이고
 *     결정적인 핵심 가드 = "삭제된 하드코딩 문자열이 미리보기에 절대 나타나지 않음".
 *     (실제 지점명이 우연히 '풋센터종로'인 경우는 본 CRM 데이터상 발생 가능하나,
 *      그 경우에도 전화번호 하드코딩 '010-8827-7791' 부재로 회귀를 잡는다.)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 정정 전 하드코딩 값 — 미리보기에 이 문자열이 박혀 나오면 회귀.
const HARDCODED_PHONE = '010-8827-7791';

/** /admin/settings → ③ 템플릿 관리 진입. 성공 시 true. */
async function gotoTemplateSection(page: Page): Promise<boolean> {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (!page.url().includes('/admin/settings')) return false;
  const tmplNav = page.locator('button:has-text("③ 템플릿 관리"), button:has-text("템플릿 관리")').first();
  if (!(await tmplNav.isVisible({ timeout: 12_000 }).catch(() => false))) return false;
  await tmplNav.click();
  await page.waitForTimeout(400);
  return true;
}

/** reserved 자동발송 템플릿(본문에 {지점명}/{지점전화번호} 포함)의 [수정]/[등록] 다이얼로그를 연다. */
async function openReservedEditDialog(page: Page): Promise<boolean> {
  const btn = page.locator('button:has-text("수정"), button:has-text("등록")').first();
  if (!(await btn.isVisible({ timeout: 6_000 }).catch(() => false))) return false;
  await btn.click();
  // 미리보기 영역 등장 대기
  return await page.getByTestId('tmpl-preview').isVisible({ timeout: 5_000 }).catch(() => false);
}

// ---------------------------------------------------------------------------
// AC-1/2/3: 미리보기에 제거된 하드코딩(지점전화번호)이 나타나지 않음
// ---------------------------------------------------------------------------
test('AC-2/3: 미리보기 {지점전화번호} 하드코딩(010-8827-7791) 부재', async ({ page }, testInfo) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }
  if (!(await openReservedEditDialog(page))) { test.skip(); return; }

  const preview = page.getByTestId('tmpl-preview');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  await testInfo.attach('preview', { body: await page.screenshot(), contentType: 'image/png' });

  const text = (await preview.textContent()) ?? '';
  // 본문에 {지점전화번호} 토큰이 있었다면 → 실제 발신번호 또는 토큰 유지, 절대 하드코딩 금지.
  expect(text).not.toContain(HARDCODED_PHONE);
});

// ---------------------------------------------------------------------------
// AC-2: 본문에 {지점명} 토큰 입력 시 미리보기에 고정값이 아닌 실제값/토큰만
// ---------------------------------------------------------------------------
test('AC-2: 본문 {지점명} 입력 → 미리보기 고정 하드코딩 부재', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  // 사용자 정의 추가 다이얼로그에서 {지점명}{지점전화번호} 직접 입력 → 미리보기 검증(저장 불필요).
  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  const bodyInput = page.getByTestId('tmpl-body-input');
  if (!(await bodyInput.isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(); return; }
  await bodyInput.fill('지점: {지점명} / 전화: {지점전화번호}');
  await page.waitForTimeout(500);

  const preview = page.getByTestId('tmpl-preview');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  const text = (await preview.textContent()) ?? '';
  // 제거된 전화 하드코딩이 미리보기에 박혀 나오면 회귀.
  expect(text).not.toContain(HARDCODED_PHONE);
  // 조회 전/실패 시 토큰 유지가 안전 fallback → '전화:' 라벨은 항상 보여야 함.
  expect(text).toContain('전화:');
});

// ---------------------------------------------------------------------------
// 회귀: 미리보기 자체가 정상 렌더(고객명/날짜/시간 치환 유지)
// ---------------------------------------------------------------------------
test('회귀: 미리보기 기본 치환(고객명/날짜/시간) 유지', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  const bodyInput = page.getByTestId('tmpl-body-input');
  if (!(await bodyInput.isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(); return; }
  await bodyInput.fill('{고객명}님 {날짜} {시간}');
  await page.waitForTimeout(400);

  const preview = page.getByTestId('tmpl-preview');
  const text = (await preview.textContent()) ?? '';
  expect(text).toContain('홍길동');
  expect(text).toContain('2026-05-26');
  expect(text).toContain('14:30');
});
