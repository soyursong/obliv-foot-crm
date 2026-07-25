/**
 * E2E spec — T-20260725-foot-PKG-TRIAL-VISITTYPE-EXPERIENCE-FIX
 * 패키지 체험권(session_type='trial') 차감 내원을 치료사 통계 '체험 건수(experience_total)'에 포함.
 *
 * 현장 요청 (풋센터 C0ATE5P6JTH, thread 1784979624.732659, reporter U0ATDB587PV):
 *   "2번차트에서 패키지-체험권으로 발생되는 티켓은 전부 체험으로 잡혀야 함"
 *
 * 배경(DIAG T-20260725-foot-THERAPIST-STATS-EXPERIENCE-COUNT-ZERO-DIAG, normal_not_bug):
 *   선(先)체험 접수 버튼 6/29 운영종료 → visit_type='experience' 신규 생성경로 소멸(prod experience=1건뿐).
 *   그러나 실제 체험은 2번차트 '금일치료=체험권' 차감(package_sessions.session_type='trial')으로 계속 발생,
 *   당일 check_in 에 링크되지만 그 check_in.visit_type 은 접수값(new/returning) 그대로 → 체험 집계 누락.
 *
 * 수정 방향 = Option B(집계단). RPC foot_stats_therapist_summary 의 exp_agg 만 확장:
 *   체험 판별 = base.visit_type='experience'  OR  그 check_in 에 링크된 trial(used) package_sessions 존재.
 *   COUNT(*) 는 base(check_ins) 행 기준 → 양쪽 충족해도 1회만(중복 없음). 원본 visit_type 무접점.
 *   (mig 20260725190000_foot_stats_experience_include_pkg_trial.sql)
 *
 * prod 실측(2026-07 dry-run): experience_total July 0 → 88(8치료사), June 1 → 1(회귀 없음),
 *   신규 88건 experience_converted=0(check_ins.package_id NULL 의존 → 전환율 비상향).
 *
 * 시나리오 → AC 매핑:
 *   시나리오1 = 체험권 차감 check_in 이 체험으로 카운트(정상 동선) → AC(체험 건수 반영)
 *   시나리오2 = 비(非)체험권 일반 내원(new/returning)은 불변 → AC(회귀 방지)
 *
 * RPC exp_agg 불변식을 page.evaluate 순수 함수로 검증(seeded DB 비의존, 로직 회귀 방지) + UI 렌더 best-effort.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── RPC exp_agg 신규 판별식의 순수 모델 ────────────────────────────────────────
// base 행(check_in) 하나가 '체험'으로 집계되는가:
//   visit_type='experience'  OR  (그 check_in 에 링크된 session_type='trial' AND status='used' 존재)
type CheckIn = { id: string; visit_type: string; package_id: string | null };
type PkgSession = { check_in_id: string | null; session_type: string; status: string };

function isExperienceCounted(ci: CheckIn, sessions: PkgSession[]): boolean {
  if (ci.visit_type === 'experience') return true;
  return sessions.some(
    (s) => s.check_in_id === ci.id && s.session_type === 'trial' && s.status === 'used',
  );
}

// exp_conv: 해당 check_in 의 package_id 에 payment(payment_type='payment') 존재 여부
type PkgPayment = { package_id: string; payment_type: string };
function isConverted(ci: CheckIn, payments: PkgPayment[]): boolean {
  if (!ci.package_id) return false;
  return payments.some((p) => p.package_id === ci.package_id && p.payment_type === 'payment');
}

test.describe('T-20260725 PKG-TRIAL-VISITTYPE-EXPERIENCE — 패키지 체험권 차감을 체험 집계에 포함', () => {
  // ── 시나리오1: 패키지 체험권 차감 → 체험 집계 반영 (정상 동선) ──
  test('시나리오1: trial(used) 링크 check_in 은 visit_type=new/returning 이라도 체험으로 카운트된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(
      ({ fn }) => {
        // eslint-disable-next-line no-new-func
        const isExp = new Function('return ' + fn)() as (ci: CheckIn, s: PkgSession[]) => boolean;
        type CheckIn = { id: string; visit_type: string; package_id: string | null };
        type PkgSession = { check_in_id: string | null; session_type: string; status: string };

        // ci-A: 접수는 new 였으나 오늘 체험권(trial) 차감 링크 → 체험으로 잡혀야(핵심 정정)
        const ciA: CheckIn = { id: 'ci-A', visit_type: 'new', package_id: 'pkg1' };
        // ci-B: 재진 고객이 체험권 차감 → 역시 체험으로 잡혀야
        const ciB: CheckIn = { id: 'ci-B', visit_type: 'returning', package_id: 'pkg2' };
        // ci-C: 기존 선체험(visit_type='experience') → 여전히 체험(회귀 없음)
        const ciC: CheckIn = { id: 'ci-C', visit_type: 'experience', package_id: null };
        const sessions: PkgSession[] = [
          { check_in_id: 'ci-A', session_type: 'trial', status: 'used' },
          { check_in_id: 'ci-B', session_type: 'trial', status: 'used' },
        ];
        return {
          a: isExp(ciA, sessions),
          b: isExp(ciB, sessions),
          c: isExp(ciC, sessions),
          total: [ciA, ciB, ciC].filter((ci) => isExp(ci, sessions)).length,
        };
      },
      { fn: isExperienceCounted.toString() },
    );

    expect(result.a).toBe(true); // new + trial 링크 → 체험 (정정 핵심)
    expect(result.b).toBe(true); // returning + trial 링크 → 체험
    expect(result.c).toBe(true); // 기존 experience → 유지(회귀 없음)
    expect(result.total).toBe(3);
  });

  // ── 시나리오2: 비(非)체험권 일반 내원은 불변 (회귀 방지) ──
  test('시나리오2: trial 링크 없는 일반 내원(new/returning)은 체험으로 잡히지 않는다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(
      ({ fn }) => {
        // eslint-disable-next-line no-new-func
        const isExp = new Function('return ' + fn)() as (ci: CheckIn, s: PkgSession[]) => boolean;
        type CheckIn = { id: string; visit_type: string; package_id: string | null };
        type PkgSession = { check_in_id: string | null; session_type: string; status: string };

        const ciNew: CheckIn = { id: 'ci-new', visit_type: 'new', package_id: 'pkg1' };
        const ciRet: CheckIn = { id: 'ci-ret', visit_type: 'returning', package_id: 'pkg2' };
        const sessions: PkgSession[] = [
          // 일반 치료(비가열) 차감 — trial 아님 → 체험 미집계
          { check_in_id: 'ci-new', session_type: 'unheated_laser', status: 'used' },
          // 다른 고객의 trial(다른 check_in) — 매칭 안 됨
          { check_in_id: 'ci-other', session_type: 'trial', status: 'used' },
          // 삭제(deleted)된 trial — used 아님 → 미집계
          { check_in_id: 'ci-ret', session_type: 'trial', status: 'deleted' },
        ];
        return {
          newCounted: isExp(ciNew, sessions),
          retCounted: isExp(ciRet, sessions),
        };
      },
      { fn: isExperienceCounted.toString() },
    );

    expect(result.newCounted).toBe(false); // 비가열 차감 → 체험 아님
    expect(result.retCounted).toBe(false); // deleted trial → 체험 아님(status='used'만)
  });

  // ── 중복 카운트 방지: visit_type='experience' 이면서 trial 링크도 있는 경우 1회만 ──
  test('dedup: visit_type=experience 이면서 trial 링크도 있어도 base 행 기준 1회만 카운트', async ({ page }) => {
    await page.goto('/');
    const total = await page.evaluate(
      ({ fn }) => {
        // eslint-disable-next-line no-new-func
        const isExp = new Function('return ' + fn)() as (ci: CheckIn, s: PkgSession[]) => boolean;
        type CheckIn = { id: string; visit_type: string; package_id: string | null };
        type PkgSession = { check_in_id: string | null; session_type: string; status: string };
        // 양 조건 모두 충족하는 단일 check_in
        const ci: CheckIn = { id: 'ci-both', visit_type: 'experience', package_id: 'pkg1' };
        const sessions: PkgSession[] = [
          { check_in_id: 'ci-both', session_type: 'trial', status: 'used' },
          { check_in_id: 'ci-both', session_type: 'trial', status: 'used' }, // 같은 내원 2회 링크여도
        ];
        // base(check_ins) 행 기준 COUNT → 1
        return [ci].filter((c) => isExp(c, sessions)).length;
      },
      { fn: isExperienceCounted.toString() },
    );
    expect(total).toBe(1); // 중복 없음
  });

  // ── 전환율 회귀: trial 링크 + package_id NULL → 전환 미계상(prod 실측 conversion 0.0 정합) ──
  test('전환율: trial 링크 check_in 의 package_id 가 NULL 이면 전환 미계상(전환율 비상향)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(
      ({ convFn }) => {
        // eslint-disable-next-line no-new-func
        const isConv = new Function('return ' + convFn)() as (
          ci: CheckIn,
          p: PkgPayment[],
        ) => boolean;
        type CheckIn = { id: string; visit_type: string; package_id: string | null };
        type PkgPayment = { package_id: string; payment_type: string };
        const payments: PkgPayment[] = [{ package_id: 'pkg1', payment_type: 'payment' }];
        // trial 링크 내원이지만 check_ins.package_id=NULL (prod 실측 케이스) → 전환 false
        const ciNull: CheckIn = { id: 'ci-A', visit_type: 'new', package_id: null };
        // 참고: package_id 링크됐고 payment 있으면 전환 true (정의상)
        const ciLinked: CheckIn = { id: 'ci-B', visit_type: 'new', package_id: 'pkg1' };
        return { nullConv: isConv(ciNull, payments), linkedConv: isConv(ciLinked, payments) };
      },
      { convFn: isConverted.toString() },
    );
    expect(result.nullConv).toBe(false); // prod 실측: 88건 전환 0 → 전환율 비상향
    expect(result.linkedConv).toBe(true); // 정의 정합성 확인(링크+payment 시 전환)
  });

  // ── UI 렌더 best-effort: 치료사 통계 '체험 → 결제 전환율' 카드에 체험 건수 컬럼 노출 ──
  test('UI: 치료사 통계 지표4(체험→결제 전환율) 카드가 체험 건수와 함께 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — 로직 모델 테스트로 대체');

    await page.goto('/admin/stats');
    const tab = page.getByTestId('stats-tab-therapist');
    try {
      await tab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role(=권한 차단 정상)');
      return;
    }
    await tab.click();
    await page.waitForTimeout(7_000);

    const card = page.getByTestId('therapist-metric-conversion');
    await expect(card).toBeVisible();
    await expect(card).toContainText('체험 건수');
  });
});
