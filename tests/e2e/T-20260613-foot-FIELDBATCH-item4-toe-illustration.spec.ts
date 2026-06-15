/**
 * E2E spec — T-20260613-foot-FIELDBATCH-CHECKIN-CHART-0613 §item4 (스펙 최종확정 pzp9)
 * 치료부위 발가락 일러스트 — 2번차트 패키지 탭 이동 + 양발 SVG 멀티선택 + 1번차트 조건부 연동.
 *
 * 변경 스펙(최종, 김주연 총괄 confirm 2026-06-14):
 *  1) 패키지명(포돌로게/PD) 매칭 조건 제거 → 패키지 탭 상단에 "항상 고정 노출".
 *  2) 양발 발가락 일러스트(SVG): 발가락 10개(L1~L5, R1~R5) 전부 클릭, 중복(복수) 선택 허용.
 *  3) 1번차트: 2번차트 패키지 탭에서 생성된(foot_sites 존재) 경우에만 read-only 자동 연동.
 *  저장: check_ins.treatment_memo.foot_sites jsonb 배열 — 신규 컬럼 0(DB 스키마 변경 없음).
 *
 * 현장 시나리오 3 (E2E 변환):
 *  1. 2번차트 패키지 탭 진입 → 양발 발가락 일러스트가 항상 고정 노출(패키지명 무관)
 *  2. 발가락 1개 클릭 → 선택(ON)
 *  3. 발가락 여러 개 동시 클릭 → 모두 선택 유지(중복선택 허용)
 *  4. 발가락 10개 전부 선택 가능
 *
 * 구성:
 *  - PART A(순수함수): parseFootSites/formatFootSites/toggleFootSite/hasFootSite — 실서버 불필요.
 *  - PART B(라이브): 2번차트 패키지 탭 일러스트 멀티선택 + 영속(check_ins) — service key 없으면 skip.
 *  - PART C(소스 정합): 2번차트 wire-in + 1번차트 조건부 read-only 배선 정적 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFootSites,
  formatFootSites,
  toggleFootSite,
  hasFootSite,
  type FootSite,
} from '../../src/components/FootSiteSelector';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const hasServiceKey = Boolean(SUPA_URL && SERVICE_KEY);

// ─────────────────────────────────────────────────────────────────────────
// PART A — 순수함수(멀티선택 모델)
// ─────────────────────────────────────────────────────────────────────────
test.describe('item4 PART A: FootSites 멀티선택 헬퍼', () => {
  test('parseFootSites — 배열 정상 파싱 + 중복 제거 + 정렬(좌→우, 번호 오름차순)', () => {
    const raw = [
      { side: 'R', toe: 2 },
      { side: 'L', toe: 3 },
      { side: 'L', toe: 1 },
      { side: 'L', toe: 3 }, // 중복
    ];
    expect(parseFootSites(raw)).toEqual([
      { side: 'L', toe: 1 },
      { side: 'L', toe: 3 },
      { side: 'R', toe: 2 },
    ]);
  });

  test('parseFootSites — 레거시 단일 foot_site 객체 호환', () => {
    expect(parseFootSites({ side: 'L', toe: 1 })).toEqual([{ side: 'L', toe: 1 }]);
  });

  test('parseFootSites — 잘못된 원소 제거(빈/범위밖/표시문자열)', () => {
    const raw = [
      { side: 'L', toe: 0 }, // 범위 밖
      { side: 'X', toe: 1 }, // 잘못된 side
      'L1', // 표시문자열 오적재
      { side: 'R', toe: 4 }, // 정상
    ];
    expect(parseFootSites(raw)).toEqual([{ side: 'R', toe: 4 }]);
  });

  test('parseFootSites — null/undefined/빈배열 → []', () => {
    expect(parseFootSites(null)).toEqual([]);
    expect(parseFootSites(undefined)).toEqual([]);
    expect(parseFootSites([])).toEqual([]);
  });

  test('formatFootSites — "L1, L3, R2"', () => {
    expect(formatFootSites([{ side: 'L', toe: 3 }, { side: 'R', toe: 2 }, { side: 'L', toe: 1 }])).toBe('L1, L3, R2');
    expect(formatFootSites([])).toBe('');
    expect(formatFootSites(null)).toBe('');
  });

  test('toggleFootSite — 없으면 추가, 있으면 제거(중복선택 허용 모델)', () => {
    let v: FootSite[] = [];
    v = toggleFootSite(v, 'L', 1);
    expect(v).toEqual([{ side: 'L', toe: 1 }]);
    v = toggleFootSite(v, 'R', 5); // 동시 복수 선택
    expect(hasFootSite(v, 'L', 1)).toBe(true);
    expect(hasFootSite(v, 'R', 5)).toBe(true);
    v = toggleFootSite(v, 'L', 1); // 다시 클릭 → 해제
    expect(hasFootSite(v, 'L', 1)).toBe(false);
    expect(hasFootSite(v, 'R', 5)).toBe(true);
  });

  test('10개 발가락 전부 선택 가능(L1~L5, R1~R5)', () => {
    let v: FootSite[] = [];
    (['L', 'R'] as const).forEach((side) => {
      for (let toe = 1; toe <= 5; toe++) v = toggleFootSite(v, side, toe);
    });
    expect(v).toHaveLength(10);
    (['L', 'R'] as const).forEach((side) => {
      for (let toe = 1; toe <= 5; toe++) expect(hasFootSite(v, side, toe)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PART B — 라이브: 2번차트 패키지 탭 일러스트 멀티선택 + 영속
// ─────────────────────────────────────────────────────────────────────────
test.describe('item4 PART B: 2번차트 패키지 탭 발가락 일러스트(라이브)', () => {
  // SUPERSEDED by T-20260615-foot-PKGTAB-TREATSITE-REMOVE — 2번차트 패키지 탭 일러스트 제거로 본 시나리오 무효.
  test.skip(true, 'SUPERSEDED: 패키지 탭 일러스트 제거(PKGTAB-TREATSITE-REMOVE)');
  test.skip(!hasServiceKey, 'service key 없음 → 시딩 불가, 라이브 skip');

  test('시나리오3: 항상 고정 노출 + 멀티선택 + check_ins 영속', async ({ page }) => {
    const handle = await seedCheckIn({ status: 'consultation', visit_type: 'new', name: `E2E발가락${Date.now().toString().slice(-5)}` });
    try {
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) test.skip(true, '로그인 실패 — 라이브 skip');

      // 2번차트(고객차트 풀페이지) 진입
      await page.goto(`/chart/${handle.customerId}`);
      await page.waitForLoadState('networkidle');

      // 패키지 탭 클릭
      const pkgTab = page.getByRole('button', { name: '패키지', exact: true }).first();
      if ((await pkgTab.count()) === 0) test.skip(true, '패키지 탭 미노출(권한/레이아웃) — skip');
      await pkgTab.click();

      // 1. 항상 고정 노출(패키지명 무관)
      const illust = page.locator('[data-testid="foot-toe-illustration"]');
      await expect(illust, '패키지 탭 상단 발가락 일러스트 항상 노출').toBeVisible();

      // 발가락 10개 테스트id 존재
      for (const side of ['L', 'R'] as const) {
        for (let t = 1; t <= 5; t++) {
          await expect(page.locator(`[data-testid="toe-${side}-${t}"]`)).toHaveCount(1);
        }
      }

      // 2. 발가락 1개 클릭 → 선택
      await page.locator('[data-testid="toe-L-1"]').click();
      await expect(page.locator('[data-testid="toe-L-1"]')).toHaveAttribute('data-selected', 'true');

      // 3. 여러 개 동시 선택(중복선택 허용)
      await page.locator('[data-testid="toe-R-5"]').click();
      await page.locator('[data-testid="toe-L-3"]').click();
      await expect(page.locator('[data-testid="toe-R-5"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-testid="toe-L-3"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-testid="toe-L-1"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-testid="foot-toe-preview"]')).toContainText('L1');

      // 4. check_ins 영속 — 리로드 후 선택 유지
      await page.waitForTimeout(600); // optimistic update + DB write
      await page.reload();
      await page.waitForLoadState('networkidle');
      const pkgTab2 = page.getByRole('button', { name: '패키지', exact: true }).first();
      await pkgTab2.click();
      await expect(page.locator('[data-testid="toe-L-1"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-testid="toe-R-5"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('[data-testid="toe-L-3"]')).toHaveAttribute('data-selected', 'true');
    } finally {
      await handle.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PART C — 소스 정합(배선 정적 검증)
// ─────────────────────────────────────────────────────────────────────────
test.describe('item4 PART C: 소스 정합', () => {
  const here = fileURLToPath(import.meta.url); // .../tests/e2e/<spec>.ts
  const root = join(here, '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf-8');

  test('FootToeIllustration — 10개 발가락 testid + 멀티선택 헬퍼 사용', () => {
    const src = read('src/components/FootToeIllustration.tsx');
    expect(src).toContain('data-testid={`toe-${side}-${t.toe}`}');
    expect(src).toContain('toggleFootSite');
    expect(src).toContain('data-testid="foot-toe-illustration"');
    // 발가락 5개 좌표(BASE_TOES) × 양발 → 10개
    expect(src).toContain('BASE_TOES');
  });

  // SUPERSEDED by T-20260615-foot-PKGTAB-TREATSITE-REMOVE — 2번차트 패키지 탭 일러스트는 현장 요청으로 제거됨.
  //   (입력 UI 제거. treatment_memo.foot_sites 데이터·하류 read-path는 보존 — 아래 chart1 test가 가드)
  test('2번차트(CustomerChartPage) 패키지 탭 — 일러스트 제거(SUPERSEDED)', () => {
    const src = read('src/pages/CustomerChartPage.tsx');
    expect(src).not.toContain('data-testid="pkg-tab-toe-section"');
    expect(src).not.toContain('<FootToeIllustration');
    expect(src).not.toContain('saveTreatmentToes');
  });

  test('1번차트(CheckInDetailSheet) — foot_sites 있을 때만 read-only 조건부 연동', () => {
    const src = read('src/components/CheckInDetailSheet.tsx');
    expect(src).toContain('data-testid="chart1-toe-readonly"');
    expect(src).toContain('<FootToeIllustration value={toes} readOnly />');
    expect(src).toContain('if (toes.length === 0) return null'); // 조건부(생성분만)
    // 편집형 FootSiteSelector 는 1번차트에서 제거(2번차트로 이동)
    expect(src).not.toContain('<FootSiteSelector');
  });
});
