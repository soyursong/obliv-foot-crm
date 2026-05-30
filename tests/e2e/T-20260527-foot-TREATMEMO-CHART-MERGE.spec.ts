/**
 * E2E spec — T-20260527-foot-TREATMEMO-CHART-MERGE
 * 치료메모 뷰어를 우측 패널 '별도 탭' → [치료사차트] 섹션 통합 검증
 *
 * 배경: 5/26 MEDCHART-SYNC(8fee665) 로 진료차트 Drawer 우측 패널에 '치료메모' 탭이
 *   추가됐으나, 김주연 총괄 요청으로 별도 탭을 제거하고 [치료사차트] 섹션 안에 통합 표시.
 *   commit 03084ca — MedicalChartPanel.tsx: right-panel-tab-treat_memo 제거 +
 *   loadData() Promise.all 에 customer_treatment_memos 통합 + treat-memo-in-chart-section 렌더.
 *
 * 검증 전략: 라이브 데이터 의존(skip) 회피 — SUPABASE_SERVICE_ROLE_KEY(.env 로드)로
 *   beforeAll 에서 customer(치료메모 보유 / 미보유) 2건 + customer_treatment_memos 1건을
 *   결정론적으로 seed → /chart/:customerId 에서 진료차트 Drawer 오픈 → 통합 위치 검증.
 *   afterAll 에서 정리. SERVICE_KEY 없으면 환경 skip.
 *
 * AC-1: 치료메모 이력이 [치료사차트] 섹션(treat-memo-in-chart-section)에 통합 표시
 *       + 우측 패널 별도 '치료메모' 탭(right-panel-tab-treat_memo) 제거
 * AC-2: 통합 치료메모는 읽기전용 (입력 필드 없음 + '읽기전용' 라벨)
 * AC-3: 기존 치료사차트(medical-chart-treatment) 콘텐츠 영역 보존 (readonly)
 * AC-4: 치료메모 없는 고객 → 통합 섹션 미표시 (에러 없음)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

// ── seed 식별자 (afterAll 정리용) ─────────────────────────────────────────────
const SUFFIX = `${Date.now().toString().slice(-7)}`;
const NAME_WITH_MEMO = `E2E치료메모보유${SUFFIX}`;
const NAME_NO_MEMO = `E2E치료메모없음${SUFFIX}`;
const MEMO_CONTENT = `E2E치료메모${SUFFIX} 통합위치검증 본문`;

interface SeedIds {
  clinicId: string;
  custWithMemoId: string;
  custNoMemoId: string;
  memoId: string;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/** 진료차트 Drawer 오픈 — /chart/:id 진입 후 진료차트 버튼 클릭 → drawer visible */
async function openMedicalChart(page: Page, customerId: string): Promise<void> {
  await page.goto(`/chart/${customerId}`);
  const btn = page.getByTestId('btn-open-medical-chart');
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 10_000 });
  // 중앙 진료기록 폼(치료사차트 포함) 렌더 + loadData 완료 대기
  await expect(page.getByTestId('medical-chart-form')).toBeVisible({ timeout: 10_000 });
}

test.describe('T-20260527 TREATMEMO-CHART-MERGE — 치료메모 [치료사차트] 통합 검증', () => {
  // ── seed: 클리닉 + 고객 2건(메모 보유/미보유) + 치료메모 1건 ──────────────────
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return; // SERVICE_KEY 없으면 seed 불가 → 각 테스트 환경 skip
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;

    // 고객 2명 (E.164: +82 + 10자리)
    const { data: custWith, error: cwErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: NAME_WITH_MEMO, phone: `+82109${SUFFIX}` })
      .select('id').single();
    if (cwErr || !custWith) throw new Error(`customer(with-memo) seed 실패: ${cwErr?.message}`);

    const { data: custNo, error: cnErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: NAME_NO_MEMO, phone: `+82108${SUFFIX}` })
      .select('id').single();
    if (cnErr || !custNo) throw new Error(`customer(no-memo) seed 실패: ${cnErr?.message}`);

    // 치료메모 1건 (with-memo 고객에만)
    const { data: memo, error: mErr } = await admin.from('customer_treatment_memos')
      .insert({
        clinic_id: clinicId,
        customer_id: custWith.id,
        content: MEMO_CONTENT,
        created_by: null,
        created_by_name: 'E2E치료사',
        memo_type: '치료메모', // ctm_memo_type_check: '치료메모'|'진료메모'|'특이사항'
      }).select('id').single();
    if (mErr || !memo) throw new Error(`treatment_memo seed 실패: ${mErr?.message}`);

    seed = { clinicId, custWithMemoId: custWith.id, custNoMemoId: custNo.id, memoId: memo.id };
  });

  // ── cleanup: 메모 → 고객 (FK) · best-effort ───────────────────────────────────
  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('customer_treatment_memos').delete().eq('id', seed.memoId);
    await admin.from('customers').delete().in('id', [seed.custWithMemoId, seed.custNoMemoId]);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 skip');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — skip');
  });

  // ── AC-1/2/3: 치료메모 보유 고객 — 통합 위치·읽기전용·기존 치료사차트 보존 ────────
  test('AC-1/2/3: 치료메모가 [치료사차트] 섹션에 통합 + 별도 탭 제거 + 읽기전용', async ({ page }) => {
    await openMedicalChart(page, seed!.custWithMemoId);

    // AC-1: 우측 패널 '치료메모' 별도 탭 제거 확인 (관련 탭은 잔존)
    await expect(page.getByTestId('right-panel-tab-treat_memo')).toHaveCount(0);
    await expect(page.getByTestId('right-panel-tab-rx')).toBeVisible();
    await expect(page.getByTestId('right-panel-tab-visit_hist')).toBeVisible();

    // AC-1: 치료메모 이력이 [치료사차트] 섹션에 통합 표시
    const memoSection = page.getByTestId('treat-memo-in-chart-section');
    await expect(memoSection).toBeVisible({ timeout: 10_000 });
    await expect(memoSection.getByText('치료메모 이력')).toBeVisible();
    const memoItems = page.getByTestId('treat-memo-item');
    await expect(memoItems.first()).toBeVisible();
    await expect(memoSection).toContainText(MEMO_CONTENT);

    // AC-2: 통합 치료메모는 읽기전용 — 섹션 내 편집 가능한 입력 필드 없음 + '읽기전용' 라벨
    await expect(memoSection.locator('input, textarea')).toHaveCount(0);
    await expect(memoSection.getByText('읽기전용')).toBeVisible();

    // AC-3: 기존 치료사차트(treatment_record) 영역 보존 + readonly
    const treatmentField = page.getByTestId('medical-chart-treatment');
    await expect(treatmentField).toBeVisible();
    await expect(treatmentField).toHaveAttribute('readonly', '');
  });

  // ── AC-4: 치료메모 없는 고객 — 통합 섹션 미표시 (에러 없음) ─────────────────────
  test('AC-4: 치료메모 없는 고객은 통합 섹션 미표시 + 런타임 에러 없음', async ({ page }) => {
    await openMedicalChart(page, seed!.custNoMemoId);

    // 통합 치료메모 섹션 미렌더 (treatMemos.length === 0)
    await expect(page.getByTestId('treat-memo-in-chart-section')).toHaveCount(0);
    // 별도 탭도 여전히 제거 상태
    await expect(page.getByTestId('right-panel-tab-treat_memo')).toHaveCount(0);
    // 기존 치료사차트 영역은 정상 렌더 (에러 없이 폼 표시)
    await expect(page.getByTestId('medical-chart-treatment')).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Unhandled Runtime Error');
  });
});
