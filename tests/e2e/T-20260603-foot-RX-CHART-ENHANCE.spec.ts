/**
 * E2E spec — T-20260603-foot-RX-CHART-ENHANCE (FE 즉시분: AC-3 + AC-4)
 * 진료차트(MedicalChartPanel) 처방내역 영역 개선.
 *
 * 본 spec 범위 = 구현 완료된 순수 FE 분(db_change 없음):
 *   - AC-3: 약 종류(투여경로) 색상 구분 도트 — route(경구/외용/주사) → 색상 매핑
 *   - AC-4: 처방내역 컬럼 분리(약이름+용량 | 횟수 | 일수) + 행별 횟수·일수 직접 조정(인라인 편집)
 *           frequency/days 는 PrescriptionItem 에 이미 분리 필드로 존재 → 순수 FE,
 *           DB 모델/데이터 이관 불요.
 *
 * 범위 외(별도 트랙):
 *   - AC-1(처방세트 폴더링), AC-2(금기증 팝업), AC-5(약 직접검색) → spec-investigation/supervisor 이관.
 *
 * 검증 전략: SUPABASE_SERVICE_ROLE_KEY 로 customer 1건 + prescription_set 1건(서로 다른 route 약 3개)
 *   결정론적 seed → /chart/:id 진료차트 Drawer 오픈 → 세트 1회 클릭으로 처방내역 3행 적재 →
 *   (AC-3) route 도트 색상 검증, (AC-4) 횟수/일수 인라인 편집 → 저장 → 재조회 영속 검증.
 *   SERVICE_KEY 없으면 환경 skip.
 *
 * 회귀: RX-SET-ACCUMULATE 누적 동작(세트 클릭 → 약 전체 일괄 추가)은 그대로 유지됨을 전제로 사용.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E처방개선${SUFFIX}`;
const SET_NAME = `E2E세트RX${SUFFIX}`;
// route 가 서로 다른 약 3개 — AC-3 색상 구분 검증용
const DRUG_PO = `E2E경구약_${SUFFIX}`; // route 경구 → teal
const DRUG_TOP = `E2E외용약_${SUFFIX}`; // route 외용 → amber
const DRUG_INJ = `E2E주사약_${SUFFIX}`; // route 주사 → rose

function mkItem(name: string, route: string) {
  return { name, dosage: '1정', route, frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  customerId: string;
  setId: number;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/** 진료차트 Drawer 오픈 + 처방세트 1회 클릭으로 처방내역 3행 적재 */
async function openChartWithRx(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
  // 세트 1회 클릭 → 약 3개 일괄 적재
  await page.getByTestId('rx-set-option').filter({ hasText: SET_NAME }).first().click();
  await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
  await expect(rxRows(page)).toHaveCount(3);
}

function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

test.describe('T-20260603 RX-CHART-ENHANCE — 처방내역 색상 구분 + 컬럼 분리/인라인 편집', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    const { data: cust, error: cErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82108${SUFFIX}` })
      .select('id').single();
    if (cErr || !cust) throw new Error(`customer seed 실패: ${cErr?.message}`);

    const { data: set, error: sErr } = await admin.from('prescription_sets')
      .insert({
        name: SET_NAME,
        items: [mkItem(DRUG_PO, '경구'), mkItem(DRUG_TOP, '외용'), mkItem(DRUG_INJ, '주사')],
        is_active: true,
        sort_order: 9101,
      })
      .select('id').single();
    if (sErr || !set) throw new Error(`prescription_set seed 실패: ${sErr?.message}`);

    seed = { clinicId, customerId: cust.id as string, setId: set.id as number };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().eq('id', seed.setId);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-3: 약 종류(투여경로) 색상 구분 도트 ─────────────────────────────────────
  test('AC-3: route(경구/외용/주사)별로 색상 도트가 다르게 표시된다', async ({ page }) => {
    await openChartWithRx(page, seed!.customerId);

    const dot0 = page.getByTestId('rx-route-dot-0');
    const dot1 = page.getByTestId('rx-route-dot-1');
    const dot2 = page.getByTestId('rx-route-dot-2');
    await expect(dot0).toBeVisible();
    await expect(dot1).toBeVisible();
    await expect(dot2).toBeVisible();

    // 경구=teal, 외용=amber, 주사=rose — 클래스로 색상 구분 검증
    await expect(dot0).toHaveClass(/bg-teal-500/);
    await expect(dot1).toHaveClass(/bg-amber-500/);
    await expect(dot2).toHaveClass(/bg-rose-500/);
    // 셋의 색상 클래스가 서로 달라야 함 (구분 표시 성립)
    await expect(dot0).not.toHaveClass(/bg-amber-500/);
    await expect(dot2).not.toHaveClass(/bg-teal-500/);
  });

  // ── AC-4: 컬럼 분리 + 약이름(용량 포함) 표시 ──────────────────────────────────
  test('AC-4: 약이름(용량) | 횟수 | 일수 컬럼 분리 + 용량이 약이름 셀에 포함', async ({ page }) => {
    await openChartWithRx(page, seed!.customerId);
    const table = page.getByTestId('prescription-items-table');

    // 헤더에 횟수/일수 컬럼 존재
    await expect(table.locator('thead')).toContainText('횟수');
    await expect(table.locator('thead')).toContainText('일수');
    // 약이름 셀에 약명 + 용량(1정) 함께 표시
    await expect(table).toContainText(DRUG_PO);
    await expect(table).toContainText('1정');
    // 횟수/일수가 input 으로 제공 (행별 직접 조정 가능)
    await expect(page.getByTestId('rx-frequency-0')).toBeVisible();
    await expect(page.getByTestId('rx-days-0')).toBeVisible();
  });

  // ── AC-4: 행별 횟수·일수 직접 조정 → 저장 → 재조회 영속 ────────────────────────
  test('AC-4: 횟수·일수 인라인 편집 → 저장 → 새로고침 후에도 유지', async ({ page }) => {
    await openChartWithRx(page, seed!.customerId);

    // 0번 행 횟수=1일1회, 일수=10 으로 직접 수정
    const freq0 = page.getByTestId('rx-frequency-0');
    const days0 = page.getByTestId('rx-days-0');
    await freq0.fill('1일1회');
    await days0.fill('10');
    await expect(freq0).toHaveValue('1일1회');
    await expect(days0).toHaveValue('10');

    // 저장
    const saveBtn = page.getByTestId('medical-chart-save-btn');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 });

    // 재조회 — 좌측 타임라인 엔트리 로드 후 편집값 복원 확인
    await openChartWithRx(page, seed!.customerId); // 신규폼 리셋 회피용으로 타임라인 사용
    const entry = page.getByTestId('medical-chart-timeline-entry').first();
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await entry.locator('button').first().click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 10_000 });
    // 저장된 차트는 약 3건 — 0번 행 편집값 유지
    await expect(page.getByTestId('rx-frequency-0')).toHaveValue('1일1회');
    await expect(page.getByTestId('rx-days-0')).toHaveValue('10');
  });
});
