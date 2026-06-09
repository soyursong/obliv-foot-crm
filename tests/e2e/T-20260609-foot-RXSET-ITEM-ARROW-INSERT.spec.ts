/**
 * E2E spec — T-20260609-foot-RXSET-ITEM-ARROW-INSERT
 * 진료차트 우측 '처방세트' 탭 약품 폴더 항목 좌측 `<`(ChevronLeft) compact 즉시삽입 버튼.
 *
 * 변경 요지:
 *   - DrugFolderTree 각 약품 항목 좌측에 `<` 버튼(drug-folder-item-arrow, w-5 ≤ w-6) 추가 →
 *     클릭 시 기존 onAdd([단건]) 삽입 로직 재사용 → 즉시 좌측 처방내역 삽입.
 *   - 기존 체크박스 다중선택 + '선택 추가'(drug-folder-add-selected) bulk UI 제거/숨김.
 *   - 묶음처방(prescription_sets) 다중약 일괄삽입(loadPrescriptionSet) GUARD는 그대로 유지
 *     (PrescriptionSetTreePicker 미변경 → QuickRxBar 공용 컴포넌트 영향 없음).
 *   순수 FE (db_change:false). prescription_sets.items(JSONB)는 이미 다중약 배열 지원.
 *
 * 검증 전략: SUPABASE_SERVICE_ROLE_KEY 로 결정론적 seed.
 *   폴더 1개 + 약품 1건(폴더 매핑) + 묶음처방 1건(약 2개). SERVICE_KEY 없으면 환경 skip.
 *   prescription_folders 마이그 미적용 환경이면 폴더 시드 실패 → S1 graceful skip.
 *
 * S1 (정상 1클릭 삽입): 약품 좌측 `<` 버튼 클릭 → 처방내역 1행 + 'bulk UI 부재' GUARD.
 * S2 (다중약 세트 일괄삽입 GUARD): 묶음처방(약 2개) 1회 클릭 → 세트 내 약 전체(2행) 일괄 적재.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E처방화살${SUFFIX}`;
const FOLDER_ROOT = `폴더${SUFFIX}`;
const DRUG_1 = `E2E화살약1_${SUFFIX}`;
const SET_NAME = `E2E세트${SUFFIX}`;
const SET_DRUG_1 = `E2E세트약1_${SUFFIX}`;
const SET_DRUG_2 = `E2E세트약2_${SUFFIX}`;

function mkItem(name: string) {
  return { name, dosage: '1정', route: 'PO', frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  customerId: string;
  rootFolderId: string | null;
  code1Id: string | null;
  setId: number;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;
let folderSeedMissing = false;

/** 진료차트 Drawer 오픈 → 우측 '처방세트' 탭 활성 */
async function openMedicalChartRx(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
}

/** 묶음처방 폴더 펼치기 (기본 전체 접힘 — seed 세트는 folder 미지정 → '미분류' 귀속). */
async function expandRxFolder(page: Page, folderName: string): Promise<void> {
  const toggle = page.getByTestId('rx-set-folder-toggle').filter({ hasText: folderName }).first();
  await toggle.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

function drugItem(page: Page, name: string) {
  return page.getByTestId('drug-folder-item').filter({ hasText: name });
}
function rxSetOption(page: Page, setName: string) {
  return page.getByTestId('rx-set-option').filter({ hasText: setName });
}
function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

test.describe('T-20260609 RXSET-ITEM-ARROW-INSERT — `<` 즉시삽입 + 세트 일괄삽입 GUARD', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    const { data: cust, error: custErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82109${SUFFIX}` })
      .select('id').single();
    if (custErr || !cust) throw new Error(`customer seed 실패: ${custErr?.message}`);

    // 묶음처방(약 2개) — S2 GUARD 검증용. items(JSONB) 다중약 배열.
    const { data: set, error: setErr } = await admin.from('prescription_sets')
      .insert({ name: SET_NAME, items: [mkItem(SET_DRUG_1), mkItem(SET_DRUG_2)], is_active: true, sort_order: 9301 })
      .select('id').single();
    if (setErr || !set) throw new Error(`prescription_set seed 실패: ${setErr?.message}`);

    // 약품 폴더 + 약품 1건(매핑) — S1 화살표 즉시삽입 검증용.
    //   prescription_folders 마이그 미적용 환경이면 graceful skip 플래그.
    let rootFolderId: string | null = null;
    let code1Id: string | null = null;
    const { data: root, error: rootErr } = await admin.from('prescription_folders')
      .insert({ name: FOLDER_ROOT, parent_id: null, sort_order: 9301 })
      .select('id').single();
    if (rootErr || !root) {
      folderSeedMissing = true;
    } else {
      rootFolderId = root.id as string;
      const { data: c1, error: c1Err } = await admin.from('prescription_codes')
        .insert({ claim_code: `E2EA1${SUFFIX}`, name_ko: DRUG_1, classification: '내복약', code_source: 'custom' })
        .select('id').single();
      if (c1Err || !c1) throw new Error(`code1 seed 실패: ${c1Err?.message}`);
      code1Id = c1.id as string;
      const { error: mErr } = await admin.from('prescription_code_folders')
        .insert({ prescription_code_id: c1.id, folder_id: rootFolderId, sort_order: 0 });
      if (mErr) throw new Error(`mapping 실패: ${mErr.message}`);
    }

    seed = {
      clinicId,
      customerId: cust.id as string,
      rootFolderId,
      code1Id,
      setId: set.id as number,
    };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    if (seed.code1Id) {
      await admin.from('prescription_code_folders').delete().eq('prescription_code_id', seed.code1Id);
      await admin.from('prescription_codes').delete().eq('id', seed.code1Id);
    }
    if (seed.rootFolderId) await admin.from('prescription_folders').delete().eq('id', seed.rootFolderId);
    await admin.from('prescription_sets').delete().eq('id', seed.setId);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    if (!seed) test.skip(true, 'seed 없음 — skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── S1: 정상 1클릭 삽입 — 약품 좌측 `<` 버튼 ──────────────────────────────────────
  test('S1: 약품 좌측 `<` 버튼 클릭 → 처방내역 1행 즉시 삽입 + bulk UI 부재', async ({ page }) => {
    if (folderSeedMissing) test.skip(true, 'prescription_folders 마이그 미적용 — supervisor 게이트 후 재실행');
    await openMedicalChartRx(page, seed!.customerId);

    // 좌측 `<` 즉시삽입 버튼 노출 + 클릭 → 1행 적재
    const arrow = drugItem(page, DRUG_1).first().getByTestId('drug-folder-item-arrow');
    await expect(arrow).toBeVisible({ timeout: 10_000 });
    await arrow.click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(DRUG_1);

    // GUARD: 제거된 bulk UI(체크박스 / '선택 추가' 버튼)는 더 이상 존재하지 않음
    await expect(page.getByTestId('drug-folder-add-selected')).toHaveCount(0);
    await expect(drugItem(page, DRUG_1).first().getByTestId('drug-folder-item-check')).toHaveCount(0);
  });

  // ── S2: 다중약 세트 일괄삽입 GUARD — 묶음처방(약 2개) 1회 클릭 ─────────────────────
  test('S2: 묶음처방(약 2개) 1회 클릭 → 세트 내 약 전체(2행) 일괄 적재 유지', async ({ page }) => {
    await openMedicalChartRx(page, seed!.customerId);
    // seed 세트(folder 미지정 → '미분류') 폴더 펼침 후 옵션 클릭.
    await expandRxFolder(page, '미분류');

    await rxSetOption(page, SET_NAME).first().click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    // 첫 항목만 X — 세트 내 약 2개 전부 적재(GUARD).
    await expect(rxRows(page)).toHaveCount(2);
    await expect(page.getByTestId('prescription-items-table')).toContainText(SET_DRUG_1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(SET_DRUG_2);
  });
});
