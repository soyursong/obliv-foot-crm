/**
 * T-20260810-foot-DAYCLOSE-MOMTREND-TITLE-REMOVE
 *   마감일 > '총 매출' 탭에서 '2. 전월 대비 매출 추이' 섹션 제목 텍스트(라벨)만 제거.
 *   현장 요청(김주연 총괄 U0ATDB587PV/C0ATE5P6JTH): "마감일 > 총 매출 탭에서 '2. 전월 대비 매출 추이' 섹션 제목 텍스트 삭제"
 *
 *   census 결과: 삭제 대상 제목은 공유 컴포넌트 MonthlyComparisonSection.tsx 의 <h2> 이며
 *   Stats.tsx(통계>MTM매출 02섹션)과 Closing.tsx(마감일 총매출 탭)이 공통 소비.
 *   → 컴포넌트에 hideTitle?:boolean(기본 false) prop 추가. 마감일 탭(Closing)만 hideTitle=true 로 제목 숨김,
 *     통계 화면(Stats)은 prop 미전달(default false) → 제목 유지(AC-3 회귀 가드).
 *   무접촉(불변): 표·산식·데이터·컬럼 헤더·2단 레이아웃·합계 마커 전부. db_change=false, read-only 렌더.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test.describe('정적 소스 불변식 (T-20260810-foot-DAYCLOSE-MOMTREND-TITLE-REMOVE)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const closing = read('src/pages/Closing.tsx');
  const stats = read('src/pages/Stats.tsx');
  const lib = read('src/lib/mtmSales.ts');

  test('AC-0(census): 제목은 공유 컴포넌트 MonthlyComparisonSection 의 <h2> — hideTitle prop 으로 조건부 렌더', () => {
    // 제목 문자열은 컴포넌트에 남아있되(통계 화면용) hideTitle 조건부 가드로 감싸짐.
    expect(compare).toMatch(/hideTitle\?:\s*boolean/);
    expect(compare).toMatch(/hideTitle\s*=\s*false/);        // 기본값 false = 통계 화면 종전대로 노출
    expect(compare).toMatch(/!hideTitle\s*&&/);              // 제목 <h2> 는 !hideTitle 조건부
    expect(compare).toMatch(/2\. 전월 대비 매출 추이/);       // 문자열 자체는 유지(통계 화면에서 렌더)
  });

  test('AC-1: 마감일 총매출 탭은 hideTitle={true} 로 제목 라벨 숨김', () => {
    // Closing 의 <MonthlyComparisonSection ... hideTitle={true} /> 존재.
    const idx = closing.indexOf('<MonthlyComparisonSection');
    expect(idx).toBeGreaterThan(-1);
    const block = closing.slice(idx, idx + 400);
    expect(block).toMatch(/hideTitle=\{true\}/);
  });

  test('AC-2: 하위 "일자별 매출 비교(당월 vs 전월)" 표는 유지(무접촉)', () => {
    expect(compare).toMatch(/일자별 매출 비교 \(당월 vs 전월\)/);
    expect(compare).toMatch(/mtm-monthly-compare/);
    expect(compare).toMatch(/당월 매출\(원\)/);
    expect(compare).toMatch(/전월 매출\(원\)/);
    expect(compare).toMatch(/DailyCompareHalf/);
    expect(compare).toMatch(/mtm-compare-total-cur/);   // 합계 행 마커 불변
    expect(compare).toMatch(/mtm-compare-total-prev/);
    // 마감일 탭은 공유 컴포넌트 소비 유지.
    expect(closing).toMatch(/<MonthlyComparisonSection/);
  });

  test('AC-3(회귀 가드): 통계 화면(Stats)은 hideTitle 미전달 → 제목 계속 표시', () => {
    expect(stats).toMatch(/from '@\/components\/stats\/MonthlyComparisonSection'/);
    const idx = stats.indexOf('<MonthlyComparisonSection');
    expect(idx).toBeGreaterThan(-1);
    const block = stats.slice(idx, idx + 300);
    // 통계 화면은 hideTitle 을 전달하지 않아 기본 false → 제목 유지.
    expect(block).not.toMatch(/hideTitle/);
  });

  test('db_change=false: 렌더 컴포넌트/산식 write 계열 부재(read-only 불변)', () => {
    expect(compare).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});
