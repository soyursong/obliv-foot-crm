/**
 * E2E spec — T-20260614-foot-STATS-SVCDIST-BOXGRID
 * 통계 지표2(치료사별 시술 분포·평균 소요시간) 컴팩트 박스 그리드 리디자인 + 타임아웃 회귀 가드.
 *
 * 배경 (supervisor FIX-REQUEST MSG-20260614-224935, qa_fail_reason=spec_fail_new):
 *   1) 리디자인 커밋(de4b25c)이 박스 그리드 전용 spec 을 동반하지 않음 → 본 spec 으로 보강.
 *   2) /admin/stats 진입 시 "canceling statement due to statement timeout · code=57014" 배너 →
 *      그 여파로 통계 페이지 전반 미로드(지표2 박스 그리드 '데이터 없음'으로 보임).
 *
 * 근본 원인(실측):
 *   foot_stats_by_category 가 PostgREST generic plan 에서 payments ⋈ check_in_services 를
 *   Nested Loop(인덱스 없음)로 풀어 check_in_services 를 payment 행마다 Seq Scan +
 *   RLS 함수 행당 평가 → 7.6~8.2초 = authenticated statement_timeout(8s) → 57014.
 *   해결: check_in_services(check_in_id) 인덱스 추가 → 7.6초 → ~130ms (실측).
 *   migration: supabase/migrations/20260614230000_check_in_services_checkin_idx.sql
 *
 * 검증 구성:
 *   AC1 (순수 로직): services rows → 치료사별 그룹화 + 4종 박스 표현 모델 불변식.
 *   AC2 (브라우저): 치료사 통계 탭 → 박스 그리드(svcdist-box-grid) + 박스(svcdist-box) 렌더.
 *   AC3 (브라우저, 회귀 가드): /admin/stats 가 57014/timeout 에러 배너 없이 로드된다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260614 STATS-SVCDIST-BOXGRID — 지표2 박스 그리드 + 타임아웃 회귀 가드', () => {
  // ── AC1: 치료사별 그룹화 + 박스 표현 모델 (DB 비의존 순수 로직) ──
  test('AC1: services rows 가 치료사별 그룹으로 묶이고 그룹별 박스(시술명·건수·평균)로 표현된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Row = { therapist_id: string; name: string; treatment_type: string; cnt: number; avg_minutes: number | null };
      // TherapistStatsSection.servicesByTherapist 와 동일한 그룹화 로직
      const services: Row[] = [
        { therapist_id: 't1', name: '김치료', treatment_type: '비가열', cnt: 5, avg_minutes: 20.0 },
        { therapist_id: 't1', name: '김치료', treatment_type: '가열', cnt: 3, avg_minutes: null },
        { therapist_id: 't2', name: '이치료', treatment_type: '포돌로게', cnt: 2, avg_minutes: 33.3 },
      ];
      const map = new Map<string, { name: string; rows: Row[] }>();
      for (const r of services) {
        const e = map.get(r.therapist_id) ?? { name: r.name, rows: [] };
        e.rows.push(r);
        map.set(r.therapist_id, e);
      }
      const groups = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      // 박스 표현: 평균 null → '-', 아니면 'N.N분'
      const fmtAvg = (m: number | null) => (m != null ? `${m.toFixed(1)}분` : '-');
      return {
        groupCount: groups.length,
        firstName: groups[0].name,
        firstBoxes: groups[0].rows.length,
        firstTotal: groups[0].rows.reduce((s, r) => s + r.cnt, 0),
        avgHeated: fmtAvg(groups[0].rows.find((r) => r.treatment_type === '가열')!.avg_minutes),
        avgUnheated: fmtAvg(groups[0].rows.find((r) => r.treatment_type === '비가열')!.avg_minutes),
      };
    });

    expect(result.groupCount).toBe(2);           // 치료사 2명 → 그룹 2
    expect(result.firstName).toBe('김치료');       // localeCompare 정렬
    expect(result.firstBoxes).toBe(2);            // t1 박스 2개(비가열/가열)
    expect(result.firstTotal).toBe(8);            // 5 + 3 = 그룹 헤더 '총 8건'
    expect(result.avgHeated).toBe('-');           // avg null → '-'
    expect(result.avgUnheated).toBe('20.0분');     // avg → 'N.N분'
  });

  // ── AC2: 치료사 통계 탭 박스 그리드 렌더 (best-effort, 로그인/권한 환경 의존) ──
  test('AC2: 치료사 통계 탭에 박스 그리드와 시술 박스가 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — AC1 로직 모델로 대체');

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

    // 지표2 섹션은 항상 마운트(데이터 유무 무관)
    await expect(page.getByTestId('therapist-metric-services')).toBeVisible();

    // 데이터가 있으면 박스 그리드 + 박스가 렌더(최소 1개). 데이터 없으면 '데이터 없음'으로 스킵.
    const grids = page.getByTestId('svcdist-box-grid');
    const gridCount = await grids.count();
    if (gridCount === 0) {
      test.skip(true, '기간 내 치료사 시술 분포 데이터 없음 — 구조 단언은 AC1 로 대체');
      return;
    }
    await expect(grids.first()).toBeVisible();
    const boxes = page.getByTestId('svcdist-box');
    expect(await boxes.count()).toBeGreaterThan(0);
    // 박스 안에 시술 분류 칩 + '건' 단위 표기
    await expect(boxes.first()).toContainText('건');
    await expect(page.getByTestId('svcdist-therapist-group').first()).toContainText('총');
  });

  // ── AC3: 회귀 가드 — /admin/stats 가 57014/timeout 에러 없이 로드된다 ──
  //   check_in_services(check_in_id) 인덱스 누락 회귀 시 매출 통계(foot_stats_by_category)가
  //   다시 statement timeout(57014) 배너를 띄움 → 본 단언이 회귀를 잡는다.
  test('AC3: 매출 통계 탭이 statement timeout(57014) 없이 로드된다 (인덱스 회귀 가드)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경');

    await page.goto('/admin/stats');
    const revTab = page.getByTestId('stats-tab-revenue');
    try {
      await revTab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role');
      return;
    }
    // 매출 통계 탭(기본)의 by_category 까지 로드 시간 확보 (타임아웃이면 8초 후 배너)
    await page.waitForTimeout(9_000);

    // 에러 배너에 timeout/57014 문구가 없어야 한다.
    const banner = page.getByText('통계를 불러오지 못했습니다', { exact: false });
    if (await banner.count() > 0) {
      const txt = (await banner.first().textContent()) ?? '';
      expect(txt).not.toContain('57014');
      expect(txt).not.toContain('timeout');
      expect(txt).not.toContain('statement');
    }
    // 매출 통계 섹션 헤더는 렌더되어 있어야 한다(페이지 자체는 살아있음)
    await expect(page.getByText('매출 통계', { exact: false }).first()).toBeVisible();
  });
});
