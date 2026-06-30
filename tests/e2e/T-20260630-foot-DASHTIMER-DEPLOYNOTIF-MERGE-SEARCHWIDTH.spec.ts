import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-DASHTIMER-DEPLOYNOTIF-MERGE-SEARCHWIDTH
 *
 * 현장(김주연 총괄): 풋 대시보드 우측 상단 정리 3건 (FE-only, DB 무변경).
 *   AC1 — 자동갱신 타이머(A) + 배포 알림(B)을 타이머 자리에 단일 UI로 합체.
 *         평소=⟳ 카운트다운 / 새 버전 감지=같은 자리가 '새로고침 안내'로 자동 전환 → 클릭 시 리로드.
 *         배포 감지는 旣존 빌드버전 체크(useVersionCheck) 재사용 — 신규 감지 로직/폴링/API 0.
 *   AC2 — 합친 타이머 박스 세로높이 = 옆 고객 검색창 높이 정렬(동일 min-h 토큰).
 *   AC3 — 고객 검색창 가로 길이 현재의 약 2배(sm:w-72) + 겹침/줄바꿈 없이 한 줄 유지.
 *   AC4 — 60초 자동갱신 주기·배포감지 트리거·검색 동작 무변경(표현/위치/크기만).
 *   AC5 — 헤더 타 요소(벨/전체·신규·재진/슬롯·배치·당일검색 = DASHHEADER-DEDUP-COMPACT 소관),
 *         하단 패널, 배포알림 강제로직(DEPLOY-NOTIF-ENFORCE 소관)은 무영향(위치만 이동).
 *
 * 구현 요지:
 *   - DashboardRefreshCountdown: useVersionCheck().updateAvailable 분기 추가.
 *     true면 같은 슬롯이 dashboard-deploy-refresh 버튼(클릭=collectDirty 보호 후 location.reload)으로 전환.
 *     UpdateBanner(하단 enforce)는 무수정 → 강제로직 격리.
 *   - AdminLayout: 고객 검색 버튼에 min-h-[36px](타이머와 동일) + sm:w-72(2배) + whitespace-nowrap.
 *
 * 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상 — 접수/대시보드 헤더 표현 작업, 의료화면 무관.
 */

const RC = fs.readFileSync(path.resolve('src/components/DashboardRefreshCountdown.tsx'), 'utf-8');
const LAYOUT = fs.readFileSync(path.resolve('src/components/AdminLayout.tsx'), 'utf-8');
const BANNER = fs.readFileSync(path.resolve('src/components/UpdateBanner.tsx'), 'utf-8');

/** /version.json 을 임의 buildId 로 모킹 (배포 감지 재현 — SPA-VERSION-AUTORELOAD spec 패턴) */
async function mockVersion(page: Page, buildId: string) {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
// S1 — source-integrity (결정론, auth 불요)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASHTIMER-DEPLOYNOTIF-MERGE-SEARCHWIDTH — source-integrity', () => {
  test('S1-a: AC1 — 타이머가 旣존 빌드버전 체크(useVersionCheck) 재사용 (신규 감지 로직 0)', () => {
    expect(RC).toMatch(/import\s*\{\s*useVersionCheck\s*\}\s*from\s*'@\/hooks\/useVersionCheck'/);
    expect(RC).toMatch(/const\s*\{\s*updateAvailable\s*\}\s*=\s*useVersionCheck\(\)/);
    // 신규 폴링/fetch 추가 금지 — 타이머 컴포넌트가 자체 version fetch 를 만들지 않음.
    expect(RC).not.toContain('version.json');
    expect(RC).not.toMatch(/\bfetch\(/);
  });

  test('S1-b: AC1 — 새 버전 감지 시 같은 슬롯이 새로고침 안내 버튼으로 분기(클릭=리로드)', () => {
    // updateAvailable 분기 + 전용 deploy 버튼 렌더.
    expect(RC).toMatch(/if\s*\(\s*updateAvailable\s*\)/);
    expect(RC).toContain('data-testid="dashboard-deploy-refresh"');
    // 클릭 핸들러가 페이지 리로드를 수행.
    expect(RC).toMatch(/window\.location\.reload\(\)/);
  });

  test('S1-c: AC1 — 리로드 직전 旣존 dirty-guard(collectDirty)로 미저장 입력 보호(무손실)', () => {
    expect(RC).toMatch(/import\s*\{\s*collectDirty\s*\}\s*from\s*'@\/lib\/unsavedGuard'/);
    expect(RC).toMatch(/collectDirty\(\)/);
    // blocking 있으면 reload 보류(early return) — 강제 reload 로 데이터 날리지 않음.
    expect(RC).toMatch(/blocking\.length\s*>\s*0[\s\S]{0,40}?return/);
  });

  test('S1-d: AC2 — 타이머 박스와 고객 검색창이 동일 세로높이 토큰(min-h-[36px])', () => {
    // 타이머: 평소/배포 두 분기 모두 min-h-[36px].
    const timerMinH = RC.match(/min-h-\[36px\]/g) ?? [];
    expect(timerMinH.length, '타이머 평소/배포 분기 양쪽 min-h-[36px] 필요').toBeGreaterThanOrEqual(2);
    // 검색 버튼도 동일 토큰.
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?min-h-\[36px\]/);
  });

  test('S1-e: AC3 — 고객 검색창 가로 2배(sm:w-72) + 한 줄 유지(whitespace-nowrap)', () => {
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?sm:w-72/);
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?whitespace-nowrap/);
  });

  test('S1-f: AC5 — 배포알림 강제로직(UpdateBanner/DEPLOY-NOTIF-ENFORCE) 무수정(위치만 이동)', () => {
    // UpdateBanner 의 enforce(자동 카운트다운 reload·flush) 핵심 시그니처가 그대로 보존.
    expect(BANNER).toContain("data-testid=\"app-update-banner\"");
    expect(BANNER).toContain('attemptReload');
    expect(BANNER).toContain('flushAll');
    // 타이머 컴포넌트는 enforce 경로(flushAll/UpdateBanner import·렌더)를 끌어다 쓰지 않음 — 격리.
    expect(RC).not.toContain('flushAll');
    expect(RC).not.toMatch(/import[\s\S]{0,40}UpdateBanner/);
    expect(RC).not.toMatch(/<UpdateBanner/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASHTIMER-DEPLOYNOTIF-MERGE-SEARCHWIDTH — live', () => {
  test('S2-a: 평소 상태 — 타이머 카운트다운 단일 표시 + 검색창 높이정렬/2배폭 + pageerror 0', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.waitForTimeout(1500);

    // AC1 평소: 카운트다운 타이머 노출 + 배포 안내 미노출.
    const timer = page.getByTestId('dashboard-refresh-countdown');
    await expect(timer).toBeVisible({ timeout: 8000 });
    expect(await page.getByTestId('dashboard-deploy-refresh').count()).toBe(0);

    // AC2: 타이머 박스 세로높이 ≈ 고객 검색창 세로높이(±2px 허용).
    const search = page.getByTestId('dashboard-customer-search');
    await expect(search).toBeVisible();
    const tBox = await timer.boundingBox();
    const sBox = await search.boundingBox();
    expect(tBox && sBox).toBeTruthy();
    if (tBox && sBox) {
      expect(Math.abs(tBox.height - sBox.height), `타이머(${tBox.height}) vs 검색창(${sBox.height}) 높이 불일치`).toBeLessThanOrEqual(2);
      // AC3: 검색창이 한 줄 유지(높이가 한 줄 수준 — 줄바꿈 시 높이 2배가 됨).
      expect(sBox.height, '검색창 줄바꿈 의심(높이 과다)').toBeLessThanOrEqual(48);
      // AC3: 검색창 폭이 충분히 넓음(2배 확장 — 데스크톱 뷰포트 기준 sm:w-72≈288px).
      expect(sBox.width, '검색창 폭 미확장').toBeGreaterThanOrEqual(220);
    }

    // AC4: 검색 동작 무변경 — 클릭 시 검색 입력창 오픈.
    await search.click();
    await expect(page.getByPlaceholder(/이름.*전화번호.*차트번호/)).toBeVisible({ timeout: 4000 });

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('S2-b: 배포 감지 — 타이머 자리가 새로고침 안내로 전환 + 클릭 시 reload', async ({ page }) => {
    // 로컬 번들과 다른 buildId 로 /version.json 모킹 → updateAvailable=true 유도.
    await mockVersion(page, 'REMOTE-NEW-BUILD-DASHTIMER-vB');

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    // 같은 슬롯이 배포 안내로 자동 전환.
    const deployBtn = page.getByTestId('dashboard-deploy-refresh');
    await expect(deployBtn).toBeVisible({ timeout: 8000 });
    // 평소 카운트다운은 그 자리에서 사라짐(단일 UI — 동시 노출 금지).
    expect(await page.getByTestId('dashboard-refresh-countdown').count()).toBe(0);

    // reload 검증용 마커 — 클릭 후 reload 되면 마커 초기화.
    await page.evaluate(() => { (window as unknown as { __beforeReload?: boolean }).__beforeReload = true; });
    await deployBtn.click();
    await page.waitForLoadState('load', { timeout: 8000 });
    const cleared = await page.evaluate(
      () => (window as unknown as { __beforeReload?: boolean }).__beforeReload === undefined,
    );
    expect(cleared, 'reload 미발생').toBe(true);
  });
});
