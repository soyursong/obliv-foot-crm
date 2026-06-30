import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-DASHTIMER-DEPLOYMERGE-SEARCHBAR
 *
 * 현장(김주연 총괄, #project-doai-crm-풋확장 ts 1782782866.713309): 풋 대시보드 상단 툴바 정리 3건 (FE-only, DB 무변경).
 *   AC1 — (a)평소=⟳ 데이터 자동갱신 카운트다운 / (b)새 배포 감지 시 같은 박스가 '새로고침 알림' UI로 전환
 *         (2박스 → 1박스, 타이머 박스가 배포 알림 기능 흡수). (c)상단 툴바에 별도로 떠 있던 배포 알림 박스는
 *         더 이상 없음(단일 박스). 배포 감지/새로고침 트리거는 旣존 로직 재사용(신규 구독/폴링 0).
 *   AC2 — 타이머 박스 세로높이 = 옆 고객 검색창 높이 정렬(동일 min-h 토큰, items-stretch 류).
 *   AC3 — 고객 검색창 가로 약 2배(sm:w-72) + 겹침/줄바꿈 없이 한 줄 유지.
 *   AC4 — 데이터 fetch·자동갱신 주기·카운트다운·배포 감지·새로고침 유도 동작 무변경(순수 표현만).
 *   AC5 — 대시보드 상단 툴바 한정. 헤더 타 요소·하단 패널·타 메뉴 회귀 0.
 *
 * ── 본 티켓은 T-20260630-foot-DASHTIMER-DEPLOYNOTIF-MERGE-SEARCHWIDTH 와 동일 AC(중복 요청) ──
 *   해당 구현이 이미 main(commit 74fce5f9)에 머지됨. 본 spec 은 같은 불변식을 본 티켓 ID 로 고정하는
 *   회귀 가드. 신규 코드 변경은 없음(중복 구현 금지 — §S2.2 anti-pattern).
 *
 * ── AC1-c 해석(상단 툴바 단일 박스) ──
 *   상단 툴바의 배포 알림은 타이머 박스(DashboardRefreshCountdown)가 흡수 → 상단엔 단일 박스만 존재.
 *   하단 고정 토스트(UpdateBanner = SPA-VERSION-AUTORELOAD / DEPLOY-NOTIF-ENFORCE 소관, 자동
 *   카운트다운 reload + dirty-flush 안전기제)는 '상단 툴바 박스'가 아닌 별도 surface·소관이며,
 *   삭제 시 AC4(새로고침 유도 동작 무변경)와 충돌하므로 유지(격리). 상단 dedup 은 충족.
 *
 * 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상 — 대시보드 상단 헤더 표현 작업, 의료화면 무관.
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
test.describe('T-20260630 DASHTIMER-DEPLOYMERGE-SEARCHBAR — source-integrity', () => {
  test('S1-a: AC1 — 타이머가 旣존 빌드버전 체크(useVersionCheck) 재사용 (신규 감지 로직/폴링 0)', () => {
    expect(RC).toMatch(/import\s*\{\s*useVersionCheck\s*\}\s*from\s*'@\/hooks\/useVersionCheck'/);
    expect(RC).toMatch(/const\s*\{\s*updateAvailable\s*\}\s*=\s*useVersionCheck\(\)/);
    // 타이머 컴포넌트가 자체 version fetch/폴링을 새로 만들지 않음(신규 구독/폴링 금지).
    expect(RC).not.toContain('version.json');
    expect(RC).not.toMatch(/\bfetch\(/);
  });

  test('S1-b: AC1 — 새 배포 감지 시 같은 슬롯이 새로고침 알림 버튼으로 분기(클릭=리로드)', () => {
    expect(RC).toMatch(/if\s*\(\s*updateAvailable\s*\)/);
    expect(RC).toContain('data-testid="dashboard-deploy-refresh"');
    expect(RC).toMatch(/window\.location\.reload\(\)/);
  });

  test('S1-c: AC1/AC4 — 리로드 직전 旣존 dirty-guard(collectDirty)로 미저장 입력 보호(무손실)', () => {
    expect(RC).toMatch(/import\s*\{\s*collectDirty\s*\}\s*from\s*'@\/lib\/unsavedGuard'/);
    expect(RC).toMatch(/collectDirty\(\)/);
    // blocking 있으면 reload 보류(early return) — 강제 reload 로 데이터 날리지 않음.
    expect(RC).toMatch(/blocking\.length\s*>\s*0[\s\S]{0,40}?return/);
  });

  test('S1-d: AC2 — 타이머 박스(평소/배포 양분기)와 고객 검색창이 동일 세로높이 토큰(min-h-[36px])', () => {
    const timerMinH = RC.match(/min-h-\[36px\]/g) ?? [];
    expect(timerMinH.length, '타이머 평소/배포 분기 양쪽 min-h-[36px] 필요').toBeGreaterThanOrEqual(2);
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?min-h-\[36px\]/);
  });

  test('S1-e: AC3 — 고객 검색창 가로 2배(sm:w-72) + 한 줄 유지(whitespace-nowrap)', () => {
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?sm:w-72/);
    expect(LAYOUT).toMatch(/data-testid="dashboard-customer-search"[\s\S]{0,400}?whitespace-nowrap/);
  });

  test('S1-f: AC1-c — 상단 툴바 단일 박스(타이머/배포 분기가 한 컴포넌트 = 단일 컨테이너)', () => {
    // 평소/배포 두 분기 모두 단일 <button> 슬롯으로 렌더(중첩 박스/이중 컨테이너 없음 →
    // 추후 LIVESLOT-GLASS-SILVER STYLING 이 깨끗이 입혀지는 단일 컨테이너 구조).
    const buttonOpens = RC.match(/<button/g) ?? [];
    expect(buttonOpens.length, '타이머는 평소/배포 두 분기 = 단일 button 슬롯 2개(중첩 아님)').toBe(2);
    // AdminLayout 상단 툴바에는 타이머 컴포넌트 외 별도 배포 알림 박스 렌더가 없음.
    expect(LAYOUT).not.toMatch(/<UpdateBanner/);
    expect(LAYOUT).not.toContain('dashboard-deploy-refresh'); // 배포 분기는 타이머 컴포넌트 내부에만 존재
  });

  test('S1-g: AC4/AC5 — 배포 enforce(UpdateBanner) 무수정·격리 (위치/소관만 분리)', () => {
    // 하단 enforce 배너의 자동 reload·flush 핵심 시그니처 보존(삭제·변경 금지).
    expect(BANNER).toContain('data-testid="app-update-banner"');
    expect(BANNER).toContain('attemptReload');
    expect(BANNER).toContain('flushAll');
    // 타이머 컴포넌트는 enforce 경로를 끌어다 쓰지 않음 — 격리(중복 강제로직 0).
    expect(RC).not.toContain('flushAll');
    expect(RC).not.toMatch(/import[\s\S]{0,40}UpdateBanner/);
    expect(RC).not.toMatch(/<UpdateBanner/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// 시나리오 1(평소) / 2(새 배포 전환) / 3(좁은화면·회귀) → §3 매핑
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASHTIMER-DEPLOYMERGE-SEARCHBAR — live', () => {
  // 시나리오 1 + 3(데스크톱 뷰) — 평소 타이머 단일 표시 + 높이정렬 + 2배폭 + 회귀
  test('S2-a: 시나리오1 — 평소 타이머 단일 표시 + 검색창 높이정렬/2배폭 + pageerror 0', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.waitForTimeout(1500);

    // AC1(a): 카운트다운 타이머 1개 노출 + AC1(c): 배포 안내 미노출(평소).
    const timer = page.getByTestId('dashboard-refresh-countdown');
    await expect(timer).toBeVisible({ timeout: 8000 });
    expect(await page.getByTestId('dashboard-refresh-countdown').count()).toBe(1);
    expect(await page.getByTestId('dashboard-deploy-refresh').count()).toBe(0);

    // AC2: 타이머 박스 세로높이 ≈ 고객 검색창 세로높이(±2px).
    const search = page.getByTestId('dashboard-customer-search');
    await expect(search).toBeVisible();
    const tBox = await timer.boundingBox();
    const sBox = await search.boundingBox();
    expect(tBox && sBox).toBeTruthy();
    if (tBox && sBox) {
      expect(Math.abs(tBox.height - sBox.height), `타이머(${tBox.height}) vs 검색창(${sBox.height}) 높이 불일치`).toBeLessThanOrEqual(2);
      expect(sBox.height, '검색창 줄바꿈 의심(높이 과다)').toBeLessThanOrEqual(48);
      expect(sBox.width, '검색창 폭 미확장(sm:w-72≈288px)').toBeGreaterThanOrEqual(220);
    }

    // AC4: 검색 동작 무변경 — 클릭 시 검색 입력창 오픈.
    await search.click();
    await expect(page.getByPlaceholder(/이름.*전화번호.*차트번호/)).toBeVisible({ timeout: 4000 });

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  // 시나리오 2 — 새 배포 감지 시 같은 박스가 새로고침 알림으로 전환(별도 박스 신규 출현 아님)
  test('S2-b: 시나리오2 — 새 배포 감지 시 타이머 자리가 새로고침 알림으로 전환 + 클릭 reload', async ({ page }) => {
    await mockVersion(page, 'REMOTE-NEW-BUILD-DEPLOYMERGE-vB');

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    // 같은 슬롯이 배포 알림으로 자동 전환 — 별도 박스가 새로 뜨는 게 아니라 모드 전환(AC1-b).
    const deployBtn = page.getByTestId('dashboard-deploy-refresh');
    await expect(deployBtn).toBeVisible({ timeout: 8000 });
    // 평소 카운트다운은 그 자리에서 사라짐(단일 UI — 동시 노출 금지).
    expect(await page.getByTestId('dashboard-refresh-countdown').count()).toBe(0);

    // reload 검증 마커 — 클릭 후 reload 되면 마커 초기화.
    await page.evaluate(() => { (window as unknown as { __beforeReload?: boolean }).__beforeReload = true; });
    await deployBtn.click();
    await page.waitForLoadState('load', { timeout: 8000 });
    const cleared = await page.evaluate(
      () => (window as unknown as { __beforeReload?: boolean }).__beforeReload === undefined,
    );
    expect(cleared, 'reload 미발생').toBe(true);
  });

  // 시나리오 3 — 좁은 화면(태블릿 세로 폭)에서도 타이머+검색창 한 줄, 줄바꿈/잘림 0
  test('S2-c: 시나리오3 — 좁은 화면에서도 타이머+검색창 한 줄 유지(줄바꿈/잘림 0)', async ({ page }) => {
    // 로그인은 기본(데스크톱) 뷰포트로 — 좁은 폭에서 먼저 로그인하면 로그인 헬퍼가
    // lg-전용 사이드바 요소를 기다리며 행이 걸림(제품 레이아웃과 무관한 헬퍼 의존성).
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    // 로그인 후 갤탭 세로 류 좁은 폭으로 리사이즈해 한 줄 유지 검증.
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(1200);

    const timer = page.getByTestId('dashboard-refresh-countdown');
    const search = page.getByTestId('dashboard-customer-search');
    await expect(timer).toBeVisible({ timeout: 8000 });
    await expect(search).toBeVisible();

    const tBox = await timer.boundingBox();
    const sBox = await search.boundingBox();
    if (tBox && sBox) {
      // 같은 줄(세로 중심 좌표 근접) — 줄바꿈 시 한 박스가 아래로 밀려 top 격차가 커짐.
      const tMid = tBox.y + tBox.height / 2;
      const sMid = sBox.y + sBox.height / 2;
      expect(Math.abs(tMid - sMid), '타이머/검색창 줄바꿈 의심(세로중심 격차)').toBeLessThanOrEqual(6);
      // 검색창이 잘리지 않고 한 줄 높이 유지.
      expect(sBox.height, '검색창 줄바꿈/잘림 의심').toBeLessThanOrEqual(48);
    }
  });
});
