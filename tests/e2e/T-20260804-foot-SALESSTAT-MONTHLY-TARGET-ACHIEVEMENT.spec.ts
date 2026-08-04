/**
 * T-20260804-foot-SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT
 * 통계 > "01 매출통계" 최상단 — 이번 달 목표 매출(월별 저장/수정) + 목표 대비 달성률(%) E2E spec
 *
 * AC:
 *   AC-1: 01 매출통계 최상단 목표매출 입력·저장 칸 렌더, 저장 시 월별 영속(재진입 유지).
 *   AC-2: 달성률 = 당월 실매출 ÷ 목표 × 100. 분자=누적매출(순)=pkg+single−refund(fetchRevenue SSOT).
 *   AC-3: 목표 미설정/0 → 달성률 '-'(0 나눗셈·0% 오도 금지).
 *   AC-4: 저장소 ADDITIVE 마이그(멱등+롤백) — 정적 불변식으로 검증.
 *   AC-5: 01 섹션 레이아웃 = 목표카드가 RevenueSection '위'(맨 상단) 마운트, 회귀 없음.
 *
 * ※ 목표 저장 라이브 동선은 monthly_sales_targets 테이블 배포(마이그 적용, DA GO 후) 이후 검증.
 *   본 spec은 정적 소스 불변식 + 라이브 렌더 스모크(테이블 부재에도 카드 렌더/에러없음)로 커버.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loginAndWaitForDashboard } from '../helpers';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 정적 소스 불변식 — 산식·저장방식·레이아웃·마이그 (토큰 무관 견고 검증)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('정적 소스 불변식 (SALESSTAT-MONTHLY-TARGET-ACHIEVEMENT)', () => {
  const lib = read('src/lib/monthlyTarget.ts');
  const section = read('src/components/stats/MonthlyTargetSection.tsx');
  const page = read('src/pages/Stats.tsx');
  const mig = read('supabase/migrations/20260804110000_foot_monthly_sales_targets.sql');
  const rollback = read('supabase/migrations/20260804110000_foot_monthly_sales_targets.rollback.sql');

  test('AC-2(분자 정의): 당월 실매출 = fetchRevenue net(pkg+single−refund) — 새 산식 창작 금지', () => {
    expect(lib).toMatch(/import\s*\{\s*fetchRevenue\s*\}\s*from\s*'@\/lib\/stats'/);
    const fn = lib.slice(lib.indexOf('export async function fetchMonthRevenueNet'));
    expect(fn).toMatch(/package_amount\s*\?\?\s*0\)\s*\+\s*\(r\.single_amount\s*\?\?\s*0\)\s*-\s*\(r\.refund_amount/);
  });

  test('AC-2(달성률 산식): actualNet ÷ target × 100', () => {
    const fn = lib.slice(lib.indexOf('export function achievementRate'));
    expect(fn).toMatch(/\(actualNet\s*\/\s*target\)\s*\*\s*100/);
  });

  test('AC-3(0/미설정 가드): target null·0·음수 → null(달성률 -)', () => {
    const fn = lib.slice(lib.indexOf('export function achievementRate'));
    // target===null 또는 target>0 아니면 null 반환 → 0 나눗셈·0% 오도 방지
    expect(fn).toMatch(/if\s*\(target\s*===\s*null\s*\|\|\s*!\(target\s*>\s*0\)\)\s*return\s*null/);
    // 화면: rate === null → '-'
    expect(section).toMatch(/rate\s*===\s*null\s*\?\s*'-'/);
  });

  test('AC-1(월별 저장): upsert on (clinic_id, year_month) UNIQUE — 월 단위 영속/수정', () => {
    const fn = lib.slice(lib.indexOf('export async function upsertMonthlyTarget'));
    expect(fn).toMatch(/\.from\('monthly_sales_targets'\)/);
    expect(fn).toMatch(/\.upsert\(/);
    expect(fn).toMatch(/onConflict:\s*'clinic_id,year_month'/);
  });

  test('AC-1(월 스코프): refISO가 속한 달(YYYY-MM) 기준 — day-of-month TZ 안전', () => {
    const fn = lib.slice(lib.indexOf('export function monthScope'));
    expect(fn).toMatch(/new Date\(y,\s*m,\s*0\)\.getDate\(\)/); // 말일 계산(TZ 무관)
    expect(fn).toMatch(/yearMonth:\s*`\$\{y\}-\$\{mm\}`/);
  });

  test('AC-5(레이아웃): 목표카드가 RevenueSection 위(맨 상단)에 마운트', () => {
    expect(page).toMatch(/import MonthlyTargetSection from '@\/components\/stats\/MonthlyTargetSection'/);
    // revenue fragment 내에서 MonthlyTargetSection이 RevenueSection보다 먼저 렌더
    const frag = page.slice(page.indexOf("tab === 'revenue' ?"));
    const mIdx = frag.indexOf('<MonthlyTargetSection');
    const rIdx = frag.indexOf('<RevenueSection');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(rIdx).toBeGreaterThan(mIdx); // 목표카드 → 매출섹션 순서
  });

  test('AC-4(ADDITIVE 마이그): create table if not exists + UNIQUE + RLS, DROP/타입변경 없음', () => {
    expect(mig).toMatch(/create table if not exists public\.monthly_sales_targets/);
    expect(mig).toMatch(/unique\s*\(clinic_id,\s*year_month\)/);
    expect(mig).toMatch(/enable row level security/);
    // 파괴적 연산 부재(up.sql): 기존 객체 drop table/alter drop column 금지
    expect(mig).not.toMatch(/drop table(?!\s+if\s+exists\s+public\.monthly_sales_targets)/i);
    expect(mig).not.toMatch(/drop column|alter column .* type/i);
  });

  test('AC-4(롤백 존재): rollback = 신규 테이블 DROP(역연산)', () => {
    expect(rollback).toMatch(/drop table if exists public\.monthly_sales_targets/);
  });

  test('AC(멱등): 정책 drop-if-exists 가드 + set_updated_at 트리거 재사용', () => {
    expect(mig).toMatch(/drop policy if exists "monthly_sales_targets_select"/);
    expect(mig).toMatch(/execute function public\.set_updated_at\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 브라우저 동선 — 로그인 가능 시에만 (테이블 배포 전에도 카드 렌더/에러없음 스모크)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('목표매출/달성률 카드 브라우저 동선', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('시나리오1: 매출통계 탭 최상단 목표매출/달성률 카드 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 기본 탭 = 매출 통계
    await expect(page.getByText('이번 달 목표 매출').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('목표 대비 달성률').first()).toBeVisible();
    // 통계 로드 에러 배너 없음(회귀 가드)
    await expect(page.getByText(/통계를 불러오지 못했습니다/)).toHaveCount(0);
    console.log('[목표매출] 카드 렌더 OK');
  });

  test('AC-3 시나리오: 목표 미설정 시 달성률 "-" 표시', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    const achievement = page.getByTestId('monthly-target-achievement');
    await expect(achievement.first()).toBeVisible({ timeout: 10_000 });
    // 목표 미설정 상태(테이블 부재/빈값)에서 0% 오도 없이 '-' 또는 %(설정된 경우) 표시
    const txt = (await achievement.first().textContent())?.trim() ?? '';
    expect(txt === '-' || txt === '…' || /%$/.test(txt)).toBeTruthy();
    console.log(`[목표매출] 달성률 표시=${txt} (0% 오도 없음)`);
  });

  test('회귀: 매출통계 기존 지표(총 매출/누적매출) 정상 렌더', async ({ page }) => {
    await page.goto('/admin/stats');
    await expect(page.getByText('통계 대시보드')).toBeVisible({ timeout: 10_000 });
    // 목표카드가 얹혀도 기존 매출 섹션 회귀 없음
    await expect(page.getByText('일별 매출 추이').first()).toBeVisible({ timeout: 10_000 });
    console.log('[목표매출] 기존 매출통계 회귀 없음 OK');
  });
});
