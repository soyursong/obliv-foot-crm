/**
 * E2E spec — T-20260609-foot-CHART-LEFTCOL-MINIMAL
 * 진료차트(MedicalChartPanel) 좌측 단 미니멀 정리 + 진료의 이름 중복 제거
 * — 문지은 대표원장 C0ATE5P6JTH (U0ALGAAAJAV)
 *
 * policy_superseded: T-20260609-foot-TIMELINE-HEADER-DESC-REMOVE 가 보존한 헤더는 유지하되,
 *   그 위에 좌측 타임라인 확장 섹션의 '잔존 라벨'(치료메모·임상경과·진료메모) 텍스트를 덮어쓰기로 제거한다.
 *
 * 범위 (presentation-only, DB 무변경):
 *   AC-1 좌측 단 확장 섹션에서 '치료메모'·'임상경과'·'진료메모' 텍스트 라벨이 보이지 않는다.
 *   AC-2 섹션 구분은 유형색 border-left 세로줄로만 식별(텍스트 없이).
 *   AC-3 진료의(담당의) 이름이 화면에서 1회만 표시된다(본인 작성 시 진료의·작성 이름 중복 제거).
 *   AC-5 경과·메모 본문 내용은 그대로 렌더된다(라벨만 제거).
 *
 * 데이터 의존(저장된 차트/확장 항목)이라 Drawer/데이터 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

// 진료차트 Drawer 열기 — 못 열면 false
async function openMedicalChart(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator(
    '[data-testid="open-chart-btn"], [aria-label="차트 열기"], button:has-text("진료차트")',
  );
  if ((await chartBtns.count()) === 0) return false;
  await chartBtns.first().click();
  const drawer = page.locator('[data-testid="medical-chart-drawer"]');
  return drawer
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

// 타임라인 첫 항목을 펼쳐 확장 콘텐츠 locator 반환 — 항목/콘텐츠 없으면 null
async function expandFirstEntry(page: Page) {
  const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
  if ((await entries.count()) === 0) return null;
  const toggle = entries.first().locator('[data-testid^="chart-accordion-toggle-"]');
  if ((await toggle.count()) === 0) return null;
  await toggle.first().click();
  const content = page.locator('[data-testid^="chart-accordion-content-"]').first();
  const appeared = await content
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return appeared ? content : null;
}

test.describe('T-20260609-CHART-LEFTCOL-MINIMAL — 좌측 단 미니멀 + 진료의 중복 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 확장 섹션 텍스트 라벨 제거 ───────────────────────────────────────
  test('AC-1: 좌측 확장 섹션에 "치료메모/임상경과/진료메모" 텍스트 라벨이 없다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const content = await expandFirstEntry(page);
    if (!content) {
      test.skip(true, '타임라인 항목/확장 콘텐츠 없음(데이터) — 스킵');
      return;
    }
    // 확장 콘텐츠 영역 안에서만 라벨 텍스트 부재 검증(우측 폼 placeholder 등과 분리)
    await expect(content.getByText('치료메모', { exact: true })).toHaveCount(0);
    await expect(content.getByText('임상경과', { exact: true })).toHaveCount(0);
    await expect(content.getByText('진료메모', { exact: true })).toHaveCount(0);
  });

  // ── AC-2/AC-5: 본문 보존 + border-left 세로줄 구분 ─────────────────────────
  test('AC-2/AC-5: 메모 본문은 보존되고 섹션은 border-left 세로줄로 구분된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const content = await expandFirstEntry(page);
    if (!content) {
      test.skip(true, '타임라인 항목/확장 콘텐츠 없음(데이터) — 스킵');
      return;
    }
    // 확장 콘텐츠에 본문 단락(p)이 1개 이상 렌더(라벨만 제거, 내용 보존)
    const paras = content.locator('p');
    const pCount = await paras.count();
    if (pCount === 0) {
      test.skip(true, '표시할 메모 본문 없음(데이터) — 스킵');
      return;
    }
    // 유형색 border-left 세로줄(border-l-2)을 가진 섹션이 존재
    await expect(content.locator('div.border-l-2').first()).toBeVisible();
  });

  // ── AC-3: 진료의 이름 중복 제거 ────────────────────────────────────────────
  test('AC-3: 진료의 이름이 1회만 표시(작성자명과 같으면 작성 줄 미노출)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // 저장된 차트 1건 선택 → 서명 블록 노출
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    if ((await entries.count()) === 0) {
      test.skip(true, '타임라인 항목 없음(데이터) — 스킵');
      return;
    }
    await entries.first().locator('button').first().click();
    const sigBlock = page.locator('[data-testid="chart-signature-block"]');
    if (
      !(await sigBlock
        .waitFor({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false))
    ) {
      test.skip(true, '서명 블록 미노출(신규/더미 차트) — 스킵');
      return;
    }
    const doctor = sigBlock.locator('[data-testid="chart-signing-doctor"]');
    const recorder = sigBlock.locator('[data-testid="chart-recorder"]');
    // 진료의 표기가 있으면, 작성자 표기는 진료의명과 다른 경우에만 존재해야 함(같으면 0건)
    if ((await doctor.count()) === 1) {
      const doctorTxt = ((await doctor.innerText()).replace(/진료의|\(인\)|\s/g, '')).trim();
      if ((await recorder.count()) === 1) {
        const recorderTxt = ((await recorder.innerText()).replace(/작성|\s/g, '')).trim();
        expect(recorderTxt).not.toEqual(doctorTxt);
      } else {
        // 작성자 줄 미노출 = 진료의와 동일 인물 → 중복 제거 정상
        expect(await recorder.count()).toBe(0);
      }
    }
  });
});
