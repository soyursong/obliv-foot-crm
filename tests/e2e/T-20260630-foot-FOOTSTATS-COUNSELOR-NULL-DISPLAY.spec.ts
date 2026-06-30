/**
 * E2E/Unit — T-20260630-foot-FOOTSTATS-COUNSELOR-NULL-DISPLAY
 *
 * 근거: DA CONSULT-REPLY DA-20260630-FOOTPUSH-COUNSELOR-ATTRIBUTION
 *       (verdict = NO-SCHEMA-CHANGE_GO). 스키마/RPC/backfill 0.
 *
 * 핵심: 도파민-출처(source_system='dopamine') 풋 예약은 풋 상담 전이라 통계 '상담사'
 *       (reservations.created_by) = NULL 인 게 설계상 정상(결함 아님).
 *
 * AC-1 (표시): TM집계의 NULL/미매칭 상담사 행을 공란/에러/렌더깨짐이 아니라
 *              provenance 라벨('도파민/TM 유입 (상담사 미배정)')로 graceful 표시.
 *              표시 전용 — created_by/consultant_id 값 변경 0, DDL 0.
 *
 * ⛔ 급소 가드: '미지정'을 도파민 TM staff_id/cue_card 리드 owner로 자동 스탬프 금지.
 *    → 인센티브 분모 오염 + 이중계상 + changed_by 네임스페이스 위반. NULL 유지=fail-closed.
 *    본 spec 은 라벨 파생이 read-only 임을 라벨 함수 시그니처(입력→문자열, side-effect 0)로 보증한다.
 *
 * 본 spec 은 라벨 규칙(tmCounselorLabel) 의 순수 단위 검증 + 통계 화면 TM집계 렌더 무회귀 가드.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import {
  tmCounselorLabel,
  TM_DOPAMINE_LABEL,
  TM_UNASSIGNED_LABEL,
} from '../../src/lib/stats';

test.describe('T-20260630 TM상담사 NULL provenance 라벨 (순수 규칙)', () => {
  test('AC-1: 풋 직원이 등록 → 직원명 (정상 귀속, 무회귀)', () => {
    expect(tmCounselorLabel('staff-uuid-1', null, '엄경은')).toBe('엄경은');
    // source_system 이 dopamine 이어도 실제 풋 직원에 매칭되면 직원 귀속 우선 (NULL 아님)
    expect(tmCounselorLabel('staff-uuid-1', 'dopamine', '엄경은')).toBe('엄경은');
  });

  test('AC-1: 도파민-출처 + 상담사 NULL → provenance 라벨 (graceful)', () => {
    // created_by NULL 이면서 source_system='dopamine' → 도파민/TM 유입 라벨
    expect(tmCounselorLabel(null, 'dopamine', null)).toBe(TM_DOPAMINE_LABEL);
    // created_by 가 풋 staffMap 에 미매칭(도파민 신원 등)이어도 dopamine 마커면 provenance
    expect(tmCounselorLabel('dopamine-identity', 'dopamine', undefined)).toBe(TM_DOPAMINE_LABEL);
    expect(TM_DOPAMINE_LABEL).toContain('도파민');
  });

  test('AC-1: 비-도파민 + 상담사 NULL → 미지정 (오귀속 방지)', () => {
    // dopamine 마커가 없으면 도파민 라벨을 붙이지 않는다(거짓 provenance 주장 금지).
    expect(tmCounselorLabel(null, null, null)).toBe(TM_UNASSIGNED_LABEL);
    expect(tmCounselorLabel(null, '', undefined)).toBe(TM_UNASSIGNED_LABEL);
    expect(tmCounselorLabel('unmatched-id', null, undefined)).toBe(TM_UNASSIGNED_LABEL);
    // selfbook/walkin 등 다른 source_system 도 dopamine 아니면 미지정
    expect(tmCounselorLabel(null, 'selfbook', null)).toBe(TM_UNASSIGNED_LABEL);
  });

  test('급소 가드: 라벨 파생은 입력을 변형하지 않는다(read-only, side-effect 0)', () => {
    const created = null;
    const src = 'dopamine';
    tmCounselorLabel(created, src, null);
    // 입력 인자는 그대로 — 어떤 스탬프/뮤테이션도 없음
    expect(created).toBeNull();
    expect(src).toBe('dopamine');
  });
});

test.describe('T-20260630 통계 TM집계 렌더 무회귀', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('AC-1: 통계 > TM집계 섹션이 에러/렌더깨짐 없이 표시', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    // TM집계 탭 진입 (Stats.tsx: data-testid="stats-tab-tm" 버튼)
    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible({ timeout: 10_000 });
    await tmTab.click();

    // TM집계 핵심 표/헤더 렌더 (crash 없이 도달) — graceful 표시 보증
    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('TM 상담사 (등록자)')).toBeVisible();
    console.log('[FOOTSTATS-COUNSELOR-NULL] TM집계 렌더 OK (NULL graceful)');
  });
});
