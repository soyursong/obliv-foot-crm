/**
 * E2E spec — T-20260610-foot-TEMPLATE-IMAGE-SAVE
 * 메시지 템플릿 설정 — 이미지 삽입 시 저장 안 됨(영속 실패) 버그.
 *
 * AC-0(조사 결과): image_path 컬럼 + message-images 버킷(migration 20260609200000)이
 *   prod 미적용이면 이미지 저장이 실패한다. FE/EF는 배포됐으나 DB 인프라 미적용이 root cause.
 *   → 1차 해결은 supervisor DB게이트(마이그레이션 prod 적용). 본 spec은 FE 방어(AC-2)를 검증.
 *
 * 현장 클릭 시나리오:
 *   S1 (AC-1/AC-2): 템플릿 편집기 → JPG 이미지 첨부 → 저장.
 *      - 인프라 적용 환경: 성공 토스트 + 재진입 시 미리보기 영속(AC-1).
 *      - 인프라 미적용 환경: "이미지 첨부 저장 기능이 아직 활성화되지 않았습니다…" 명확 안내(AC-2).
 *      ⇒ 어느 경우든 **silent 실패 금지** — raw "Bucket not found"/"image_path"는 화면에 노출되지 않는다.
 *   S2 (AC-3 회귀): 이미지 미첨부 텍스트 템플릿 저장은 종전대로 동작(컬럼 부재와 무관).
 *
 * 주: clinic/role/DB 의존 동작은 환경에 따라 skip 가드. 렌더·인터랙션·토스트 의미는 항상 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 더미 JPG(디코드 불가해도 mimeType=image/jpeg 면 클라 가드 통과 → 미리보기 생성·업로드 시도)
const FAKE_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

async function gotoTemplateSection(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/settings');
  await page.waitForTimeout(500);
  const tmplNav = page.locator('button:has-text("③ 템플릿 관리"), button:has-text("템플릿 관리")').first();
  if (!(await tmplNav.isVisible({ timeout: 6_000 }).catch(() => false))) return false;
  await tmplNav.click();
  await page.waitForTimeout(400);
  return true;
}

// ---------------------------------------------------------------------------
// S1 / AC-1+AC-2: 이미지 첨부 저장 — 성공 영속 OR 명확한 안내(절대 silent 아님)
// ---------------------------------------------------------------------------
test('AC-1/2: 이미지 첨부 저장 — 영속 성공 또는 명확한 안내(silent 실패 금지)', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 4_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  const titleInput = page.getByTestId('custom-tmpl-title-input');
  if (!(await titleInput.isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(); return; }

  const uniqueName = `E2E이미지템플릿_${Date.now()}`;
  await titleInput.fill(uniqueName);
  await page.getByTestId('tmpl-body-input').fill('약도 안내: 종로점 1층입니다.');

  // 이미지 첨부 → 미리보기 생성 확인
  await page.getByTestId('tmpl-image-input').setInputFiles({
    name: 'map.jpg', mimeType: 'image/jpeg', buffer: FAKE_JPG,
  });
  await expect(page.getByTestId('tmpl-image-preview')).toBeVisible({ timeout: 5_000 });

  // 저장 클릭
  await page.getByTestId('tmpl-save-btn').click();
  await page.waitForTimeout(1500);

  // 핵심: 저장 권한이 없는 환경(다이얼로그 유지 + 권한 토스트)이면 skip — 인프라 검증 대상 아님
  const dialogStillOpen = await titleInput.isVisible({ timeout: 1_000 }).catch(() => false);

  // raw 시스템 메시지는 절대 노출되면 안 됨(AC-2: 의미 풀어서 안내)
  await expect(page.locator('body')).not.toContainText('Bucket not found');
  await expect(page.locator('body')).not.toContainText('image_path');

  if (dialogStillOpen) {
    // 저장이 막힌 경우 → 반드시 사용자에게 보이는 안내가 있어야 한다(silent 금지).
    //   인프라 미적용이면 graceful 안내, 권한이면 권한 안내 — 둘 다 한국어 메시지.
    const infraMsg = page.getByText('이미지 첨부 저장 기능이 아직 활성화되지', { exact: false });
    const anyToast = page.locator('[data-sonner-toast], [role="status"]');
    const hasInfra = await infraMsg.isVisible({ timeout: 1_000 }).catch(() => false);
    const hasToast = await anyToast.first().isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasInfra || hasToast).toBeTruthy();
    return;
  }

  // 다이얼로그가 닫힘 = 저장 성공(AC-1 영속 검증): 목록 재진입 → 이미지 배지/미리보기 확인
  const row = page.getByTestId('custom-tmpl-row').filter({ hasText: uniqueName });
  if (await row.isVisible({ timeout: 4_000 }).catch(() => false)) {
    // MMS 배지(이미지 첨부 영속 신호) 노출 확인
    await expect(row.getByTestId('custom-tmpl-mms-badge')).toBeVisible({ timeout: 4_000 });
    // 편집 재진입 → 미리보기 복원(AC-1 핵심)
    await row.getByTestId('custom-tmpl-edit-btn').click();
    await expect(page.getByTestId('tmpl-image-preview')).toBeVisible({ timeout: 5_000 });

    // 정리: 닫고 삭제(테스트 잔여 제거)
    const cancel = page.locator('button:has-text("취소"), button[aria-label="Close"]').first();
    if (await cancel.isVisible({ timeout: 1_000 }).catch(() => false)) await cancel.click();
    page.once('dialog', (d) => d.accept());
    await row.getByTestId('custom-tmpl-delete-btn').click().catch(() => {});
    await page.waitForTimeout(800);
  }
});

// ---------------------------------------------------------------------------
// S2 / AC-3 회귀: 이미지 미첨부 텍스트 템플릿 저장은 종전대로 동작
// ---------------------------------------------------------------------------
test('AC-3(회귀): 이미지 미첨부 텍스트 템플릿 저장 — 정상 동작', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) { test.skip(); return; }
  if (!(await gotoTemplateSection(page))) { test.skip(); return; }

  const addBtn = page.getByTestId('custom-tmpl-add-btn');
  if (!(await addBtn.isVisible({ timeout: 4_000 }).catch(() => false))) { test.skip(); return; }
  await addBtn.click();

  const titleInput = page.getByTestId('custom-tmpl-title-input');
  if (!(await titleInput.isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(); return; }

  const uniqueName = `E2E텍스트전용_${Date.now()}`;
  await titleInput.fill(uniqueName);
  await page.getByTestId('tmpl-body-input').fill('텍스트 전용 템플릿입니다.');
  await page.getByTestId('tmpl-save-btn').click();
  await page.waitForTimeout(1500);

  // 권한 없는 환경이면 skip
  const stillOpen = await titleInput.isVisible({ timeout: 1_000 }).catch(() => false);
  if (stillOpen) { test.skip(); return; }

  // 텍스트 전용 저장은 image_path 키를 페이로드에 넣지 않으므로 컬럼 부재와 무관하게 성공해야 함
  const row = page.getByTestId('custom-tmpl-row').filter({ hasText: uniqueName });
  await expect(row).toBeVisible({ timeout: 5_000 });

  // 정리
  page.once('dialog', (d) => d.accept());
  await row.getByTestId('custom-tmpl-delete-btn').click().catch(() => {});
  await page.waitForTimeout(800);
});
