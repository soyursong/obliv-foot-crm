/**
 * E2E/Unit — T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT
 *
 * §963⑩(a) HARD INVARIANT (DA-decision 20260722, scalp2 Phase 0 foot 동형 전파):
 *   TM집계 grouping key + "TM팀만" 필터 inclusion 판정축에서 registrar_name(수동편집 가능한
 *   display SoT) 을 제거하고 정규 귀속 identity(reservations.created_by)로 repoint한다.
 *   dopamine-origin(created_by=NULL, §416 firewall) = 단일 provenance 버킷('도파민 등록').
 *   registrar_name = 화면 label 표시로만(tmCounselorLabel) — 집계/필터축 절대 미참여.
 *
 * ── AC0 진단(위반 확정) ─────────────────────────────────────────────
 *   구 TmAggregateSection: tmStats grouping key = tmCounselorLabel 결과(registrar_name-aware),
 *   "TM팀만" = isTmLabel(라벨). 둘 다 registrar_name 을 축으로 read → §963⑩(a) 위반. 본 티켓이 repoint.
 *
 * ── AC1~AC5 검증 ────────────────────────────────────────────────────
 *   AC1 grouping = created_by, AC2 filter = created_by∈role'tm' id, AC3 dopamine 단일 버킷,
 *   AC4 registrar_name = 표시 label 로만 존치, AC5 registrar_name 편집→count 버킷 미이동(집계-inert).
 *
 * ⛔ 순수 함수 read-only. registrar_name/created_by/role 어떤 값도 write/승격 없음. no-DDL.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import {
  tmAttributionKey,
  tmRoleIds,
  tmCounselorLabel,
  TM_DOPAMINE_BUCKET,
  TM_UNASSIGNED_LABEL,
  type TmStaffInfo,
} from '../../src/lib/stats';

// 현장 실측 계정 지형(dev DB): role='tm' 3계정(진운선/이수빈/김효신) + 데스크 role(admin/coordinator).
const STAFF: Record<string, TmStaffInfo> = {
  'u-tm-1': { name: '진운선', role: 'tm' },
  'u-tm-2': { name: '이수빈', role: 'tm' },
  'u-tm-3': { name: '김효신', role: 'tm' },
  'u-admin-1': { name: '김주연', role: 'admin' },
  'u-coord-1': { name: '박민석', role: 'coordinator' },
};

// 컴포넌트 grouping key 재현 helper (attrOfRes 등가).
const groupKey = (createdBy: string | null, sourceSystem: string | null) =>
  tmAttributionKey(createdBy, sourceSystem, STAFF[createdBy ?? '']?.name);
// registrar_name 을 넘기는 변형(카브아웃 인자 경로 검증용).
const groupKeyRn = (createdBy: string | null, sourceSystem: string | null, registrarName: string | null) =>
  tmAttributionKey(createdBy, sourceSystem, STAFF[createdBy ?? '']?.name, registrarName);

test.describe('T-20260722 AC1 — grouping key = 정규 귀속키(created_by), registrar_name 미참여', () => {
  test('직접등록(created_by=직원) → staff:<uid> 버킷 + 직원명 라벨', () => {
    const a = groupKey('u-tm-1', null);
    expect(a.key).toBe('staff:u-tm-1');
    expect(a.label).toBe('진운선');
  });

  test('데스크(admin)가 등록 → created_by=admin 정규 버킷 (registrar 무관)', () => {
    const a = groupKey('u-admin-1', null);
    expect(a.key).toBe('staff:u-admin-1');
    expect(a.label).toBe('김주연');
  });

  test('AC5(native 집계-inert): native(created_by 有) grouping 은 registrar_name 편집에 불가침 — REPOINT AC4 STAYS', () => {
    // ★ 2026-07-24 CEO-GATED CARVE-OUT(VARIANT) 이후: tmAttributionKey 는 4번째 인자 registrar_name 을
    //   dopamine 파티션 display 버킷 전용으로 받는다. 그러나 native(created_by 有) 는 첫 분기에서 반환되어
    //   registrar_name 이 무엇이든 grouping key/label 불변 — REPOINT AC4(native)는 STAYS(VARIANT AC2).
    expect(groupKey('u-tm-2', null).key).toBe('staff:u-tm-2');
    expect(groupKey('u-tm-2', 'dopamine').key).toBe('staff:u-tm-2'); // created_by 있으면 dopamine 무관
    // registrar_name 을 임의로 넘겨도 native key/label 동일(편집→count 버킷 이동 0).
    expect(groupKeyRn('u-tm-2', null, '아무개').key).toBe('staff:u-tm-2');
    expect(groupKeyRn('u-tm-2', null, '아무개').label).toBe('이수빈');
    expect(groupKeyRn('u-tm-2', 'dopamine', '제3자').key).toBe('staff:u-tm-2');
  });
});

test.describe('T-20260722 AC3 — dopamine-origin(created_by=NULL) = 단일 provenance 버킷', () => {
  test('created_by=NULL + dopamine → __dopamine__ / "도파민 등록" 단일 버킷', () => {
    const a = groupKey(null, 'dopamine');
    expect(a.key).toBe('__dopamine__');
    expect(a.label).toBe(TM_DOPAMINE_BUCKET);
    expect(a.label).toBe('도파민 등록');
  });

  test('AC3 핵심: 서로 다른 registrar_name 의 dopamine 행 다건 → 전부 같은 단일 버킷(per-name 분해 금지)', () => {
    // 시뮬: 도파민 예약 3건 (registrar_name 이 '진운선','이수빈','타인' 으로 달라도)
    //   → created_by=NULL/dopamine 이므로 grouping key 는 모두 '__dopamine__' 하나로 병합.
    const rows = [
      { created_by: null, source_system: 'dopamine' /* registrar_name='진운선' */ },
      { created_by: null, source_system: 'dopamine' /* registrar_name='이수빈' */ },
      { created_by: null, source_system: 'dopamine' /* registrar_name='제3자' */ },
    ];
    const keys = new Set(rows.map((r) => groupKey(r.created_by, r.source_system).key));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('__dopamine__');
  });

  test('created_by=NULL + source_system 아님 → 미지정 버킷', () => {
    const a = groupKey(null, null);
    expect(a.key).toBe('__unassigned__');
    expect(a.label).toBe(TM_UNASSIGNED_LABEL);
  });
});

test.describe('T-20260722 AC2 — "TM팀만" 필터 = 정규 귀속 identity(created_by∈role\'tm\')', () => {
  const tmSet = () => tmRoleIds(STAFF);
  const isTmRes = (createdBy: string | null) => !!createdBy && tmSet().has(createdBy);

  test('role=tm id(진운선/이수빈/김효신) 3계정만 필터 집합', () => {
    expect([...tmSet()].sort()).toEqual(['u-tm-1', 'u-tm-2', 'u-tm-3']);
  });

  test('데스크(admin/coordinator) created_by → TM팀만 제외', () => {
    expect(isTmRes('u-admin-1')).toBe(false);
    expect(isTmRes('u-coord-1')).toBe(false);
  });

  test('★ 위반 반전: dopamine 예약(created_by=NULL, registrar_name=진운선) → TM팀만 제외', () => {
    // 구 label-매칭축에서는 registrar_name='진운선'(role=tm 이름)이라 잘못 포함되었다(§963⑩(a) 위반).
    // repoint 후: created_by=NULL 이라 정규 identity 축에서 제외 → '도파민 등록' 버킷으로 집계됨.
    expect(isTmRes(null)).toBe(false);
    // 같은 행의 grouping 은 dopamine 단일 버킷.
    expect(groupKey(null, 'dopamine').key).toBe('__dopamine__');
  });

  test('role 대문자 "TM" 은 계약 enum(소문자 tm) 아님 → 미포함', () => {
    const s = tmRoleIds({ x: { name: '가짜', role: 'TM' } } as Record<string, TmStaffInfo>);
    expect(s.has('x')).toBe(false);
  });

  test('가드: staffMap 빈/누락 방어 + read-only', () => {
    expect(tmRoleIds({} as Record<string, TmStaffInfo>).size).toBe(0);
    const snapshot = JSON.stringify(STAFF);
    tmRoleIds(STAFF);
    tmAttributionKey('u-tm-1', null, STAFF['u-tm-1'].name);
    expect(JSON.stringify(STAFF)).toBe(snapshot); // side-effect 0
  });
});

test.describe('T-20260722 AC4 — registrar_name = 화면 label 표시로만 존치(집계축 아님)', () => {
  test('detail 표시 라벨(tmCounselorLabel)은 registrar_name 을 그대로 표시(표시 로직 revert 아님)', () => {
    // 도파민 예약의 상세 드릴다운 'TM상담사' 컬럼은 registrar_name('진운선')을 표시한다 —
    // grouping/필터축에서만 제거했을 뿐 표시 로직은 유지(AC4).
    const label = tmCounselorLabel(null, 'dopamine', null, '진운선');
    expect(label).toBe('진운선');
  });

  test('직접등록 표시 라벨은 직원명 불변(회귀 0)', () => {
    const label = tmCounselorLabel('u-admin-1', null, '김주연');
    expect(label).toBe('김주연');
  });
});

test.describe('T-20260722 통계 TM집계 렌더 무회귀(집계-inert 동선)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('TM집계 탭 진입 + TM팀만 토글 시 에러 없이 재렌더 + 총합행 유지', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible({ timeout: 10_000 });
    await tmTab.click();

    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });

    const tmOnlyBtn = page.getByRole('button', { name: /TM팀만/ });
    await expect(tmOnlyBtn).toBeVisible();
    await tmOnlyBtn.click(); // ON — created_by∈role'tm' 만
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    await expect(page.getByRole('button', { name: /✓ TM팀만/ })).toBeVisible();
    await tmOnlyBtn.click(); // OFF — 전건 복귀(총합 회귀 0)
    await expect(page.getByText('TM상담사별 집계')).toBeVisible();
    console.log('[TMAGG-REGISTRAR-AXIS-REPOINT] grouping/필터축 created_by repoint · registrar_name label-only OK');
  });
});
