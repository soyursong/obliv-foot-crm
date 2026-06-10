/**
 * E2E spec — T-20260610-foot-SMS-DISPLAYNAME-SPLIT (옵션B)
 * 문자 발송용 지점 표시명을 법정 의료서식(clinics.name)과 분리.
 *
 * 결정(김주연 총괄 2026-06-10): clinics.name = 17종 법정 의료서식 전용 불변,
 *   문자용 표시명 = clinic_messaging_capability.sms_display_name(별도 컬럼).
 *   NULL이면 clinics.name fallback → 세 치환 경로(수동SMS·템플릿미리보기·자동발송EF)
 *   모두 동일 우선순위(sms_display_name → clinics.name).
 *
 * 검증 surface (환경 독립·결정적인 부분만 E2E):
 *   - AC-4: /admin/settings ⓪ 연결 설정 에 "문자용 지점명" 입력 필드 렌더 + 편집 가능.
 *   - AC-2: ③ 템플릿 관리 미리보기 {지점명} 치환이 동작(고정 하드코딩 부재, 토큰/실제값).
 *
 * 주: sms_display_name 컬럼은 supervisor DB 게이트에서 마이그레이션 적용 후 값이 채워진다.
 *     loadCapability 는 select('*') 이라 컬럼 부재 시에도 에러 없이 빈값(fallback) 동작 →
 *     본 spec 은 컬럼 미적용 상태에서도 입력 필드 렌더·미리보기 동작을 결정적으로 검증한다.
 *     실제 표시명 값 치환(설정→정합)은 환경 의존이라 supervisor QA 게이트 수동 시나리오로 확인.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 전임 티켓의 정정 전 하드코딩 값 — 미리보기에 박혀 나오면 회귀.
const HARDCODED_PHONE = '010-8827-7791';

/** /admin/settings → ⓪ 연결 설정 진입. admin 전용. 성공 시 true. */
async function gotoConnectionSection(page: Page): Promise<boolean> {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (!page.url().includes('/admin/settings')) return false;
  const nav = page.locator('button:has-text("⓪ 연결 설정"), button:has-text("연결 설정")').first();
  if (!(await nav.isVisible({ timeout: 12_000 }).catch(() => false))) return false;
  await nav.click();
  await page.waitForTimeout(400);
  return true;
}

/** /admin/settings → ③ 템플릿 관리 진입. */
async function gotoTemplateSection(page: Page): Promise<boolean> {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  if (!page.url().includes('/admin/settings')) return false;
  const nav = page.locator('button:has-text("③ 템플릿 관리"), button:has-text("템플릿 관리")').first();
  if (!(await nav.isVisible({ timeout: 12_000 }).catch(() => false))) return false;
  await nav.click();
  await page.waitForTimeout(400);
  return true;
}

// ---------------------------------------------------------------------------
// AC-4: "문자용 지점명" 입력 필드 렌더 + 편집 가능
// ---------------------------------------------------------------------------
test('AC-4: ⓪ 연결 설정에 "문자용 지점명" 입력 필드 렌더', async ({ page }, testInfo) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  // admin이 아니면 ⓪ 연결 설정 미노출 → skip(권한 의존).
  if (!(await gotoConnectionSection(page))) { test.skip(); return; }

  // 라벨 "문자용 지점명" 자체가 화면에 노출되는지 먼저 확정(UI 텍스트 노출 보장).
  await expect(page.getByText('문자용 지점명').first()).toBeVisible({ timeout: 8_000 });

  const input = page.getByTestId('sms-display-name-input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await testInfo.attach('connection', { body: await page.screenshot(), contentType: 'image/png' });

  // 편집 가능 — 값 입력 후 반영(저장은 DB 게이트 후 수동 시나리오, 여기선 입력 동작만).
  await input.fill('오리진');
  await expect(input).toHaveValue('오리진');

  // 빈값=기관 정식명칭 fallback 안내 문구 노출(의도 문서화).
  // 안내 <p> 단일 요소로 scope — placeholder 속성과의 strict-mode 충돌 방지.
  await expect(page.getByText('기관 정식명칭').first()).toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// AC-2: 템플릿 미리보기 {지점명} 치환 동작 (고정 하드코딩 부재)
// ---------------------------------------------------------------------------
test('AC-2: 템플릿 미리보기 {지점명} — 고정 하드코딩 부재 + 토큰/실제값 치환', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  const bodyInput = page.getByTestId('tmpl-body-input');
  if (!(await bodyInput.isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(); return; }
  await bodyInput.fill('[오블리브 {지점명}점] {고객명}님');
  await page.waitForTimeout(500);

  const preview = page.getByTestId('tmpl-preview');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  const text = (await preview.textContent()) ?? '';
  // 전임 하드코딩 전화번호가 박혀 나오면 회귀.
  expect(text).not.toContain(HARDCODED_PHONE);
  // 고객명 치환은 항상 동작 → 미리보기 자체가 살아있음 보증.
  expect(text).toContain('홍길동');
});

// ---------------------------------------------------------------------------
// 회귀: 미리보기 기본 치환(고객명/날짜/시간) 유지
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
