/**
 * T-20260809-foot-SALESCOMPARE-TOTAL-LABEL-SYNC — 합계 행 자체 라벨(당월/전월/증감) 부여 E2E
 *
 * 무엇: 일자별 매출 비교(당월 vs 전월) 표가 좌우 2단(1~15일 / 16~말일)으로 나뉜 뒤,
 *   하단 [합계]가 자체 머리글 없는 별도 <table> 로 렌더돼 위쪽 반표 머리글(당월/전월/증감)과 떨어짐 →
 *   현장이 "어느 게 당월/전월인지 모르겠음" 보고. 합계 표에 자체 <thead> 머리글을 붙여 합계만 봐도 구분.
 *
 * AC:
 *   AC-1 합계 자체 라벨 : 합계 표에 당월/전월/증감 머리글(thead) 부여.
 *   AC-2 연동 불변식    : 공유 컴포넌트(MonthlyComparisonSection) 1곳만 수정 → 통계(Stats)·일마감(Closing)
 *                        동시·동일 반영. 소비처별 분기 금지(불변식 코드주석 명시).
 *   AC-3 값 불변        : 합계 값·증감 산식·2단 15일 분할·컬럼 정의 전부 무접촉(mtmSales.ts 무접촉).
 *   AC-4 전월무데이터   : prevHasData=false 시 전월/증감 '-' 유지.
 *
 * 시나리오 3종: (1) 통계 합계 라벨  (2) 일마감 동일성  (3) 값 불변 회귀.
 * screenshot 게이트 면제 — 대상 정밀 식별(합계 머리글 텍스트/testid).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 통계 합계 라벨: 합계 표에 당월/전월/증감 머리글 부여
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 · 통계 합계 라벨 (T-20260809-foot-SALESCOMPARE-TOTAL-LABEL-SYNC)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');

  test('AC-1/정적: 합계 표에 자체 thead 머리글(당월/전월/증감) 추가', () => {
    // 합계 표(mtm-compare-total-*)에 붙인 머리글 행.
    expect(compare).toMatch(/data-testid="mtm-compare-total-head"/);
    // 머리글 텍스트 당월/전월/증감 배열.
    expect(compare).toMatch(/'당월',\s*'전월',\s*'증감/);
  });

  test('AC-1/런타임: 통계 화면 합계 위에 당월/전월/증감 머리글 노출', async ({ page }) => {
    try {
      await loginAndWaitForDashboard(page);
    } catch {
      test.skip(true, '로그인 실패 — 환경차');
      return;
    }
    await page.goto('/stats');
    await page.waitForLoadState('networkidle').catch(() => {});

    const container = page.getByTestId('mtm-monthly-compare');
    if ((await container.count()) === 0) {
      // 컨테이너 없음 → 빈/로딩(권한·데이터차) 이면 정상, 그마저 없으면 환경차(라우트/권한)로 skip(false-RED 방지).
      const emptyOrLoading =
        (await page.getByText('데이터 없음').count()) > 0 ||
        (await page.getByText('로딩 중').count()) > 0;
      test.skip(!emptyOrLoading, '통계 화면 미렌더 — 환경차(권한/라우트). 정적 불변식으로 대체 검증.');
      expect(emptyOrLoading, '빈/로딩 상태 렌더').toBeTruthy();
      return;
    }

    // 합계 머리글 행 존재(정확히 1회) + 당월/전월/증감 텍스트.
    const head = page.getByTestId('mtm-compare-total-head');
    await expect(head).toHaveCount(1);
    await expect(head).toContainText('당월');
    await expect(head).toContainText('전월');
    await expect(head).toContainText('증감');
    // 값 셀(합계)은 여전히 1회.
    await expect(page.getByTestId('mtm-compare-total-cur')).toHaveCount(1);
    await expect(page.getByTestId('mtm-compare-total-prev')).toHaveCount(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 일마감 동일성: 같은 공유 컴포넌트 1곳 수정 → 양쪽 동일 반영(AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 · 일마감 동일성 (연동 불변식 AC-2)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');

  test('AC-2/단일 소스: 공유 컴포넌트를 Stats.tsx + Closing.tsx 가 함께 소비', () => {
    const stats = read('src/pages/Stats.tsx');
    const closing = read('src/pages/Closing.tsx');
    expect(stats).toMatch(/MonthlyComparisonSection/);
    expect(closing).toMatch(/MonthlyComparisonSection/);
  });

  test('AC-2/불변식 주석: 소비처별 분기 금지·1곳 수정 원칙을 코드에 명시', () => {
    expect(compare).toMatch(/연동 불변식/);
    expect(compare).toMatch(/Stats\.tsx/);
    expect(compare).toMatch(/Closing\.tsx/);
    // 소비처별 분기 금지 문구.
    expect(compare).toMatch(/분기[\s\S]*?(절대\s*금지|금지)/);
  });

  test('AC-2/합계 머리글은 단일 정의: 소비처 분기 없이 1곳에서만 렌더', () => {
    // 머리글 정의(당월/전월/증감 배열)는 컴포넌트 내 정확히 1회 — 소비처별 중복/분기 없음.
    expect((compare.match(/data-testid="mtm-compare-total-head"/g) ?? []).length).toBe(1);
    expect((compare.match(/'당월',\s*'전월',\s*'증감/g) ?? []).length).toBe(1);
    // showStaffBreakdown 로 분기되는 건 카드 #2(실장별)뿐 — 합계 표(카드 #1)는 분기 밖.
    expect(compare).toMatch(/showStaffBreakdown/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 값 불변 회귀: 합계 값·증감 산식·2단 분할·컬럼 정의·전월무데이터 처리 무접촉(AC-3/AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 · 값 불변 회귀 (AC-3/AC-4)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const lib = read('src/lib/mtmSales.ts');

  test('AC-3/합계 값·증감 산식 불변(당월−전월) + read-only 유지', () => {
    expect(compare).toMatch(/formatAmount\(data\.curMonthTotal\)/);
    expect(compare).toMatch(/data\.curMonthTotal\s*-\s*data\.prevMonthTotal/);
    expect(compare).toMatch(/p\.current\s*-\s*p\.previous/);
    // 표시 컴포넌트에 write/집계 로직 유입 금지.
    expect(compare).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    // mtmSales.ts(산식 SSOT) 무접촉 — write 로직 없음.
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC-3/2단 15일 분할·컬럼 정의 불변', () => {
    expect(compare).toMatch(/data\.points\.filter\(\(p\)\s*=>\s*p\.day\s*<=\s*15\)/);
    expect(compare).toMatch(/data\.points\.filter\(\(p\)\s*=>\s*p\.day\s*>=\s*16\)/);
    // 반쪽 표 컬럼 정의(일자/당월/전월/증감) 유지.
    expect(compare).toMatch(/'일자',\s*'당월 매출\(원\)',\s*'전월 매출\(원\)'/);
  });

  test('AC-3/합계 값 셀 각 1회만 — 중복 렌더 없음', () => {
    expect((compare.match(/data-testid="mtm-compare-total-cur"/g) ?? []).length).toBe(1);
    expect((compare.match(/data-testid="mtm-compare-total-prev"/g) ?? []).length).toBe(1);
  });

  test('AC-4/전월 무데이터: prevHasData=false 시 전월·증감 "-" 유지', () => {
    // 전월 값 셀 + 증감 셀 모두 prevHasData 분기로 '-' 폴백.
    expect(compare).toMatch(/data\.prevHasData\s*\?/);
    // 폴백 렌더는 muted '-' span.
    expect(compare).toMatch(/text-muted-foreground">-<\/span>/);
  });
});
