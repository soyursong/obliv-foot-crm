/**
 * E2E spec — T-20260601-foot-RX-SET-ACCUMULATE
 * 진료차트(MedicalChartPanel) 처방세트: 누적(append) 버그 수정 + 세트(폴더)=다중 약 일괄 추가
 *
 * 배경: 진료차트 우측 패널 '처방세트' 버튼 클릭 시 loadPrescriptionSet 가
 *   setFormRx(set.items) 로 기존 처방 목록을 '덮어쓰기(replace)' 하던 버그.
 *   → setFormRx(prev => [...prev, ...set.items]) 로 누적(append) + 세트 내 약 전체 일괄 추가.
 *   commit: MedicalChartPanel.tsx loadPrescriptionSet 수정 (순수 FE, db_change:false).
 *   prescription_sets.items(JSONB) 가 이미 다중 약 배열을 지원 → 스키마 변경 불요.
 *
 * 검증 전략: 라이브 데이터 의존(skip) 회피 — SUPABASE_SERVICE_ROLE_KEY 로
 *   beforeAll 에서 customer 1건 + prescription_sets 2건(A: 약 2개 / B: 약 1개)을
 *   결정론적으로 seed → /chart/:id 진료차트 Drawer 오픈 → 처방세트 클릭 누적 검증.
 *   afterAll 에서 정리. SERVICE_KEY 없으면 환경 skip.
 *
 * AC-1: 처방세트 클릭 → 기존 목록 유지한 채 추가 (덮어쓰기 없음)
 * AC-2: 약 2개 묶인 세트 1회 클릭 → 세트 내 모든 약 항목 추가 (첫 항목만 X)
 * AC-3: 서로 다른 세트 연속 클릭 → 모두 누적
 * AC-4: 저장 → 새로고침/재조회 후에도 누적 항목 유지
 * AC-6: (중복 정책) 같은 세트 재클릭 시 중복 행 그대로 누적 (기본 정책)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

// ── seed 식별자 (afterAll 정리용) ─────────────────────────────────────────────
const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST_NAME = `E2E처방누적${SUFFIX}`;
// 세트 A: 약 2개 / 세트 B: 약 1개 — 이름에 SUFFIX 로 다른 시드와 충돌 회피
const SET_A_NAME = `E2E세트A${SUFFIX}`;
const SET_B_NAME = `E2E세트B${SUFFIX}`;
const A_DRUG_1 = `E2EA약1_${SUFFIX}`;
const A_DRUG_2 = `E2EA약2_${SUFFIX}`;
const B_DRUG_1 = `E2EB약1_${SUFFIX}`;

function mkItem(name: string) {
  return { name, dosage: '1정', route: 'PO', frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  customerId: string;
  setAId: number;
  setBId: number;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/**
 * 처방세트 폴더 펼치기 (T-20260606-foot-RX-PANEL-UX-5FIX AC-2 대응).
 *   6/6 신규 UX: 처방세트 폴더는 Drawer 오픈 시 '기본 전체 접힘' → 접힌 폴더 안의
 *   rx-set-option 버튼은 렌더되지 않음(미마운트). 본 spec 의 seed 세트는 folder 미지정
 *   → '미분류' 폴더에 귀속되므로, 옵션 클릭 전 해당 폴더를 펼쳐야 한다.
 *   toggle 의 aria-expanded='false'(접힘) 일 때만 클릭하여 멱등 보장.
 */
async function expandRxFolder(page: Page, folderName: string): Promise<void> {
  const toggle = page.getByTestId('rx-set-folder-toggle').filter({ hasText: folderName }).first();
  await toggle.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

/** 진료차트 Drawer 오픈 — /chart/:id 진입 후 진료차트 버튼 클릭 → drawer visible */
async function openMedicalChart(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
  // 우측 패널 '처방세트' 탭 활성 (기본 rightTab='rx')
  await page.getByTestId('right-panel-tab-rx').click();
  await expect(page.getByTestId('right-panel-rx-content')).toBeVisible({ timeout: 10_000 });
  // 6/6 신규 UX 대응: seed 세트(folder 미지정 → '미분류')가 담긴 폴더를 펼쳐 옵션 노출.
  await expandRxFolder(page, '미분류');
}

/** 처방세트 옵션 버튼(이름으로 특정) 클릭 */
function rxSetOption(page: Page, setName: string) {
  return page.getByTestId('rx-set-option').filter({ hasText: setName });
}

/** 현재 처방내역 테이블의 행 수 */
function rxRows(page: Page) {
  return page.getByTestId('prescription-items-table').locator('tbody tr');
}

test.describe('T-20260601 RX-SET-ACCUMULATE — 처방세트 누적 + 세트 일괄 추가', () => {
  // ── seed: 고객 1건 + 처방세트 2건(A 약2개 / B 약1개) ──────────────────────────
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return; // SERVICE_KEY 없으면 seed 불가 → 환경 skip
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    const { data: cust, error: cErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST_NAME, phone: `+82107${SUFFIX}` })
      .select('id').single();
    if (cErr || !cust) throw new Error(`customer seed 실패: ${cErr?.message}`);

    // 세트 A — 약 2개 (AC-2 일괄 추가 검증용)
    const { data: setA, error: aErr } = await admin.from('prescription_sets')
      .insert({ name: SET_A_NAME, items: [mkItem(A_DRUG_1), mkItem(A_DRUG_2)], is_active: true, sort_order: 9001 })
      .select('id').single();
    if (aErr || !setA) throw new Error(`prescription_set A seed 실패: ${aErr?.message}`);

    // 세트 B — 약 1개 (AC-3 누적 검증용)
    const { data: setB, error: bErr } = await admin.from('prescription_sets')
      .insert({ name: SET_B_NAME, items: [mkItem(B_DRUG_1)], is_active: true, sort_order: 9002 })
      .select('id').single();
    if (bErr || !setB) throw new Error(`prescription_set B seed 실패: ${bErr?.message}`);

    seed = { clinicId, customerId: cust.id as string, setAId: setA.id as number, setBId: setB.id as number };
  });

  // ── cleanup: 세트 → 고객 · best-effort ────────────────────────────────────────
  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('prescription_sets').delete().in('id', [seed.setAId, seed.setBId]);
    await admin.from('customers').delete().eq('id', seed.customerId);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1/2/3: 세트 일괄 추가 + 누적 (정상 동선) ────────────────────────────────
  test('AC-1/2/3: 세트 A(약2개) 일괄 추가 → 세트 B 클릭 → A+B 모두 누적', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);

    // AC-2: 세트 A(약 2개) 1회 클릭 → 세트 내 약 전체 추가 (첫 항목만 X)
    await rxSetOption(page, SET_A_NAME).first().click();
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 5_000 });
    await expect(rxRows(page)).toHaveCount(2);
    await expect(page.getByTestId('prescription-items-table')).toContainText(A_DRUG_1);
    await expect(page.getByTestId('prescription-items-table')).toContainText(A_DRUG_2);

    // AC-1 + AC-3: 세트 B(약 1개) 클릭 → A 사라지지 않고 누적 (총 3행)
    await rxSetOption(page, SET_B_NAME).first().click();
    await expect(rxRows(page)).toHaveCount(3);
    const table = page.getByTestId('prescription-items-table');
    await expect(table).toContainText(A_DRUG_1); // A 보존 (덮어쓰기 없음)
    await expect(table).toContainText(A_DRUG_2);
    await expect(table).toContainText(B_DRUG_1); // B 누적
  });

  // ── AC-6: 중복 정책 — 같은 세트 재클릭 시 중복 행 그대로 누적 ────────────────────
  test('AC-6: 동일 세트 재클릭 → 중복 행 그대로 누적 (기본 정책)', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);

    await rxSetOption(page, SET_A_NAME).first().click();
    await expect(rxRows(page)).toHaveCount(2);
    // 동일 세트 재클릭 → 2 + 2 = 4행 (중복 행 누적)
    await rxSetOption(page, SET_A_NAME).first().click();
    await expect(rxRows(page)).toHaveCount(4);
  });

  // ── AC-4: 저장 → 새로고침 후에도 누적 항목 유지 ────────────────────────────────
  test('AC-4: 누적 처방 저장 → 새로고침/재조회 후 유지', async ({ page }) => {
    await openMedicalChart(page, seed!.customerId);

    await rxSetOption(page, SET_A_NAME).first().click();
    await rxSetOption(page, SET_B_NAME).first().click();
    await expect(rxRows(page)).toHaveCount(3);

    // 저장 (더미 아닌 실제 고객 — 신규 기록 저장)
    const saveBtn = page.getByTestId('medical-chart-save-btn');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    // 저장 완료 대기 (saving 해제)
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 });

    // 새로고침 → 진료차트 재오픈 → 폼은 NEW 로 리셋되므로(설계),
    // 좌측 경과 타임라인에서 방금 저장한 차트 엔트리를 클릭해 폼에 로드
    await openMedicalChart(page, seed!.customerId);
    const entry = page.getByTestId('medical-chart-timeline-entry').first();
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await entry.locator('button').first().click();
    // 선택된 차트의 처방내역(3행)이 복원되어야 함
    await expect(page.getByTestId('prescription-items-table')).toBeVisible({ timeout: 10_000 });
    await expect(rxRows(page)).toHaveCount(3);
    const table = page.getByTestId('prescription-items-table');
    await expect(table).toContainText(A_DRUG_1);
    await expect(table).toContainText(A_DRUG_2);
    await expect(table).toContainText(B_DRUG_1);
  });
});
