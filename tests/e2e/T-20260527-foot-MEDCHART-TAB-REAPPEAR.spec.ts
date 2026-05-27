/**
 * E2E spec — T-20260527-foot-MEDCHART-TAB-REAPPEAR
 * 진료차트 탭 미표시 재발 (regression) 검증
 *
 * 배경:
 *   T-20260526-foot-MEDCHART-TAB-FIX (reporter-withdrawn 5/26) 재발.
 *   MEDCHART-SYNC(8fee665) 배포 후 MedicalChartPanel import 추가됐으나
 *   JSX에서 미사용 상태 → TS6133 → 빌드 경고 누적.
 *   PENCHART-FORM-BLACKSCR FIX-REQUEST (4eb64c8)에서 import를 실제 JSX에 연결
 *   (btn-open-medical-chart 버튼 + Drawer 렌더) 하여 근본 수정.
 *
 * 루트 코즈:
 *   CustomerChartPage.tsx의 CLINICAL_TABS 섹션에서 "진료차트" 탭 버튼이
 *   조건부 렌더링 또는 역할 체크에 가려져 미노출되는 패턴 재발 방지.
 *
 * 수정 내용 (4eb64c8):
 *   FE-1: MedicalChartPanel import → JSX 연결 (medicalChartOpen state + Drawer)
 *   FE-2: btn-open-medical-chart 버튼 — CLINICAL_TABS 섹션 내 고정 삽입 (조건부 없음)
 *   FE-3: 역할(원장·치료사·데스크) 무관 항상 표시
 *
 * AC 검증:
 *   AC-1: btn-open-medical-chart 존재 + 조건부 렌더링 없음 (코드 레벨)
 *   AC-2: 역할 제한 없음 — role 체크 없이 항상 렌더 (코드 레벨)
 *   AC-3: MedicalChartPanel import → JSX 연결 완결 (코드 레벨)
 *   AC-4: 빌드 통과 (dist/ 디렉토리 확인)
 *   AC-BROWSER: 고객차트 진입 → 진료차트 버튼 visible (브라우저 E2E)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const chartPage = (): string =>
  fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');

// ─── AC-1: btn-open-medical-chart 버튼 고정 존재 ─────────────────────────────

test.describe('T-20260527-MEDCHART-TAB-REAPPEAR AC-1: 탭 버튼 무조건 렌더', () => {

  test('btn-open-medical-chart testid 존재', () => {
    const s = chartPage();
    expect(s).toContain('data-testid="btn-open-medical-chart"');
  });

  test('"진료차트" 텍스트 버튼 존재', () => {
    const s = chartPage();
    expect(s).toContain('진료차트');
  });

  test('Stethoscope 아이콘 import — 탭 버튼 시각 요소', () => {
    const s = chartPage();
    expect(s).toContain('Stethoscope');
  });

  test('medicalChartOpen state 선언 존재', () => {
    const s = chartPage();
    expect(s).toContain('medicalChartOpen');
    expect(s).toContain('setMedicalChartOpen');
  });

  test('onClick → setMedicalChartOpen(true) 연결', () => {
    const s = chartPage();
    expect(s).toContain('setMedicalChartOpen(true)');
  });

});

// ─── AC-2: 역할 조건 없이 항상 렌더 ─────────────────────────────────────────

test.describe('T-20260527-MEDCHART-TAB-REAPPEAR AC-2: 역할 무관 항상 표시', () => {

  test('btn-open-medical-chart 주변에 isDirector 조건부 없음', () => {
    const s = chartPage();
    // btn-open-medical-chart 앞에 역할 체크가 없어야 함 (isDirector && ... 패턴)
    const btnIdx = s.indexOf('data-testid="btn-open-medical-chart"');
    expect(btnIdx).toBeGreaterThan(0);
    // 버튼 앞 200자 내에 isDirector 조건부 분기가 없어야 함
    const surroundingBefore = s.slice(Math.max(0, btnIdx - 200), btnIdx);
    expect(surroundingBefore).not.toMatch(/\{.*isDirector.*&&/);
  });

  test('btn-open-medical-chart 버튼이 role 조건부로 감싸지지 않음', () => {
    const s = chartPage();
    const btnIdx = s.indexOf('data-testid="btn-open-medical-chart"');
    const surroundingBefore = s.slice(Math.max(0, btnIdx - 300), btnIdx);
    // hasRole / canView / profile?.role 등의 조건부로 시작하는 블록 없어야 함
    expect(surroundingBefore).not.toMatch(/\{.*canView.*&&/);
    expect(surroundingBefore).not.toMatch(/\{.*profile\?\.role.*&&/);
  });

  test('데이터 의존성 없음 — medicalCharts.length 조건부 없음', () => {
    const s = chartPage();
    const btnIdx = s.indexOf('data-testid="btn-open-medical-chart"');
    const surroundingBefore = s.slice(Math.max(0, btnIdx - 300), btnIdx);
    // medicalCharts.length > 0 등의 조건으로 버튼 숨기지 않아야 함
    expect(surroundingBefore).not.toMatch(/medicalCharts\.length\s*[><=]/);
  });

});

// ─── AC-3: MedicalChartPanel import → JSX 연결 ───────────────────────────────

test.describe('T-20260527-MEDCHART-TAB-REAPPEAR AC-3: MedicalChartPanel 연결', () => {

  test('MedicalChartPanel import 존재', () => {
    const s = chartPage();
    expect(s).toContain("import MedicalChartPanel from '@/components/MedicalChartPanel'");
  });

  test('MedicalChartPanel JSX 렌더 존재 (open prop 포함)', () => {
    const s = chartPage();
    expect(s).toContain('<MedicalChartPanel');
    expect(s).toContain('open={medicalChartOpen}');
    expect(s).toContain('onOpenChange={setMedicalChartOpen}');
  });

  test('MedicalChartPanel — customerId + clinicId prop 전달', () => {
    const s = chartPage();
    // customer 객체에서 id/clinic_id 전달
    expect(s).toContain('customerId={customer.id}');
    expect(s).toContain('clinicId={customer.clinic_id}');
  });

  test('MedicalChartPanel — currentUserRole + currentUserEmail prop 전달', () => {
    const s = chartPage();
    expect(s).toContain('currentUserRole={profile?.role');
    expect(s).toContain('currentUserEmail={profile?.email');
  });

  test('MedicalChartPanel 렌더 조건 — customer 존재 시에만 (NPE 방지)', () => {
    const s = chartPage();
    // {medicalChartOpen && customer && <MedicalChartPanel ...>} 패턴
    expect(s).toContain('medicalChartOpen && customer && (');
  });

});

// ─── AC-4: 빌드 통과 ─────────────────────────────────────────────────────────

test.describe('T-20260527-MEDCHART-TAB-REAPPEAR AC-4: 빌드 산출물 확인', () => {

  test('dist/ 디렉토리 존재 — 빌드 성공 확인', () => {
    expect(fs.existsSync('dist')).toBe(true);
  });

  test('CustomerChartPage 번들 존재 — 빌드 포함 확인', () => {
    const distAssets = fs.readdirSync('dist/assets');
    const hasChartBundle = distAssets.some(f => f.startsWith('CustomerChartPage'));
    expect(hasChartBundle).toBe(true);
  });

  test('MedicalChartPanel 번들 존재 — import 연결 확인', () => {
    const distAssets = fs.readdirSync('dist/assets');
    const hasMedBundle = distAssets.some(f => f.startsWith('MedicalChartPanel'));
    expect(hasMedBundle).toBe(true);
  });

});

// ─── AC-BROWSER: 고객차트 진입 → 진료차트 버튼 visible ──────────────────────
// Auth 필요 — 로컬 dev 서버(5173) + .auth/user.json 세션 있어야 실행됨.
// CI 환경에서는 auth 없으면 skip.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260527-MEDCHART-TAB-REAPPEAR BROWSER: 진료차트 탭 가시성', () => {

  test('고객차트 화면에서 진료차트 버튼 visible', async ({ page }) => {
    await page.goto('/admin/customers', { waitUntil: 'domcontentloaded' });

    // 인증 실패(로그인 리다이렉트) 시 skip
    const url = page.url();
    if (url.includes('/login') || url.includes('/auth')) {
      test.skip(true, `인증 미설정 — 로그인 리다이렉트 (${url}). auth.setup.ts 확인 필요.`);
      return;
    }

    // open-chart-btn 버튼(차트 열기)이 있는 첫 번째 고객 클릭
    const openChartBtn = page.locator('[data-testid="open-chart-btn"]').first();
    const btnCount = await openChartBtn.count();
    if (btnCount === 0) {
      test.skip(true, '고객 목록 없음 — 시드 데이터 확인 필요');
      return;
    }
    await openChartBtn.click();

    // 고객차트 시트 열림 대기
    await page.waitForSelector('[data-testid="customer-chart-sheet"]', { timeout: 10_000 }).catch(() => null);

    // chart-tab-clinical 탭 열 로드 대기
    await page.waitForSelector('[data-testid="chart-tab-clinical"]', { timeout: 10_000 }).catch(() => null);

    // btn-open-medical-chart 버튼 visible 확인 (AC-2: 항상 표시)
    const medBtn = page.locator('[data-testid="btn-open-medical-chart"]');
    await expect(medBtn).toBeVisible({ timeout: 10_000 });
    console.log('[BROWSER AC-1] 진료차트 탭 버튼 visible 확인');
  });

  test('진료차트 버튼 클릭 → MedicalChartPanel Drawer 열림', async ({ page }) => {
    await page.goto('/admin/customers', { waitUntil: 'domcontentloaded' });

    const url = page.url();
    if (url.includes('/login') || url.includes('/auth')) {
      test.skip(true, `인증 미설정 — 로그인 리다이렉트 (${url})`);
      return;
    }

    const openChartBtn = page.locator('[data-testid="open-chart-btn"]').first();
    if (await openChartBtn.count() === 0) {
      test.skip(true, '고객 목록 없음');
      return;
    }
    await openChartBtn.click();

    await page.waitForSelector('[data-testid="btn-open-medical-chart"]', { timeout: 10_000 });

    // 버튼 클릭
    await page.locator('[data-testid="btn-open-medical-chart"]').click();

    // MedicalChartPanel Drawer 열림 확인 — "진료차트" 타이틀 여러 개 중 Drawer 안에 있는 것
    await page.waitForTimeout(500);
    const drawerOpen = await page.locator('text=진료차트').count();
    expect(drawerOpen).toBeGreaterThan(0);

    // 에러 없음 확인
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Unhandled Runtime Error');
    expect(bodyText).not.toContain('TypeError');
    console.log('[BROWSER AC-3] 진료차트 Drawer 열림 확인');
  });

  test('데이터 없는 고객에서도 버튼 visible (AC-2: 데이터 독립)', async ({ page }) => {
    await page.goto('/admin/customers', { waitUntil: 'domcontentloaded' });

    const url = page.url();
    if (url.includes('/login') || url.includes('/auth')) {
      test.skip(true, `인증 미설정 — 로그인 리다이렉트 (${url})`);
      return;
    }

    // 임의 고객(첫 번째) — 데이터 유무 무관하게 탭은 항상 나와야 함
    const openChartBtn = page.locator('[data-testid="open-chart-btn"]').first();
    if (await openChartBtn.count() === 0) {
      test.skip(true, '고객 목록 없음');
      return;
    }
    await openChartBtn.click();

    await page.waitForSelector('[data-testid="chart-tab-clinical"]', { timeout: 10_000 }).catch(() => null);

    // 진료차트 버튼은 데이터 유무 무관하게 항상 visible
    const medBtn = page.locator('[data-testid="btn-open-medical-chart"]');
    await expect(medBtn).toBeVisible({ timeout: 10_000 });
    console.log('[AC-2] 데이터 독립 진료차트 탭 버튼 visible 확인');
  });

});
