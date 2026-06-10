/**
 * E2E spec — T-20260601-foot-RX-QUICKBAR-ACCUMULATE
 * 진료차트(DoctorTreatmentPanel) 처방 탭 빠른처방(QuickRxBar) 버튼 누적 버그 수정
 *
 * 배경: CheckInDetailSheet → DoctorTreatmentPanel(진료 중/examination) 처방 탭의
 *   빠른처방 버튼(QuickRxBar) onSelectItems 콜백이 setRxItems append 직후
 *   `setFieldsSynced(false)` 를 호출 → 다음 렌더에서 최초 동기화 블록(L573)이 재실행되어
 *   방금 누적한 (미저장) 항목이 DB 상태로 리셋 → 누적 소실.
 *   수정: DoctorTreatmentPanel.tsx 빠른처방 onSelectItems 콜백 내 `setFieldsSynced(false)` 제거.
 *   (FE only, db_change:false. 최초 1회 동기화 블록 !fieldsSynced 은 유지 → 환자 전환 회귀 없음)
 *
 *   ※ T-20260601-foot-RX-SET-ACCUMULATE(MedicalChartPanel)와 별개 surface — 중복 아님.
 *     본 건은 DoctorTreatmentPanel 처방 탭 QuickRxBar 경로.
 *
 * 검증 전략: 라이브 데이터 의존(skip) 회피 — SUPABASE_SERVICE_ROLE_KEY 로 beforeAll 에서
 *   고객 2건 + prescription_sets 2건(A 약1개 / B 약1개) + quick_rx_buttons 2개 +
 *   check_in 2건(P1: examination·처방 빈 상태 / P2: examination·DB에 처방 1건 선존재)을
 *   결정론적으로 seed → 대시보드 칸반 카드 클릭 → 진료 패널 처방 탭 → 빠른처방 버튼 누적 검증.
 *   afterAll 정리. SERVICE_KEY 없으면 환경 skip.
 *
 * AC-1: 빠른처방 버튼 클릭 시 항목 추가
 * AC-2: 다른 버튼 이어 클릭 시 기존 항목 위에 누적 (덮어쓰기 X) — 핵심 버그
 * AC-3: 동일 name 중복 추가 안 됨 (기존 필터 유지)
 * AC-4: 확정/저장 후 목록 유지 · DB 영속
 * AC-5: 다른 환자 전환/재진입 시 그 환자 DB 목록으로 정상 표시 (최초 동기화 회귀 없음)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

// ── seed 식별자 (afterAll 정리용) ─────────────────────────────────────────────
const SUFFIX = `${Date.now().toString().slice(-7)}`;
const CUST1_NAME = `E2E빠른처방A${SUFFIX}`; // 빈 상태 → 누적 검증
const CUST2_NAME = `E2E빠른처방B${SUFFIX}`; // DB 선존재 → 동기화 회귀 검증
const SET_A_NAME = `E2E빠른세트A${SUFFIX}`;
const SET_B_NAME = `E2E빠른세트B${SUFFIX}`;
const BTN_A_NAME = `빠처A${SUFFIX}`;
const BTN_B_NAME = `빠처B${SUFFIX}`;
const A_DRUG = `E2EQA약_${SUFFIX}`;
const B_DRUG = `E2EQB약_${SUFFIX}`;
const PRESEED_DRUG = `E2E선존재약_${SUFFIX}`; // P2 가 DB에 미리 들고 있는 처방

function mkItem(name: string) {
  return { name, dosage: '1정', route: 'PO', frequency: '1일3회', days: 3, notes: '' };
}

interface SeedIds {
  clinicId: string;
  cust1Id: string;
  cust2Id: string;
  setAId: number;
  setBId: number;
  btnAId: string;
  btnBId: string;
  checkIn1Id: string;
  checkIn2Id: string;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/** 대시보드 칸반에서 고객명 카드 클릭 → 진료 패널 처방 탭 오픈 */
async function openTreatmentRxTab(page: Page, customerName: string): Promise<void> {
  await page.goto('/admin/dashboard');
  await expect(page.getByText('통합 시간표')).toBeVisible({ timeout: 15_000 });
  // 진료중(examination) 칸반 카드 — title "드래그=다음단계 이동 · 클릭=상세" + 고객명
  const card = page
    .locator('[title*="드래그=다음단계 이동"]')
    .filter({ hasText: customerName })
    .first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();

  // ── QA-FIX(phase2): Dashboard.handleCardClick 은 진료 패널(CheckInDetailSheet, z-50)과
  //    함께 2번차트(CustomerChartSheet, z-70)를 동시에 연다. 2번차트가 진료 패널 위를 덮어
  //    그 로딩 오버레이("차트 불러오는 중…")가 처방 탭 클릭 포인터를 가로막아 timeout 발생.
  //    → 진료 패널을 조작하기 전에 2번차트를 ESC 로 닫고(닫힘 완료까지 대기) 오버레이를 제거한다.
  //    CustomerChartSheet 의 ESC 핸들러는 document capture 단계 + stopPropagation 이고,
  //    CheckInDetailSheet(Radix Sheet)의 ESC 는 bubble 단계 → capture 가 먼저 stopPropagation
  //    하므로 ESC 는 2번차트만 닫고 진료 패널은 유지된다. (닫기 버튼은 CustomerChartPage 헤더에
  //    가려 actionable 하지 않으므로 사용하지 않음)
  const chartSheet = page.getByTestId('customer-chart-sheet');
  try {
    await chartSheet.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // 미연결 고객 등 2번차트가 안 열린 케이스 — 무시하고 진행
  }
  if (await chartSheet.count()) {
    await page.keyboard.press('Escape');
    await expect(chartSheet).toBeHidden({ timeout: 10_000 });
  }

  // 진료 패널 마운트 (status=examination)
  await expect(page.getByTestId('doctor-treatment-panel')).toBeVisible({ timeout: 10_000 });
  const rxTab = page.getByTestId('doctor-tab-prescription');
  await rxTab.scrollIntoViewIfNeeded();
  await rxTab.click();
  await expect(page.getByTestId('quick-rx-bar')).toBeVisible({ timeout: 10_000 });
}

/** 진료 패널 처방내역 행 (DoctorTreatmentPanel 의 prescription-item-row) */
function rxRows(page: Page) {
  return page.getByTestId('prescription-item-row');
}

function quickBtn(page: Page, name: string) {
  return page.getByTestId(`quick-rx-btn-${name}`);
}

test.describe('T-20260601 RX-QUICKBAR-ACCUMULATE — 진료 패널 빠른처방 버튼 누적', () => {
  // ── seed ──────────────────────────────────────────────────────────────────
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return; // SERVICE_KEY 없으면 seed 불가 → 환경 skip
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    // 고객 2건
    const { data: c1, error: c1Err } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST1_NAME, phone: `+82109${SUFFIX}` })
      .select('id').single();
    if (c1Err || !c1) throw new Error(`customer1 seed 실패: ${c1Err?.message}`);
    const { data: c2, error: c2Err } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: CUST2_NAME, phone: `+82108${SUFFIX}` })
      .select('id').single();
    if (c2Err || !c2) throw new Error(`customer2 seed 실패: ${c2Err?.message}`);

    // 처방세트 2건 (각 약 1개)
    const { data: setA, error: aErr } = await admin.from('prescription_sets')
      .insert({ name: SET_A_NAME, items: [mkItem(A_DRUG)], is_active: true, sort_order: 9101 })
      .select('id').single();
    if (aErr || !setA) throw new Error(`prescription_set A seed 실패: ${aErr?.message}`);
    const { data: setB, error: bErr } = await admin.from('prescription_sets')
      .insert({ name: SET_B_NAME, items: [mkItem(B_DRUG)], is_active: true, sort_order: 9102 })
      .select('id').single();
    if (bErr || !setB) throw new Error(`prescription_set B seed 실패: ${bErr?.message}`);

    // 빠른처방 버튼 2개
    const { data: btnA, error: baErr } = await admin.from('quick_rx_buttons')
      .insert({ name: BTN_A_NAME, icon: 'Pill', prescription_set_id: setA.id, sort_order: 9101, is_active: true })
      .select('id').single();
    if (baErr || !btnA) throw new Error(`quick_rx_button A seed 실패: ${baErr?.message}`);
    const { data: btnB, error: bbErr } = await admin.from('quick_rx_buttons')
      .insert({ name: BTN_B_NAME, icon: 'Pill', prescription_set_id: setB.id, sort_order: 9102, is_active: true })
      .select('id').single();
    if (bbErr || !btnB) throw new Error(`quick_rx_button B seed 실패: ${bbErr?.message}`);

    // check_in 2건 (status=examination → DoctorTreatmentPanel 마운트)
    const { data: ci1, error: ci1Err } = await admin.from('check_ins')
      .insert({
        clinic_id: clinicId, customer_id: c1.id, customer_name: CUST1_NAME,
        customer_phone: `+82109${SUFFIX}`, visit_type: 'returning',
        status: 'examination', queue_number: 9101, prescription_items: [],
      })
      .select('id').single();
    if (ci1Err || !ci1) throw new Error(`check_in1 seed 실패: ${ci1Err?.message}`);

    // P2: DB 에 처방 1건 선존재 (AC-5 동기화 회귀 검증용)
    const { data: ci2, error: ci2Err } = await admin.from('check_ins')
      .insert({
        clinic_id: clinicId, customer_id: c2.id, customer_name: CUST2_NAME,
        customer_phone: `+82108${SUFFIX}`, visit_type: 'returning',
        status: 'examination', queue_number: 9102, prescription_items: [mkItem(PRESEED_DRUG)],
      })
      .select('id').single();
    if (ci2Err || !ci2) throw new Error(`check_in2 seed 실패: ${ci2Err?.message}`);

    seed = {
      clinicId, cust1Id: c1.id as string, cust2Id: c2.id as string,
      setAId: setA.id as number, setBId: setB.id as number,
      btnAId: btnA.id as string, btnBId: btnB.id as string,
      checkIn1Id: ci1.id as string, checkIn2Id: ci2.id as string,
    };
  });

  // ── cleanup: check_in → button → set → customer · best-effort ─────────────────
  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('check_ins').delete().in('id', [seed.checkIn1Id, seed.checkIn2Id]);
    await admin.from('quick_rx_buttons').delete().in('id', [seed.btnAId, seed.btnBId]);
    await admin.from('prescription_sets').delete().in('id', [seed.setAId, seed.setBId]);
    await admin.from('customers').delete().in('id', [seed.cust1Id, seed.cust2Id]);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1/AC-2/AC-3: 시나리오 1(누적) + 시나리오 2(중복 엣지) ──────────────────
  test('AC-1/2/3: 빠른처방 A 클릭 → B 클릭 → A 유지된 채 B 누적 (덮어쓰기 X) + 동일 버튼 중복 X', async ({ page }) => {
    await openTreatmentRxTab(page, CUST1_NAME);

    // AC-1: 빠른처방 A 클릭 → 1행 추가
    await quickBtn(page, BTN_A_NAME).click();
    await expect(rxRows(page)).toHaveCount(1);
    // ⚠ locator 스코프: 약명은 처방행(prescription-item-row) 외에 빠른처방 hover 툴팁
    //   (quick-rx-tooltip-*, QUICKRX-HOVER-TOOLTIP)에도 노출 → bare getByText 는 strict 위반.
    //   처방행으로 한정해 누적 실체만 단언한다.
    await expect(rxRows(page).filter({ hasText: A_DRUG })).toHaveCount(1);

    // AC-2(핵심 버그): B 이어 클릭 → A 사라지지 않고 누적 (2행). 버그 시 setFieldsSynced(false) 로 DB(빈) 리셋되어 0~1행.
    await quickBtn(page, BTN_B_NAME).click();
    await expect(rxRows(page)).toHaveCount(2);
    await expect(rxRows(page).filter({ hasText: A_DRUG })).toHaveCount(1); // A 보존
    await expect(rxRows(page).filter({ hasText: B_DRUG })).toHaveCount(1); // B 누적

    // AC-3: 동일 버튼 A 재클릭 → name 중복 필터로 추가 안 됨 (여전히 2행)
    await quickBtn(page, BTN_A_NAME).click();
    await expect(rxRows(page)).toHaveCount(2);
  });

  // ── AC-4: 저장 → 재진입 후 누적 항목 유지 · DB 영속 ────────────────────────────
  test('AC-4: 빠른처방 A+B 누적 → 임시 저장 → 재진입 시 2행 유지', async ({ page }) => {
    await openTreatmentRxTab(page, CUST1_NAME);

    await quickBtn(page, BTN_A_NAME).click();
    await expect(rxRows(page)).toHaveCount(1); // A 누적 확인 후 B 클릭(연속 클릭 레이스 방지)
    await quickBtn(page, BTN_B_NAME).click();
    await expect(rxRows(page)).toHaveCount(2);

    // 처방 임시 저장
    const saveBtn = page.getByRole('button', { name: '임시 저장' }).first();
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 }); // 저장 완료(isPending 해제) 대기

    // 재진입 → DB 영속 확인 (2행 복원)
    await openTreatmentRxTab(page, CUST1_NAME);
    await expect(rxRows(page)).toHaveCount(2);
    await expect(rxRows(page).filter({ hasText: A_DRUG })).toHaveCount(1);
    await expect(rxRows(page).filter({ hasText: B_DRUG })).toHaveCount(1);
  });

  // ── AC-5: 다른 환자 전환 → 그 환자 DB 목록으로 정상 표시 (최초 동기화 회귀 없음) ──
  test('AC-5: DB 처방 선존재 환자 진입 → 그 환자 DB 목록(1행) 정상 표시', async ({ page }) => {
    await openTreatmentRxTab(page, CUST2_NAME);
    // 최초 동기화 블록(!fieldsSynced)이 유지되어 DB 의 선존재 처방 1건이 표시돼야 함
    await expect(rxRows(page)).toHaveCount(1);
    await expect(rxRows(page).filter({ hasText: PRESEED_DRUG })).toHaveCount(1);
  });
});
