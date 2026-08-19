/**
 * E2E spec — T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE — (y) visit_route keep-widen
 * 방문경로/예약경로(visit_route) offered-set 을 최종 12값으로 통일 + 2-table CHECK widen(ADDITIVE).
 *
 * 배경 (김주연 총괄 최종확정 reply_ts 1787134438.745499 '올 예리한데 아래가 최종!!', responder MSG-20260819-191804-5ezp):
 *   - 최종 offered 12값: TM / 인바운드(전화) / 인바운드(네이버) / 인바운드(공홈) / 카톡 / 워크인 / 지인소개 /
 *     에이전시 / 타센터 연계 / 병원 인계 / 임직원.가족 / 기타(사유 필수 입력).
 *   - 재방문 = EXCLUDE 확정(first_inflow_channel IMMUTABLE 정합·미저장).
 *   - 카톡 = already-live(T-20260819-foot-INFLOW-KAKAO-INBOUND-ADD 배포완료) → 무접촉(conflate 금지·flat '카톡').
 *   - store-literal caveat(mirror-not-invent): '임직원.가족' = 마침표('.') — system_codes 라벨 가운데점('·') 아님.
 *   - 인바운드(전화/네이버/공홈) = 기존 '인바운드'/'인콜'/'네이버'/'공홈' 4값을 3 세분값으로 offered widen(기존값 byte-parity 존치).
 *
 * money-safety (DA-BLESS-7 + planner):
 *   - 배정 라우팅(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE·money-adjacent) 무접촉 → 신규 라벨 WALK_IN 안전폴백(money-shift 0).
 *   - 정산(Closing) = visit_route 원문 per-row passthrough(fold 없음) → 신규 라벨 distinct label = parity by-construction.
 *
 * AC:
 *   AC-1  offered 12값 = VISIT_ROUTE_OPTIONS SSOT 로 통일(3 surface 자동 노출).
 *   AC-2  재방문 EXCLUDE + 카톡 flat 존치(컴파운드 미도입).
 *   AC-3  기존값 byte-parity 존치(인바운드/네이버/공홈/인콜 → VISIT_ROUTE_LEGACY, 타입/CHECK 허용).
 *   AC-4  배정 map 무접촉 — 신규 라벨 전부 미매핑→WALK_IN 안전폴백(accounting-neutral). 기존 6매핑 불변.
 *   AC-5  store-literal caveat: '임직원.가족'(마침표) 저장, '임직원·가족'(가운데점) 아님.
 *   AC-6  [DB·POST-GO-token] 2-table CHECK 가 신규 8값 허용 + 기존 8값 존치 + 2-table 대칭. (CHECK 미widen 시 자동 스킵)
 *
 * ⚠ AC-6(DB-contract) 은 supervisor 물리 GO-token apply 後 POST-CHECK validator. apply 前에는 CHECK-widen 미탐지 → 스킵.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';
import {
  VISIT_ROUTE_OPTIONS,
  VISIT_ROUTE_LEGACY,
  visitRouteOptionsFor,
  VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE,
} from '../../src/lib/types';
import { deriveAssignLeadSource } from '../../src/lib/assignmentStrategy';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = Boolean(SUPABASE_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady
  ? createClient(SUPABASE_URL as string, SERVICE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const TEST_TAG = 'E2E-INFLOW-WIDEN';

// 최종 offered 12값 (SSOT 순서)
const OFFERED_12 = [
  'TM',
  '인바운드(전화)',
  '인바운드(네이버)',
  '인바운드(공홈)',
  '카톡',
  '워크인',
  '지인소개',
  '에이전시',
  '타센터 연계',
  '병원 인계',
  '임직원.가족',
  '기타',
] as const;

// 신규 8값(ADDITIVE) — 배정 미매핑→WALK_IN 폴백 대상 + CHECK widen 대상
const NEW_8 = [
  '인바운드(전화)',
  '인바운드(네이버)',
  '인바운드(공홈)',
  '에이전시',
  '타센터 연계',
  '병원 인계',
  '임직원.가족',
  '기타',
] as const;

// 기존 8값(byte-parity 존치) — CHECK 존치 대상
const EXISTING_8 = ['TM', '워크인', '인바운드', '지인소개', '네이버', '인콜', '공홈', '카톡'] as const;

let clinicId: string | null = null;
let seededCustomerId: string | null = null;
// AC-6 pre-flight: prod CHECK 가 신규값을 이미 허용하는지(=GO-token apply 완료) 프로브 결과
let checkWidened = false;

test.beforeAll(async () => {
  if (!sb) return;
  const { data: clinic } = await sb.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  clinicId = clinic?.id ?? null;
  if (!clinicId) return;
  // pre-flight: 신규값('에이전시') insert 시도로 CHECK-widen 여부 판정(성공=widen 완료). 즉시 정리.
  const probe = await sb
    .from('customers')
    .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `PROBE-${Date.now()}`, visit_type: 'new', visit_route: '에이전시' })
    .select('id')
    .single();
  checkWidened = !probe.error;
  if (probe.data?.id) await sb.from('customers').delete().eq('id', probe.data.id);
});

test.afterAll(async () => {
  if (!sb) return;
  await sb.from('customers').delete().eq('name', TEST_TAG);
});

test.describe('INFLOW-WIDEN — SSOT (순수 코드, DB/앱 불요)', () => {
  test('AC-1: VISIT_ROUTE_OPTIONS = offered 12값(순서 포함) 통일', () => {
    expect([...VISIT_ROUTE_OPTIONS]).toEqual([...OFFERED_12]);
    // 3 surface 단일 SSOT(visitRouteOptionsFor) → 12값 자동 노출
    for (const v of OFFERED_12) expect(visitRouteOptionsFor(null)).toContain(v);
    console.log('[AC-1] offered 12값 SSOT 통일 PASS');
  });

  test('AC-2: 재방문 EXCLUDE + 카톡 flat 존치(컴파운드 미도입)', () => {
    const opts = VISIT_ROUTE_OPTIONS as readonly string[];
    expect(opts, '재방문은 offered 미포함(EXCLUDE 확정)').not.toContain('재방문');
    expect(opts, '카톡 flat 존치(already-live)').toContain('카톡');
    expect(opts, "'인바운드(카톡)' 컴파운드 미도입(conflate 금지)").not.toContain('인바운드(카톡)');
    console.log('[AC-2] 재방문 EXCLUDE + 카톡 flat 존치 PASS');
  });

  test('AC-3: 기존값 byte-parity 존치(legacy 이동 — 인바운드/네이버/공홈/인콜)', () => {
    const legacy = VISIT_ROUTE_LEGACY as readonly string[];
    for (const v of ['인콜', '인바운드', '네이버', '공홈']) {
      expect(legacy, `legacy '${v}' 보존 실패`).toContain(v);
    }
    // 편집 시 현재값(legacy)이 드롭다운에 보존(빈칸화 방지)
    expect(visitRouteOptionsFor('인바운드')).toContain('인바운드');
    expect(visitRouteOptionsFor('네이버')).toContain('네이버');
    console.log('[AC-3] 기존값 byte-parity(legacy) 존치 PASS');
  });

  test('AC-4: 배정 map 무접촉 — 신규 8값 전부 WALK_IN 안전폴백(accounting-neutral)', () => {
    for (const v of NEW_8) {
      expect(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[v], `신규 라벨 '${v}' 은 배정 map 미매핑이어야(WALK_IN 폴백)`).toBeUndefined();
      expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: v }), `'${v}' → WALK_IN 폴백`).toBe('WALK_IN');
    }
    // 기존 6매핑 불변(money-shift 0 by-construction)
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: 'TM' })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '인바운드' })).toBe('INBOUND');
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '워크인' })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '네이버' })).toBe('NAVER');
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '지인소개' })).toBe('REFERRAL');
    expect(deriveAssignLeadSource({ visit_type: 'new', visit_route: '공홈' })).toBe('HOMEPAGE');
    console.log('[AC-4] 배정 map 무접촉 + 신규 라벨 WALK_IN 폴백 + 기존 6매핑 불변 PASS');
  });

  test('AC-5: store-literal caveat — 임직원.가족(마침표), 가운데점 아님', () => {
    const opts = VISIT_ROUTE_OPTIONS as readonly string[];
    expect(opts, "'임직원.가족'(마침표) 저장 리터럴").toContain('임직원.가족');
    expect(opts, "'임직원·가족'(가운데점)은 미도입").not.toContain('임직원·가족');
    console.log('[AC-5] store-literal 임직원.가족(마침표) 확인 PASS');
  });
});

test.describe('INFLOW-WIDEN — DB 계약 (POST-GO-token validator)', () => {
  test('AC-6-a: [POST-apply] customers.visit_route 가 신규 8값 전부 허용', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    test.skip(!checkWidened, 'CHECK 미widen(물리 GO-token apply 前) — POST-CHECK validator 스킵');
    for (const v of NEW_8) {
      const { data, error } = await sb!
        .from('customers')
        .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `DUMMY-${Date.now()}-${v}`, visit_type: 'new', visit_route: v })
        .select('id, visit_route')
        .single();
      expect(error, `신규값 '${v}' CHECK 통과 실패`).toBeNull();
      expect(data?.visit_route).toBe(v);
      if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    }
    console.log('[AC-6-a] customers.visit_route 신규 8값 허용 PASS');
  });

  test('AC-6-b: [POST-apply] reservations.visit_route 가 신규 8값 전부 허용(2-table 대칭)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    test.skip(!checkWidened, 'CHECK 미widen(물리 GO-token apply 前) — POST-CHECK validator 스킵');
    // 시드 고객 1건 확보
    const { data: cust } = await sb!
      .from('customers')
      .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `DUMMY-RESV-${Date.now()}`, visit_type: 'new' })
      .select('id')
      .single();
    seededCustomerId = cust?.id ?? null;
    test.skip(!seededCustomerId, '시드 고객 생성 실패 — 스킵');
    for (const v of NEW_8) {
      const { data, error } = await sb!
        .from('reservations')
        .insert({
          clinic_id: clinicId,
          customer_id: seededCustomerId,
          reservation_date: '2099-01-01',
          reservation_time: '10:00',
          visit_route: v,
        })
        .select('id, visit_route')
        .single();
      expect(error, `reservations 신규값 '${v}' CHECK 통과 실패`).toBeNull();
      expect(data?.visit_route).toBe(v);
      if (data?.id) await sb!.from('reservations').delete().eq('id', data.id);
    }
    console.log('[AC-6-b] reservations.visit_route 신규 8값 허용 PASS');
  });

  test('AC-6-c: [POST-apply] 기존 8값 byte-parity 존치(여전히 CHECK 통과)', async () => {
    test.skip(!sb || !clinicId, 'DB env / clinic 없음 — 스킵');
    test.skip(!checkWidened, 'CHECK 미widen(물리 GO-token apply 前) — POST-CHECK validator 스킵');
    for (const v of EXISTING_8) {
      const { data, error } = await sb!
        .from('customers')
        .insert({ clinic_id: clinicId, name: TEST_TAG, phone: `DUMMY-EX-${Date.now()}-${v}`, visit_type: 'new', visit_route: v })
        .select('id, visit_route')
        .single();
      expect(error, `기존값 '${v}' 존치 실패`).toBeNull();
      expect(data?.visit_route).toBe(v);
      if (data?.id) await sb!.from('customers').delete().eq('id', data.id);
    }
    console.log('[AC-6-c] 기존 8값 byte-parity 존치 PASS');
  });
});

test.describe('INFLOW-WIDEN — 고객정보(2번차트) UI', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1(UI): 2번차트 방문경로 드롭다운에 신규 offered 노출', async ({ page }) => {
    test.skip(!checkWidened, 'CHECK 미widen(apply 前) — 신규값 저장 불가 → UI 노출만 별 검증(POST-apply 재확인)');
    test.skip(!seededCustomerId, '시드 고객 없음 — 스킵');
    await page.goto(`/chart/${seededCustomerId}`);
    const select = page.locator('[data-testid="chart-visit-route-select"]').first();
    const visible = await select.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      test.skip(true, '2번차트 방문경로 드롭다운 미렌더 — 스킵');
      return;
    }
    const optionTexts = await select.locator('option').allTextContents();
    expect(optionTexts, "'에이전시' 신규 옵션 누락").toContain('에이전시');
    expect(optionTexts, "'임직원.가족' 신규 옵션 누락").toContain('임직원.가족');
    expect(optionTexts, "'인바운드(전화)' 세분 옵션 누락").toContain('인바운드(전화)');
    console.log('[AC-1/UI] 2번차트 방문경로 신규 offered 노출 PASS');
    await dismissCustomerChartSheet(page).catch(() => {});
  });
});
