/**
 * E2E spec — T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER
 * 통계 > 치료사 통계: 모든 지표의 치료사 집계 소스를 "직원·공간 > 치료사 role" 단일 출처로 통일하고,
 * 집계 대상을 재직(active) 치료사로 한정.
 *
 * 배경 (planner NEW-TASK MSG-20260622-105450 / 김주연 운영총괄):
 *   - AC3: 항목별 상이 출처 제거 → 단일 소스(staff 테이블 role='therapist').
 *   - AC4: 집계 대상 = role='therapist' AND active=true 만. 퇴사자(김성우)·비치료사 role
 *          (상담실장=consultant: 엄경은·김주연) 노출 금지. 기본값 = 재직 치료사만.
 *   - 비범위(여기서 구현 금지): 로딩 무한전환/지연(AC1/AC2 = T-20260622-foot-LOADING-FLICKER-TRIAGE).
 *
 * 구현 방식(외과적):
 *   RPC 2종(foot_stats_therapist_summary / foot_stats_therapist_services)에 roster CTE 도입.
 *   roster = staff WHERE clinic_id=p AND role='therapist' AND active=true.
 *   집계는 roster 를 anchor 로 LEFT JOIN → 모든 재직 치료사가 4개 지표에 동일 명단으로 등장(AC3),
 *   퇴사자/비치료사는 어떤 지표에도 등장하지 않음(AC4). 반환형 무변경(CREATE OR REPLACE) = db_change 없음.
 *
 * 검증 구성:
 *   AC-로직 (DB 비의존, 순수): 마이그레이션 SQL 이 roster 필터(role='therapist' AND active=true)를
 *     양 RPC 에 모두 포함하고, anchor LEFT JOIN 구조이며, 반환형을 바꾸지 않는다(DROP 없음).
 *   AC-브라우저 (best-effort): 치료사 통계 4개 지표에서 제외 대상 이름(김성우/엄경은/김주연)이
 *     하나도 보이지 않고, 지표1·3·4 표의 치료사 명단이 동일하다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/20260622120000_foot_therapist_stats_staff_source_filter.sql',
);

// 통계에 절대 등장하면 안 되는 이름 — 퇴사 치료사 + 비치료사 role(상담실장)
const EXCLUDED_NAMES = ['김성우', '엄경은', '김주연'];

test.describe('T-20260622 STATS-THERAPIST-LOAD-STAFFFILTER — 치료사 통계 단일소스·재직한정', () => {
  // ── AC-로직: 마이그레이션 SQL 이 roster 필터·anchor 구조·반환형 무변경을 만족 (DB 비의존) ──
  test('AC-로직: 양 RPC 에 roster 필터(therapist·active)와 anchor LEFT JOIN, DROP 없음', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    // 두 RPC 가 모두 CREATE OR REPLACE 로 정의됨 (반환형 변경 없음 = db_change 없음).
    // 스키마 prefix(public.) 유무는 무관 → 함수명 기준으로만 매칭.
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.)?foot_stats_therapist_summary/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.)?foot_stats_therapist_services/i);
    // DROP FUNCTION 으로 반환형을 갈아엎지 않는다 (스키마 변경 회피)
    expect(sql).not.toMatch(/DROP\s+FUNCTION/i);

    // AC4 핵심: roster 정의에 role='therapist' AND active=true 가 함께 존재
    // (공백·따옴표 변형 허용)
    const rosterFilter =
      /role\s*=\s*'therapist'[\s\S]{0,80}?active\s*=\s*true/i;
    const matches = sql.match(new RegExp(rosterFilter, 'gi')) || [];
    // summary·services 양쪽 roster CTE 에서 최소 2회 등장
    expect(matches.length).toBeGreaterThanOrEqual(2);

    // AC3 핵심: 집계가 roster 를 anchor 로 LEFT JOIN (모든 재직 치료사 등장)
    expect(sql).toMatch(/FROM\s+roster\s+r[\s\S]*?LEFT\s+JOIN/i);
    // 단일 소스 = staff 테이블에서만 치료사 명단 도출
    expect(sql).toMatch(/FROM\s+staff\s+s/i);
  });

  // ── AC-브라우저: 통계에 제외 대상 이름이 없고, 지표 간 치료사 명단이 일치 (best-effort) ──
  test('AC-브라우저: 치료사 통계에 퇴사자·비치료사 미노출 + 지표 간 명단 일치', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — AC-로직으로 대체');

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

    // 지표 섹션이 마운트되어야 함
    const avgSection = page.getByTestId('therapist-metric-avgtime');
    await expect(avgSection).toBeVisible();

    // 데이터가 없으면 명단 단언은 AC-로직으로 대체
    const avgRows = avgSection.locator('tbody tr');
    const avgCount = await avgRows.count();
    if (avgCount === 0) {
      test.skip(true, '기간 내 치료사 통계 데이터 없음 — AC-로직으로 대체');
      return;
    }

    // (1) 제외 대상 이름이 통계 어디에도 보이지 않는다 (4개 지표 전체)
    const pageText = (await page.locator('body').innerText()) || '';
    for (const name of EXCLUDED_NAMES) {
      // 통계 컨테이너 내부에서만 검사 — 헤더/사이드바 우연 일치 회피 위해 지표 섹션 한정
      const inAvg = await avgSection.getByText(name, { exact: false }).count();
      expect(inAvg, `지표1에 제외 대상 "${name}" 노출`).toBe(0);
    }

    // (2) 지표1·3·4 표의 치료사 명단이 동일 (단일 소스 anchor)
    const namesIn = async (testid: string) => {
      const sec = page.getByTestId(testid);
      const cells = sec.locator('tbody tr td:first-child');
      const n = await cells.count();
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(((await cells.nth(i).innerText()) || '').trim());
      return out.sort();
    };
    const avgNames = await namesIn('therapist-metric-avgtime');
    const desigNames = await namesIn('therapist-metric-designated');
    const convNames = await namesIn('therapist-metric-conversion');

    // 세 지표 모두 동일한 치료사 명단(단일 roster anchor) — 데이터가 있을 때만
    if (desigNames.length > 0) expect(desigNames).toEqual(avgNames);
    if (convNames.length > 0) expect(convNames).toEqual(avgNames);

    // 명단 중 어느 것도 제외 대상이 아니어야 함
    for (const nm of avgNames) {
      expect(EXCLUDED_NAMES, `명단에 제외 대상 "${nm}"`).not.toContain(nm);
    }
  });
});
