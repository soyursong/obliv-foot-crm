/**
 * E2E spec — T-20260605-foot-RX-SET-EXPLORER-TREE
 * 진료차트(MedicalChartPanel) 우측 패널 '처방세트' 탭: 평면 리스트 → 폴더 위계 트리(탐색기형)
 *
 * 배경: 현장(문지은 대표원장) UX 요청. 처방세트가 많아지면 평면 리스트가 길어져 탐색 곤란.
 *   prescription_sets.folder(text nullable) 기준으로 folder→set 2단 아코디언 트리 렌더.
 *   폴더 노드 펼침/접기. folder null/'' = '미분류' 노드. 폴더 가나다순 + 미분류 맨 끝
 *   (관리화면 PrescriptionSetsTab 그룹핑과 동일 규칙). FE-only, 스키마 변경 없음.
 *   leaf 클릭 = 기존 loadPrescriptionSet(set) 그대로 보존(적용 로직 변경 없음, ACCUMULATE 충돌 회피).
 *
 * 검증 전략: RX-SET-ACCUMULATE 와 동일 — SUPABASE_SERVICE_ROLE_KEY 로 결정론적 seed.
 *   세트 3건: 폴더 '발톱'(약1개) / 폴더 '진균'(약1개) / folder=null(약1개, '미분류' 노드).
 *   SERVICE_KEY 없으면 환경 skip.
 *
 * 시나리오 1 (폴더 펼침/접기 → leaf 적용):
 *   - 트리에 폴더 노드 렌더 + '미분류' 노드 존재
 *   - 폴더 토글 클릭 → 접힘 → leaf 숨김 / 재클릭 → 펼침 → leaf 노출
 *   - leaf 클릭 → loadPrescriptionSet 동작 그대로(처방내역 행 추가)
 * 시나리오 2 (미분류·빈상태 회귀):
 *   - folder=null 세트가 '미분류' 노드 아래 렌더 + 정상 적용
 *   - (빈상태) 활성 세트 0건이면 rx-set-empty 안내 노출 — 별도 deactivate 케이스로 회귀
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E처방트리${SUFFIX}`;
const FOLDER_A = `발톱${SUFFIX}`;
const FOLDER_B = `진균${SUFFIX}`;
const SET_A_NAME = `E2E발톱세트${SUFFIX}`;   // 폴더 A
const SET_B_NAME = `E2E진균세트${SUFFIX}`;   // 폴더 B
const SET_C_NAME = `E2E미분류세트${SUFFIX}`; // folder=null → '미분류'
const A_DRUG = `E2E발톱약_${SUFFIX}`;
const B_DRUG = `E2E진균약_${SUFFIX}`;
const C_DRUG = `E2E미분류약_${SUFFIX}`;

function mkItem(name: string) {
  return { name, dosage: '1정', route: 'PO', frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  customerId: string;
  setAId: number;
  setBId: number;
  setCId: number;
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
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
}

/** 폴더 노드(이름으로 특정) */
function folderNode(page: Page, name: string) {
  return page.getByTestId('rx-set-folder-node').filter({ hasText: name });
}
/** 처방세트 leaf 옵션(이름으로 특정) */
function rxSetOption(page: Page, setName: string) {
  return page.getByTestId('rx-set-option').filter({ hasText: setName });
}
function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

test.describe('T-20260605 RX-SET-EXPLORER-TREE — 처방세트 폴더 트리', () => {
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

    // 폴더 A 세트
    const { data: setA, error: aErr } = await admin.from('prescription_sets')
      .insert({ name: SET_A_NAME, items: [mkItem(A_DRUG)], is_active: true, sort_order: 9101, folder: FOLDER_A })
      .select('id').single();
    if (aErr || !setA) throw new Error(`set A seed 실패: ${aErr?.message}`);
    // 폴더 B 세트
    const { data: setB, error: bErr } = await admin.from('prescription_sets')
      .insert({ name: SET_B_NAME, items: [mkItem(B_DRUG)], is_active: true, sort_order: 9102, folder: FOLDER_B })
      .select('id').single();
    if (bErr || !setB) throw new Error(`set B seed 실패: ${bErr?.message}`);
    // folder=null → 미분류 노드
    const { data: setC, error: cErr2 } = await admin.from('prescription_sets')
      .insert({ name: SET_C_NAME, items: [mkItem(C_DRUG)], is_active: true, sort_order: 9103, folder: null })
      .select('id').single();
    if (cErr2 || !setC) throw new Error(`set C seed 실패: ${cErr2?.message}`);

    seed = {
      clinicId,
      customerId: cust.id as string,
      setAId: setA.id as number,
      setBId: setB.id as number,
      setCId: setC.id as number,
    };
  });

  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().in('id', [seed.setAId, seed.setBId, seed.setCId]);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── 시나리오 1: 폴더 펼침/접기 → leaf 적용 ─────────────────────────────────────
  test('S1: 폴더 노드 렌더 → 접기(leaf 숨김)/펼치기(leaf 노출) → leaf 클릭 적용', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);

    // 폴더 노드 + 미분류 노드 렌더 확인
    await expect(folderNode(page, FOLDER_A)).toBeVisible({ timeout: 10_000 });
    await expect(folderNode(page, FOLDER_B)).toBeVisible();
    await expect(folderNode(page, '미분류')).toBeVisible();

    // 기본 펼침 → leaf 노출
    await expect(rxSetOption(page, SET_A_NAME)).toBeVisible();

    // 폴더 A 토글 클릭 → 접힘 → leaf 숨김
    await folderNode(page, FOLDER_A).getByTestId('rx-set-folder-toggle').click();
    await expect(rxSetOption(page, SET_A_NAME)).toBeHidden();
    // 다른 폴더(B) leaf 는 영향 없음
    await expect(rxSetOption(page, SET_B_NAME)).toBeVisible();

    // 재클릭 → 펼침 → leaf 다시 노출
    await folderNode(page, FOLDER_A).getByTestId('rx-set-folder-toggle').click();
    await expect(rxSetOption(page, SET_A_NAME)).toBeVisible();

    // leaf 클릭 → loadPrescriptionSet 동작 그대로(처방내역 행 추가)
    await rxSetOption(page, SET_A_NAME).click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(A_DRUG);

    // 다른 폴더 leaf 클릭 → 누적(기존 ACCUMULATE 동작 보존)
    await rxSetOption(page, SET_B_NAME).click();
    await expect(rxRows(page)).toHaveCount(2);
    await expect(page.getByTestId('prescription-items-table')).toContainText(B_DRUG);
  });

  // ── 시나리오 2: 미분류·빈상태 회귀 ────────────────────────────────────────────
  test('S2: 미분류 노드 leaf 적용 + 빈상태(전체 비활성) 회귀', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);

    // folder=null 세트가 '미분류' 노드 아래 렌더 + 정상 적용
    await expect(folderNode(page, '미분류')).toBeVisible({ timeout: 10_000 });
    await expect(rxSetOption(page, SET_C_NAME)).toBeVisible();
    await rxSetOption(page, SET_C_NAME).click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(C_DRUG);

    // ── 빈상태 회귀: 시드 3건을 모두 비활성 → 재오픈 → rx-set-empty 안내 노출 ──
    // (best-effort: 다른 활성 세트가 prod 에 있을 수 있어 empty 미보장 → 조건부 assert)
    await admin!.from('prescription_sets')
      .update({ is_active: false }).in('id', [seed!.setAId, seed!.setBId, seed!.setCId]);
    try {
      await openMedicalChart(page, seed!.customerId);
      // 비활성화한 시드 세트는 더 이상 노출되지 않아야 함(회귀 핵심)
      await expect(rxSetOption(page, SET_C_NAME)).toHaveCount(0, { timeout: 10_000 });
      // 활성 세트가 0건이면 empty 안내, 아니면 폴더 트리 유지 — 둘 중 하나는 참
      const emptyCount = await page.getByTestId('rx-set-empty').count();
      const folderCount = await page.getByTestId('rx-set-folder-node').count();
      expect(emptyCount + folderCount).toBeGreaterThan(0);
    } finally {
      // 정리(afterAll delete 전 복원 — best-effort)
      await admin!.from('prescription_sets')
        .update({ is_active: true }).in('id', [seed!.setAId, seed!.setBId, seed!.setCId]);
    }
  });
});
