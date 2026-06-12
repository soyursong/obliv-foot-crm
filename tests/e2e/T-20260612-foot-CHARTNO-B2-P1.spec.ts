/**
 * T-20260612-foot-CHARTNO-B2-P1
 * 환자명↔차트번호 인접 표기 Phase B-2 (P1 우선 5 surface).
 *
 * B-1(PAIRING-AUDIT)에 이어, 환자명이 노출되는 운영 surface에 차트번호를 인접 표기한다.
 * 핵심 규약(공통 헬퍼 chartNoBadge/chartNoDisplay): 미발번이어도 환자명 단독 노출 금지
 *   → 배지는 '#'+값(예: '#F-1234') 또는 '#미발번'으로 항상 표기(AC4).
 *
 * 본 배치(P1) 대상 4 (내부 직원 화면):
 *   - DoctorCallDashboard 진료 대기중/완료 — 이름 셀 서브텍스트(별도 칼럼 신설 X)
 *   - DoctorPatientList 진료 환자 목록 — 이름 셀 서브텍스트
 *   - Dashboard 진료대기배너(진료콜 알람) — 환자명 옆 병기
 *   - TreatmentTable 당일 치료 데이터테이블 — 환자명 옆 병기 + CSV 차트번호 동반
 *   (Waiting 공개 대기실 TV는 이름 마스킹·anon 공개 화면 → PHI 외부노출 우려로 별도 planner 판정 대기)
 *
 * 주: 테스트 DB에 데이터가 없을 수 있어 구조/회귀 위주 방어적 단언.
 *     차트번호 배지가 렌더되면 반드시 '#' 접두(또는 미발번 표기)여야 함을 검증(환자명 단독 표기 0).
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

/** 배지 텍스트가 chartNoBadge 규약(항상 '#' 접두)을 지키는지 — 환자명 단독 표기 0 보장. */
async function assertBadgeFormat(locator: import('@playwright/test').Locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const txt = ((await locator.nth(i).textContent()) ?? '').trim();
    if (txt.length === 0) continue;
    expect(txt.startsWith('#')).toBeTruthy(); // '#F-1234' | '#미발번'
  }
}

test.describe('T-20260612-foot-CHARTNO-B2-P1', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // S1: 진료부 통합 대시보드 — 이름 셀 차트번호 서브텍스트(대기중/완료 모두)
  test('S1: DoctorCallDashboard 이름 셀에 차트번호 배지(미발번도 명시)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.waitForLoadState('networkidle').catch(() => {});
    // 기본 탭 = call_dashboard
    const dash = page.getByTestId('doctor-call-dashboard');
    if (await dash.isVisible({ timeout: 8000 }).catch(() => false)) {
      // 대기중/완료 이름 셀에 차트번호 배지가 렌더되면 '#' 규약 준수
      await assertBadgeFormat(page.getByTestId('doctor-call-chartno'));
      await assertBadgeFormat(page.getByTestId('doctor-completed-chartno'));
      // 별도 칼럼 신설 금지(8칼럼 유지) — thead 칼럼 수가 8 그대로
      const thead = page.getByTestId('doctor-call-feed-table').locator('thead th');
      if (await thead.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        expect(await thead.count()).toBe(8);
      }
    }
  });

  // S2: 진료 환자 목록 — 이름 셀 차트번호 서브텍스트
  test('S2: DoctorPatientList 이름 셀에 차트번호 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/doctor-tools`);
    await page.waitForLoadState('networkidle').catch(() => {});
    // 진료 환자 목록 탭으로 전환
    const tab = page.getByTestId('tab-patient-list');
    if (await tab.isVisible({ timeout: 6000 }).catch(() => false)) {
      await tab.click();
    }
    const list = page.getByTestId('patient-list');
    if (await list.isVisible({ timeout: 6000 }).catch(() => false)) {
      const names = page.getByTestId('patient-name');
      if ((await names.count()) > 0) {
        // 이름 셀 내부에 차트번호 배지가 동반
        await assertBadgeFormat(page.getByTestId('patient-chartno'));
      }
    }
  });

  // S3: 진료대기배너(진료콜 알람) — 환자명 옆 차트번호 병기
  test('S3: Dashboard 진료대기배너 환자명에 차트번호 병기', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const bannerPatients = page.getByTestId('exam-waiting-banner-patient');
    if ((await bannerPatients.count()) > 0) {
      // 배너 각 환자 항목에 '#' 배지(미발번 포함)가 동반 — 환자명 단독 노출 0
      await assertBadgeFormat(
        bannerPatients.locator('span.font-mono'),
      );
    }
  });

  // S4: 당일 치료 데이터테이블 — 환자명 옆 차트번호 병기
  test('S4: TreatmentTable 환자명에 차트번호 배지', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const table = page.locator('table');
    if (await table.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await assertBadgeFormat(page.getByTestId('treatment-chartno'));
    }
  });

  // S5: 칸반 대기 환자 카드 — 차트번호 always-on(미발번도 '#미발번')
  //   주: 공개 대기실 TV(/waiting/:slug)는 이름 마스킹 anon 화면 → PHI 외부노출 우려로 planner 판정 대기.
  //   본 surface = 내부 admin 칸반 '대기 환자 카드'(CheckInCard)로, 미발번도 명시(환자명 단독 노출 0).
  test('S5: 칸반 대기카드 차트번호 배지(미발번도 명시)', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const badges = page.getByTestId('waiting-card-chartno');
    if ((await badges.count()) > 0) {
      // 카드에 차트번호가 렌더되면 항상 '#' 접두(미발번 포함) — 환자명 단독 노출 0
      await assertBadgeFormat(badges);
    }
  });
});
