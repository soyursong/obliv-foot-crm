/**
 * E2E/Unit — T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING
 *
 * 현장(박민지 팀장): 통계 > TM집계에서 도파민 연동(source_system='dopamine', visit_route='TM')
 *   예약건의 '등록자'가 공란. 동일 예약이 예약관리에서는 등록자 '진운선'으로 정상 표시.
 *
 * ── 진단(실측, dev DB) ────────────────────────────────────────────
 *   도파민/TM 경로 예약: created_by=NULL(firewall §416, 설계상 정상), registrar_name='진운선'.
 *   · 예약관리(Reservations.tsx)  → reservations.registrar_name 스냅샷으로 '진운선' 표시(SSOT).
 *   · TM집계(tmCounselorLabel)    → created_by→직원명만 봄 → created_by=NULL 이라 실제 등록자
 *                                    '진운선' 을 못 보고 provenance 라벨로 뭉갬 = 등록자명 누락.
 *   RC = 두 화면의 '등록자' 참조 축 불일치(예약관리=registrar_name / TM집계=created_by).
 *
 * ── Fix (read-only, 표시측) ────────────────────────────────────────
 *   tmCounselorLabel 에 registrar_name 축 추가. 우선순위:
 *     (1) created_by→직원명  (직접등록 예약: 동작 불변, 회귀 0)
 *     (2) registrar_name     (예약관리 '등록자'와 동일 SSOT → '진운선')
 *     (3) source_system='dopamine' + 스냅샷 없음 → provenance 라벨
 *     (4) 그 외 → 미지정
 *
 * ⛔ 급소 가드(§416): registrar_name 은 표시 전용 — created_by/집계 귀속/인센티브 산식으로
 *    승격하지 않는다. 라벨 함수는 순수(입력→문자열, side-effect 0).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import {
  tmCounselorLabel,
  TM_DOPAMINE_LABEL,
  TM_UNASSIGNED_LABEL,
} from '../../src/lib/stats';

test.describe('T-20260702 TM집계 도파민 등록자 표시 (순수 규칙)', () => {
  test('핵심 AC: 도파민/TM 예약(created_by=NULL) → registrar_name(예약관리와 동일) 표시', () => {
    // 현장 실측 케이스: created_by NULL, source='dopamine', registrar_name='진운선'
    expect(tmCounselorLabel(null, 'dopamine', null, '진운선')).toBe('진운선');
    // provenance TEXT 스냅샷([도파민TM] {name}) 도 그대로 표시(예약관리와 동일 문자열)
    expect(tmCounselorLabel(null, 'dopamine', null, '[도파민TM] 김수진')).toBe('[도파민TM] 김수진');
  });

  test('회귀 가드: 직접등록 예약(직원명) 우선 — registrar_name 있어도 직원명 불변', () => {
    // created_by 가 풋 직원에 매칭되면 (1)번에서 직원명 반환. registrar_name 은 (1)을 못 이김.
    expect(tmCounselorLabel('staff-uuid-1', null, '엄경은')).toBe('엄경은');
    expect(tmCounselorLabel('staff-uuid-1', null, '엄경은', '진운선')).toBe('엄경은');
    expect(tmCounselorLabel('staff-uuid-1', 'dopamine', '엄경은', '진운선')).toBe('엄경은');
  });

  test('fallback: registrar_name 없는 도파민 → provenance / 그 외 → 미지정 (기존 무회귀)', () => {
    // registrar_name 미수신(빈값) + dopamine → provenance 라벨 유지
    expect(tmCounselorLabel(null, 'dopamine', null)).toBe(TM_DOPAMINE_LABEL);
    expect(tmCounselorLabel(null, 'dopamine', null, '')).toBe(TM_DOPAMINE_LABEL);
    expect(tmCounselorLabel(null, 'dopamine', null, '   ')).toBe(TM_DOPAMINE_LABEL);
    // 비-도파민 + 상담사/스냅샷 모두 없음 → 미지정 (거짓 귀속 방지)
    expect(tmCounselorLabel(null, null, null)).toBe(TM_UNASSIGNED_LABEL);
    expect(tmCounselorLabel(null, null, null, null)).toBe(TM_UNASSIGNED_LABEL);
    expect(tmCounselorLabel('unmatched-id', null, undefined, undefined)).toBe(TM_UNASSIGNED_LABEL);
  });

  test('급소 가드: 라벨 파생은 입력을 변형하지 않는다(read-only, side-effect 0)', () => {
    const created = null;
    const src = 'dopamine';
    const reg = '진운선';
    const out = tmCounselorLabel(created, src, null, reg);
    expect(out).toBe('진운선');
    // 입력 인자 불변 — 어떤 스탬프/뮤테이션도 없음
    expect(created).toBeNull();
    expect(src).toBe('dopamine');
    expect(reg).toBe('진운선');
  });
});

test.describe('T-20260702 통계 TM집계 렌더 무회귀', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('통계 > TM집계 섹션이 에러/렌더깨짐 없이 표시 (등록자 컬럼 포함)', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });

    const tmTab = page.getByTestId('stats-tab-tm');
    await expect(tmTab).toBeVisible({ timeout: 10_000 });
    await tmTab.click();

    await expect(page.getByText('TM상담사별 집계')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('TM 상담사 (등록자)')).toBeVisible();
    console.log('[TMSTATS-DOPAMINE-REGISTRANT] TM집계 렌더 OK (registrar_name 표시축)');
  });
});
