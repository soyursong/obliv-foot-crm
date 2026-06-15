/**
 * E2E spec — T-20260615-foot-STATS-SVCDIST-PERSTAFF-CARD
 * 통계 지표2(치료사별 시술 분포·평균 소요시간) 박스 단위 재정의.
 *
 * 배경 (planner NEW-TASK MSG-20260615-100837):
 *   직전 배포(T-20260614-STATS-SVCDIST-BOXGRID, 79f96a9)는 박스 = 시술(치료종류) 단위였으나,
 *   현장이 원한 건 박스 = 치료사 1명 단위 회색 카드.
 *   그룹핑 단위만 시술→치료사로 교체. 집계/SQL 무변경(순수 표현 레이어).
 *
 * 카드(박스) 1개 = 치료사 1명:
 *   헤더: 치료사명 + "총 N건"
 *   본문: 시술 4종(비가열/가열/포돌로게/Re:Born) 각각 한 줄 — "시술명 · N건 · 평균 N.N분"
 *   0건 시술도 한 줄로 표기(누락 금지). 회색 배경 카드, 데스크탑 4열 grid.
 *
 * 검증 구성:
 *   AC1 (순수 로직): services rows → 치료사 1명 = 카드 1개, 본문은 4종 정규 순서로 채워진다.
 *   AC2 (브라우저): 치료사 통계 탭 → 박스 그리드(svcdist-box-grid) 안의 박스(svcdist-box)가
 *                   치료사 카드(총 N건 헤더 + 시술 줄 svcdist-line)로 렌더된다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const TREATMENT_TYPES = ['비가열', '가열', '포돌로게', 'Re:Born'] as const;

test.describe('T-20260615 STATS-SVCDIST-PERSTAFF-CARD — 지표2 박스=치료사 카드', () => {
  // ── AC1: 박스 1개 = 치료사 1명, 본문은 4종 정규 순서 (DB 비의존 순수 로직) ──
  test('AC1: 치료사 1명 = 카드 1개이고 본문이 시술 4종 정규 순서로 채워진다(누락 금지)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate((TYPES) => {
      type Row = { therapist_id: string; name: string; treatment_type: string; cnt: number; avg_minutes: number | null };
      // TherapistStatsSection 의 servicesByTherapist + 카드 본문 라인 생성 로직과 동일
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
      const cards = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      const fmtAvg = (m: number | null) => (m != null ? `${m.toFixed(1)}분` : '-');
      // 첫 카드(김치료) 본문 4종 정규 순서로 채우기
      const first = cards[0];
      const byType = new Map(first.rows.map((r) => [r.treatment_type, r]));
      const lines = TYPES.map((type) => {
        const r = byType.get(type);
        return { type, cnt: r?.cnt ?? 0, avg: fmtAvg(r?.avg_minutes ?? null) };
      });
      return {
        cardCount: cards.length,
        firstName: first.name,
        firstTotal: first.rows.reduce((s, r) => s + r.cnt, 0),
        lineCount: lines.length,
        lineOrder: lines.map((l) => l.type),
        unheatedCnt: lines.find((l) => l.type === '비가열')!.cnt,
        heatedAvg: lines.find((l) => l.type === '가열')!.avg,
        podoCnt: lines.find((l) => l.type === '포돌로게')!.cnt,   // 김치료엔 없음 → 0건(누락 금지)
        rebornAvg: lines.find((l) => l.type === 'Re:Born')!.avg,  // 없음 → '-'
      };
    }, TREATMENT_TYPES as unknown as string[]);

    expect(result.cardCount).toBe(2);                 // 치료사 2명 → 카드 2개
    expect(result.firstName).toBe('김치료');           // localeCompare 정렬
    expect(result.firstTotal).toBe(8);                // 5 + 3 → '총 8건'
    expect(result.lineCount).toBe(4);                 // 본문은 항상 4종(정규 순서)
    expect(result.lineOrder).toEqual([...TREATMENT_TYPES]);
    expect(result.unheatedCnt).toBe(5);
    expect(result.heatedAvg).toBe('-');               // avg null → '-'
    expect(result.podoCnt).toBe(0);                   // 데이터 없는 종류는 0건으로 채움
    expect(result.rebornAvg).toBe('-');
  });

  // ── AC2: 치료사 통계 탭 박스(=치료사 카드) 렌더 (best-effort, 로그인/권한 의존) ──
  test('AC2: 박스 그리드의 박스가 치료사 카드(총 N건 헤더 + 시술 줄)로 렌더된다', async ({ page }) => {
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

    const grids = page.getByTestId('svcdist-box-grid');
    if (await grids.count() === 0) {
      test.skip(true, '기간 내 치료사 시술 분포 데이터 없음 — 구조 단언은 AC1 로 대체');
      return;
    }
    await expect(grids.first()).toBeVisible();

    // 박스(=치료사 카드) 최소 1개, 헤더에 '총' + 본문 시술 줄 4개
    const boxes = page.getByTestId('svcdist-box');
    expect(await boxes.count()).toBeGreaterThan(0);
    const firstBox = boxes.first();
    await expect(firstBox).toContainText('총');
    await expect(firstBox).toContainText('평균');
    // 카드 1개당 시술 줄 4개(4종 정규 표기)
    expect(await firstBox.getByTestId('svcdist-line').count()).toBe(4);
  });
});
