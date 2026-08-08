/**
 * T-20260809-foot-STATS-EXTRA-DESC-BOX-REMOVE
 *   (canonical of T-20260809-foot-SALESCOMPARE-BLURB-REMOVE 외 duplicate 통합)
 *   풋센터 통계/일마감 매출비교 화면에서 요청하지 않은 teal 안내 설명 박스 3개 전부 제거.
 *   현장 요청(김주연 총괄 U0ATDB587PV/C0ATE5P6JTH): "통계 / 일마감 - 매출비교 - 요청하지 않은 부연 설명 전부 제거해줘"
 *
 *   제거 대상 (JSX 표시 요소 삭제만, 산식·데이터·테이블 구조 무접촉):
 *     #1 MonthlyComparisonSection.tsx — "이 표 읽는 법" 범례   → data-testid="mtm-compare-legend"
 *     #2 MonthlyComparisonSection.tsx — 실장별 표 안내 노트     → data-testid="mtm-staff-daily-note"
 *     #3 Closing.tsx 매출 비교 탭 — "{compareMonth} 기준 ... 동일한 값입니다" teal 박스
 *   무접촉(불변): 표·숫자·컬럼 헤더(단위 원)·2단 레이아웃(SALESCOMPARE-2COL)·합계·산식(mtmSales.ts).
 *   db_change=false, read-only 렌더. 소비처 = Stats.tsx(통계) + Closing.tsx(일마감).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test.describe('정적 소스 불변식 (T-20260809-foot-STATS-EXTRA-DESC-BOX-REMOVE)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const closing = read('src/pages/Closing.tsx');
  const lib = read('src/lib/mtmSales.ts');

  test('AC-1: 통계 컴포넌트 안내 박스 2개(범례·실장 노트) 제거됨', () => {
    expect(compare).not.toMatch(/mtm-compare-legend/);
    expect(compare).not.toMatch(/mtm-staff-daily-note/);
    expect(compare).not.toMatch(/이 표 읽는 법/);
    expect(compare).not.toMatch(/맡은 고객의/);
  });

  test('AC-2: 일마감 매출 비교 탭 teal 안내 박스 제거됨', () => {
    // "{compareMonth} 기준 일자별 매출 비교(당월 vs 전월)예요. 통계 화면의 같은 표와 동일한 값입니다." 박스 부재.
    expect(closing).not.toMatch(/기준 일자별 매출 비교\(당월 vs 전월\)예요/);
    expect(closing).not.toMatch(/통계 화면의 같은 표와 동일한 값입니다/);
    // compareMonth 쿼리 변수는 유지(데이터 경로 무접촉).
    expect(closing).toMatch(/const compareMonth = date\.slice/);
  });

  test('AC-3(회귀 0 / 무접촉): 표·컬럼 헤더·2단 레이아웃·합계 마커 불변', () => {
    expect(compare).toMatch(/mtm-monthly-compare/);
    expect(compare).toMatch(/당월 매출\(원\)/);
    expect(compare).toMatch(/전월 매출\(원\)/);
    expect(compare).toMatch(/증감\(당월−전월/);
    expect(compare).toMatch(/md:grid-cols-2/);       // 2단 레이아웃(SALESCOMPARE-2COL)
    expect(compare).toMatch(/DailyCompareHalf/);
    expect(compare).toMatch(/mtm-compare-total-cur/); // 합계 행
    expect(compare).toMatch(/mtm-compare-total-prev/);
    // 실장별 표(표 자체)는 유지 — 제거된 것은 노트뿐.
    expect(compare).toMatch(/mtm-staff-daily/);
    expect(compare).toMatch(/mtm-staff-grand-total/);
    // 일마감 탭은 MonthlyComparisonSection 공유 소비 유지.
    expect(closing).toMatch(/<MonthlyComparisonSection/);
  });

  test('db_change=false: 렌더 컴포넌트/산식 write 계열 부재(read-only 불변)', () => {
    expect(compare).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC(양쪽 반영·divergence 금지): 공유 컴포넌트를 통계·일마감이 공통 소비', () => {
    const stats = read('src/pages/Stats.tsx');
    expect(stats).toMatch(/from '@\/components\/stats\/MonthlyComparisonSection'/);
    expect(closing).toMatch(/from '@\/components\/stats\/MonthlyComparisonSection'/);
  });
});
