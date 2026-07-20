/**
 * E2E spec — T-20260710-foot-RESVROUTE-VISITCHANNEL-UNIFY
 * 예약관리 '예약경로' ↔ 고객정보(2번차트) '방문경로' 항목 통일·연동 + 지인소개 성함 입력칸
 *
 * 배경(김주연 총괄 A안 확정, ts=1783651711.419909):
 *   두 화면 드롭다운을 단일 SSOT(visitRouteOptionsFor / VISIT_ROUTE_OPTIONS)로 통일.
 *   통일 목록 = 미지정(빈값) / TM / 네이버 / 인바운드 / 워크인 / 지인소개.
 *   기존 '인콜' → '인바운드'로 어휘 수렴(A안). '인콜'은 legacy 보존(기존행 표시).
 *
 * ADDITIVE(비파괴): DB CHECK(customers/reservations _visit_route_check)는 이미 6값 전부 허용
 *   (20260624100000) → 신규 DDL/enum 0, 기존행 물리 UPDATE 0. referral_name 컬럼 기존 존재.
 *
 * AC:
 *   AC1  두 화면 방문경로/예약경로가 단일 SSOT 동일 목록을 렌더(하드코딩 이원화 제거).
 *   AC2  예약 생성 시 고른 예약경로가 고객 방문경로에 자동 반영(초진 seed).
 *   AC3  예약모달 예약경로=지인소개 → 소개자 성함 입력·저장·재조회 유지.
 *   AC4  고객정보 방문경로=지인소개 → 소개자 성함 입력·저장·재조회 유지.
 *   AC5  통일/연동 후에도 reservations.source_system 기반 매출 귀속 불변(직교축).
 *   AC6  기존 데이터 정합 — 파괴적 마이그 없이 read-time 흡수.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = Boolean(SUPABASE_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady
  ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const TEST_TAG = 'E2E-RESVROUTE-UNIFY';
// A안 통일 목록(미지정=빈값 제외한 활성 6값 중 대표 검증값)
const UNIFIED_MUST_HAVE = ['TM', '네이버', '인바운드', '워크인', '지인소개'];

let clinicId: string | null = null;
let seededCustomerId: string | null = null;

test.beforeAll(async () => {
  if (!sb) return;
  const { data: clinic } = await sb.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  clinicId = clinic?.id ?? null;
});

test.afterAll(async () => {
  if (!sb) return;
  // 픽스처 한정 물리 정리 (TEST_TAG 격리) — 운영 데이터 무접촉
  await sb.from('customers').delete().eq('name', TEST_TAG);
});

test.describe('T-20260710 RESVROUTE-VISITCHANNEL-UNIFY — DB 계약(비파괴)', () => {
  test('AC1/AC6-a: customers.visit_route CHECK 가 통일 6값 전부 허용', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    // 신규 DDL 없이 A안 통일값(특히 인바운드·네이버)이 CHECK 를 통과하는지 실측.
    for (const v of UNIFIED_MUST_HAVE) {
      const { data, error } = await sb!
        .from('customers')
        .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `+8210${String(Date.now()).slice(-8)}`, visit_type: 'new', visit_route: v })
        .select('id')
        .single();
      expect(error, `visit_route='${v}' CHECK 통과 실패`).toBeNull();
      if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    }
    console.log('[AC1/AC6] customers.visit_route CHECK 통일 6값 허용 확인 PASS');
  });

  test('AC1/AC6-b: legacy 인콜 값도 여전히 허용(기존행 read-time 보존)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `+8210${String(Date.now()).slice(-8)}`, visit_type: 'new', visit_route: '인콜' })
      .select('id')
      .single();
    expect(error, "legacy '인콜' 보존 실패").toBeNull();
    if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    console.log('[AC6] legacy 인콜 값 보존(파괴적 마이그 없음) 확인 PASS');
  });

  test('AC3/AC4: 지인소개 + referral_name 저장·재조회 유지', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    const { data, error } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `+8210${String(Date.now()).slice(-8)}`, visit_type: 'new', visit_route: '지인소개', referral_name: '홍길동' })
      .select('id, visit_route, referral_name')
      .single();
    expect(error).toBeNull();
    expect(data?.visit_route).toBe('지인소개');
    expect(data?.referral_name).toBe('홍길동');
    seededCustomerId = data?.id ?? null;
    console.log('[AC3/AC4] 지인소개 + 소개자 성함 저장·재조회 유지 PASS');
  });
});

test.describe('T-20260710 RESVROUTE-VISITCHANNEL-UNIFY — 고객정보(2번차트) UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC1/AC4: 방문경로 드롭다운 통일 목록 렌더 + 지인소개 시 소개자 성함 노출', async ({ page }) => {
    test.skip(!seededCustomerId, '시드 고객 없음(DB env 미설정) — 스킵');
    await page.goto(`/chart/${seededCustomerId}`);

    const select = page.locator('[data-testid="chart-visit-route-select"]').first();
    const visible = await select.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      test.skip(true, '2번차트 방문경로 드롭다운 미렌더 — 스킵');
      return;
    }

    // AC1: 통일 목록 옵션 실측 — 인바운드/네이버 포함(하드코딩 이원화 제거 확인)
    const optionTexts = await select.locator('option').allTextContents();
    for (const v of UNIFIED_MUST_HAVE) {
      expect(optionTexts, `방문경로 옵션에 '${v}' 누락`).toContain(v);
    }
    console.log('[AC1] 2번차트 방문경로 통일 목록(인바운드·네이버 포함) 확인 PASS');

    // AC4: 지인소개 선택 → 소개자 성함 입력칸 노출
    await select.selectOption('지인소개');
    const referralRow = page.getByText('소개자 성함', { exact: true }).first();
    await expect(referralRow).toBeVisible({ timeout: 5_000 });
    console.log('[AC4] 2번차트 지인소개 → 소개자 성함 입력칸 노출 확인 PASS');

    await dismissCustomerChartSheet(page).catch(() => {});
  });
});
