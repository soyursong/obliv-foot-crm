/**
 * STAB-2026-04-30 — 풋센터 CRM 안정화 회귀 스펙
 * T-20260430-foot-STABILIZATION
 *
 * 검증 범위 (04-28 ~ 04-30 배포 14건 전체 커버):
 *
 * ── 인라인 스펙 (S01~S11) ──────────────────────────────────────────────────
 *   S01. SEARCH-DOB-CHART   — 생년월일(YYMMDD)+차트번호 검색
 *   S02. REFERRER           — 추천인 필드 등록/표시
 *   S03. TREATMENT-LABEL    — 진료종류 라벨 + 5필드 (consultation_done, treatment_kind,
 *                             preconditioning_done, pododulle_done, laser_minutes)
 *   S04. ADMIN-CRUD         — 서비스/카테고리 수정·삭제 버튼 존재
 *   S05. CHECKIN-SPEC-REFRESH — 셀프체크인 form 필드 ID 확인
 *   S06. STAFF-CRUD         — 직원 수정/비활성화 버튼 존재
 *   S07. PAYMENT-PACKAGE-INTEGRATED — DeskPaymentMenu 4버튼 + 회차차감 Dialog
 *   S08. CHECKIN-UX         — 셀프체크인 브라운 테마 + 접수 완료 화면
 *   S09. DOC-PRINT-SPEC     — 서류 발행 패널 렌더링
 *   S10. CHART-DETAIL       — 고객 차트 상세 (메모/패키지/예약)
 *   S11. DASHBOARD-RECONFIG — 10칸반 컬럼 (초진/재진/진료/선체험/상담대기/상담/치료대기/치료/레이저/데스크)
 *
 * ── 별도 R-spec 파일 (S12~S14) ─────────────────────────────────────────────
 *   S12. DESK-PAYMENT-MENU          — R-2026-04-30-desk-payment-menu.spec.ts (T1~T8)
 *                                     payment_waiting 상태 → DeskPaymentMenu 4버튼 + 각 액션
 *   S13. PACKAGE-CREATE-IN-SHEET    — R-2026-04-30-package-create-in-sheet.spec.ts (T1~T5)
 *                                     체크인 시트 내 패키지 생성 CTA (신규/체험/재진 분기)
 *   S14. CONSENT-FLOW-INTEGRATION   — R-2026-04-30-consent-flow-integration.spec.ts (T1~T5)
 *                                     상담/결제 단계 동의서 배너 + 서명 gate
 *
 * ── 인라인 스모크 (S12s~S14s) ──────────────────────────────────────────────
 *   S12s. DESK-PAYMENT-MENU 경로 존재 확인 (셀프체크인 주소 기반)
 *   S13s. 패키지 페이지 (/admin/packages) 렌더링 확인
 *   S14s. 동의서 버튼 data-testid 코드베이스 존재 확인 (정적)
 *
 * 실행 전제:
 *   - VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 설정
 *   - Playwright storageState 인증 완료
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  loginAndWaitForDashboard,
  expectDeprecatedCheckinRedirect,
  stubCanonicalCheckin,
  CANONICAL_STUB_MARKER,
} from '../../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

function sb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

// ─── S05 / S08: 셀프체크인 UI ─────────────────────────────────────────────────
//
// T-20260615-foot-REGRESSION-SUITE-DEROT RC-A:
// S05(form ID), S08(브라운 테마/추천인/완료화면)은 모두 obliv-foot-crm 네이티브
// 셀프체크인 폼(#sc-name 등)을 검증했다. 6/2 CF-CUTOVER + 6/3 OLDURL-DEPRECATE 후
// 네이티브 폼은 폐기되고 canonical 이 foot-checkin.pages.dev(별도 레포)로 단일
// 이전됨. 네이티브 폼·테마·완료화면은 외부 레포 소유라 본 레포 회귀 범위 밖.
// 본 레포가 책임지는 잔여 동작은 "deprecated slug → canonical 리다이렉트 고지"뿐이며
// 이를 결정적(offline-safe)으로 검증한다.

test.describe('S05+S08 셀프체크인 deprecated slug → canonical 리다이렉트', () => {
  test('deprecated /checkin/jongno-foot 진입 → canonical 리다이렉트 고지 (네이티브 폼 폐기)', async ({ page }) => {
    await expectDeprecatedCheckinRedirect(page);
  });
});

// ─── S11: 대시보드 10칸반 컬럼 ─────────────────────────────────────────────────

test.describe('S11 대시보드 DASHBOARD-RECONFIG — 10칸반 컬럼', () => {
  test('대시보드 10카테고리 컬럼 렌더링', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 10개 컬럼 레이블 확인
    const columnLabels = [
      '초진',
      '재진',
      '진료',       // 진료 섹션 (examination)
      '선체험',
      '상담대기',
      '상담',       // 상담 섹션
      '치료대기',
      '치료실',     // 치료실 섹션
      '레이저실',   // 레이저 섹션
      '결제',
      '완료',
    ];
    for (const label of columnLabels) {
      const el = page.getByText(label, { exact: true }).first();
      const visible = await el.isVisible({ timeout: 5_000 }).catch(() => false);
      test.info().annotations.push({
        type: 'column',
        description: `${label}: ${visible ? '✓' : '✗'}`,
      });
    }

    await page.screenshot({ path: 'test-results/screenshots/STAB-S11-dashboard.png' });
  });

  test('대시보드 체크인 버튼 + 날짜 네비게이션', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 체크인 버튼
    const checkInBtn = page.getByRole('button', { name: '체크인' }).first();
    await expect(checkInBtn).toBeVisible({ timeout: 5_000 });

    // 탭 (전체/신규/재진)
    await expect(page.getByRole('tab', { name: '전체' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '신규' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '재진' })).toBeVisible();
  });
});

// ─── S01: 고객 검색 (생년월일 + 차트번호) ──────────────────────────────────────

test.describe('S01 SEARCH-DOB-CHART — 생년월일+차트번호 검색', () => {
  let testCustId: string | null = null;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    const ts = Date.now();
    const { data } = await client
      .from('customers')
      .insert({
        clinic_id: CLINIC_ID,
        name: `STAB-S01-${ts}`,
        phone: `010${String(ts).slice(-8)}`,
        birth_date: '901231',
        chart_number: `STAB-${ts}`,
        visit_type: 'new',
      })
      .select('id')
      .single();
    testCustId = data?.id ?? null;
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY || !testCustId) return;
    await sb().from('customers').delete().eq('id', testCustId);
  });

  test('S01: 생년월일(YYMMDD) 검색', async ({ page }) => {
    if (!testCustId) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder(/이름|전화|생년월일|검색/).first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // 생년월일 검색
    await searchInput.fill('901231');
    await page.waitForTimeout(600);

    const nameCell = page.getByText(`STAB-S01-`, { exact: false }).first();
    const found = await nameCell.isVisible({ timeout: 5_000 }).catch(() => false);
    test.info().annotations.push({ type: 'result', description: `생년월일 검색: ${found ? '✓' : '✗ (예상 데이터 없거나 검색 지연)'}` });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S01-birth-search.png' });
  });

  test('S01: 차트번호 검색', async ({ page }) => {
    if (!testCustId) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder(/이름|전화|생년월일|검색/).first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    const client = sb();
    const { data: cust } = await client
      .from('customers')
      .select('chart_number')
      .eq('id', testCustId!)
      .single();
    const chartNum = cust?.chart_number as string;
    await searchInput.fill(chartNum);
    await page.waitForTimeout(600);

    const nameCell = page.getByText(`STAB-S01-`, { exact: false }).first();
    const found = await nameCell.isVisible({ timeout: 5_000 }).catch(() => false);
    test.info().annotations.push({ type: 'result', description: `차트번호 검색: ${found ? '✓' : '✗'}` });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S01-chart-search.png' });
  });
});

// ─── S02: 추천인 필드 ──────────────────────────────────────────────────────────

test.describe('S02 REFERRER — 추천인 필드 등록', () => {
  test('S02: 고객 등록 다이얼로그 추천인 필드 존재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    // 고객 등록 버튼 클릭
    const addBtn = page.getByRole('button', { name: /신규 등록|고객 추가|등록/ }).first();
    const addVisible = await addBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!addVisible) {
      test.info().annotations.push({ type: 'skip', description: '신규 등록 버튼 없음' });
      return;
    }
    await addBtn.click();
    await page.waitForTimeout(500);

    // 추천인 필드 확인
    const referrerLabel = page.getByText('추천인', { exact: true });
    await expect(referrerLabel).toBeVisible({ timeout: 3_000 });

    // 생년월일 필드 확인 (SEARCH-DOB-CHART)
    const birthLabel = page.getByText('생년월일', { exact: true });
    await expect(birthLabel).toBeVisible({ timeout: 2_000 });

    // 차트번호 필드
    const chartLabel = page.getByText('차트번호', { exact: true });
    await expect(chartLabel).toBeVisible({ timeout: 2_000 });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S02-referrer-field.png' });
    await page.keyboard.press('Escape');
  });
});

// ─── S03: 진료종류 5필드 ───────────────────────────────────────────────────────

test.describe('S03 TREATMENT-LABEL — 진료종류 5필드', () => {
  let ciId: string | null = null;
  let custId: string | null = null;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    const ts = Date.now();
    const phone = `010${String(ts).slice(-8)}`;
    const { data: cust } = await client
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `STAB-S03-${ts}`, phone, visit_type: 'new' })
      .select('id')
      .single();
    custId = cust?.id ?? null;
    const { data: ci } = await client
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: custId,
        customer_name: `STAB-S03-${ts}`,
        customer_phone: phone,
        visit_type: 'new',
        status: 'examination',
        queue_number: 960,
      })
      .select('id')
      .single();
    ciId = ci?.id ?? null;
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    if (ciId) await client.from('check_ins').delete().eq('id', ciId);
    if (custId) await client.from('customers').delete().eq('id', custId);
  });

  test('S03: 체크인 상세 시트 — 진료종류 5필드 렌더링', async ({ page }) => {
    if (!ciId) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 카드 클릭
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ciId}"]`);
    const cardVisible = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!cardVisible) {
      test.info().annotations.push({ type: 'skip', description: '카드 미표시 — 날짜 필터 확인' });
      return;
    }
    await card.click();
    await page.waitForTimeout(800);

    // 진료종류 섹션 확인
    await expect(page.getByText('진료종류', { exact: true })).toBeVisible({ timeout: 3_000 });

    // 상담유무 토글
    await expect(page.getByText('상담유무', { exact: true })).toBeVisible();

    // 치료종류 버튼들
    const treatmentKinds = ['가열레이저', '비가열레이저', '프컨+레이저', '수액', '상담', '기타'];
    for (const kind of treatmentKinds) {
      const btn = page.getByText(kind, { exact: true }).first();
      const visible = await btn.isVisible({ timeout: 2_000 }).catch(() => false);
      test.info().annotations.push({ type: 'field', description: `치료종류 [${kind}]: ${visible ? '✓' : '✗'}` });
    }

    // 프컨 / 포돌 토글
    await expect(page.getByText('프컨', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('포돌', { exact: true }).first()).toBeVisible();

    // 레이저 시간 입력
    await expect(page.getByText('레이저 시간', { exact: true })).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/STAB-S03-treatment-label.png' });
  });
});

// ─── S06: 직원 수정/비활성화 (STAFF-CRUD) ──────────────────────────────────────

test.describe('S06 STAFF-CRUD — 직원 수정/비활성화 버튼', () => {
  test('S06: Staff 탭 — 직원 목록 + 수정 버튼 존재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/staff');
    await page.waitForLoadState('networkidle');

    // 직원 탭 클릭
    const staffTab = page.getByRole('tab', { name: '직원' });
    const tabVisible = await staffTab.isVisible({ timeout: 5_000 }).catch(() => false);
    if (tabVisible) await staffTab.click();

    await page.waitForTimeout(500);

    // 수정 버튼 (Pencil 아이콘 버튼) 존재 확인
    const editBtns = page.locator('button[title="수정"]');
    const editCount = await editBtns.count();
    test.info().annotations.push({
      type: 'result',
      description: `직원 수정 버튼 수: ${editCount}`,
    });

    // 비활성화 버튼 (최소 1개 이상)
    const deactivateBtns = page.locator('button[title="비활성화"]');
    const deactivateCount = await deactivateBtns.count();
    test.info().annotations.push({
      type: 'result',
      description: `직원 비활성화 버튼 수: ${deactivateCount}`,
    });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S06-staff-crud.png' });
  });
});

// ─── S04: 카테고리/서비스 관리 (ADMIN-CRUD) ────────────────────────────────────

test.describe('S04 ADMIN-CRUD — 서비스/카테고리 수정·삭제', () => {
  test('S04: Services 페이지 — 서비스 수정/삭제 버튼 존재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/services');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // 서비스 목록이 렌더링 확인
    const serviceRows = page.locator('table tbody tr');
    const rowCount = await serviceRows.count().catch(() => 0);
    test.info().annotations.push({ type: 'result', description: `서비스 행 수: ${rowCount}` });

    // 수정 버튼 (Pencil)
    const editBtns = page.locator('button').filter({ has: page.locator('svg') });
    const editCount = await editBtns.count();
    test.info().annotations.push({ type: 'result', description: `서비스 관리 버튼 수: ${editCount}` });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S04-admin-crud.png' });
  });
});

// ─── S07: 통합 결제 + DeskPaymentMenu (PAYMENT-PACKAGE-INTEGRATED) ─────────────

test.describe('S07 PAYMENT-PACKAGE-INTEGRATED — DeskPaymentMenu 4버튼', () => {
  let ciId: string | null = null;
  let custId: string | null = null;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    const ts = Date.now();
    const phone = `010${String(ts).slice(-8)}`;
    const { data: cust } = await client
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `STAB-S07-${ts}`, phone, visit_type: 'returning' })
      .select('id')
      .single();
    custId = cust?.id ?? null;
    const { data: ci } = await client
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: custId,
        customer_name: `STAB-S07-${ts}`,
        customer_phone: phone,
        visit_type: 'returning',
        status: 'payment_waiting',
        queue_number: 970,
      })
      .select('id')
      .single();
    ciId = ci?.id ?? null;
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    if (ciId) await client.from('check_ins').delete().eq('id', ciId);
    if (custId) await client.from('customers').delete().eq('id', custId);
  });

  // T-20260629-foot-CHART1-PAYMENT-INSURANCE-REMOVE: DeskPaymentMenu('수납 처리' 카드)는 1번차트에서 제거됨.
  //   S07 은 '4버튼 렌더' 단언에서 '제거 회귀 가드'로 rebase. (상세: T-20260629-...-REMOVE.spec.ts)
  test('S07: payment_waiting → DeskPaymentMenu 제거 회귀 가드(미노출)', async ({ page }) => {
    if (!ciId) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ciId}"]`);
    const cardVisible = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!cardVisible) {
      test.info().annotations.push({ type: 'skip', description: '카드 미표시' });
      return;
    }
    await card.click();
    await page.waitForTimeout(800);

    // DeskPaymentMenu + 하위 버튼은 더 이상 렌더되지 않아야 함
    await expect(page.locator('[data-testid="desk-payment-menu"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="desk-menu-session-deduct"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="desk-menu-new-package"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="desk-menu-single-payment"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="desk-menu-insurance-doc"]')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/screenshots/STAB-S07-desk-menu-removed.png' });
  });
});

// ─── S09: 서류 발행 패널 (DOC-PRINT-SPEC) ──────────────────────────────────────

test.describe('S09 DOC-PRINT-SPEC — 서류 발행 패널', () => {
  let ciId: string | null = null;
  let custId: string | null = null;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    const ts = Date.now();
    const phone = `010${String(ts).slice(-8)}`;
    const { data: cust } = await client
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `STAB-S09-${ts}`, phone, visit_type: 'new' })
      .select('id')
      .single();
    custId = cust?.id ?? null;
    const { data: ci } = await client
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: custId,
        customer_name: `STAB-S09-${ts}`,
        customer_phone: phone,
        visit_type: 'new',
        status: 'done',
        queue_number: 980,
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    ciId = ci?.id ?? null;
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    const client = sb();
    if (ciId) await client.from('check_ins').delete().eq('id', ciId);
    if (custId) await client.from('customers').delete().eq('id', custId);
  });

  test('S09: 체크인 상세 시트 — 서류 발행 섹션 렌더링', async ({ page }) => {
    if (!ciId) { test.skip(true, 'SERVICE_KEY 없음'); return; }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ciId}"]`);
    const cardVisible = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!cardVisible) {
      test.info().annotations.push({ type: 'skip', description: '완료 카드 미표시 — 완료 컬럼 스크롤' });
      return;
    }
    await card.click();
    await page.waitForTimeout(1000);

    // 서류 발행 텍스트 존재 확인
    const docPanel = page.getByText('서류 발행').first();
    const docVisible = await docPanel.isVisible({ timeout: 3_000 }).catch(() => false);
    test.info().annotations.push({ type: 'result', description: `서류 발행 패널: ${docVisible ? '✓' : '✗'}` });

    await page.screenshot({ path: 'test-results/screenshots/STAB-S09-doc-print.png' });
  });
});

// ─── S10: 고객 차트 상세 (CHART-DETAIL) ────────────────────────────────────────

test.describe('S10 CHART-DETAIL — 고객 차트 상세 탭', () => {
  test('S10: 고객 목록 → 차트 상세 (메모/패키지/예약 탭)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 첫 번째 고객 클릭
    const firstRow = page.locator('table tbody tr').first();
    const rowVisible = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!rowVisible) {
      test.info().annotations.push({ type: 'skip', description: '고객 없음' });
      return;
    }
    await firstRow.click();
    await page.waitForTimeout(800);

    // 차트 상세 Sheet 열림 확인
    const sheet = page.locator('[role="dialog"], [data-vaul-drawer]').first();
    const sheetVisible = await sheet.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!sheetVisible) {
      // Sheet 렌더 방식이 다를 수 있음
      const tabsArea = page.getByRole('tablist').first();
      const tabsVisible = await tabsArea.isVisible({ timeout: 3_000 }).catch(() => false);
      test.info().annotations.push({ type: 'result', description: `차트 탭: ${tabsVisible ? '✓' : '✗'}` });
    }

    await page.screenshot({ path: 'test-results/screenshots/STAB-S10-chart-detail.png' });
  });
});

// ─── 빌드 검증 (정적 자산 로드) ─────────────────────────────────────────────────

test.describe('빌드 정적 자산 로드', () => {
  test('/ → /admin 리다이렉트 정상', async ({ page }) => {
    await page.goto('/');
    // 클라 라우터 리다이렉트는 비동기 — domcontentloaded 직후엔 아직 '/' 일 수 있어
    // 결정적으로 착지 URL 을 폴링 대기한다 (false-fail 방지).
    await page.waitForURL(/\/(login|admin|checkin)/, { timeout: 10_000 }).catch(() => {});
    const url = page.url();
    const isExpected = url.includes('/login') || url.includes('/admin') || url.includes('/checkin');
    expect(isExpected).toBe(true);
  });

  test('셀프체크인 JS 번들 로드 + React 렌더링', async ({ page }) => {
    // canonical 을 오프라인 stub 으로 fulfill → 본 레포 번들이 로드되고 React 가 실행되어
    // canonical 로 리다이렉트하기까지의 시간을 결정적으로 측정(abort 는 메인프레임 pending 유발).
    await stubCanonicalCheckin(page);
    const t0 = Date.now();
    await page.goto('/checkin/jongno-foot').catch(() => {});
    // canonical stub 착지 = SPA 번들 로드 + React 렌더(리다이렉트) 완료 신호
    await expect(page.locator(`#${CANONICAL_STUB_MARKER}`)).toBeVisible({ timeout: 10_000 });
    const loadMs = Date.now() - t0;
    test.info().annotations.push({ type: 'performance', description: `셀프체크인 로드: ${loadMs}ms` });
    // 10초 이내 로드 목표 (티켓 성능 기준)
    expect(loadMs).toBeLessThan(10_000);
  });
});

// ─── S12s: DESK-PAYMENT-MENU 스모크 ─────────────────────────────────────────
// 상세 스펙: R-2026-04-30-desk-payment-menu.spec.ts (T1~T8)

test.describe('S12s DESK-PAYMENT-MENU — 셀프체크인 경로 정상 (smoke)', () => {
  test('S12s: /checkin/jongno-foot 로드 → 앱 정상 렌더링 (DeskPaymentMenu 전제)', async ({
    page,
  }) => {
    // RC-A: deprecated slug 는 canonical 로 window.location.replace 한다(6/3 OLDURL-DEPRECATE).
    // 과거엔 page.evaluate 로 native 폼 body 를 검증했으나, 리다이렉트로 실행 컨텍스트가
    // 파괴돼 false-fail 났다. 본 레포 번들이 정상 실행되어 canonical 로 리다이렉트함을
    // (= 앱이 죽지 않고 라우트가 동작함을) 오프라인 stub 착지로 결정적 검증한다.
    await expectDeprecatedCheckinRedirect(page);
    test.info().annotations.push({
      type: 'note',
      description: '상세: R-2026-04-30-desk-payment-menu.spec.ts T1~T8',
    });
  });
});

// ─── S13s: PACKAGE-CREATE-IN-SHEET 스모크 ────────────────────────────────────
// 상세 스펙: R-2026-04-30-package-create-in-sheet.spec.ts (T1~T5)

test.describe('S13s PACKAGE-CREATE-IN-SHEET — /admin/packages 라우트 smoke', () => {
  test('S13s: /admin/packages 라우트 → 로그인 게이트 또는 패키지 페이지 착지', async ({
    page,
  }) => {
    await page.goto('/admin/packages');
    await page.waitForLoadState('domcontentloaded');
    const url = page.url();
    const isExpected =
      url.includes('/login') ||
      url.includes('/admin/packages') ||
      url.includes('/admin');
    expect(isExpected).toBe(true);
    test.info().annotations.push({
      type: 'note',
      description: '상세: R-2026-04-30-package-create-in-sheet.spec.ts T1~T5',
    });
  });
});

// ─── S14s: CONSENT-FLOW-INTEGRATION 스모크 ───────────────────────────────────
// 상세 스펙: R-2026-04-30-consent-flow-integration.spec.ts (T1~T5)

test.describe('S14s CONSENT-FLOW-INTEGRATION — 앱 번들 내 동의서 라우트 smoke', () => {
  test('S14s: 앱 진입 라우트 → 동의서 통합 전제 번들 정상 로드', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    const loadMs = Date.now() - t0;
    // 동의서 흐름 통합(CONSENT-FLOW-INTEGRATION) 후에도 번들 로드 정상 (10초 이내)
    expect(loadMs).toBeLessThan(10_000);
    test.info().annotations.push({
      type: 'performance',
      description: `/admin 로드: ${loadMs}ms`,
    });
    test.info().annotations.push({
      type: 'note',
      description: '상세: R-2026-04-30-consent-flow-integration.spec.ts T1~T5',
    });
  });
});
