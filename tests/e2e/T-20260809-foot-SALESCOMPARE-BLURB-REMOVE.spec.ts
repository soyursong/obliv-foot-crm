/**
 * T-20260809-foot-SALESCOMPARE-BLURB-REMOVE
 *   풋센터 통계/일마감 > 매출비교(당월 vs 전월) 화면에서 요청하지 않은 부연 설명 문구 제거.
 *   현장 요청: 표가 아닌 서술형 안내 문구(도움말·범례·노트)만 제거.
 *
 *   삭제 대상 (공유 컴포넌트 MonthlyComparisonSection.tsx 1곳):
 *     - "이 표 읽는 법" 범례 박스        → data-testid="mtm-compare-legend"
 *     - 실장별 표 상단 안내 노트 박스     → data-testid="mtm-staff-daily-note"
 *   무접촉(불변): 표·숫자·컬럼 헤더(단위 원)·2단 레이아웃(SALESCOMPARE-2COL)·합계·산식(mtmSales.ts).
 *   db_change=false, read-only 렌더. 소비처 = Stats.tsx(통계) + Closing.tsx(일마감) → 공유 1곳 수정으로 동시 반영(AC-3).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test.describe('정적 소스 불변식 (T-20260809-foot-SALESCOMPARE-BLURB-REMOVE)', () => {
  const compare = read('src/components/stats/MonthlyComparisonSection.tsx');
  const lib = read('src/lib/mtmSales.ts');

  test('삭제: 요청 안 한 서술형 안내 박스(범례·노트)가 소스에서 제거됨', () => {
    // 안내 박스 testid + 대표 문구 부재.
    expect(compare).not.toMatch(/mtm-compare-legend/);
    expect(compare).not.toMatch(/mtm-staff-daily-note/);
    expect(compare).not.toMatch(/이 표 읽는 법/);
    // 실장별 노트 본문 서술형 문구 부재.
    expect(compare).not.toMatch(/맡은 고객의/);
  });

  test('무접촉(표·컬럼·2단 레이아웃): 표 구조/헤더/합계 마커 불변', () => {
    // 표 자체 + 컬럼 헤더(단위 원 포함) 유지.
    expect(compare).toMatch(/mtm-monthly-compare/);
    expect(compare).toMatch(/당월 매출\(원\)/);
    expect(compare).toMatch(/전월 매출\(원\)/);
    expect(compare).toMatch(/증감\(당월−전월/);
    // 2단 레이아웃(SALESCOMPARE-2COL) + 반쪽 렌더러 불변.
    expect(compare).toMatch(/md:grid-cols-2/);
    expect(compare).toMatch(/DailyCompareHalf/);
    // 합계 행 마커 불변.
    expect(compare).toMatch(/mtm-compare-total-cur/);
    expect(compare).toMatch(/mtm-compare-total-prev/);
    // 실장별 표(표 자체)는 유지 — 제거된 것은 노트뿐.
    expect(compare).toMatch(/mtm-staff-daily/);
    expect(compare).toMatch(/mtm-staff-grand-total/);
  });

  test('db_change=false: 렌더 컴포넌트/산식에 write 계열 부재(read-only 불변)', () => {
    expect(compare).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(lib).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  test('AC-3(양쪽 반영·divergence 금지): 공유 컴포넌트 1곳을 통계·일마감이 공통 소비', () => {
    const stats = read('src/pages/Stats.tsx');
    const closing = read('src/pages/Closing.tsx');
    expect(stats).toMatch(/from '@\/components\/stats\/MonthlyComparisonSection'/);
    expect(closing).toMatch(/from '@\/components\/stats\/MonthlyComparisonSection'/);
  });
});
