/**
 * E2E spec — T-20260615-foot-RX-WHITELIST-FOLDERTREE (Phase 1, DA Model B)
 * 진료차트 약품폴더트리(DrugFolderTree=prescription_codes arm) 처방 화이트리스트 overlay.
 *
 * ── 착지 순서(임상 안전) ─────────────────────────────────────────────────────────
 *   Phase 1(본 착수) = overlay 테이블 prescription_code_allowlist 신설 + FE enforcement
 *     **feature-flag OFF** ship. 플래그 OFF = 기존과 동일하게 폴더트리 전량 노출(무회귀, fail-OPEN).
 *   Phase 2(문지은 CONTENT confirm 후, planner 지시) = VITE_RX_ALLOWLIST_ENFORCEMENT='on' 재배포 →
 *     allowlist(enabled) 코드만 노출. 빌드타임 플래그라 런타임 오조작으로 켜지지 않음(임상 안전).
 *
 * ── 본 spec 범위 = Phase 1 무회귀 + fail-open 데이터증명 ──────────────────────────
 *   S1: enforcement OFF(default) 에서 폴더트리에 seed 약이 그대로 노출(전량 노출=무회귀).
 *   S2(deploy-tolerant): allowlist 테이블 실존 시 — seed 약을 **제외**한 allowlist 행을 넣어도
 *       enforcement OFF 라 폴더트리에 여전히 노출(fail-OPEN 데이터 증명). 테이블 부재면 graceful skip.
 *   ※ enforcement ON(AC-1 폴더트리 통제 / AC-2 묶음처방)의 렌더 제한 검증은 빌드타임 플래그 특성상
 *     별도 ON 빌드가 필요 → Phase 2 확인 대상(문지은 confirm 후). 본 spec 범위 밖.
 *
 * 검증 전략: SUPABASE_SERVICE_ROLE_KEY 로 결정론적 seed(폴더 1 + 약 1 매핑). SERVICE_KEY 없으면 skip.
 *   prescription_folders 마이그 미적용 환경이면 folderSeedMissing → S1/S2 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E화이트리스트${SUFFIX}`;
const FOLDER_ROOT = `WL폴더${SUFFIX}`;
const DRUG_1 = `E2EWL약1_${SUFFIX}`;

interface SeedIds {
  clinicId: string;
  customerId: string;
  rootFolderId: string | null;
  code1Id: string | null;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;
let folderSeedMissing = false;
let allowlistTableExists = false;

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

/** 폴더 트리에서 seed 폴더 펼치기(기본 접힘 가능) */
async function expandFolder(page: Page, name: string): Promise<void> {
  const toggle = page.getByTestId('drug-folder-toggle').filter({ hasText: name }).first();
  await toggle.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

function drugItem(page: Page, name: string) {
  return page.getByTestId('drug-folder-item').filter({ hasText: name });
}

test.describe('T-20260615 RX-WHITELIST-FOLDERTREE — Phase 1 무회귀(enforcement OFF, fail-open)', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    const { data: cust, error: custErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82108${SUFFIX}` })
      .select('id').single();
    if (custErr || !cust) throw new Error(`customer seed 실패: ${custErr?.message}`);

    let rootFolderId: string | null = null;
    let code1Id: string | null = null;
    const { data: root, error: rootErr } = await admin.from('prescription_folders')
      .insert({ name: FOLDER_ROOT, parent_id: null, sort_order: 9401 })
      .select('id').single();
    if (rootErr || !root) {
      folderSeedMissing = true;
    } else {
      rootFolderId = root.id as string;
      const { data: c1, error: c1Err } = await admin.from('prescription_codes')
        .insert({ claim_code: `E2EWL${SUFFIX}`, name_ko: DRUG_1, classification: '내복약', code_source: 'custom' })
        .select('id').single();
      if (c1Err || !c1) throw new Error(`code1 seed 실패: ${c1Err?.message}`);
      code1Id = c1.id as string;
      const { error: mErr } = await admin.from('prescription_code_folders')
        .insert({ prescription_code_id: c1.id, folder_id: rootFolderId, sort_order: 0 });
      if (mErr) throw new Error(`mapping 실패: ${mErr.message}`);

      // allowlist 테이블 실존 여부(Phase 1 적용 후엔 존재). S2 fail-open 데이터증명 게이트.
      //   seed 약을 **제외**한 다른(임의) 코드로 allowlist 행 1건 삽입 시도 →
      //   enforcement OFF 라 폴더트리엔 여전히 seed 약이 노출됨을 S2 에서 검증.
      const probe = await admin.from('prescription_code_allowlist').select('id').limit(1);
      allowlistTableExists = !probe.error;
      if (allowlistTableExists) {
        // seed 약과 다른 임의 코드 1건을 allowlist enabled 로 등록(= seed 약은 비-allowlist).
        const { data: other } = await admin.from('prescription_codes')
          .select('id').neq('id', code1Id).limit(1).single();
        if (other?.id) {
          await admin.from('prescription_code_allowlist')
            .upsert(
              { clinic_slug: CLINIC_SLUG, prescription_code_id: other.id, enabled: true, note: `E2E-WL-${SUFFIX}` },
              { onConflict: 'clinic_slug,prescription_code_id' },
            );
        }
      }
    }

    seed = { clinicId, customerId: cust.id as string, rootFolderId, code1Id };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    if (allowlistTableExists) {
      await admin.from('prescription_code_allowlist').delete().eq('note', `E2E-WL-${SUFFIX}`);
    }
    if (seed.code1Id) {
      await admin.from('prescription_code_folders').delete().eq('prescription_code_id', seed.code1Id);
      await admin.from('prescription_codes').delete().eq('id', seed.code1Id);
    }
    if (seed.rootFolderId) await admin.from('prescription_folders').delete().eq('id', seed.rootFolderId);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test('S1: enforcement OFF(default) → 폴더트리 seed 약 전량 노출(무회귀)', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 없음 — 환경 skip');
    test.skip(folderSeedMissing, 'prescription_folders 마이그 미적용 — folder seed 불가, graceful skip');
    if (!seed) return;

    await loginAndWaitForDashboard(page);
    await openMedicalChartRx(page, seed.customerId);
    await expect(page.getByTestId('drug-folder-tree')).toBeVisible({ timeout: 10_000 });
    await expandFolder(page, FOLDER_ROOT);
    // enforcement OFF → allowlist 필터 미적용 → seed 약이 그대로 노출(무회귀).
    await expect(drugItem(page, DRUG_1)).toBeVisible({ timeout: 10_000 });
  });

  test('S2: fail-open — allowlist 가 seed 약 제외해도 enforcement OFF 라 노출(deploy-tolerant)', async ({ page }) => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 없음 — 환경 skip');
    test.skip(folderSeedMissing, 'folder seed 불가 — graceful skip');
    test.skip(!allowlistTableExists, 'prescription_code_allowlist 미적용(Phase 1 pre-apply) — graceful skip');
    if (!seed) return;

    await loginAndWaitForDashboard(page);
    await openMedicalChartRx(page, seed.customerId);
    await expect(page.getByTestId('drug-folder-tree')).toBeVisible({ timeout: 10_000 });
    await expandFolder(page, FOLDER_ROOT);
    // seed 약은 allowlist 에 없지만(다른 코드만 enabled 등록), enforcement OFF → fail-OPEN → 여전히 노출.
    await expect(drugItem(page, DRUG_1)).toBeVisible({ timeout: 10_000 });
  });
});
