/**
 * E2E spec — T-20260615-foot-PKGTAB-TREATSITE-REMOVE
 * 고객차트(2번차트) 패키지 탭 상단 치료부위(발가락) 일러스트 제거.
 *
 * 현장 요청(김주연 총괄): "CRM-[패키지] 상단 노출 치료부위 제거 — 고객차트에만 해당.
 *   고객차트에는 영향없게 범위 잘 설정." → pkg-tab-toe-section(FootToeIllustration 입력 UI) 제거.
 *   기존 treatment_memo.foot_sites 데이터 + 하류 read-path(1번차트 read-only / 균검사지 프리필)는 전면 보존.
 *
 * 본 티켓은 T-20260615-TOEILLUST-NAIL-FOCUS-RESIZE(deployed 6bae271)를 supersede.
 *
 * AC1 (제거): 패키지 탭 상단 pkg-tab-toe-section 더 이상 렌더 안 됨.
 * AC2 (범위 한정): 같은 패키지 탭 구매 패키지(티켓) 상세 등 다른 섹션 불변.
 * AC3 (하류 보존): 1번차트 read-only 표시 / 균검사지 프리필 소스 코드 경로 그대로.
 * AC4 (빌드 clean): pkg 탭에서만 쓰이던 import/콜백 안전 제거(unused 0).
 *
 * 구성:
 *  - PART A(소스 정합, 실서버 불필요): 제거 + 하류 보존 정적 검증 — 회귀 가드의 주축.
 *  - PART B(라이브 렌더): 패키지 탭 진입 시 일러스트 부재 + 구매 패키지 섹션 잔존(service key 없으면 skip).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const hasServiceKey = Boolean(SUPA_URL && SERVICE_KEY);

// ─────────────────────────────────────────────────────────────────────────
// PART A — 소스 정합(제거 + 하류 보존 정적 검증)
// ─────────────────────────────────────────────────────────────────────────
test.describe('PKGTAB-TREATSITE-REMOVE PART A: 소스 정합', () => {
  const here = fileURLToPath(import.meta.url); // .../tests/e2e/<spec>.ts
  const root = join(here, '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf-8');

  test('AC1: 2번차트(CustomerChartPage) 패키지 탭에서 치료부위 일러스트 제거', () => {
    const src = read('src/pages/CustomerChartPage.tsx');
    // 제거 대상 요소·연동 전부 소멸
    expect(src).not.toContain('pkg-tab-toe-section');
    expect(src).not.toContain('pkg-tab-toe-nocheckin');
    expect(src).not.toContain('<FootToeIllustration');
    // pkg 탭 전용 import/콜백/메모 정의도 함께 제거(unused 0 — AC4)
    expect(src).not.toContain("import FootToeIllustration");
    expect(src).not.toContain('saveTreatmentToes');
    expect(src).not.toContain('const treatmentToes');
    expect(src).not.toContain('canEditToes');
  });

  test('AC2: 같은 패키지 탭 구매 패키지(티켓) 상세 섹션은 보존', () => {
    const src = read('src/pages/CustomerChartPage.tsx');
    const tabBlock = src.slice(src.indexOf("chartTab === 'packages'"));
    expect(tabBlock).toContain('구매 패키지(티켓)');
    expect(tabBlock).toContain('setOpenPackagePurchase'); // 구입 티켓 추가
  });

  test('AC3-a: 1번차트(CheckInDetailSheet) read-only 치료부위 표시 보존', () => {
    const src = read('src/components/CheckInDetailSheet.tsx');
    // 하류 read-path 불변 — 기존 데이터로 계속 동작
    expect(src).toContain('data-testid="chart1-toe-readonly"');
    expect(src).toContain('<FootToeIllustration value={toes} readOnly />');
    expect(src).toContain('parseFootSites');
  });

  test('AC3-b: 균검사지(KohReportTab) 치료부위 프리필 소스 보존', () => {
    const src = read('src/components/doctor/KohReportTab.tsx');
    // treatment_memo.foot_sites → 균검사지 프리필 미러 로직 불변
    expect(src).toContain('parseFootSites');
    expect(src).toContain('foot_sites');
    expect(src).toContain('footSiteToNailSite');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PART B — 라이브 렌더(패키지 탭 일러스트 부재 + 구매 패키지 잔존)
// ─────────────────────────────────────────────────────────────────────────
test.describe('PKGTAB-TREATSITE-REMOVE PART B: 라이브 렌더', () => {
  test.skip(!hasServiceKey, 'service key 없음 → 시딩 불가, 라이브 skip');

  test('시나리오1: 패키지 탭 진입 — 일러스트 부재 + 구매 패키지 섹션 상단 위치', async ({ page }) => {
    const handle = await seedCheckIn({ status: 'consultation', visit_type: 'new', name: `E2E제거${Date.now().toString().slice(-5)}` });
    try {
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) test.skip(true, '로그인 실패 — 라이브 skip');

      await page.goto(`/chart/${handle.customerId}`);
      await page.waitForLoadState('networkidle');

      const pkgTab = page.getByRole('button', { name: '패키지', exact: true }).first();
      if ((await pkgTab.count()) === 0) test.skip(true, '패키지 탭 미노출(권한/레이아웃) — skip');
      await pkgTab.click();

      // AC1: 일러스트 박스 부재
      await expect(page.locator('[data-testid="pkg-tab-toe-section"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="foot-toe-illustration"]')).toHaveCount(0);

      // AC2: 구매 패키지(티켓) 섹션은 그대로 노출
      await expect(page.getByText('구매 패키지(티켓)').first()).toBeVisible();
    } finally {
      await handle.cleanup();
    }
  });
});
