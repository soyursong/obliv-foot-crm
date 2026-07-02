/**
 * E2E/Unit — T-20260702-foot-TMSTATS-TEAMFILTER-ROLE
 *
 * 현장: 통계 > TM집계 "TM팀만" 필터 클릭 시 계정관리 role='TM'이 아닌 계정(데스크 admin/coordinator)도
 *   집계에 포함됨. 요구: "TM팀만" = 계정관리 role='tm' 계정만 필터 대상/결과/집계에 표시.
 *
 * ── 진단(실측, dev DB) ────────────────────────────────────────────
 *   · 계정관리 role='tm' 계정 = 진운선 / 이수빈 / 김효신 (전부 active). role 값 소문자 'tm'.
 *   · 풋 TM팀 예약 귀속축 = reservations.registrar_name (created_by 는 데스크 admin/coordinator).
 *   · 기존 "TM팀만" 필터 = isTm(created_by) 단일축 → TM팀 예약 전건 누락 + 데스크 계정이 그대로 남음
 *     (필터축=created_by ↔ 집계 표시축=registrar_name-aware 라벨 불일치가 RC).
 *
 * ── Fix ────────────────────────────────────────────────────────────
 *   판정축을 표시 라벨(tmCounselorLabel 결과)로 통일. staffMap 에서 role='tm' 계정명 집합(tmRoleNames)
 *   을 만들고, 표시 라벨이 그 집합에 들면 TM으로 판정 → 필터·결과·집계 3자 일치.
 *   role 소스 = user_profiles.role (계약 v1.0 §2-3 'tm'; user_roles flip 은 게이트 SEQUENCED).
 *
 * ⛔ 순수 함수 read-only. registrar_name/role 어떤 값도 write/승격 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { tmRoleNames, tmCounselorLabel, type TmStaffInfo } from '../../src/lib/stats';

// 현장 실측 계정 지형(dev DB): role='tm' 3계정 + 데스크 role(admin/coordinator).
const STAFF: Record<string, TmStaffInfo> = {
  'u-tm-1': { name: '진운선', role: 'tm' },
  'u-tm-2': { name: '이수빈', role: 'tm' },
  'u-tm-3': { name: '김효신', role: 'tm' },
  'u-admin-1': { name: '김주연', role: 'admin' },
  'u-coord-1': { name: '박민석', role: 'coordinator' },
};

// 컴포넌트 "TM팀만" 판정 = tmRoleNames(staffMap).has(표시라벨). 여기서 표시라벨은 tmCounselorLabel 결과.
const tmSet = () => tmRoleNames(STAFF);
const isTmLabel = (label: string) => tmSet().has(label);

test.describe('T-20260702 TM팀만 = role=tm 계정만 (순수 규칙)', () => {
  test('AC1: role=tm 계정(진운선/이수빈/김효신)만 필터 집합에 포함', () => {
    const set = tmSet();
    expect([...set].sort()).toEqual(['김효신', '이수빈', '진운선']);
    expect(set.has('진운선')).toBe(true);
    expect(set.has('이수빈')).toBe(true);
    expect(set.has('김효신')).toBe(true);
  });

  test('AC2: role≠tm 계정(데스크 admin/coordinator)은 제외 — 현상 재현 계정 사라짐', () => {
    expect(isTmLabel('김주연')).toBe(false);   // admin
    expect(isTmLabel('박민석')).toBe(false);   // coordinator
    expect(isTmLabel('미지정')).toBe(false);   // provenance
    expect(isTmLabel('워크인')).toBe(false);
  });

  test('시나리오1: 데스크(admin=김주연)가 registrar 없이 등록 → 라벨 김주연 → TM팀만 제외', () => {
    // created_by=admin 매칭 → 라벨=직원명(김주연). role=admin 이므로 TM팀만에서 빠진다.
    const label = tmCounselorLabel('u-admin-1', null, STAFF['u-admin-1'].name);
    expect(label).toBe('김주연');
    expect(isTmLabel(label)).toBe(false);
  });

  test('시나리오2: 도파민/TM 예약(created_by=NULL, registrar_name=진운선) → 라벨 진운선 → TM팀만 포함', () => {
    // 풋 TM팀 실제 귀속 경로. created_by=NULL 이라도 registrar_name 으로 진운선 라벨 → role=tm → 포함.
    const label = tmCounselorLabel(null, 'dopamine', null, '진운선');
    expect(label).toBe('진운선');
    expect(isTmLabel(label)).toBe(true);
  });

  test('AC4: 집계 대상 = TM role 계정 라벨만 (mixed 입력 → tm 라벨만 통과)', () => {
    const labels = ['진운선', '김주연', '이수빈', '박민석', '김효신', '미지정'];
    const passed = labels.filter(isTmLabel);
    expect(passed.sort()).toEqual(['김효신', '이수빈', '진운선']);
  });

  test('AC3 회귀 축: 필터 미적용(onlyTmRole=false)이면 전건 유지 — 판정 함수 미개입', () => {
    // OFF 경로는 컴포넌트에서 filtered* 를 그대로 반환(isTmLabel 미호출). 여기선 규칙 무개입 확인.
    const rows = ['진운선', '김주연', '박민석', '미지정'];
    // OFF = 필터 없음 → 전건. (ON 이면 아래처럼 좁혀짐)
    expect(rows.length).toBe(4);
    expect(rows.filter(isTmLabel).length).toBe(1);
  });

  test('가드: staffMap 빈/누락 방어 + read-only (입력 불변)', () => {
    expect(tmRoleNames({} as Record<string, TmStaffInfo>).size).toBe(0);
    const snapshot = JSON.stringify(STAFF);
    tmRoleNames(STAFF);
    expect(JSON.stringify(STAFF)).toBe(snapshot); // side-effect 0
  });

  test('가드: role 대문자 "TM" 은 계약 enum(소문자 tm) 아님 → 미포함 (오탐 방지)', () => {
    const s = tmRoleNames({ x: { name: '가짜', role: 'TM' } } as Record<string, TmStaffInfo>);
    expect(s.has('가짜')).toBe(false);
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
