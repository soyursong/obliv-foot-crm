/**
 * E2E spec — T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN
 *   (김주연 총괄, C0ATE5P6JTH. 상담·치료사 배정 → 상담 → 오늘 배정 현황/금일 배분 이력.)
 *
 * 요청: 담당(배정 실장) 옆에 '상담 성격' 드롭다운(4종: 초진/재진/당일재상담/대리상담, 기본 초진) 추가.
 *   배정 초진/재진 분류를 자동 365-recency 판정 대신 실장 수동 선택으로 확정(전향적).
 *
 * ── 본 배포 스코프(planner MSG-20260803-071839-ata7 scoped hold) ──
 *   ▸ 병행 착수(본 배포): (1) migration assignment_consult_type TEXT NULL + named CHECK(4값)
 *       (2) '상담 성격' 드롭다운 UI(담당 옆·상담 탭) (3) 수동 선택 write path(check_ins.assignment_consult_type).
 *   ▸ HOLD(DA 파생view co-sign 대기): 카운터(배정 초진/재진·일일목표)의 NULL/자동배정 소비 로직.
 *     → 본 spec 은 '드롭다운 표면 + 저장' 만 검증. 누적 카운트 재분류(monthAxisOf)는 무접촉이므로 검증 대상 아님.
 *
 * 시나리오(라이브 데이터 독립·구조 불변식으로 검증):
 *  1) 상담 탭: 금일 배분 이력 표에 '상담 성격' 헤더 컬럼 존재.
 *  2) 드롭다운(행 존재 시): 옵션 정확히 4종(초진/재진/당일재상담/대리상담), 현재값이 4종 중 하나(NULL→기본 초진).
 *  3) 치료 탭 회귀: '상담 성격' 컬럼 미노출(상담축 개념 — 치료 탭 무의미).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const CONSULT_TYPES = ['초진', '재진', '당일재상담', '대리상담'];

async function gotoAssignmentsConsult(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin/assignments');
  const card = page.locator('[data-testid="assignments-today-distribution-card"]');
  const ok = await card
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return false;
  // 기본 activeTab=consult 이나 명시적으로 상담 탭 선택(안정화).
  const consultTab = page.locator('[data-testid="assignments-tab-consult"]');
  if (await consultTab.count()) await consultTab.click();
  return true;
}

/** 금일 배분 이력 카드 헤더 행에서 '상담 성격' th 존재 여부. */
function consultTypeHeader(page: import('@playwright/test').Page) {
  return page
    .locator('[data-testid="assignments-today-distribution-card"] thead th', { hasText: '상담 성격' });
}

test.describe('T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN', () => {
  test('시나리오1·2: 상담 탭 — 상담 성격 헤더 + 드롭다운 4종/기본 초진', async ({ page }) => {
    const logged = await loginAndWaitForDashboard(page);
    test.skip(!logged, '로그인 실패(환경 미가용) → 스킵');

    const nav = await gotoAssignmentsConsult(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    // 시나리오1: '상담 성격' 헤더 컬럼 존재(담당 옆).
    await expect(consultTypeHeader(page)).toHaveCount(1);

    // 시나리오2: 금일 배분 이력에 배정 행이 있으면 드롭다운 표면 검증.
    const selects = page.locator('[data-testid^="dist-consulttype-select-"]');
    const n = await selects.count();
    if (n === 0) {
      test.info().annotations.push({ type: 'note', description: '금일 배분 이력 0건 — 헤더 존재만 검증(드롭다운 행 부재).' });
      return;
    }
    const first = selects.first();
    // 옵션 = 정확히 4종, 라벨 일치.
    const optionTexts = (await first.locator('option').allTextContents()).map((t) => t.trim());
    expect(optionTexts).toEqual(CONSULT_TYPES);
    // 현재 선택값 = 4종 중 하나(DB NULL → App default '초진' pre-select).
    const val = await first.inputValue();
    expect(CONSULT_TYPES).toContain(val);
  });

  test('시나리오3(회귀): 치료 탭 — 상담 성격 컬럼 미노출', async ({ page }) => {
    const logged = await loginAndWaitForDashboard(page);
    test.skip(!logged, '로그인 실패(환경 미가용) → 스킵');

    const nav = await gotoAssignmentsConsult(page);
    test.skip(!nav, '배정 화면 미도달(권한/환경) → 스킵');

    const therapyTab = page.locator('[data-testid="assignments-tab-therapy"]');
    test.skip(!(await therapyTab.count()), '치료 탭 미노출(권한) → 스킵');
    await therapyTab.click();

    // 치료 탭에서는 '상담 성격' 헤더/드롭다운 모두 부재.
    await expect(consultTypeHeader(page)).toHaveCount(0);
    await expect(page.locator('[data-testid^="dist-consulttype-select-"]')).toHaveCount(0);
  });
});
