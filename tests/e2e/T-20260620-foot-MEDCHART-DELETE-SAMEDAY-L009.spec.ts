/**
 * T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY — L-009 실클릭 검증 (마이그 적용 후)
 *
 * logic_lock L-009(DUMMY-CHART-VERIFY-STANDING): 차트 동선 변경은 브라우저 실클릭 DoD 의무.
 *   정책 로직 가드 spec(...-POLICY.spec.ts)은 컬럼 미적용 환경에서 graceful skip 하도록 설계됐다.
 *   본 spec 은 supervisor DDL-diff GO → dev-foot 가 마이그 단계1·2 + index_apply(단계3~5)를 prod 에
 *   적용한 **이후** softDeleteEnabled(런타임 스키마 게이트) 활성 상태를 실제 브라우저로 검증한다.
 *
 * 실행: npx playwright test T-20260620-foot-MEDCHART-DELETE-SAMEDAY-L009.spec.ts --project=desktop-chrome
 *   (auth.setup storageState = test admin(role=admin → isDirector) / webServer = localhost:8091)
 *
 * 안전: service_role 로 격리 fixture(고객 1 + medical_charts) 만 생성·회수. 실환자 데이터 무접촉.
 *   삭제 검증은 seed 한 fixture chart 에만 수행(soft-delete, 트리거가 audit DELETE 자동 적재).
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
// 진료의 서명 트리거(enforce_medchart_signing_doctor, 의료법) 충족용 활성 clinic_doctor.
const SIGNING_DOCTOR_ID = 'cd2639d0-a3d6-47f9-901e-5b841a4ce6d0'; // 문지은(is_default)
// E2E 로그인 계정(TEST_EMAIL=test@medibuilder.com=김민경)의 staff 행. 기본 role=coordinator 라
//   isDirector(=role∈{director,admin})=false → soft-delete UI(삭제 버튼·삭제차트 토글) 비노출.
//   삭제 UI 는 director/admin 전용이므로, 본 spec 은 beforeAll 에서 이 계정을 'admin' 으로 일시 승격하고
//   afterAll(Playwright 는 실패 시에도 afterAll 실행)에서 원복한다 → CI/재검 어디서든 결정적 director 실클릭.
//   승격은 이 격리 테스트 계정 1행에만·serial(workers:1)·afterAll 보장 원복 → privilege 잔존 0.
const TEST_STAFF_ID = 'ca0e8887-1163-4c0e-bb43-76b0d56ae383';

// KST 오늘 (visit_date DATE grain)
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

let sb: SupabaseClient;
let customerId: string;
let chartAId: string;
let originalStaffRole: string | null = null;
const ts = Date.now();
const custName = `qa-fixture-L009-${ts}`;

test.describe('L-009 진료차트 soft-delete + 동일일 1차트 (마이그 적용 후 실클릭)', () => {
  test.beforeAll(async () => {
    sb = createClient(SUPA_URL, SERVICE_KEY);
    // 로그인 계정 director 승격(원복은 afterAll) — soft-delete UI 가 isDirector 게이트라 필수.
    const { data: staffRow } = await sb.from('staff').select('role').eq('id', TEST_STAFF_ID).single();
    originalStaffRole = (staffRow?.role as string | undefined) ?? null;
    if (originalStaffRole !== null && originalStaffRole !== 'admin' && originalStaffRole !== 'director') {
      const { error: elevErr } = await sb.from('staff').update({ role: 'admin' }).eq('id', TEST_STAFF_ID);
      if (elevErr) throw new Error(`L009 test-account 승격 실패: ${elevErr.message}`);
    }
    // 격리 고객
    const { data: c, error: cErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: custName, phone: `+8210${String(ts).slice(-8)}`, visit_type: 'new', memo: '[QA-FIXTURE]' })
      .select('id')
      .single();
    if (cErr || !c) throw new Error(`L009 customer seed 실패: ${cErr?.message}`);
    customerId = c.id as string;
    // 오늘자 활성 진료차트 A (내용 보유 → 타임라인 렌더 + 삭제 버튼 대상)
    const { data: mc, error: mcErr } = await sb
      .from('medical_charts')
      .insert({
        customer_id: customerId,
        clinic_id: CLINIC_ID,
        visit_date: todayKST(),
        chief_complaint: 'L009 실클릭 검증용 차트',
        clinical_progress: 'L009 soft-delete 실클릭 시나리오',
        signing_doctor_id: SIGNING_DOCTOR_ID,
        signing_doctor_name: '문지은',
      })
      .select('id')
      .single();
    if (mcErr || !mc) throw new Error(`L009 medical_chart seed 실패: ${mcErr?.message}`);
    chartAId = mc.id as string;
  });

  test.afterAll(async () => {
    if (!sb) return;
    // fixture 회수 — hard-delete(격리 QA 데이터). audit_log 는 감사보존(무삭제).
    if (customerId) {
      await sb.from('medical_charts').delete().eq('customer_id', customerId);
      await sb.from('customers').delete().eq('id', customerId);
    }
    // 로그인 계정 role 원복(승격했던 경우) — privilege 잔존 0 보장.
    if (originalStaffRole !== null && originalStaffRole !== 'admin' && originalStaffRole !== 'director') {
      await sb.from('staff').update({ role: originalStaffRole }).eq('id', TEST_STAFF_ID);
    }
  });

  // ── 시나리오 3(구조): 동일일 2번째 활성차트 INSERT → partial UNIQUE index 23505 차단 ──
  //   FE 는 이 23505 를 잡아 "이미 오늘 차트가 있습니다" 로 append 유도(§B-2 (a)안, source 가드=POLICY.spec).
  //   여기선 DB 강제(uix_mc_customer_clinic_date WHERE is_deleted=false)가 런타임에 실제 작동함을 증명.
  test('AC-2 동일일 1차트: 2번째 활성 차트 INSERT 는 23505(unique_violation) 로 거부된다', async () => {
    const { error } = await sb
      .from('medical_charts')
      .insert({
        customer_id: customerId,
        clinic_id: CLINIC_ID,
        visit_date: todayKST(),
        chief_complaint: '동일일 2번째(차단 대상)',
        signing_doctor_id: SIGNING_DOCTOR_ID,
        signing_doctor_name: '문지은',
      })
      .select('id')
      .single();
    expect(error).not.toBeNull();
    expect((error as { code?: string } | null)?.code).toBe('23505');
  });

  // ── 시나리오 1: 삭제(무효화) 정상 동선 — director/admin 실클릭 ──
  test('AC-1 soft-delete: 삭제 버튼(softDeleteEnabled) → 확인 다이얼로그 → 사유 → 목록 숨김', async ({ page }) => {
    await page.goto(`/chart/${customerId}`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/login')) test.skip(true, '미인증(TEST_PASSWORD 부재) — macstudio + 갤탭 field-soak 에서 실검증');

    // 진료차트 패널 열기 (탭 버튼 — 데이터 유무 무관 항상 렌더)
    const openBtn = page.getByTestId('btn-open-medical-chart');
    await expect(openBtn).toBeVisible({ timeout: 30_000 });
    await openBtn.click();

    // 삭제 버튼 노출 = softDeleteEnabled(is_deleted 컬럼 실재) 런타임 활성 증명
    const deleteBtn = page.getByTestId(`chart-delete-${chartAId}`);
    await expect(deleteBtn).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/L009/01-delete-button-visible.png', fullPage: true });

    await deleteBtn.click();
    const confirm = page.getByTestId('chart-delete-confirm');
    await expect(confirm).toBeVisible();
    await page.getByTestId('chart-delete-reason').fill('L-009 실클릭 검증(중복/오입력 무효화)');
    await page.screenshot({ path: 'test-results/L009/02-delete-confirm-dialog.png', fullPage: true });
    await page.getByTestId('chart-delete-confirm-ok').click();

    // 다이얼로그 닫힘 + 활성 목록에서 해당 차트 삭제 버튼 사라짐(목록 숨김)
    await expect(confirm).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId(`chart-delete-${chartAId}`)).toHaveCount(0, { timeout: 10_000 });
    await page.screenshot({ path: 'test-results/L009/03-after-delete-hidden.png', fullPage: true });

    // DB 진실검증: is_deleted=true + audit_log DELETE 1행
    const { data: row } = await sb.from('medical_charts').select('is_deleted,delete_reason').eq('id', chartAId).single();
    expect(row?.is_deleted).toBe(true);
    const { count } = await sb
      .from('medical_charts_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('medical_chart_id', chartAId)
      .eq('operation', 'DELETE');
    expect((count ?? 0)).toBeGreaterThanOrEqual(1);
  });

  // ── 시나리오 2: "삭제된 차트 보기" 토글 + 삭제됨 배지 (director + 삭제차트 존재) ──
  test('AC-1 가시성: 삭제된 차트 보기 토글 → 삭제됨 배지 노출 (관리자 전용 열람)', async ({ page }) => {
    await page.goto(`/chart/${customerId}`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('/login')) test.skip(true, '미인증 — field-soak 에서 실검증');
    await page.getByTestId('btn-open-medical-chart').click();

    const toggle = page.getByTestId('toggle-show-deleted-charts');
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect(page.getByTestId('timeline-deleted-badge').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/L009/04-deleted-toggle-badge.png', fullPage: true });
  });
});
