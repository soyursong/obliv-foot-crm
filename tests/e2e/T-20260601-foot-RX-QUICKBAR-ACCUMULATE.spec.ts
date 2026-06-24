/**
 * E2E spec — T-20260601-foot-RX-QUICKBAR-ACCUMULATE
 * 진료차트(DoctorTreatmentPanel) 처방 탭 빠른삽입 항목 누적 버그 수정
 *
 * ⚠ T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL Part E (REPLACE, 2026-06-24 문지은 대표원장):
 *   처방 탭의 빠른처방 버튼 바(QuickRxBar)가 묶음처방 태그(BundleRxTagBar)로 대체됨.
 *   본 누적 버그(아래)는 처방 탭 부모(DoctorTreatmentPanel)의 setRxItems 콜백 로직이라 surface 교체와 무관하게 유지 —
 *   따라서 본 spec 을 QuickRxBar 버튼 클릭 → BundleRxTagBar 태그 칩 클릭으로 retarget(동일 누적/dedup 경로 검증).
 *
 * 배경: CheckInDetailSheet → DoctorTreatmentPanel(진료 중/examination) 처방 탭의
 *   빠른삽입 onSelectItems 콜백이 setRxItems append 직후 `setFieldsSynced(false)` 를 호출 →
 *   다음 렌더에서 최초 동기화 블록이 재실행되어 방금 누적한 (미저장) 항목이 DB 상태로 리셋 → 누적 소실.
 *   수정: DoctorTreatmentPanel.tsx 빠른삽입 onSelectItems 콜백 내 `setFieldsSynced(false)` 제거.
 *   (FE only, db_change:false. 최초 1회 동기화 블록 !fieldsSynced 은 유지 → 환자 전환 회귀 없음)
 *
 *   ※ T-20260601-foot-RX-SET-ACCUMULATE(MedicalChartPanel)와 별개 surface — 중복 아님.
 *     본 건은 DoctorTreatmentPanel 처방 탭 빠른삽입(현 BundleRxTagBar) 경로.
 *
 * 검증 전략: 라이브 데이터 의존(skip) 회피 — SUPABASE_SERVICE_ROLE_KEY 로 beforeAll 에서
 *   고객 2건 + prescription_sets 2건(A 약1개 / B 약1개, 태그 부여 → BundleRxTagBar 칩 노출) +
 *   check_in 2건(P1: examination·처방 빈 상태 / P2: examination·DB에 처방 1건 선존재)을
 *   결정론적으로 seed → 대시보드 칸반 카드 클릭 → 진료 패널 처방 탭 → 묶음처방 태그 칩 누적 검증.
 *   afterAll 정리. SERVICE_KEY 없으면 환경 skip.
 *
 * AC-1: 묶음처방 태그 칩 클릭 시 항목 추가
 * AC-2: 다른 태그 이어 클릭 시 기존 항목 위에 누적 (덮어쓰기 X) — 핵심 버그
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
// Part E retarget: 묶음처방 태그 라벨(BundleRxTagBar 칩에 노출). tag_color 부여돼야 칩 렌더.
const TAG_A_LABEL = `빠처A${SUFFIX}`;
const TAG_B_LABEL = `빠처B${SUFFIX}`;
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

  // ── QA-FIX(phase3): Dashboard.openChartFor 는 진료 패널(CheckInDetailSheet, z-50)과
  //    함께 2번차트(CustomerChartSheet, z-70)를 동시에 연다. 2번차트가 진료 패널 위를 덮어
  //    그 로딩 오버레이("불러오는 중...")가 처방 탭 클릭 포인터를 가로막아 timeout 발생.
  //    → 진료 패널을 조작하기 전에 2번차트를 ESC 로 닫고(닫힘 완료까지 대기) 오버레이를 제거한다.
  //    CustomerChartSheet 의 ESC 핸들러는 document capture 단계 + stopPropagation 이고,
  //    CheckInDetailSheet(Radix Sheet)의 ESC 는 bubble 단계 → capture 가 먼저 stopPropagation
  //    하므로 ESC 는 2번차트만 닫고 진료 패널은 유지된다. (닫기 버튼은 CustomerChartPage 헤더에
  //    가려 actionable 하지 않으므로 사용하지 않음)
  //
  //    ⚠ 재오픈 race(phase3 보강): CheckInDetailSheet 는 resolvedCustomerId 비동기 해석 완료 시점에
  //    openChart 를 자동 호출(설계 — 모든 슬롯 2번차트 자동오픈, CheckInDetailSheet L574/L595). 따라서
  //    차트 로드가 끝나기 전에 ESC 로 닫으면 직후 해석 완료로 차트가 재오픈돼 처방 탭 클릭을 다시 가로막는다.
  //    → (a) 차트 콘텐츠 로드 완료("불러오는 중..." 소멸)를 먼저 기다려 자동오픈 deps 를 안정화한 뒤,
  //       (b) ESC 로 닫고, (c) 닫힘이 1.2초 유지(재오픈 없음)될 때까지 반복 확인한다.
  const chartSheet = page.getByTestId('customer-chart-sheet');
  try {
    await chartSheet.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    // 미연결 고객 등 2번차트가 안 열린 케이스 — 무시하고 진행
  }
  if ((await chartSheet.count()) > 0) {
    // (a) 차트 콘텐츠 로드 완료 대기 — resolvedCustomerId 비동기 해석/자동오픈 deps 안정화.
    //     로딩 오버레이가 사라지면 차트가 완전 마운트됨 = 이후 자동 재오픈 트리거 없음.
    await chartSheet
      .getByText('불러오는 중...', { exact: true })
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => { /* 오버레이가 이미 없거나 미검출 — 진행 */ });
    // (b)+(c) ESC 닫기 → 닫힘이 1.2초 유지되는지 확인(재오픈 race 통과). 최대 6회.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Escape');
      try {
        await expect(chartSheet).toBeHidden({ timeout: 3_000 });
      } catch {
        // 아직 핸들러 미부착/로딩 중 — 잠시 후 재시도
        await page.waitForTimeout(400);
        continue;
      }
      // 닫힘 확인됨 — 1.2초간 재오픈(자동오픈 race) 없는지 감시
      await page.waitForTimeout(1200);
      if ((await chartSheet.count()) === 0) break;
    }
  }
  await expect(chartSheet).toHaveCount(0);

  // 진료 패널 마운트 (status=examination)
  await expect(page.getByTestId('doctor-treatment-panel')).toBeVisible({ timeout: 10_000 });
  const rxTab = page.getByTestId('doctor-tab-prescription');
  await rxTab.scrollIntoViewIfNeeded();
  await rxTab.click();
  // Part E: 빠른삽입 surface 가 QuickRxBar → BundleRxTagBar(묶음처방 태그 칩) 로 교체됨.
  await expect(page.getByTestId('bundle-rx-tag-bar')).toBeVisible({ timeout: 10_000 });
}

/** 진료 패널 처방내역 행 (DoctorTreatmentPanel 의 prescription-item-row) */
function rxRows(page: Page) {
  return page.getByTestId('prescription-item-row');
}

/** 묶음처방 태그 칩 — testid=bundle-rx-tag-{prescription_set id}. */
function bundleTag(page: Page, setId: number) {
  return page.getByTestId(`bundle-rx-tag-${setId}`);
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

    // 처방세트 2건 (각 약 1개) — Part E: 태그(tag_label+tag_color) 부여 → BundleRxTagBar 칩으로 노출.
    const { data: setA, error: aErr } = await admin.from('prescription_sets')
      .insert({ name: SET_A_NAME, items: [mkItem(A_DRUG)], is_active: true, sort_order: 9101, tag_label: TAG_A_LABEL, tag_color: 'teal' })
      .select('id').single();
    if (aErr || !setA) throw new Error(`prescription_set A seed 실패: ${aErr?.message}`);
    const { data: setB, error: bErr } = await admin.from('prescription_sets')
      .insert({ name: SET_B_NAME, items: [mkItem(B_DRUG)], is_active: true, sort_order: 9102, tag_label: TAG_B_LABEL, tag_color: 'sky' })
      .select('id').single();
    if (bErr || !setB) throw new Error(`prescription_set B seed 실패: ${bErr?.message}`);

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
      checkIn1Id: ci1.id as string, checkIn2Id: ci2.id as string,
    };
  });

  // ── cleanup: check_in → set → customer · best-effort ──────────────────────────
  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('check_ins').delete().in('id', [seed.checkIn1Id, seed.checkIn2Id]);
    await admin.from('prescription_sets').delete().in('id', [seed.setAId, seed.setBId]);
    await admin.from('customers').delete().in('id', [seed.cust1Id, seed.cust2Id]);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1/AC-2/AC-3: 시나리오 1(누적) + 시나리오 2(중복 엣지) ──────────────────
  test('AC-1/2/3: 묶음처방 태그 A 클릭 → B 클릭 → A 유지된 채 B 누적 (덮어쓰기 X) + 동일 태그 중복 X', async ({ page }) => {
    await openTreatmentRxTab(page, CUST1_NAME);

    // AC-1: 묶음처방 태그 A 클릭 → 1행 추가
    await bundleTag(page, seed!.setAId).click();
    await expect(rxRows(page)).toHaveCount(1);
    // 처방행으로 한정해 누적 실체만 단언한다(약명이 다른 영역에도 노출될 수 있으므로 strict 회피).
    await expect(rxRows(page).filter({ hasText: A_DRUG })).toHaveCount(1);

    // AC-2(핵심 버그): B 이어 클릭 → A 사라지지 않고 누적 (2행). 버그 시 setFieldsSynced(false) 로 DB(빈) 리셋되어 0~1행.
    await bundleTag(page, seed!.setBId).click();
    await expect(rxRows(page)).toHaveCount(2);
    await expect(rxRows(page).filter({ hasText: A_DRUG })).toHaveCount(1); // A 보존
    await expect(rxRows(page).filter({ hasText: B_DRUG })).toHaveCount(1); // B 누적

    // AC-3: 동일 태그 A 재클릭 → name 중복 필터로 추가 안 됨 (여전히 2행)
    await bundleTag(page, seed!.setAId).click();
    await expect(rxRows(page)).toHaveCount(2);
  });

  // ── AC-4: 저장 → 재진입 후 누적 항목 유지 · DB 영속 ────────────────────────────
  test('AC-4: 묶음처방 태그 A+B 누적 → 임시 저장 → 재진입 시 2행 유지', async ({ page }) => {
    await openTreatmentRxTab(page, CUST1_NAME);

    await bundleTag(page, seed!.setAId).click();
    await expect(rxRows(page)).toHaveCount(1); // A 누적 확인 후 B 클릭(연속 클릭 레이스 방지)
    await bundleTag(page, seed!.setBId).click();
    await expect(rxRows(page)).toHaveCount(2);

    // 처방 임시 저장 — ⚠ 처방 탭 전용 저장 버튼(testid)을 정확히 타게팅한다.
    //   진료 패널엔 '임시 저장' 버튼이 탭별로 3개(차팅/처방/서류) 존재 → getByRole(name).first() 는
    //   탭 전환 타이밍에 차팅 탭 버튼(handleSaveNote=doctor_note 저장)을 잡아 prescription_items 가
    //   영속되지 않는 race 가 있었다(재진입 0행 재현, baseline 에서도 간헐 실패). 처방 탭 저장은
    //   rx-temp-save-btn(handleSaveRx → prescription_items 영속)으로 고정해 결정론화.
    const saveBtn = page.getByTestId('rx-temp-save-btn');
    await expect(saveBtn).toBeEnabled();

    // ⚠ 저장 완료 대기는 PATCH 응답 커밋으로 결정화한다(QA-FIX 2026-06-25, RC: 네비게이션-abort).
    //   기존 `toBeEnabled()` 재단언은 비결정적이었다: 버튼이 `disabled={save.isPending}` 인데
    //   click 직후 isPending=true 리렌더가 일어나기 전 폴링이 "enabled" 를 즉시 관찰 → 단언이 ~200ms 만에
    //   통과 → 직후 page.goto(재진입)가 아직 in-flight 인 check_ins PATCH 를 abort → prescription_items
    //   미커밋 → 재진입 0행(trace 상 PATCH status=-1 로 확인). DB write 자체는 정상(admin RLS ALL).
    //   → click 직전 PATCH 응답 대기(waitForResponse)를 걸어 "서버 커밋 완료" 를 본 뒤에만 재진입한다.
    //     update() 는 .select() 없이 204 를 반환하므로 status<300(ok) 으로 판정.
    const savePatch = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/check_ins') &&
        r.request().method() === 'PATCH' &&
        r.status() < 300,
      { timeout: 15_000 },
    );
    await saveBtn.click();
    await savePatch; // 서버 커밋 확정(navigation-abort 방지)
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 }); // isPending 해제(낙관적 마무리)

    // 재진입 → DB 영속 확인 (2행 복원)
    //   ⚠ 재진입 후 처방행은 패널 마운트 시 check_in.prescription_items 를 비동기 fetch(L165)해 채운다.
    //   풀 스위트 부하에서 이 fetch 가 기본 5초 단언 타임아웃을 넘길 수 있어 15초로 확장(영속 자체는 정상).
    await openTreatmentRxTab(page, CUST1_NAME);
    await expect(rxRows(page)).toHaveCount(2, { timeout: 15_000 });
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
