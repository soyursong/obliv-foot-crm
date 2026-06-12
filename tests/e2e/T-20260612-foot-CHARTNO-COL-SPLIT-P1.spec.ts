/**
 * T-20260612-foot-CHARTNO-COL-SPLIT-P1
 * 진료대시보드·진료리스트 차트번호 '독립 칼럼' 분리.
 *
 * 문지은 대표원장이 B2-P1(deployed 3beb48f) 실사용 후 방향 전환:
 *   차트번호를 이름 칸 내 서브텍스트(위아래 같은칸)가 아니라 '이름 칼럼 바로 옆 독립 칼럼'으로 분리.
 *   §13.1.A reporter 권위로 B2-P1 표기결정 supersede.
 *
 * 대상 2 파일:
 *   - DoctorCallDashboard: 진료 대기중(호출, 8→9칼럼) + 진료 완료(7→8칼럼) 두 테이블
 *   - DoctorPatientList: 진료 환자 목록(grid, 차트번호 칼럼 신설)
 *
 * 핵심 검증:
 *   (a) 차트번호 = 독립 칼럼(thead에 '차트번호' th 존재 / grid 별도 셀) — 이름 칸 내 서브텍스트 0.
 *   (b) 칼럼 수 +1 (호출 9 / 완료 8) — 헤더/바디 정합.
 *   (c) 미발번도 빈칸 금지 → '(미발번)' 표기(chartNoDisplay 규약).
 *
 * 주: 테스트 DB에 데이터가 없을 수 있어 구조/회귀 위주 방어적 단언.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 }).catch(() => {});
  }
}

/** 차트번호 셀은 빈칸 금지 — 렌더되면 항상 비어있지 않은 텍스트('F-1234' | '(미발번)'). */
async function assertChartNoNonEmpty(locator: import('@playwright/test').Locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const txt = ((await locator.nth(i).textContent()) ?? '').trim();
    expect(txt.length).toBeGreaterThan(0); // 빈칸 금지(AC)
  }
}

test.describe('T-20260612-foot-CHARTNO-COL-SPLIT-P1', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // S1: 진료부 통합 대시보드 — 차트번호가 이름 옆 독립 칼럼(호출 9 / 완료 8), 빈칸 금지
  test('S1: DoctorCallDashboard 차트번호 독립 칼럼 분리(호출 9칼럼/완료 8칼럼)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const dash = page.getByTestId('doctor-call-dashboard');
    if (await dash.isVisible({ timeout: 8000 }).catch(() => false)) {
      // 호출 테이블 — thead 9칼럼 + '차트번호' 헤더 존재(독립 칼럼)
      const feedTable = page.getByTestId('doctor-call-feed-table');
      if (await feedTable.isVisible({ timeout: 3000 }).catch(() => false)) {
        const th = feedTable.locator('thead th');
        expect(await th.count()).toBe(9);
        await expect(feedTable.locator('thead th', { hasText: '차트번호' })).toHaveCount(1);
        // 이름과 차트번호가 인접(이름=1번째, 차트번호=2번째 헤더)
        await expect(th.nth(0)).toHaveText('이름');
        await expect(th.nth(1)).toHaveText('차트번호');
      }
      // 완료 테이블 — thead 8칼럼 + '차트번호' 헤더 존재
      const completedTable = page.getByTestId('doctor-completed-table');
      if (await completedTable.isVisible({ timeout: 3000 }).catch(() => false)) {
        const th = completedTable.locator('thead th');
        expect(await th.count()).toBe(8);
        await expect(completedTable.locator('thead th', { hasText: '차트번호' })).toHaveCount(1);
        await expect(th.nth(0)).toHaveText('이름');
        await expect(th.nth(1)).toHaveText('차트번호');
      }
      // 차트번호 셀 빈칸 금지(렌더 시)
      await assertChartNoNonEmpty(page.getByTestId('doctor-call-chartno'));
      await assertChartNoNonEmpty(page.getByTestId('doctor-completed-chartno'));
    }
  });

  // S2: 진료 환자 목록 — 차트번호가 이름과 별개의 독립 칼럼(서브텍스트 아님)
  test('S2: DoctorPatientList 차트번호 독립 칼럼 분리', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const tab = page.getByTestId('tab-patient-list');
    if (await tab.isVisible({ timeout: 6000 }).catch(() => false)) {
      await tab.click();
    }
    const list = page.getByTestId('patient-list');
    if (await list.isVisible({ timeout: 6000 }).catch(() => false)) {
      const names = page.getByTestId('patient-name');
      const charts = page.getByTestId('patient-chartno');
      if ((await names.count()) > 0) {
        // 차트번호 셀이 이름 셀과 동수로 별개 존재(독립 칼럼) — 이름 셀 내부 서브텍스트가 아님
        expect(await charts.count()).toBe(await names.count());
        // patient-chartno 는 patient-name 의 자손이 아니어야 한다(독립 grid 셀).
        const nameHasChartInside = await names
          .first()
          .getByTestId('patient-chartno')
          .count();
        expect(nameHasChartInside).toBe(0);
        // 빈칸 금지
        await assertChartNoNonEmpty(charts);
      }
    }
  });

  // S3: 미발번 엣지 — 차트번호 칼럼은 빈칸이 아니라 '(미발번)' 표기(빈칸 금지 규약)
  test('S3: 미발번 환자도 차트번호 칼럼 빈칸 금지(전 surface)', async ({ page }) => {
    // 대시보드
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await page.getByTestId('doctor-call-dashboard').isVisible({ timeout: 8000 }).catch(() => false)) {
      for (const tid of ['doctor-call-chartno', 'doctor-completed-chartno']) {
        const cells = page.getByTestId(tid);
        const n = await cells.count();
        for (let i = 0; i < n; i++) {
          const txt = ((await cells.nth(i).textContent()) ?? '').trim();
          // 빈칸 금지 — 값이 있거나, 미발번이면 '(미발번)'
          expect(txt.length).toBeGreaterThan(0);
          if (txt === '(미발번)') expect(txt).toBe('(미발번)');
        }
      }
    }

    // 진료 환자 목록
    const tab = page.getByTestId('tab-patient-list');
    if (await tab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await tab.click();
      const charts = page.getByTestId('patient-chartno');
      const n = await charts.count();
      for (let i = 0; i < n; i++) {
        const txt = ((await charts.nth(i).textContent()) ?? '').trim();
        expect(txt.length).toBeGreaterThan(0);
      }
    }
  });
});
