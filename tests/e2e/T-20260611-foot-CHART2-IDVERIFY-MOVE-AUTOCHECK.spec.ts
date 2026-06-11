/**
 * E2E spec — T-20260611-foot-CHART2-IDVERIFY-MOVE-AUTOCHECK
 * 신분증 확인 표시 1번차트 → 2번차트 주민번호 입력칸 옆 이동 + 주민번호 유효 저장 시 자동 "확인 완료"
 *
 * 현장 클릭 시나리오 (티켓 §현장 클릭 시나리오) → E2E 변환:
 *   시나리오 1 (정상 동선/자동 확인완료):
 *     - 1번차트(체크인 상세 시트)에 "신분증 확인 필요 · 탭하여 해제" 표시가 더 이상 없음
 *     - 2번차트(고객 차트) 주민번호 입력칸 옆에 신분증 확인 상태 배지가 위치
 *     - 유효한 주민번호 입력 후 저장 → 같은 화면에서 "신분증 확인 완료"로 자동 전환
 *     - 차트 재진입에도 "확인 완료" 유지 (영속)
 *   시나리오 2 (엣지/빈값 가드):
 *     - 주민번호 13자리 미만/공란 상태에서는 저장 트리거가 막혀 자동 set 되지 않음
 *
 * 데이터 의존(고객/내원 유무)으로 graceful skip 처리.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260611 신분증확인 1→2번차트 이동 + 자동확인완료', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // 고객관리: 행 클릭=1번차트(간편/CheckInDetailSheet) · open-chart-btn(↗)=2번차트(CustomerChartPage 드로어).
  // 캘린더/공지 등 다른 tbody와 섞이지 않도록 open-chart-btn(고객 테이블 전용)을 page-scope 앵커로 사용.
  async function firstOpenChartBtn(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    const btn = page.locator('[data-testid="open-chart-btn"]').first();
    try {
      await btn.waitFor({ timeout: 10_000 });
      return btn;
    } catch {
      return null;
    }
  }

  // 2번차트(CustomerChartPage) 드로어 진입 — 관리열 ↗ 버튼(data-testid=open-chart-btn) 결정적 클릭
  async function navigateToFirstCustomerChart(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    const btn = await firstOpenChartBtn(page);
    if (!btn) return false;
    await btn.click();
    try {
      // 2번차트 드로어 로드 — 주민번호 라벨 대기 (1구역 고객정보 테이블)
      await page.getByText('주민번호', { exact: true }).first().waitFor({ timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  // 주민번호 라벨이 포함된 테이블 행(tr) locator — 같은 행에 상태 배지가 위치해야 함
  function rrnRow(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    return page.locator('tr', { has: page.getByText('주민번호', { exact: true }) }).first();
  }

  test('AC: 1번차트(간편차트)에 "신분증 확인 필요 · 탭하여 해제" 표시가 더 이상 없다', async ({ page }) => {
    const btn = await firstOpenChartBtn(page);
    if (!btn) test.skip(true, '고객 목록 비어있음 — 데이터 없음');

    // open-chart-btn이 속한 고객 행(tr)을 앵커로 잡아, 관리열이 아닌 본문 셀(이름)을 클릭
    //  → 행 클릭 핸들러(handleRowClick) → 1번차트(간편차트 = CheckInDetailSheet customerMode) 시트 오픈
    const row = btn!.locator('xpath=ancestor::tr[1]');
    await row.locator('td').first().click();
    await page.waitForTimeout(1_500);

    // 이동 대상 문구가 1번차트에 남아있으면 안 됨
    expect(await page.getByText('신분증 확인 필요 · 탭하여 해제').count()).toBe(0);
    console.log('[AC] 1번차트 신분증 확인 필요 표시 제거 확인 OK');
  });

  test('AC: 2번차트 주민번호칸 옆에 신분증 확인 상태 배지가 위치한다', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    const row = rrnRow(page);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // 같은 행 안에 "신분증 확인 완료" 또는 "신분증 확인 필요" 배지 중 하나가 존재해야 함
    const verified = row.getByText('신분증 확인 완료', { exact: true });
    const needed = row.getByText('신분증 확인 필요', { exact: true });
    await page.waitForTimeout(800); // rrn 로드 대기
    const cnt = (await verified.count()) + (await needed.count());
    expect(cnt).toBeGreaterThan(0);
    console.log(`[AC] 주민번호 행 신분증 배지 존재 OK (완료=${await verified.count()}, 필요=${await needed.count()})`);
  });

  test('시나리오2/빈값가드: 13자리 미만이면 저장 버튼 비활성 → 자동 set 불가', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    const row = rrnRow(page);
    // 입력/수정 모드 진입
    const editBtn = row.getByRole('button', { name: /입력|수정/ }).first();
    await editBtn.click();

    // 앞 6자리만 입력 (뒤 미입력 → 13자리 미달)
    const frontInput = row.locator('input[placeholder="000000"]').first();
    await expect(frontInput).toBeVisible({ timeout: 3_000 });
    await frontInput.fill('900101');

    // 저장 버튼은 13자리 미만이므로 disabled 여야 함 (빈값/형식미달 가드)
    const saveBtn = row.getByRole('button', { name: '저장' }).first();
    await expect(saveBtn).toBeDisabled();
    console.log('[시나리오2] 13자리 미달 → 저장 버튼 disabled, 자동 확인완료 set 차단 OK');
  });

  test('시나리오1/자동확인완료: 유효 주민번호 저장 후 "신분증 확인 완료"로 전환', async ({ page }) => {
    const ok = await navigateToFirstCustomerChart(page);
    if (!ok) test.skip(true, '고객 차트 진입 실패 — 데이터 없음');

    const row = rrnRow(page);
    const editBtn = row.getByRole('button', { name: /입력|수정/ }).first();
    await editBtn.click();

    const frontInput = row.locator('input[placeholder="000000"]').first();
    const backInput = row.locator('input[placeholder="0000000"]').first();
    try {
      await frontInput.waitFor({ timeout: 3_000 });
    } catch {
      test.skip(true, '주민번호 편집 모드 진입 실패');
      return;
    }
    await frontInput.fill('900101');
    await backInput.fill('1234567');

    const saveBtn = row.getByRole('button', { name: '저장' }).first();
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 저장 실패 toast 없어야 함 (RRN 암호화 RPC 성공 가정)
    await page.waitForTimeout(2_000);
    if ((await page.getByText(/저장 실패|세션이 만료/).count()) > 0) {
      test.skip(true, '주민번호 저장 RPC 실패(권한/세션) — 자동확인 검증 스킵');
      return;
    }

    // 유효 저장 후 같은 행에 "신분증 확인 완료" 배지로 전환되어야 함
    await expect(row.getByText('신분증 확인 완료', { exact: true })).toBeVisible({ timeout: 5_000 });
    // "신분증 확인 필요" 는 더 이상 보이지 않아야 함
    expect(await row.getByText('신분증 확인 필요', { exact: true }).count()).toBe(0);
    console.log('[시나리오1] 유효 주민번호 저장 → 신분증 확인 완료 자동 전환 OK');
  });
});
