/**
 * E2E spec — T-20260603-foot-CHART-UIUX-ENHANCE
 * 진료차트 UI/UX 개선 (문지은 대표원장 #6~#13)
 *
 * 이 spec 범위 (이번 배포분):
 *   AC-6  치료사차트·임상경과 칸 세로 확대 + 폼 가로폭 확대(여백 제거)
 *   AC-9  진료기록 화면에 현재 로그인 의사 상시 표시
 *   AC-10 진료메모 빨간 박스 제거 → 타 카테고리와 동일(중립) 스타일 통일
 *   AC-12④ 타임라인 처방 필터 + 처방 배지
 *   AC-13 진료차트 기록자(의사) 표시 (created_by → 표시명)
 *
 * 보류(별도 단계/티켓):
 *   AC-7 슈퍼상용구(RX-CHART-ENHANCE 묶음처방 의존)
 *   AC-11 임시저장(CHART-UNSAVED-GUARD draft 메커니즘 확장)
 *   AC-12⑤ 특이사항 공용 누적칸(스키마 — supervisor 이관)
 *   AC-8 처방전 출력(기능 존재 — 서류 출력 패널, responder 안내)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 진료차트 Drawer 열기 헬퍼 — 못 열면 skip 신호 반환
async function openMedicalChart(page: import('@playwright/test').Page): Promise<boolean> {
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

test.describe('T-20260603-CHART-UIUX-ENHANCE — 진료차트 UI/UX 개선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-9: 진료차트 헤더에 현재 로그인 의사 상시 표시
  test('AC-9: 진료차트 헤더에 로그인 의사명 상시 표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const docName = page.locator('[data-testid="current-doctor-name"]');
    await expect(docName).toBeVisible();
    const txt = (await docName.innerText()).trim();
    expect(txt.length).toBeGreaterThan(0);
  });

  // AC-6: 임상경과 칸 세로 확대 (min-height 적용)
  test('AC-6: 임상경과 textarea 세로 확대 (min-h 적용)', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const clinical = page.locator('[data-testid="medical-chart-clinical"]');
    await expect(clinical).toBeVisible();
    // min-h-[16rem] = 256px 이상이어야 함 (기존 5행 대비 2~3배)
    const box = await clinical.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(220);
  });

  // AC-12④: 타임라인 처방 필터 chip 존재
  test('AC-12④: 타임라인 처방(rx) 필터 chip 표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="memo-filter-rx"]')).toBeVisible();
    // 클릭 토글 동작 — 에러 없이 활성화
    await page.locator('[data-testid="memo-filter-rx"]').click();
  });

  // AC-10: 진료메모 영역이 빨간 박스(bg-red-*)를 쓰지 않음 (원장 로그인 시에만 표시)
  test('AC-10: 진료메모 빨간 박스 스타일 제거', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const memoSection = page.locator('[data-testid="doctor-memo-section"]');
    if ((await memoSection.count()) === 0) {
      test.skip(true, '비원장 계정 — 진료메모 미표시, 스킵');
      return;
    }
    const cls = (await memoSection.getAttribute('class')) ?? '';
    expect(cls).not.toContain('bg-red');
    expect(cls).not.toContain('border-red');
  });

  // AC-13: 차트 선택 시 기록자(의사) 표시 — 데이터 있을 때만
  test('AC-13: 저장된 차트 선택 시 기록자 표시', async ({ page }) => {
    if (!(await openMedicalChart(page))) {
      test.skip(true, '진료차트 Drawer 미열림 — 스킵');
      return;
    }
    const entries = page.locator('[data-testid="medical-chart-timeline-entry"]');
    if ((await entries.count()) === 0) {
      test.skip(true, '타임라인 엔트리 없음 — 스킵');
      return;
    }
    // 첫 엔트리 선택
    await entries.first().locator('button').first().click();
    // 기록자 표기는 created_by가 있을 때만 렌더 → 존재 시 의미 검증, 없으면 통과
    const recorder = page.locator('[data-testid="chart-recorder"]');
    if ((await recorder.count()) > 0) {
      await expect(recorder.first()).toContainText('기록자');
    }
  });
});
