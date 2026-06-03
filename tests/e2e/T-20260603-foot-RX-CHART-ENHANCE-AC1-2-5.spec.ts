/**
 * E2E spec — T-20260603-foot-RX-CHART-ENHANCE (AC-1/AC-2/AC-5 분)
 *   (구 T-20260603-foot-RX-MODULE-8REQ — superseded·RX-CHART-ENHANCE로 흡수. 정본 경로로 이관됨)
 *
 * 본 spec 범위 = 이번 세션 완성분(UI 와이어링 + DB additive 마이그 적용 후):
 *   - #1 / AC-1: 처방세트 폴더링 — prescription_sets.folder 로 그룹핑(폴더 헤더 + 건수 배지)
 *   - #2 / AC-2: 약품 금기증 확인 게이트 — prescription_code_id 매칭 금기증 보유 약 추가 시
 *               확인 모달(전체 체크 후에만 진행, 우회불가). 의료안전 직결.
 *   - #5 / AC-5: 약품 마스터(prescription_codes) 검색 → 단건 처방내역 추가(내부 마스터 대상).
 *
 * 범위 외(별도 트랙 / FOLLOWUP):
 *   - #3/#4/#6 → 선행 커밋(RX-CHART-ENHANCE AC-3/AC-4, CHART-UIUX-ENHANCE)에서 검증됨.
 *   - #2 금기증 "등록" admin UI / #7 슈퍼상용구 → 후속 FOLLOWUP.
 *   - #8 처방전 인쇄 → 기존 구현(rx_standard + RX-PRINT-DUAL) 재사용, 신규 spec 불요.
 *
 * 검증 전략: SERVICE_KEY 로 결정론적 seed.
 *   codeClean(금기 없음) / codeContra(금기 1건) prescription_codes(custom) +
 *   setGate(codeContra 1약) + 폴더 세트 2건.
 *   SERVICE_KEY 없으면 환경 skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2ERX모듈${SUFFIX}`;
const NAME_CLEAN = `E2E검색약클린${SUFFIX}`;
const NAME_CONTRA = `E2E금기약${SUFFIX}`;
const FOLDER = `E2E폴더${SUFFIX}`;
const SET_GATE = `E2E게이트세트${SUFFIX}`;
const SET_FOLDER_A = `E2E폴더세트A${SUFFIX}`;
const SET_FOLDER_B = `E2E폴더세트B${SUFFIX}`;
const CONTRA_TEXT = `E2E금기내용${SUFFIX}: 간기능 저하 환자 금기`;

interface SeedIds {
  clinicId: string;
  customerId: string;
  codeCleanId: string;
  codeContraId: string;
  contraId: string;
  setGateId: number;
  setFolderAId: number;
  setFolderBId: number;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

/** 진료차트 Drawer 오픈 + 처방세트 탭 활성 */
async function openChartRxTab(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
}

test.describe('T-20260603 RX-CHART-ENHANCE — 폴더링(AC-1) · 금기게이트(AC-2) · 마스터검색(AC-5)', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    const { data: cust, error: cErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82107${SUFFIX}` })
      .select('id').single();
    if (cErr || !cust) throw new Error(`customer seed 실패: ${cErr?.message}`);

    // 약품 마스터(custom) 2건 — claim_code 충돌 회피 위해 SUFFIX 사용
    const { data: codes, error: codeErr } = await admin.from('prescription_codes')
      .insert([
        { claim_code: `E2EC${SUFFIX}`, name_ko: NAME_CLEAN, classification: '외용약', code_source: 'custom' },
        { claim_code: `E2EG${SUFFIX}`, name_ko: NAME_CONTRA, classification: '내복약', code_source: 'custom' },
      ])
      .select('id, name_ko');
    if (codeErr || !codes || codes.length < 2) throw new Error(`prescription_codes seed 실패: ${codeErr?.message}`);
    const codeCleanId = codes.find(c => c.name_ko === NAME_CLEAN)!.id as string;
    const codeContraId = codes.find(c => c.name_ko === NAME_CONTRA)!.id as string;

    // codeContra 에 금기증 1건
    const { data: contra, error: contraErr } = await admin.from('prescription_contraindications')
      .insert({ prescription_code_id: codeContraId, contraindication_text: CONTRA_TEXT, severity: '금기' })
      .select('id').single();
    if (contraErr || !contra) throw new Error(`contraindication seed 실패: ${contraErr?.message}`);

    // 게이트 세트(codeContra 1약, prescription_code_id 보유)
    const { data: setG, error: sgErr } = await admin.from('prescription_sets')
      .insert({
        name: SET_GATE,
        items: [{ name: NAME_CONTRA, dosage: '1정', route: '경구', frequency: '1일3회', days: 3, notes: '', prescription_code_id: codeContraId, classification: '내복약' }],
        is_active: true, sort_order: 9201,
      }).select('id').single();
    if (sgErr || !setG) throw new Error(`setGate seed 실패: ${sgErr?.message}`);

    // 폴더 세트 2건(동일 folder)
    const { data: setA, error: saErr } = await admin.from('prescription_sets')
      .insert({ name: SET_FOLDER_A, folder: FOLDER, items: [{ name: '폴더약A', dosage: '1정', route: '경구', frequency: '1일3회', days: 3, notes: '' }], is_active: true, sort_order: 9202 })
      .select('id').single();
    if (saErr || !setA) throw new Error(`setFolderA seed 실패: ${saErr?.message}`);
    const { data: setB, error: sbErr } = await admin.from('prescription_sets')
      .insert({ name: SET_FOLDER_B, folder: FOLDER, items: [{ name: '폴더약B', dosage: '1정', route: '외용', frequency: '1일1회', days: 5, notes: '' }], is_active: true, sort_order: 9203 })
      .select('id').single();
    if (sbErr || !setB) throw new Error(`setFolderB seed 실패: ${sbErr?.message}`);

    seed = {
      clinicId, customerId: cust.id as string,
      codeCleanId, codeContraId, contraId: contra.id as string,
      setGateId: setG.id as number, setFolderAId: setA.id as number, setFolderBId: setB.id as number,
    };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().in('id', [seed.setGateId, seed.setFolderAId, seed.setFolderBId]);
    await admin.from('prescription_contraindications').delete().eq('id', seed.contraId);
    await admin.from('prescription_codes').delete().in('id', [seed.codeCleanId, seed.codeContraId]);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── #5 / AC-5: 약품 마스터 검색 → 단건 추가 (금기 없는 약 → 게이트 미발동) ──────────
  test('AC-5: 약품명 검색 → 결과 클릭 → 처방내역에 단건 추가', async ({ page }) => {
    await openChartRxTab(page, seed!.customerId);

    const search = page.getByTestId('rx-search-input');
    await expect(search).toBeVisible();
    await search.fill(NAME_CLEAN);

    const result = page.getByTestId('rx-search-result-item').filter({ hasText: NAME_CLEAN });
    await expect(result.first()).toBeVisible({ timeout: 8_000 });
    // custom 코드 → '자체' 배지 노출
    await expect(result.first()).toContainText('자체');
    await result.first().click();

    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('prescription-items-table')).toContainText(NAME_CLEAN);
    await expect(rxRows(page)).toHaveCount(1);
  });

  // ── #2 / AC-2: 금기증 보유 약 추가 시 확인 게이트 (우회불가) ──────────────────────
  test('AC-2: 금기약 세트 추가 → 게이트 모달 → 전체 체크 후에만 추가', async ({ page }) => {
    await openChartRxTab(page, seed!.customerId);

    // 게이트 세트 클릭 → 금기증 매칭 → 모달 발동
    await page.getByTestId('rx-set-option').filter({ hasText: SET_GATE }).first().click();
    const gate = page.getByTestId('rx-contra-gate');
    await expect(gate).toBeVisible({ timeout: 8_000 });
    await expect(gate).toContainText(CONTRA_TEXT);

    // 체크 전 — 확인 버튼 비활성 + 처방내역 미적재
    const confirm = page.getByTestId('rx-contra-confirm');
    await expect(confirm).toBeDisabled();

    // 금기 항목 체크 → 확인 활성화
    await page.getByTestId('rx-contra-ack').first().check();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // 게이트 닫힘 + 처방 적재
    await expect(gate).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId('prescription-items-table')).toContainText(NAME_CONTRA);
  });

  // ── #2 / AC-2: 게이트 취소 시 처방 미적재 ─────────────────────────────────────────
  test('AC-2: 게이트에서 "처방 취소" 시 처방내역에 추가되지 않음', async ({ page }) => {
    await openChartRxTab(page, seed!.customerId);
    await page.getByTestId('rx-set-option').filter({ hasText: SET_GATE }).first().click();
    const gate = page.getByTestId('rx-contra-gate');
    await expect(gate).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('rx-contra-cancel').click();
    await expect(gate).toBeHidden({ timeout: 5_000 });
    // 처방내역 테이블 미생성(빈 상태) 또는 금기약 미포함
    await expect(page.getByTestId('prescription-items-table')).toHaveCount(0);
  });

  // ── #1 / AC-1: 처방세트 폴더링 (admin 처방세트 탭) ────────────────────────────────
  test('AC-1: 동일 folder 세트가 폴더 그룹으로 묶여 표시된다', async ({ page }) => {
    await page.goto('/doctor-tools');
    // 처방세트 탭은 admin/manager 전용 — 테스트 유저 권한 부족 시 환경 skip
    const rxTab = page.getByRole('tab', { name: '처방세트' });
    const hasTab = await rxTab.isVisible().catch(() => false);
    if (!hasTab) test.skip(true, '처방세트 탭(admin/manager 전용) 미노출 — 테스트 유저 권한 부족, 환경 skip');
    await rxTab.click();
    await expect(page.getByTestId('rx-set-list')).toBeVisible({ timeout: 10_000 });

    // 폴더 헤더 노출 + 해당 폴더 그룹에 A/B 세트 포함
    const folderName = page.getByTestId('rx-set-folder-name').filter({ hasText: FOLDER });
    await expect(folderName.first()).toBeVisible({ timeout: 8_000 });
    const group = page.getByTestId('rx-set-folder-group').filter({ hasText: FOLDER });
    await expect(group).toContainText(SET_FOLDER_A);
    await expect(group).toContainText(SET_FOLDER_B);
  });
});
