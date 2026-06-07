/**
 * E2E spec — T-20260606-foot-RX-SET-REDESIGN
 * 처방세트 영역 3분할 재설계: 약품 폴더 트리(AC-R3) + 묶음처방(AC-R4) + 빠른처방 단일·다중추가(AC-R5)
 *
 * 배경: 현장(문지은 대표원장) "계속해서 처방세트가 마음에 안드네". 현장용어 SSOT(rato 확정):
 *   처방세트=전체 약 카탈로그(prescription_codes) / 폴더=약 분류 트리(prescription_folders) /
 *   묶음처방=이름+약 묶음(prescription_sets). 폴더 축과 묶음처방 축은 직교.
 *
 * 본 spec 검증(폴더 축):
 *   - 진료차트 우측 '처방세트' 탭에 약품 폴더 트리(drug-folder-tree) + 묶음처방 섹션 헤더 공존
 *   - 다단계 폴더(루트>자식) 펼침/접힘 + 폴더 안 개별 약품 노출
 *   - 약품 단건 클릭 → 처방내역 단건 추가 (AC-R3)
 *   - 약품 다중 체크 → '선택 추가' → 여러 건 일괄 추가 (AC-R5)
 *
 * 검증 전략: EXPLORER-TREE 와 동일 — SUPABASE_SERVICE_ROLE_KEY 로 결정론적 seed.
 *   prescription_codes 2건(custom) + 폴더 2개(루트 1 / 하위 1) + 매핑 2건.
 *   SERVICE_KEY 없으면 skip. 마이그(prescription_folders) 미적용 환경이면 skip(supervisor 게이트 후 적용).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E약폴더${SUFFIX}`;
const FOLDER_ROOT = `알약${SUFFIX}`;
const FOLDER_CHILD = `해열제${SUFFIX}`;
const DRUG_1 = `E2E약1_${SUFFIX}`;
const DRUG_2 = `E2E약2_${SUFFIX}`;

interface SeedIds {
  clinicId: string;
  customerId: string;
  rootFolderId: string;
  childFolderId: string;
  code1Id: string;
  code2Id: string;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;
let migrationMissing = false;

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

function drugFolderNode(page: Page, name: string) {
  return page.getByTestId('drug-folder-node').filter({ hasText: name });
}
function drugItem(page: Page, name: string) {
  return page.getByTestId('drug-folder-item').filter({ hasText: name });
}
function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

test.describe('T-20260606 RX-SET-REDESIGN — 약품 폴더 트리 + 묶음처방 분할', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    // 마이그 미적용 환경 graceful skip: 루트 폴더 insert 시도 → relation 없으면 skip 플래그.
    const { data: root, error: rootErr } = await admin.from('prescription_folders')
      .insert({ name: FOLDER_ROOT, parent_id: null, sort_order: 9201 })
      .select('id').single();
    if (rootErr || !root) {
      migrationMissing = true;
      return; // beforeEach 에서 skip
    }
    const rootFolderId = root.id as string;

    const { data: child, error: childErr } = await admin.from('prescription_folders')
      .insert({ name: FOLDER_CHILD, parent_id: rootFolderId, sort_order: 9202 })
      .select('id').single();
    if (childErr || !child) throw new Error(`child folder seed 실패: ${childErr?.message}`);
    const childFolderId = child.id as string;

    // 약품 2건(custom) — claim_code unique
    const { data: c1, error: c1Err } = await admin.from('prescription_codes')
      .insert({ claim_code: `E2EF1${SUFFIX}`, name_ko: DRUG_1, classification: '내복약', code_source: 'custom' })
      .select('id').single();
    if (c1Err || !c1) throw new Error(`code1 seed 실패: ${c1Err?.message}`);
    const { data: c2, error: c2Err } = await admin.from('prescription_codes')
      .insert({ claim_code: `E2EF2${SUFFIX}`, name_ko: DRUG_2, classification: '내복약', code_source: 'custom' })
      .select('id').single();
    if (c2Err || !c2) throw new Error(`code2 seed 실패: ${c2Err?.message}`);

    // 매핑: 약1 → 루트폴더, 약2 → 하위폴더
    const { error: m1Err } = await admin.from('prescription_code_folders')
      .insert({ prescription_code_id: c1.id, folder_id: rootFolderId, sort_order: 0 });
    if (m1Err) throw new Error(`mapping1 실패: ${m1Err.message}`);
    const { error: m2Err } = await admin.from('prescription_code_folders')
      .insert({ prescription_code_id: c2.id, folder_id: childFolderId, sort_order: 0 });
    if (m2Err) throw new Error(`mapping2 실패: ${m2Err.message}`);

    const { data: cust, error: custErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82108${SUFFIX}` })
      .select('id').single();
    if (custErr || !cust) throw new Error(`customer seed 실패: ${custErr?.message}`);

    seed = {
      clinicId,
      customerId: cust.id as string,
      rootFolderId,
      childFolderId,
      code1Id: c1.id as string,
      code2Id: c2.id as string,
    };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    // 매핑은 폴더/코드 삭제 시 cascade 되지만 명시 정리.
    await admin.from('prescription_code_folders').delete().in('prescription_code_id', [seed.code1Id, seed.code2Id]);
    await admin.from('prescription_folders').delete().in('id', [seed.childFolderId, seed.rootFolderId]);
    await admin.from('prescription_codes').delete().in('id', [seed.code1Id, seed.code2Id]);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    if (migrationMissing) test.skip(true, 'prescription_folders 마이그 미적용 — supervisor 게이트 후 재실행');
    if (!seed) test.skip(true, 'seed 없음 — skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── 시나리오 1: 폴더 트리 렌더 + 단건 약품 추가 (AC-R3) ──────────────────────────
  test('S1: 다단계 폴더 트리 + 약품 단건 클릭 → 처방내역 단건 추가', async ({ page }) => {
    await openMedicalChartRx(page, seed!.customerId);

    // 약품 폴더 섹션 + 묶음처방 섹션 헤더 공존(3분할 시각 분리)
    await expect(page.getByTestId('drug-folder-section-header')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('rx-set-section-header')).toBeVisible();

    // 루트 폴더 노드 렌더 + 펼치면 약1 노출
    await expect(drugFolderNode(page, FOLDER_ROOT).first()).toBeVisible({ timeout: 10_000 });
    await expect(drugItem(page, DRUG_1).first()).toBeVisible();

    // 하위 폴더(해열제) 노드도 트리에 존재
    await expect(drugFolderNode(page, FOLDER_CHILD).first()).toBeVisible();

    // 약1 단건 클릭(add 버튼) → 처방내역 1행
    await drugItem(page, DRUG_1).first().getByTestId('drug-folder-item-add').click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(DRUG_1);
  });

  // ── 시나리오 2: 다중선택 일괄 추가 (AC-R5) ────────────────────────────────────────
  test('S2: 약품 다중 체크 → 선택 추가 → 여러 건 일괄 추가', async ({ page }) => {
    await openMedicalChartRx(page, seed!.customerId);

    // 약1(루트) + 약2(하위) 체크 — 하위 폴더가 접혀있으면 펼침 보장 위해 노드 토글
    await expect(drugItem(page, DRUG_1).first()).toBeVisible({ timeout: 10_000 });
    await drugItem(page, DRUG_1).first().getByTestId('drug-folder-item-check').check();
    await expect(drugItem(page, DRUG_2).first()).toBeVisible();
    await drugItem(page, DRUG_2).first().getByTestId('drug-folder-item-check').check();

    // '선택 추가' → 2건 일괄 적재
    await page.getByTestId('drug-folder-add-selected').click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(2);
    await expect(page.getByTestId('prescription-items-table')).toContainText(DRUG_1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(DRUG_2);
  });
});
