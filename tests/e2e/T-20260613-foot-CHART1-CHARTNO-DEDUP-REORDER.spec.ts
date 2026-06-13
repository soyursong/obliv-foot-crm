/**
 * E2E spec — T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER
 * 1번차트(CheckInDetailSheet) 차트번호 중복 제거 + 섹션 순서 재정렬 — **결정적 시딩 라이브**.
 *
 * AC-1: 이름 하단 단독 차트번호(div.text-sm.font-semibold.text-teal-700) 제거
 * AC-2: 이름 옆 차트번호만 유지 (화면당 1회) — data-testid="chartno-inline"
 * AC-3: 섹션 순서 = 치료부위 → 금일동선 → 패키지 → 예약메모 → 고객메모 → 기타메모
 *        → 진료이미지 → (경과분석지/KOH = CHART1-TRIM 제거, skip) → 결제 → 서류발행
 *        ※ 핵심 변경: 메모 블록(예약/고객/기타)이 금일동선·패키지 "아래"로 이동
 * AC-4: 치료부위 2번차트 조건부 read-only 연동 — 2번차트에서 생성된 경우(treatment_memo.foot_sites
 *        존재)에만 1번차트 표시(단방향 read 바인딩). 위치는 맨 위 유지(순서 이동 없음).
 *        없으면 미렌더(현행 유지). S-4 양성 + S-2 음성으로 검증.
 *
 * 시딩: seedCheckIn(status='consultation', customer 연결) → 메모/패키지/진료이미지 섹션 렌더.
 *       customers.chart_number 세팅 → AC-1/AC-2 결정적 검증.
 *       S-4는 별도 시딩 + check_ins.treatment_memo.foot_sites 세팅 → AC-4 양성 검증.
 *       service key 없으면 skip.
 *
 * 시나리오 (현장 클릭 4종):
 *   S-1: 차트번호 중복 제거 (AC-1/AC-2) — 이름 옆 배지 1개, 하단 단독 div 0개
 *   S-2: 섹션 순서 — (치료부위 조건부) < 금일동선 < 예약메모 < 고객메모 < 기타메모 < 결제 (AC-3)
 *   S-3: 회귀 없음 — Sheet 정상 오픈, JS 에러 없음
 *   S-4: 치료부위 2번차트 조건부 read-only + 맨 위 유지 (AC-4)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Locator } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn, type FixtureHandle } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const hasServiceKey = Boolean(SUPA_URL && SERVICE_KEY);

const SEED_NAME = `E2E차트정렬${Date.now().toString().slice(-6)}`;
const CHART_NO = `F-QA${Date.now().toString().slice(-5)}`;

let sb: SupabaseClient;
let handle: (FixtureHandle & { customerId: string }) | null = null;

/** 시딩 카드를 클릭해 1번차트 Sheet를 연다. (name 미지정 시 공용 SEED_NAME) */
async function openSeededChart(page: Page, name: string = SEED_NAME): Promise<Locator | null> {
  await page.goto('/admin');
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

  const card = page
    .locator('[data-testid="checkin-card"]')
    .filter({ hasText: name })
    .first();
  const ok = await card
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return null;

  await card.scrollIntoViewIfNeeded();
  await card.click();

  // 칸반 카드 클릭은 1번차트(CheckInDetailSheet, 440px)와 2번차트(CustomerChartSheet, wide·lazy)를
  // "둘 다" 연다(Dashboard openChartFor: setSelectedCheckIn + ctxOpenChart). 2번차트가 위(z-70)로 덮으며
  // 잠시 "불러오는 중…"을 표시하므로, role=dialog first()는 2번차트를 잡는다.
  // → chartno-inline(=CheckInDetailSheet 전용 anchor)을 가진 dialog로 1번차트를 정확히 스코프한다.
  const sheet = page
    .locator('[role="dialog"]')
    .filter({ has: page.getByTestId('chartno-inline') })
    .first();
  const ready = await sheet
    .getByTestId('chartno-inline')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  return ready ? sheet : null;
}

/** 표시된 Locator의 상단 y좌표. 미표시면 null. */
async function topY(loc: Locator): Promise<number | null> {
  if ((await loc.count()) === 0) return null;
  const box = await loc.first().boundingBox();
  return box ? box.y : null;
}

test.describe('T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER — 차트번호 중복 제거 + 섹션 순서', () => {
  test.skip(!hasServiceKey, 'SUPABASE_SERVICE_ROLE_KEY 없음 — 시딩 불가');

  test.beforeAll(async () => {
    sb = createClient(SUPA_URL, SERVICE_KEY);
    // consultation 단계 + customer 연결 → 메모/패키지/진료이미지 섹션 렌더
    handle = await seedCheckIn({ status: 'consultation', visit_type: 'new', name: SEED_NAME });
    expect(handle.id, '체크인 시딩 실패').toBeTruthy();
    // AC-1 결정적 검증용 차트번호 발번
    const { error } = await sb
      .from('customers')
      .update({ chart_number: CHART_NO })
      .eq('id', handle.customerId);
    expect(error, `chart_number 세팅 실패: ${error?.message}`).toBeNull();
  });

  test.afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * S-1: 차트번호 중복 제거 (AC-1/AC-2)
   * - 이름 옆 차트번호 배지(chartno-inline) = 1개, '#F-QA…' 표기
   * - 이름 하단 단독 차트번호 div(text-sm font-semibold text-teal-700, 값 포함) = 0개
   */
  test('S-1: 차트번호 — 이름 옆 1회만, 하단 단독 미존재 (AC-1/AC-2)', async ({ page }) => {
    const sheet = await openSeededChart(page);
    expect(sheet, '시딩 카드 Sheet 오픈').not.toBeNull();
    if (!sheet) return;

    // AC-2: 이름 옆 차트번호 배지 = 정확히 1개, 발번값 포함
    const inline = sheet.getByTestId('chartno-inline');
    expect(await inline.count(), 'AC-2: 이름 옆 차트번호 배지 1개').toBe(1);
    await expect(inline.first(), 'AC-2: 배지에 발번 차트번호 표기').toContainText(CHART_NO);

    // AC-1: 이름 하단 단독 차트번호 div(제거 대상 패턴) = 0개
    const standalone = sheet
      .locator('div.text-sm.font-semibold.text-teal-700')
      .filter({ hasText: CHART_NO });
    expect(await standalone.count(), 'AC-1: 이름 하단 단독 차트번호 div 미존재').toBe(0);

    // 에러 토스트 없음
    expect(
      await page.locator('[data-sonner-toast][data-type="error"]').count(),
      'AC-1: 에러 토스트 미표시',
    ).toBe(0);
  });

  /**
   * S-2: 섹션 순서 재정렬 (AC-3)
   * 치료부위(조건부) < 금일동선 < 예약메모 < 고객메모 < 기타메모 < 결제 (y좌표 단조 증가).
   * 핵심 변경점: 금일동선이 메모(예약/고객/기타) "위"에 위치(이전엔 메모가 위였음).
   *
   * ▶ T-20260613-foot-FIELDBATCH item4 supersede(스펙 최종확정 pzp9):
   *   1번차트의 치료부위는 편집형 FootSiteSelector → 2번차트 패키지 탭으로 "이동".
   *   1번차트는 "2번차트에서 생성된(foot_sites 존재) 경우에만" read-only 조건부 표시(data-testid="chart1-toe-readonly").
   *   본 시딩 check_in 은 foot_sites 미설정 → 치료부위 섹션 미렌더(정상). 따라서 순서 체인에서 조건부(있으면 포함).
   *   (AC-4 "보류, 현행 FootSiteSelector 유지만 검증" → item4 로 해소·대체.)
   */
  test('S-2: 섹션 순서 — (치료부위 조건부) → 금일동선 → 메모 → 결제 (AC-3)', async ({ page }) => {
    const sheet = await openSeededChart(page);
    expect(sheet, '시딩 카드 Sheet 오픈').not.toBeNull();
    if (!sheet) return;

    // 측정 전 콘텐츠 풀-렌더 대기: 금일동선·기타메모 라벨이 보일 때까지(데이터 로드 완료 신호).
    await sheet.locator('[data-testid="space-assign-section"]').waitFor({ state: 'visible', timeout: 10_000 });
    await sheet.locator('label', { hasText: '기타메모' }).first().waitFor({ state: 'visible', timeout: 10_000 });

    // item4: 치료부위는 조건부 read-only(2번차트 생성분만). 미시딩이면 null → 순서 체인에서 자동 제외.
    const yFootSite = await topY(sheet.locator('[data-testid="chart1-toe-readonly"]'));
    const yDailyFlow = await topY(sheet.locator('[data-testid="space-assign-section"]'));
    const yResvMemo = await topY(sheet.locator('label', { hasText: '예약메모' }));
    const yCustMemo = await topY(sheet.locator('label', { hasText: '고객메모' }));
    const yEtcMemo = await topY(sheet.locator('label', { hasText: '기타메모' }));
    const yPayment = await topY(sheet.getByText('결제', { exact: true }));

    // 치료부위는 조건부 — 강제 표시 단언 제거(item4). 나머지 섹션은 시딩 조건에서 렌더되어야 함.
    expect(yDailyFlow, 'AC-3: 금일동선 표시').not.toBeNull();
    expect(yResvMemo, 'AC-3: 예약메모 표시').not.toBeNull();
    expect(yCustMemo, 'AC-3: 고객메모 표시').not.toBeNull();
    expect(yEtcMemo, 'AC-3: 기타메모 표시').not.toBeNull();

    const ordered: Array<[string, number | null]> = [
      ['치료부위', yFootSite],
      ['금일동선', yDailyFlow],
      ['예약메모', yResvMemo],
      ['고객메모', yCustMemo],
      ['기타메모', yEtcMemo],
      ['결제', yPayment],
    ];
    const present = ordered.filter(([, y]) => y !== null) as Array<[string, number]>;
    for (let i = 1; i < present.length; i++) {
      const [prevName, prevY] = present[i - 1];
      const [curName, curY] = present[i];
      expect(prevY, `AC-3: '${prevName}'(${prevY})가 '${curName}'(${curY})보다 위`).toBeLessThan(curY);
    }

    // 핵심 변경 명시: 금일동선이 예약메모보다 위
    expect(yDailyFlow!, 'AC-3 핵심: 금일동선이 예약메모보다 위').toBeLessThan(yResvMemo!);

    // 증거 스크린샷
    await page.screenshot({
      path: 'evidence/T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER_S2_order.png',
      fullPage: true,
    });
  });

  /**
   * S-3: 회귀 없음 — Sheet 정상 오픈, JS 에러 없음
   */
  test('S-3: 회귀 없음 — Sheet 정상 오픈/무에러', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    const sheet = await openSeededChart(page);
    expect(sheet, '시딩 카드 Sheet 오픈').not.toBeNull();
    if (!sheet) return;
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(1_000);

    const critical = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(critical, 'S-3: JS 에러 없음').toHaveLength(0);
    expect(await sheet.getByTestId('chartno-inline').count(), 'S-3: 차트번호 배지 유지').toBe(1);
  });

  /**
   * S-4: 치료부위 2번차트 조건부 read-only 연동 (AC-4)
   * - 2번차트에서 생성된 경우(= check_ins.treatment_memo.foot_sites 존재)에만 1번차트 표시.
   *   단방향 read 바인딩: 1번차트는 표시만, 편집 UI 없음.
   * - 위치 = 맨 위 그대로 유지 → 금일동선(space-assign-section)보다 위.
   * 음성 케이스(foot_sites 부재 → 미렌더)는 S-2가 공용 핸들로 검증(chart1-toe-readonly null 허용).
   */
  test('S-4: 치료부위 — 2번차트 생성분만 read-only 표시 + 맨 위 유지 (AC-4)', async ({ page }) => {
    const name = `E2E치료부위${Date.now().toString().slice(-6)}`;
    const seeded = await seedCheckIn({ status: 'consultation', visit_type: 'new', name });
    expect(seeded.id, '치료부위 시딩 실패').toBeTruthy();
    // 2번차트 생성 시뮬레이션: treatment_memo.foot_sites 배열 세팅 (parseFootSites shape)
    const { error: tmErr } = await sb
      .from('check_ins')
      .update({ treatment_memo: { foot_sites: [{ side: 'L', toe: 1 }, { side: 'R', toe: 3 }] } })
      .eq('id', seeded.id);
    expect(tmErr, `treatment_memo 세팅 실패: ${tmErr?.message}`).toBeNull();

    try {
      const sheet = await openSeededChart(page, name);
      expect(sheet, '치료부위 시딩 카드 Sheet 오픈').not.toBeNull();
      if (!sheet) return;

      // AC-4: 조건부 read-only 치료부위 = 1개 표시
      const toe = sheet.getByTestId('chart1-toe-readonly');
      expect(await toe.count(), 'AC-4: 2번차트 생성분 → 치료부위 read-only 표시').toBe(1);

      // AC-4: 위치 = 맨 위 유지 → 금일동선보다 위
      const yToe = await topY(toe);
      const yDailyFlow = await topY(sheet.locator('[data-testid="space-assign-section"]'));
      expect(yToe, 'AC-4: 치료부위 y좌표 측정').not.toBeNull();
      expect(yDailyFlow, 'AC-4: 금일동선 표시').not.toBeNull();
      expect(yToe!, 'AC-4: 치료부위가 금일동선보다 위 (맨 위 유지)').toBeLessThan(yDailyFlow!);

      // 단방향 read — 편집형 FootSiteSelector(체크박스/토글) 미존재
      expect(
        await toe.locator('input[type="checkbox"], button[role="switch"]').count(),
        'AC-4: read-only — 편집 컨트롤 미노출',
      ).toBe(0);
    } finally {
      await seeded.cleanup();
    }
  });
});
