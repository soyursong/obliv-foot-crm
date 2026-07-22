/**
 * E2E/Unit — T-20260702-foot-TMSTATS-TEAMFILTER-ROLE
 *
 * 현장: 통계 > TM집계 "TM팀만" 필터 = 계정관리 role='tm' 계정만.
 *
 * ⚠ SUPERSEDED-BY: T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT (§963⑩(a) HARD INVARIANT).
 *   구 구현은 판정축을 표시 라벨(tmCounselorLabel = registrar_name-aware)로 통일했으나,
 *   registrar_name(수동편집 가능 display SoT)을 필터 inclusion 판정축으로 쓰는 것은 §963⑩(a) 위반
 *   ("편집이 count 버킷을 이동시키는 비결정 필터")로 판정됨. → 필터축을 정규 귀속 identity(created_by)로
 *   repoint. 아래 순수 규칙 블록은 canonical(tmRoleIds/created_by) 기준으로 갱신했다. DOM 토글
 *   무회귀 테스트는 유효하므로 유지. registrar_name = 화면 label 표시로만 존치(tmCounselorLabel).
 *
 * ── 진단(실측, dev DB) ────────────────────────────────────────────
 *   · 계정관리 role='tm' 계정 = 진운선 / 이수빈 / 김효신 (전부 active). role 값 소문자 'tm'.
 *   · 풋 TM팀 예약 = 데스크(admin/coordinator) created_by 로 등록될 수 있음. 그 경우 정규 귀속은
 *     데스크 계정 → "TM팀만"에서 제외(registrar_name 으로 끌어오지 않음, §963⑩(a)).
 *
 * ⛔ 순수 함수 read-only. registrar_name/role 어떤 값도 write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { tmRoleIds, tmCounselorLabel, type TmStaffInfo } from '../../src/lib/stats';

// 현장 실측 계정 지형(dev DB): role='tm' 3계정 + 데스크 role(admin/coordinator).
const STAFF: Record<string, TmStaffInfo> = {
  'u-tm-1': { name: '진운선', role: 'tm' },
  'u-tm-2': { name: '이수빈', role: 'tm' },
  'u-tm-3': { name: '김효신', role: 'tm' },
  'u-admin-1': { name: '김주연', role: 'admin' },
  'u-coord-1': { name: '박민석', role: 'coordinator' },
};

// 컴포넌트 "TM팀만" 판정(repoint 후) = tmRoleIds(staffMap).has(created_by). 정규 귀속 identity 기준.
const tmSet = () => tmRoleIds(STAFF);
const isTmRes = (createdBy: string | null) => !!createdBy && tmSet().has(createdBy);

test.describe('T-20260702 TM팀만 = role=tm 계정만 (순수 규칙, §963⑩(a) repoint 후)', () => {
  test('AC1: role=tm id(진운선/이수빈/김효신)만 필터 집합에 포함', () => {
    const set = tmSet();
    expect([...set].sort()).toEqual(['u-tm-1', 'u-tm-2', 'u-tm-3']);
  });

  test('AC2: role≠tm 계정(데스크 admin/coordinator) created_by 는 제외', () => {
    expect(isTmRes('u-admin-1')).toBe(false);   // admin
    expect(isTmRes('u-coord-1')).toBe(false);   // coordinator
  });

  test('시나리오1: 데스크(admin=김주연)가 등록 → created_by=admin → TM팀만 제외', () => {
    expect(isTmRes('u-admin-1')).toBe(false);
  });

  test('시나리오2(반전, §963⑩(a)): 도파민 예약(created_by=NULL, registrar_name=진운선) → TM팀만 제외', () => {
    // 구 구현은 registrar_name='진운선'(role=tm 이름)이라 잘못 포함했다. repoint 후 created_by=NULL →
    // 정규 identity 축에서 제외(도파민 개별 귀속=도파민 자체 stats 소관). registrar_name 표시는 별개 유지.
    expect(isTmRes(null)).toBe(false);
    expect(tmCounselorLabel(null, 'dopamine', null, '진운선')).toBe('진운선'); // 표시 라벨은 그대로
  });

  test('가드: staffMap 빈/누락 방어 + read-only (입력 불변)', () => {
    expect(tmRoleIds({} as Record<string, TmStaffInfo>).size).toBe(0);
    const snapshot = JSON.stringify(STAFF);
    tmRoleIds(STAFF);
    expect(JSON.stringify(STAFF)).toBe(snapshot); // side-effect 0
  });

  test('가드: role 대문자 "TM" 은 계약 enum(소문자 tm) 아님 → 미포함 (오탐 방지)', () => {
    const s = tmRoleIds({ x: { name: '가짜', role: 'TM' } } as Record<string, TmStaffInfo>);
    expect(s.has('x')).toBe(false);
  });
});

test.describe('T-20260702 통계 TM집계 "TM팀만" 토글 렌더 무회귀', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('TM팀만 버튼 토글 시 에러 없이 집계 테이블 재렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible({ timeout: 10_000 });
    await tmTab.click();

    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });

    const tmOnlyBtn = page.getByRole('button', { name: /TM팀만/ });
    await expect(tmOnlyBtn).toBeVisible();
    await tmOnlyBtn.click();                       // ON
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    await expect(page.getByRole('button', { name: /✓ TM팀만/ })).toBeVisible();
    await tmOnlyBtn.click();                       // OFF (회귀: 전건 복귀)
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TMSTATS-TEAMFILTER-ROLE] TM팀만 토글 렌더 OK (role=tm 계정 기준)');
  });
});
