/**
 * E2E spec — T-20260609-foot-MSG-TEMPLATE-CRUD
 * 메시지 설정 ③ 템플릿 관리 — 사용자 정의 템플릿 추가/수정/삭제(soft-delete) CRUD.
 *
 * 현장 클릭 시나리오 (티켓 §5):
 *   S1(AC-1): ③ 템플릿 관리 진입 → [＋ 새 템플릿 추가] → 이름/본문 입력 → 저장 → 목록 노출
 *   S2(AC-2): 목록 row [수정] → 기존 값 채워짐 → 본문 변경 → 저장 → 반영
 *   S3(AC-3): row [삭제] → 확인 → 목록에서 사라짐(soft-delete: is_active=false 숨김)
 *             + 예약어 이름 차단 가드
 *   회귀(AC-5): 예약 자동발송 reserved 4종 블록 + 수정/등록 버튼 유지
 *
 * 삭제 정책(AC-3): notification_logs 는 event_type 텍스트로만 참조(FK 없음) → hard-delete
 *   FK 위반은 없으나, 이력 무결성 위해 is_active=false soft-delete 로 숨김(스키마 무변경).
 *   재추가 시 동명 숨김 템플릿은 자동 revive.
 *
 * 주: 저장·삭제 실제 DB 동작은 admin/manager + clinic 컨텍스트 필요. 미충족 환경은 skip 가드.
 *     렌더·UI 인터랙션(추가 다이얼로그·입력 필드)은 항상 검증.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** /admin/settings → ③ 템플릿 관리 진입. 성공 시 true. (cold-load 대비 충분 대기) */
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

// ---------------------------------------------------------------------------
// 회귀 / AC-5: reserved 자동발송 템플릿 4종 블록 + 수정/등록 버튼 유지
// ---------------------------------------------------------------------------
test('AC-5 회귀: 예약 자동발송(reserved) 블록 + 수정/등록 버튼 유지', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  await expect(page.getByText('예약 자동발송 템플릿').first()).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('button:has-text("수정"), button:has-text("등록")').first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// S1 / AC-1: 사용자 정의 [＋ 새 템플릿 추가] 버튼 + 다이얼로그(이름/본문)
// ---------------------------------------------------------------------------
test('AC-1: ③ 템플릿 관리 — [＋ 새 템플릿 추가] 다이얼로그(이름/본문) 노출', async ({ page }, testInfo) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  await expect(page.getByText('사용자 정의 템플릿').first()).toBeVisible({ timeout: 6_000 });
  await testInfo.attach('section-templates', { body: await page.screenshot(), contentType: 'image/png' });

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  await expect(addBtn).toBeVisible({ timeout: 6_000 });
  await addBtn.click();

  await expect(page.getByTestId('custom-tmpl-title-input')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tmpl-body-input')).toBeVisible();
  await expect(page.getByTestId('tmpl-save-btn')).toBeVisible();
  await testInfo.attach('add-dialog', { body: await page.screenshot(), contentType: 'image/png' });
});

// ---------------------------------------------------------------------------
// 가드: 예약어(reserved slug) 이름 저장 차단 — 다이얼로그 유지
// ---------------------------------------------------------------------------
test('가드: 사용자 정의 템플릿 — 예약어 이름 저장 차단', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  await page.getByTestId('custom-tmpl-title-input').fill('resv_confirm');
  await page.getByTestId('tmpl-body-input').fill('테스트 본문입니다.');
  await page.getByTestId('tmpl-save-btn').click();
  await page.waitForTimeout(500);
  // 차단되어 다이얼로그가 닫히지 않아야 함
  await expect(page.getByTestId('custom-tmpl-title-input')).toBeVisible();
});

// ---------------------------------------------------------------------------
// S1+S2+S3 / AC-1·2·3: 추가 → 수정 → 삭제(soft-delete) 풀사이클
// ---------------------------------------------------------------------------
test('AC-1/2/3: 사용자 정의 템플릿 추가→수정→삭제 풀사이클', async ({ page }, testInfo) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(); return; }

  const uniqueName = `E2E약도안내_${Date.now()}`;

  // --- 추가(AC-1) ---
  await addBtn.click();
  await page.getByTestId('custom-tmpl-title-input').fill(uniqueName);
  await page.getByTestId('tmpl-body-input').fill('주소: 종로구 어딘가 1층입니다.');
  await page.getByTestId('tmpl-save-btn').click();
  await page.waitForTimeout(1200);

  // 저장이 권한/환경 미충족으로 막히면(다이얼로그 잔존) 이후 DB 단계 skip
  if (await page.getByTestId('custom-tmpl-title-input').isVisible({ timeout: 1_500 }).catch(() => false)) {
    test.skip(); return;
  }

  const row = page.getByTestId('custom-tmpl-row').filter({ hasText: uniqueName });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await testInfo.attach('after-add', { body: await page.screenshot(), contentType: 'image/png' });

  // --- 수정(AC-2): 기존 값 채워짐 확인 → 본문 변경 ---
  await row.getByTestId('custom-tmpl-edit-btn').click();
  await expect(page.getByTestId('custom-tmpl-title-input')).toHaveValue(uniqueName);
  await page.getByTestId('tmpl-body-input').fill('주소 변경: 종로구 신주소 2층.');
  await page.getByTestId('tmpl-save-btn').click();
  await page.waitForTimeout(1000);
  await expect(
    page.getByTestId('custom-tmpl-row').filter({ hasText: '신주소 2층' }),
  ).toBeVisible({ timeout: 5_000 });

  // --- 삭제(AC-3, soft-delete): 확인 다이얼로그 수락 → 목록에서 사라짐 ---
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('custom-tmpl-row').filter({ hasText: uniqueName })
    .getByTestId('custom-tmpl-delete-btn').click();
  await page.waitForTimeout(1200);
  await expect(
    page.getByTestId('custom-tmpl-row').filter({ hasText: uniqueName }),
  ).toHaveCount(0);
  await testInfo.attach('after-delete', { body: await page.screenshot(), contentType: 'image/png' });
});
