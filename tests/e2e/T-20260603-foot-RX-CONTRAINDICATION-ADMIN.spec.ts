/**
 * E2E spec — T-20260603-foot-RX-CONTRAINDICATION-ADMIN
 *   (RX-MODULE-8REQ #2 잔여분 — 금기증 "등록" admin UI)
 *
 * 범위:
 *   - AC-1: DoctorTools "금기증 관리" 탭(admin 한정) — 약품코드 검색→선택→금기증 등록
 *   - AC-2: CRUD (등록·수정·삭제), severity nullable, created_by 자동
 *   - AC-3: 등록 후 → 진료차트 처방 시 확인 게이트 end-to-end 발동
 *   - 시나리오 2(권한 격리): 탭 미노출 환경 skip 처리(테스트 유저 권한 고정)
 *
 * 검증 전략: SERVICE_KEY 로 결정론적 seed.
 *   codeTarget(custom 약품 1건, 금기증 없음 상태로 시작) + customer 1건.
 *   UI 에서 금기증을 직접 등록 → 목록 확인 → 차트에서 게이트 발동 확인.
 *   SERVICE_KEY 없으면 환경 skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E금기등록${SUFFIX}`;
const DRUG_NAME = `E2E금기등록약${SUFFIX}`;
const CONTRA_TEXT = `E2E등록금기${SUFFIX}: 위장관 출혈 병력 환자 금기`;
const CONTRA_TEXT_EDITED = `${CONTRA_TEXT} (수정)`;

interface SeedIds {
  clinicId: string;
  customerId: string;
  codeId: string;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/** 금기증 관리 탭 진입 (admin 한정 — 미노출 시 환경 skip) */
async function openContraTab(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/doctor-tools');
  const tab = page.getByTestId('tab-contraindications');
  const visible = await tab.isVisible().catch(() => false);
  if (!visible) return false;
  await tab.click();
  await expect(page.getByTestId('contraindications-tab')).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe('T-20260603 RX-CONTRAINDICATION-ADMIN — 금기증 등록 admin 탭', () => {
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

    // 금기증 "없는" custom 약품 1건 — 본 spec UI 에서 직접 금기증을 등록한다.
    const { data: code, error: codeErr } = await admin.from('prescription_codes')
      .insert({ claim_code: `E2EA${SUFFIX}`, name_ko: DRUG_NAME, classification: '내복약', code_source: 'custom' })
      .select('id').single();
    if (codeErr || !code) throw new Error(`prescription_codes seed 실패: ${codeErr?.message}`);

    seed = { clinicId, customerId: cust.id as string, codeId: code.id as string };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    // 테스트 중 등록된 금기증 일괄 정리(FK CASCADE 도 있으나 명시 삭제)
    await admin.from('prescription_contraindications').delete().eq('prescription_code_id', seed.codeId);
    await admin.from('prescription_codes').delete().eq('id', seed.codeId);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1 + AC-2: 약품 검색 → 선택 → 금기증 등록 → 목록 확인 ─────────────────────────
  test('AC-1/2: 약품 검색 → 선택 → 금기증 등록 → 목록 표시', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭(admin 전용) 미노출 — 테스트 유저 권한 부족, 환경 skip');

    // 약품 검색 → 결과 클릭
    await page.getByTestId('contra-drug-search-input').fill(DRUG_NAME);
    const result = page.getByTestId('contra-drug-result-item').filter({ hasText: DRUG_NAME });
    await expect(result.first()).toBeVisible({ timeout: 8_000 });
    await result.first().click();

    // 선택 패널 노출 + 선택 약품명 확인
    await expect(page.getByTestId('contra-selected-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('contra-selected-name')).toContainText(DRUG_NAME);

    // 금기증 등록 다이얼로그 (AC-3 CONTRAINDICATION-MGMT: severity 드롭다운 → 버튼 토글)
    await page.getByTestId('contra-add-btn').click();
    await page.getByTestId('contra-severity-btn-금기').click();
    await page.getByTestId('contra-text-input').fill(CONTRA_TEXT);
    await page.getByTestId('contra-save-btn').click();

    // 목록에 등록 행 표시
    const item = page.getByTestId('contra-item').filter({ hasText: CONTRA_TEXT });
    await expect(item.first()).toBeVisible({ timeout: 8_000 });
    await expect(item.first()).toContainText('금기'); // severity 배지
  });

  // ── AC-2: 수정 → 삭제 ───────────────────────────────────────────────────────────
  test('AC-2: 등록된 금기증 수정 후 삭제', async ({ page }) => {
    // seed: 금기증 1건 직접 삽입(독립 테스트 보장)
    if (admin && seed) {
      await admin.from('prescription_contraindications')
        .insert({ prescription_code_id: seed.codeId, contraindication_text: CONTRA_TEXT, severity: '주의' });
    }
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭 미노출 — 환경 skip');

    await page.getByTestId('contra-drug-search-input').fill(DRUG_NAME);
    await page.getByTestId('contra-drug-result-item').filter({ hasText: DRUG_NAME }).first().click();
    await expect(page.getByTestId('contra-selected-panel')).toBeVisible({ timeout: 5_000 });

    // 수정
    const row = page.getByTestId('contra-item').filter({ hasText: CONTRA_TEXT }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.getByTestId('contra-edit-btn').click();
    await page.getByTestId('contra-text-input').fill(CONTRA_TEXT_EDITED);
    await page.getByTestId('contra-save-btn').click();
    await expect(page.getByTestId('contra-item').filter({ hasText: CONTRA_TEXT_EDITED }).first())
      .toBeVisible({ timeout: 8_000 });

    // 삭제 (confirm 자동 수락)
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('contra-item').filter({ hasText: CONTRA_TEXT_EDITED }).first()
      .getByTestId('contra-delete-btn').click();
    await expect(page.getByTestId('contra-item').filter({ hasText: CONTRA_TEXT_EDITED }))
      .toHaveCount(0, { timeout: 8_000 });
  });

  // ── AC-3: 등록한 금기증 → 진료차트 처방 시 게이트 발동 (end-to-end) ────────────────
  test('AC-3: 등록 금기증 → 차트 처방 검색 추가 시 확인 게이트 발동', async ({ page }) => {
    // 금기증 직접 seed(게이트 발동 소스)
    if (admin && seed) {
      await admin.from('prescription_contraindications')
        .insert({ prescription_code_id: seed.codeId, contraindication_text: CONTRA_TEXT, severity: '금기' });
    }
    // 차트 진입 → 처방 탭 → 약품 검색 → 추가 → 게이트 발동
    await page.goto(`/chart/${seed!.customerId}`);
    const btn = page.getByTestId('btn-open-medical-chart');
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await btn.click();
    await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('right-panel-tab-rx').click();
    await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });

    const search = page.getByTestId('rx-search-input');
    await expect(search).toBeVisible();
    await search.fill(DRUG_NAME);
    const result = page.getByTestId('rx-search-result-item').filter({ hasText: DRUG_NAME });
    await expect(result.first()).toBeVisible({ timeout: 8_000 });
    await result.first().click();

    // 금기증 보유 → 확인 게이트 모달 발동 + 등록 문구 노출
    const gate = page.getByTestId('rx-contra-gate');
    await expect(gate).toBeVisible({ timeout: 8_000 });
    await expect(gate).toContainText(CONTRA_TEXT);
  });
});
