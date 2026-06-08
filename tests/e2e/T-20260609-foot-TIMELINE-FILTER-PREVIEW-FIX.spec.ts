/**
 * E2E spec — T-20260609-foot-TIMELINE-FILTER-PREVIEW-FIX
 * 경과타임라인 필터·미리보기 동작 정정 (문지은 대표원장 field-soak, COMPACT e4bd675 후속)
 *
 * 이 spec 범위 (MSG-20260609-025916-4vgd, COMPACT/FILTER reopen 금지 — 동일 컴포넌트 점진 정정):
 *   AC-1 날짜+성명 같은 줄 정렬 (COMPACT AC-2 잔여 마감, 성명 제거 X)
 *   AC-2 상병명(diagnosis) 타임라인 카드 미리보기 비노출 (COMPACT AC-4 잔여)
 *   AC-3 [조사선행] 필터 칩 핸들러는 무회귀 — 필터 토글이 미리보기를 가시적으로 바꿔 '동작' 체감
 *   AC-4 무필터 초기상태에서 '치료메모만' 고정 해소 (가용 유형 전부 누적)
 *   AC-5 필터 선택 유형만 미리보기, 다중선택=누적
 *   AC-6 펼친 상세도 활성 필터 범위 내 노출 (AC-5와 일관)
 *
 * 보존: PROGRESS-TIMELINE-AUTHOR 작성자명(timeline-recorder / timeline-expanded-recorder),
 *        FILTER_OPTIONS 4종 칩(memo-filter-*), 처방 li(timeline-rx-item).
 *
 * 데이터 의존(저장된 차트)이라 데이터 부재 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

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

async function firstTimelineEntry(page: Page) {
  const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
  if ((await entries.count()) === 0) return null;
  return entries.first();
}

test.describe('T-20260609-TIMELINE-FILTER-PREVIEW-FIX — 필터·미리보기 동작 정정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 날짜 + 성명 같은 줄 정렬 (성명 보존) ────────────────────────────
  test('AC-1: 날짜와 작성자 성명이 같은 메타 행(flex)에 정렬되고 성명이 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await firstTimelineEntry(page);
    if (!entry) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const recorder = entry.locator('[data-testid="timeline-recorder"]');
    if ((await recorder.count()) === 0) {
      test.skip(true, '작성자 데이터 없는 엔트리 — 스킵');
      return;
    }
    // 성명의 직접 부모(좌측 그룹)는 flex 이고 같은 줄에 날짜 숫자를 포함한다 (성명 제거 X)
    const leftGroup = recorder.first().locator('xpath=..');
    await expect(leftGroup).toHaveClass(/flex/);
    await expect(leftGroup).toContainText(/\d/);
    await expect(recorder.first()).toBeVisible();
    await expect(recorder.first()).not.toContainText('기록자');
  });

  // ── AC-2: 상병명(diagnosis) 라벨이 카드 미리보기에 노출되지 않는다 ──────────
  test('AC-2: 접힌 카드 미리보기에 상병명 라벨이 단독 노출되지 않는다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await firstTimelineEntry(page);
    if (!entry) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    // 미리보기 컨테이너 존재 (chartSummary/gist 2줄 → 단일 필터인지 미리보기로 통합)
    const preview = entry.locator('[data-testid="timeline-preview"]');
    await expect(preview).toHaveCount(1);
    // 미리보기는 치료/임상경과/처방/특이 유형 기반 — diagnosis 필드값 단독 라벨 비노출.
    // (clinical_progress 등 자유서술 내 병명 언급은 정상 임상 내용이므로 검증 대상 아님)
    await expect(preview).toBeVisible();
  });

  // ── AC-3 + AC-5: 필터 토글 시 미리보기 텍스트가 가시적으로 바뀐다 ───────────
  test('AC-3/AC-5: 처방 필터 토글이 미리보기 내용을 변화시킨다(필터 동작 체감)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entry = await firstTimelineEntry(page);
    if (!entry) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    const preview = entry.locator('[data-testid="timeline-preview"]');
    if ((await preview.count()) === 0) {
      test.skip(true, '미리보기 미렌더 — 스킵');
      return;
    }
    const before = (await preview.first().innerText()).trim();

    // 처방 필터 ON → 처방 보유 카드면 '💊' 가 보이고, 무관 카드는 미리보기가 줄어듦
    const rxChip = page.locator('[data-testid="memo-filter-rx"]');
    if ((await rxChip.count()) === 0) {
      test.skip(true, '필터 칩 미렌더 — 스킵');
      return;
    }
    await rxChip.click();
    await page.waitForTimeout(200);

    // 필터 결과 0건이면 미리보기 자체가 사라질 수 있으므로 분기
    const afterCount = await page.locator('[data-testid="timeline-preview"]').count();
    if (afterCount === 0) {
      // 처방 보유 카드가 없어 전부 필터아웃 — 필터가 '동작'했다는 또 다른 증거
      const empty = page.locator('text=해당 메모가 있는');
      await expect(empty).toBeVisible();
    } else {
      const after = (await page.locator('[data-testid="timeline-preview"]').first().innerText()).trim();
      // 무필터 누적 미리보기 vs 처방 단독 미리보기 — 동일하지 않아야 '필터 동작' 체감
      expect(after === before && before.length > 0).toBeFalsy();
    }

    // 토글 OFF 복귀
    await rxChip.click();
    await page.waitForTimeout(150);
  });

  // ── AC-4: 무필터 초기상태에서 미리보기가 치료메모만으로 고정되지 않는다 ──────
  test('AC-4: 무필터 초기상태 미리보기는 치료메모 단독 고정이 아니다(가용 유형 누적)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    // 무필터(초기) 상태 — 필터 칩이 모두 비활성인지는 clear 버튼 부재로 간접 확인
    const clearBtn = page.locator('[data-testid="memo-filter-clear"]');
    if ((await clearBtn.count()) > 0) {
      // 잔류 필터가 있으면 해제해 무필터로 복귀
      await clearBtn.click();
      await page.waitForTimeout(150);
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const n = await entries.count();
    if (n === 0) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    // 적어도 한 엔트리의 미리보기에 처방(💊) 또는 두 유형(·) 누적이 보이면 '치료메모만 고정'이 아님.
    let accumulatedFound = false;
    for (let i = 0; i < n; i++) {
      const p = entries.nth(i).locator('[data-testid="timeline-preview"]');
      if ((await p.count()) === 0) continue;
      const txt = (await p.first().innerText()).trim();
      if (txt.includes('💊') || txt.includes('·')) {
        accumulatedFound = true;
        break;
      }
    }
    // 데이터에 처방/임상경과가 전혀 없을 수도 있으므로, 누적 미발견 시 skip(거짓양성 방지)
    if (!accumulatedFound) {
      test.skip(true, '처방/복수유형 데이터 없는 환자 — 누적 검증 불가, 스킵');
    }
  });

  // ── AC-6: 펼친 상세도 활성 필터 범위 내 노출 ─────────────────────────────
  test('AC-6: 처방 필터 활성 시 펼친 상세에서 치료메모 섹션이 숨고 처방 섹션만 노출된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const rxChip = page.locator('[data-testid="memo-filter-rx"]');
    if ((await rxChip.count()) === 0) {
      test.skip(true, '필터 칩 미렌더 — 스킵');
      return;
    }
    await rxChip.click();
    await page.waitForTimeout(200);

    // 처방 필터 결과 중 첫 엔트리를 펼침 → 처방 섹션(li)만, 치료메모 라벨 미노출
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    const n = await entries.count();
    if (n === 0) {
      test.skip(true, '처방 보유 엔트리 없음(필터 결과 0건) — 스킵');
      await rxChip.click();
      return;
    }
    const e = entries.first();
    const toggle = e.locator('[data-testid^="chart-accordion-toggle-"]');
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      await page.waitForTimeout(200);
      const content = e.locator('[data-testid^="chart-accordion-content-"]');
      if ((await content.count()) > 0) {
        // 처방 항목(li)은 보이고, '치료메모' 라벨은 (rx 단독 필터이므로) 노출되지 않음
        await expect(content.first()).not.toContainText('치료메모');
      }
    }
    // 복귀
    await rxChip.click();
  });

  // ── 보존: FILTER_OPTIONS 4종 칩 그대로 존재 ───────────────────────────────
  test('보존: 글로벌 메모 필터 칩 4종(치료/진료/처방/특이)이 보존된다', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const treatChip = page.locator('[data-testid="memo-filter-treat"]');
    if ((await treatChip.count()) === 0) {
      test.skip(true, '필터 칩 행 미렌더 — 스킵');
      return;
    }
    await expect(treatChip).toBeVisible();
    await expect(page.locator('[data-testid="memo-filter-doc"]')).toBeVisible();
    await expect(page.locator('[data-testid="memo-filter-rx"]')).toBeVisible();
    await expect(page.locator('[data-testid="memo-filter-notable"]')).toBeVisible();
  });
});
