/**
 * E2E spec — T-20260623-foot-DOCDASH-PATIENTNAME-CHART-DRAWER
 * 진료대시보드 '진료 환자 목록' 탭에서 환자 이름 클릭 → 진료차트(variant='full') 서랍 진입
 * (문지은 대표원장 C0ATE5P6JTH)
 *
 * RC: /admin/doctor-tools 의 '진료 알림판'(DoctorCallDashboard) 이름은 旣 서랍 동작이나,
 *     '진료 환자 목록'(DoctorPatientList) 오늘 모드 이름은 <span>(클릭 불가)이었다.
 *     openTreatmentChart→MedicalChartPanel(full) 서랍 배선은 旣 존재(isPast 행 전체·부모 단일 렌더).
 *     → today 모드 이름 <span> 을 onOpenChart 버튼으로 전환(신규 drawer 스택/조회경로 신설 0).
 *
 * 시나리오 1 (정상): 이름 클릭 → 페이지 이동 없이 진료차트 서랍(full) 오픈, 닫으면 목록 유지.
 * 시나리오 2 (귀가 readonly 보존): 이름 클릭 서랍은 旣 openTreatmentChart 동일 경로 재사용 →
 *     readonly 게이트 무접촉(MedicalChartPanel 내부 status 파생). 소스 정합으로 검증.
 * 시나리오 3 (임상경과 인라인 무회귀): 펼치기 토글 → expand-clinical-course 인라인(embed clinical),
 *     포털 서랍(medical-chart-drawer) 미오픈. 이름 클릭과 별개 동선 유지.
 *
 * 데이터 의존(당일 진료콜 명단 행) → 행 없으면 runtime graceful skip. 구조 보증은 소스 정합 테스트로 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const LIST_SRC = readFileSync(
  resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx'),
  'utf8',
);

// 진료대시보드 → '진료 환자 목록' 탭 진입 + 오늘 모드 첫 환자 이름 버튼 반환(없으면 null).
async function openPatientListFirstName(page: Page): Promise<{ nameBtn: Locator } | null> {
  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');
  const tab = page.locator('[data-testid="tab-patient-list"]');
  if (!(await tab.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))) return null;
  await tab.click();
  const list = page.locator('[data-testid="patient-list"]');
  if (!(await list.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false))) return null;
  // 오늘 모드 환자 이름(span→button). disabled(=customer_id 없음)면 차트 미연결 → 활성만.
  const nameBtn = page.locator('[data-testid="patient-row"] button[data-testid="patient-name"]').first();
  if ((await nameBtn.count()) === 0) return null;
  if (await nameBtn.isDisabled()) return null;
  return { nameBtn };
}

test.describe('T-20260623-DOCDASH-PATIENTNAME-CHART-DRAWER — 진료 환자 목록 이름 클릭 → 진료차트 서랍', () => {
  // ── 소스 정합(데이터 무관 구조 보증) ─────────────────────────────────────────────
  test('소스: 오늘 모드 이름은 onOpenChart 버튼 + patient-name/text-left 보존', () => {
    // today 모드 분기(isPast=false return)에서 이름이 <button onClick={onOpenChart}> 이어야 한다.
    // patient-name testid 보존(기존 스펙 호환), text-left 유지(VISITTYPE-UNIFY 정규식).
    expect(LIST_SRC).toMatch(
      /<button[\s\S]*?onClick=\{onOpenChart\}[\s\S]*?data-testid="patient-name"[\s\S]*?>/,
    );
    expect(LIST_SRC).toMatch(/text-left[\s\S]*?data-testid="patient-name"/);
    // 신규 drawer 스택 신설 금지: MedicalChartPanel 렌더는 부모 단일(openTreatmentChart 재사용) 유지.
    expect(LIST_SRC).toContain('const openTreatmentChart');
    expect((LIST_SRC.match(/<MedicalChartPanel/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test('소스(시나리오2): 이름 서랍은 openTreatmentChart(full) 재사용 — readonly 게이트 무접촉', () => {
    // onOpenChart 바인딩이 openTreatmentChart(customerId, "full") 동일 경로(귀가 readonly = MedicalChartPanel 내부 파생).
    expect(LIST_SRC).toMatch(/onOpenChart=\{row\.customer_id \?[\s\S]*?openTreatmentChart\(row\.customer_id as string, 'full'\)/);
    // 이름 버튼 경로에 별도 readOnly=false 강제(게이트 우회)가 없어야 한다.
    expect(LIST_SRC).not.toMatch(/data-testid="patient-name"[\s\S]{0,200}readOnly=\{false\}/);
  });

  test('소스(시나리오3): 임상경과는 인라인(expand-clinical-course, embed clinical) 유지 — 서랍 아님', () => {
    expect(LIST_SRC).toContain('data-testid="expand-clinical-course"');
    // 인라인 임상경과 블록은 embed + variant="clinical" (포털 drawer 아님).
    const idx = LIST_SRC.indexOf('data-testid="expand-clinical-course"');
    const inlineBlock = LIST_SRC.slice(idx, idx + 1500);
    expect(inlineBlock).toContain('variant="clinical"');
    expect(inlineBlock).toContain('embed');
  });

  // ── 런타임(데이터 의존 → graceful skip) ──────────────────────────────────────────
  test.describe('런타임', () => {
    test.beforeEach(async ({ page }) => {
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) test.skip(true, '로그인 실패');
    });

    test('시나리오1: 이름 클릭 시 진료차트 서랍(full)이 열리고 페이지 이동 없음', async ({ page }) => {
      const r = await openPatientListFirstName(page);
      if (!r) {
        test.skip(true, '진료 환자 목록에 차트 연결된 행 없음 — 스킵');
        return;
      }
      const tag = await r.nameBtn.evaluate((el) => el.tagName.toLowerCase());
      expect(tag).toBe('button');
      const urlBefore = page.url();
      await r.nameBtn.click();

      const drawer = page.locator('[data-testid="medical-chart-drawer"]');
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      await expect(drawer).toHaveAttribute('data-variant', 'full');
      // 페이지 이동(네비게이션) 없이 오버레이
      expect(page.url()).toBe(urlBefore);
      await expect(page.locator('[data-testid="patient-list"]')).toBeVisible();
    });

    test('시나리오1(닫기): 서랍 닫기 후 목록 유지 + 재오픈', async ({ page }) => {
      const r = await openPatientListFirstName(page);
      if (!r) {
        test.skip(true, '진료 환자 목록에 차트 연결된 행 없음 — 스킵');
        return;
      }
      await r.nameBtn.click();
      const drawer = page.locator('[data-testid="medical-chart-drawer"]');
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(page.locator('[data-testid="patient-list"]')).toBeVisible();
      // 재오픈 — 같은 서랍
      await r.nameBtn.click();
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      await expect(drawer).toHaveAttribute('data-variant', 'full');
    });

    test('시나리오3: 펼치기 토글 = 인라인 임상경과(서랍 미오픈) — 인라인 차팅 회귀 없음', async ({ page }) => {
      await page.goto('/admin/doctor-tools');
      await page.waitForLoadState('networkidle');
      const tab = page.locator('[data-testid="tab-patient-list"]');
      if ((await tab.count()) === 0) {
        test.skip(true, '탭 없음 — 스킵');
        return;
      }
      await tab.click();
      const firstRow = page.locator('[data-testid="patient-row"]').first();
      if ((await firstRow.count()) === 0) {
        test.skip(true, '환자 행 없음 — 스킵');
        return;
      }
      // 행 우측 펼치기 토글(chevron) — 이름 버튼과 별개 트리거.
      const chevron = firstRow.locator('button:has(svg)').last();
      await chevron.click();
      // 인라인 임상경과 아코디언 노출
      const inline = firstRow.locator('[data-testid="expand-clinical-course"]');
      await expect(inline).toBeVisible({ timeout: 10_000 });
      // 임상경과는 포털 서랍(medical-chart-drawer)으로 열리지 않아야 함(인라인 보존).
      await expect(page.locator('[data-testid="medical-chart-drawer"]')).toHaveCount(0);
    });
  });
});
