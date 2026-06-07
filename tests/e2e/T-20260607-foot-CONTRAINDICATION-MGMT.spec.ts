/**
 * E2E spec — T-20260607-foot-CONTRAINDICATION-MGMT
 *   금기증관리: 약 출처 제한(AC-1) + 성분명 중복 경고(AC-2) + 심각도 버튼화(AC-3)
 *   요청: 문지은 대표원장(C0ATE5P6JTH) · planner GO MSG-211523-vwhi
 *
 * 범위:
 *   - AC-1: 금기증관리 약 검색은 '처방세트(prescription_sets) 등록 약'만 노출.
 *           세트 미등록 약(orphan)은 검색되지 않는다(출처 제한). 단일 캡슐화: prescribableDrugs.ts.
 *   - AC-2: 추가하려는 약과 성분(ingredient_code) 동일하며 이미 금기증이 등록된 다른 약이 있으면
 *           성분 중복 경고 배너 + '금기증 등록' 클릭 시 경고 팝업(계속/취소).
 *   - AC-3: 심각도 드롭다운 제거 → '주의'/'금기' 버튼 2개 토글. native select 부재.
 *
 * 검증 전략: SERVICE_KEY 로 결정론적 seed.
 *   세트에 codeInSet/codeIngrA/codeIngrB 등록(=처방가능), codeOrphan 은 세트 밖(=차단 검증).
 *   codeIngrA/B 는 동일 ingredient_code, A 에만 금기증 1건(=B 선택 시 중복경고 소스).
 *   SERVICE_KEY 없으면 환경 skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const INGR = `E2EINGR${SUFFIX}`; // 공유 성분코드
const TOKEN_SRC = `E2E출처${SUFFIX}`; // 출처제한 검색 토큰(세트약+미등록약 공유)
const NAME_INSET = `${TOKEN_SRC}세트약`;
const NAME_ORPHAN = `${TOKEN_SRC}미등록약`;
const NAME_INGR_A = `E2E성분A${SUFFIX}`; // 금기증 보유(중복경고 소스)
const NAME_INGR_B = `E2E성분B${SUFFIX}`; // 동일 성분, 금기증 없음 → 선택 시 경고
const SET_NAME = `E2E출처세트${SUFFIX}`;
const CONTRA_A = `E2E성분A금기${SUFFIX}: 간기능 저하 환자 금기`;

interface SeedIds {
  inSetId: string;
  orphanId: string;
  ingrAId: string;
  ingrBId: string;
  setId: number;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

async function insertCode(
  client: SupabaseClient,
  claim: string,
  name: string,
  ingredientCode: string | null,
): Promise<string> {
  const { data, error } = await client
    .from('prescription_codes')
    .insert({
      claim_code: claim,
      name_ko: name,
      classification: '내복약',
      code_source: 'custom',
      ingredient_code: ingredientCode,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`prescription_codes seed 실패(${name}): ${error?.message}`);
  return data.id as string;
}

/** 금기증 관리 탭 진입 (admin 한정 — 미노출 시 환경 skip) */
async function openContraTab(page: Page): Promise<boolean> {
  await page.goto('/doctor-tools');
  const tab = page.getByTestId('tab-contraindications');
  const visible = await tab.isVisible().catch(() => false);
  if (!visible) return false;
  await tab.click();
  await expect(page.getByTestId('contraindications-tab')).toBeVisible({ timeout: 10_000 });
  return true;
}

async function searchAndSelect(page: Page, query: string, name: string): Promise<void> {
  const input = page.getByTestId('contra-drug-search-input');
  await input.fill('');
  await input.fill(query);
  const result = page.getByTestId('contra-drug-result-item').filter({ hasText: name });
  await expect(result.first()).toBeVisible({ timeout: 8_000 });
  await result.first().click();
  await expect(page.getByTestId('contra-selected-panel')).toBeVisible({ timeout: 5_000 });
}

test.describe('T-20260607 CONTRAINDICATION-MGMT — 출처제한·성분중복·심각도버튼', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const inSetId = await insertCode(admin, `E2ES${SUFFIX}`, NAME_INSET, null);
    const orphanId = await insertCode(admin, `E2EO${SUFFIX}`, NAME_ORPHAN, null);
    const ingrAId = await insertCode(admin, `E2EA${SUFFIX}`, NAME_INGR_A, INGR);
    const ingrBId = await insertCode(admin, `E2EB${SUFFIX}`, NAME_INGR_B, INGR);

    // 세트에 inSet/ingrA/ingrB 등록 (orphan 제외 → 출처제한 검증)
    const items = [inSetId, ingrAId, ingrBId].map((id) => ({
      name: 'seed', dosage: '', route: '경구', frequency: '1일 3회', days: 3, notes: '',
      prescription_code_id: id,
    }));
    const { data: set, error: setErr } = await admin
      .from('prescription_sets')
      .insert({ name: SET_NAME, items, is_active: true })
      .select('id')
      .single();
    if (setErr || !set) throw new Error(`prescription_sets seed 실패: ${setErr?.message}`);

    // ingrA 에 금기증 1건 (성분 중복경고 소스)
    const { error: cErr } = await admin
      .from('prescription_contraindications')
      .insert({ prescription_code_id: ingrAId, contraindication_text: CONTRA_A, severity: '금기' });
    if (cErr) throw new Error(`contra seed 실패: ${cErr.message}`);

    seed = { inSetId, orphanId, ingrAId, ingrBId, setId: set.id as number };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    const ids = [seed.inSetId, seed.orphanId, seed.ingrAId, seed.ingrBId];
    await admin.from('prescription_contraindications').delete().in('prescription_code_id', ids);
    await admin.from('prescription_sets').delete().eq('id', seed.setId);
    await admin.from('prescription_codes').delete().in('id', ids);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1: 약 출처 제한 — 세트 등록 약만 검색 노출, orphan 차단 ───────────────────────
  test('AC-1: 검색 결과는 처방세트 등록 약만 — 미등록 약은 차단', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭(admin 전용) 미노출 — 환경 skip');

    // 공통 토큰으로 검색 → 세트약은 노출, 미등록약은 미노출
    await page.getByTestId('contra-drug-search-input').fill(TOKEN_SRC);
    const inSetResult = page.getByTestId('contra-drug-result-item').filter({ hasText: NAME_INSET });
    await expect(inSetResult.first()).toBeVisible({ timeout: 8_000 });
    // orphan 은 prescription_codes 에는 존재하나 세트 밖 → 결과에 없어야 함
    await expect(
      page.getByTestId('contra-drug-result-item').filter({ hasText: NAME_ORPHAN }),
    ).toHaveCount(0);
  });

  // ── AC-2: 성분명 중복 경고 — 동일 성분 약에 금기증 기등록 시 배너 + 경고 팝업(계속/취소) ──
  test('AC-2: 동일 성분 약 선택 시 중복 배너 + 등록 클릭 시 경고 팝업', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭 미노출 — 환경 skip');

    // 성분B 선택(성분A 에 금기증 기등록) → 중복 배너 노출
    await searchAndSelect(page, NAME_INGR_B, NAME_INGR_B);
    const banner = page.getByTestId('contra-ingredient-dup-banner');
    await expect(banner).toBeVisible({ timeout: 8_000 });
    await expect(banner).toContainText(NAME_INGR_A);

    // '금기증 등록' 클릭 → 경고 팝업(계속/취소)
    await page.getByTestId('contra-add-btn').click();
    const dupDialog = page.getByTestId('contra-ingredient-dup-dialog');
    await expect(dupDialog).toBeVisible({ timeout: 5_000 });
    await expect(dupDialog).toContainText(NAME_INGR_A);

    // 취소 → 등록 폼 안 열림
    await page.getByTestId('contra-dup-cancel-btn').click();
    await expect(dupDialog).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId('contra-text-input')).toHaveCount(0);

    // 다시 등록 → 계속 → 등록 폼 진입
    await page.getByTestId('contra-add-btn').click();
    await expect(dupDialog).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('contra-dup-continue-btn').click();
    await expect(page.getByTestId('contra-text-input')).toBeVisible({ timeout: 5_000 });
  });

  test('AC-2(negative): 성분 중복 아닌 약은 경고 없음 + 바로 등록 폼', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭 미노출 — 환경 skip');

    // inSet(성분코드 null·중복 없음) 선택 → 배너 없음
    await searchAndSelect(page, TOKEN_SRC, NAME_INSET);
    await expect(page.getByTestId('contra-ingredient-dup-banner')).toHaveCount(0);
    // 등록 클릭 → 경고 팝업 없이 바로 폼
    await page.getByTestId('contra-add-btn').click();
    await expect(page.getByTestId('contra-ingredient-dup-dialog')).toHaveCount(0);
    await expect(page.getByTestId('contra-text-input')).toBeVisible({ timeout: 5_000 });
  });

  // ── AC-3: 심각도 버튼화 — 드롭다운 부재, 주의/금기 토글 ─────────────────────────────
  test('AC-3: 심각도는 주의/금기 버튼 토글 — native select 부재', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭 미노출 — 환경 skip');

    await searchAndSelect(page, TOKEN_SRC, NAME_INSET);
    await page.getByTestId('contra-add-btn').click();

    // 드롭다운(native select) 제거 확인
    await expect(page.getByTestId('contra-severity-select')).toHaveCount(0);
    // 토글 영역 + 2버튼만
    await expect(page.getByTestId('contra-severity-toggle')).toBeVisible({ timeout: 5_000 });
    const btnCaution = page.getByTestId('contra-severity-btn-주의');
    const btnContra = page.getByTestId('contra-severity-btn-금기');
    await expect(btnCaution).toBeVisible();
    await expect(btnContra).toBeVisible();
    // '경고' 버튼 부재(2값만)
    await expect(page.getByTestId('contra-severity-btn-경고')).toHaveCount(0);

    // 금기 선택 → aria-pressed true, 저장 → 목록 배지 '금기'
    await btnContra.click();
    await expect(btnContra).toHaveAttribute('aria-pressed', 'true');
    const txt = `E2E심각도버튼${SUFFIX}: 금기 토글 검증`;
    await page.getByTestId('contra-text-input').fill(txt);
    await page.getByTestId('contra-save-btn').click();
    const item = page.getByTestId('contra-item').filter({ hasText: txt });
    await expect(item.first()).toBeVisible({ timeout: 8_000 });
    await expect(item.first()).toContainText('금기');
  });

  test('AC-3: 같은 버튼 재클릭 시 선택 해제(미지정)', async ({ page }) => {
    const hasTab = await openContraTab(page);
    if (!hasTab) test.skip(true, '금기증 관리 탭 미노출 — 환경 skip');

    await searchAndSelect(page, TOKEN_SRC, NAME_INSET);
    await page.getByTestId('contra-add-btn').click();
    const btnCaution = page.getByTestId('contra-severity-btn-주의');
    await btnCaution.click();
    await expect(btnCaution).toHaveAttribute('aria-pressed', 'true');
    await btnCaution.click(); // 재클릭 = 해제
    await expect(btnCaution).toHaveAttribute('aria-pressed', 'false');
  });
});
