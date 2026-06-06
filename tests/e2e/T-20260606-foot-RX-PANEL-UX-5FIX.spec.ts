/**
 * E2E spec — T-20260606-foot-RX-PANEL-UX-5FIX
 * 진료차트(MedicalChartPanel) 우측 패널 UX 5건 (문지은 대표원장 요청).
 *
 * 구현 범위(이 스펙 검증 대상):
 *   AC-2: 처방세트 폴더 기본 접힘 (기존: 펼침) — 데이터 로드 후 전체 폴더 접힘으로 시작.
 *   AC-3: 상용구 탭 진료차트/펜차트 그룹 분리 + 펜차트 그룹 항상 기본 접힘.
 *   AC-4: 상용구 행 왼쪽 체크박스 제거 → 활성 행 우측 끝 ✓ 비방해 토글.
 *   AC-5: '슈퍼상용구 관리 화면으로' 클릭 → /admin/clinic-management?tab=super_phrases 로
 *         슈퍼상용구 탭 pre-select 진입 (기존: 기본/메인 탭).
 *         (T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT: 관리 도구가 진료도구 → 진료관리로 이전됨)
 *
 * 범위 밖:
 *   AC-1 (약품 검색을 어드민 등록 약품으로만 제한)은 "어드민이 처방용으로 등록/활성화한 약품"
 *   화이트리스트 데이터모델(플래그/테이블/등록 UI)이 부재 → 임의 스키마 신설 금지 정책에 따라
 *   planner FOLLOWUP 에스컬레이트. 본 스펙 미포함.
 *
 * 검증 전략: RX-SET-EXPLORER-TREE 와 동일 — SUPABASE_SERVICE_ROLE_KEY 로 결정론적 seed.
 *   처방세트 2건(같은 폴더) + 상용구 4건(medical_chart 2 / pen_chart 2). SERVICE_KEY 없으면 환경 skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E패널UX${SUFFIX}`;
const FOLDER = `발톱UX${SUFFIX}`;
const SET_1 = `E2E세트1_${SUFFIX}`;
const SET_2 = `E2E세트2_${SUFFIX}`;
const MED_PHRASE_1 = `E2E진료차트구1_${SUFFIX}`;
const MED_PHRASE_2 = `E2E진료차트구2_${SUFFIX}`;
const PEN_PHRASE_1 = `E2E펜차트구1_${SUFFIX}`;
const PEN_PHRASE_2 = `E2E펜차트구2_${SUFFIX}`;

function mkItem(name: string) {
  return { name, dosage: '1정', route: 'PO', frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  customerId: string;
  setIds: number[];
  phraseIds: number[];
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

async function openMedicalChart(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
}

function folderNode(page: Page, name: string) {
  return page.getByTestId('rx-set-folder-node').filter({ hasText: name });
}
function rxSetOption(page: Page, setName: string) {
  return page.getByTestId('rx-set-option').filter({ hasText: setName });
}

test.describe('T-20260606 RX-PANEL-UX-5FIX — 진료차트 우측 패널 UX', () => {
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

    // 처방세트 2건 — 같은 폴더(AC-2 기본 접힘 검증용)
    const { data: sets, error: sErr } = await admin.from('prescription_sets')
      .insert([
        { name: SET_1, items: [mkItem(`약1_${SUFFIX}`)], is_active: true, sort_order: 9201, folder: FOLDER },
        { name: SET_2, items: [mkItem(`약2_${SUFFIX}`)], is_active: true, sort_order: 9202, folder: FOLDER },
      ])
      .select('id');
    if (sErr || !sets) throw new Error(`set seed 실패: ${sErr?.message}`);

    // 상용구 4건 — medical_chart 2 / pen_chart 2 (AC-3/AC-4 검증용)
    const { data: phrases, error: pErr } = await admin.from('phrase_templates')
      .insert([
        { category: 'charting', name: MED_PHRASE_1, content: '진료차트 임상경과 1', is_active: true, phrase_type: 'medical_chart', sort_order: 9301 },
        { category: 'charting', name: MED_PHRASE_2, content: '진료차트 임상경과 2', is_active: true, phrase_type: 'medical_chart', sort_order: 9302 },
        { category: 'general', name: PEN_PHRASE_1, content: '펜차트 내용 1', is_active: true, phrase_type: 'pen_chart', sort_order: 9303 },
        { category: 'general', name: PEN_PHRASE_2, content: '펜차트 내용 2', is_active: true, phrase_type: 'pen_chart', sort_order: 9304 },
      ])
      .select('id');
    if (pErr || !phrases) throw new Error(`phrase seed 실패: ${pErr?.message}`);

    seed = {
      clinicId,
      customerId: cust.id as string,
      setIds: sets.map((s) => s.id as number),
      phraseIds: phrases.map((p) => p.id as number),
    };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().in('id', seed.setIds);
    await admin.from('phrase_templates').delete().in('id', seed.phraseIds);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-2: 처방세트 폴더 기본 접힘 ─────────────────────────────────────────────
  test('AC-2: 처방세트 폴더 기본 접힘 → 토글 시 펼침', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);
    await page.getByTestId('right-panel-tab-rx').click();
    await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });

    // 폴더 노드는 렌더되지만 기본 접힘 → leaf(세트 옵션) 숨김
    await expect(folderNode(page, FOLDER)).toBeVisible({ timeout: 10_000 });
    await expect(rxSetOption(page, SET_1)).toBeHidden();

    // 폴더 토글 클릭 → 펼침 → leaf 노출
    await folderNode(page, FOLDER).getByTestId('rx-set-folder-toggle').click();
    await expect(rxSetOption(page, SET_1)).toBeVisible();
    await expect(rxSetOption(page, SET_2)).toBeVisible();
  });

  // ── AC-3 + AC-4: 상용구 그룹 분리 + 우측 ✓ 토글 ──────────────────────────────
  test('AC-3: 상용구 진료차트/펜차트 분리 + 펜차트 기본 접힘', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);
    await page.getByTestId('right-panel-tab-phrase').click();
    await expect(page.getByTestId('right-panel-phrase-content')).toBeVisible({ timeout: 10_000 });

    // 진료차트 그룹 — 항상 펼침, medical_chart 상용구 노출
    await expect(page.getByTestId('phrase-group-medical')).toBeVisible();
    await expect(page.getByTestId('phrase-group-medical').getByText(MED_PHRASE_1)).toBeVisible();

    // 펜차트 그룹 — 기본 접힘 → pen_chart 상용구 숨김
    await expect(page.getByTestId('phrase-group-pen')).toBeVisible();
    await expect(page.getByText(PEN_PHRASE_1)).toBeHidden();

    // 펜차트 헤더 토글 → 펼침 → pen_chart 상용구 노출
    await page.getByTestId('phrase-group-pen-toggle').click();
    await expect(page.getByText(PEN_PHRASE_1)).toBeVisible();
    await expect(page.getByText(PEN_PHRASE_2)).toBeVisible();
  });

  test('AC-4: 상용구 행 클릭 → 우측 ✓ 노출(왼쪽 체크박스 없음) → 임상경과 삽입', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);
    await page.getByTestId('right-panel-tab-phrase').click();
    await expect(page.getByTestId('right-panel-phrase-content')).toBeVisible({ timeout: 10_000 });

    const row = page.getByTestId('phrase-option').filter({ hasText: MED_PHRASE_1 });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 비활성 상태: ✓ 버튼 없음 (비방해 — 좌측 placeholder 체크박스 제거됨)
    await expect(row.getByTestId('phrase-insert-check')).toHaveCount(0);

    // 행 클릭 → 활성 → 우측 ✓ 노출
    await row.click();
    await expect(row).toHaveAttribute('data-active', 'true');
    await expect(row.getByTestId('phrase-insert-check')).toBeVisible();

    // ✓ 클릭 → 임상경과(formClinical) textarea 에 content 삽입 (value 검증)
    await row.getByTestId('phrase-insert-check').click();
    await expect(page.getByTestId('medical-chart-clinical')).toHaveValue(/진료차트 임상경과 1/, { timeout: 5_000 });
  });

  // ── AC-5: 슈퍼상용구 관리 화면으로 → 탭 pre-select ───────────────────────────
  test('AC-5: 슈퍼상용구 관리 화면으로 → ?tab=super_phrases 탭 pre-select', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);
    await page.getByTestId('right-panel-tab-super').click();
    await expect(page.getByTestId('right-panel-super-content')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('super-phrase-edit-btn').click();

    // URL ?tab=super_phrases 진입
    // T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT: 관리 도구가 진료도구 → 진료관리(clinic-management)로 이전됨.
    await expect(page).toHaveURL(/\/admin\/clinic-management\?tab=super_phrases/, { timeout: 10_000 });
    // 슈퍼상용구 탭이 active(pre-select) 상태 — Radix Tabs data-state
    await expect(page.getByTestId('tab-super-phrases')).toHaveAttribute('data-state', 'active', { timeout: 10_000 });
  });
});
