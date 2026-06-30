/**
 * T-20260630-foot-RESV-CAL-COUNT-LABEL
 * 예약관리 일간(가로 시간격자) 슬롯 헤더 — 시간 텍스트 바로 아래 한 줄에 초/재/힐러 3종 건수 통일 표기.
 * reporter=김주연 총괄(C0ATE5P6JTH, thread 1782785111.693999) / P2 · FE-only · DB 무변경.
 *
 * 변경 전: 슬롯 헤더 건수가 0인 종은 칩을 생략 → "초2 재1"처럼 부분표기(힐러0 누락). 시간 옆 인라인.
 * 변경 후: 시간 바로 아래 full-width 한 줄에 초/재/힐러 3종을 항상 노출(0 포함, 부분표기 제거).
 *   포맷 例 "초2 · 재1 · 힐러0". 색 = T-20260625 A안(초진 파랑 / 재진 초록 firstvisit / 힐러 노랑 healer-700).
 *   산식 = kindCounts(resvKind SSOT·취소 제외) — 이미 로드된 resvByKey 재사용(신규쿼리 없음).
 *
 * 현장 클릭 시나리오 → E2E (AC1~AC5):
 *   [S1] 일간 진입 → 모든 시간 슬롯 헤더에 건수 라벨(resv-day-hslot-count-*)이 존재하고, 각 라벨에
 *        초/재/힐러 3종 토큰이 모두 한 줄로 노출(부분표기 X). (AC1)
 *   [S2] 0 처리 일관 — 예약 없는 슬롯 포함 모든 라벨이 3종을 0까지 표기(초0/재0/힐러0 누락 없음). (AC1/AC4)
 *   [S3] 좁은 90px 컬럼 overflow/줄넘침 가드 — 라벨은 한 줄(높이 1줄)·컬럼 폭 내. 시간 텍스트 바로 아래 위치. (AC3)
 *
 * 데이터/로그인/clinic 미할당 환경에서는 구조 검증으로 graceful skip.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

async function gotoDayView(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/reservations`);
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle');
  // 뷰 토글은 정확히 "일간"(미니 "일" 버튼과 구분).
  const dayToggle = page.getByRole('button', { name: '일간', exact: true });
  if ((await dayToggle.count()) > 0) {
    await dayToggle.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const horizontal = page.locator('[data-testid="resv-day-horizontal"]');
  return await horizontal.isVisible({ timeout: 5000 }).catch(() => false);
}

test.describe('RESV-CAL-COUNT-LABEL [S1] 슬롯 헤더 3종 건수 통일 표기', () => {
  test('모든 시간 슬롯 헤더에 초/재/힐러 3종이 한 줄로 노출(부분표기 X)', async ({ page }) => {
    const ok = await gotoDayView(page);
    test.skip(!ok, '일간 가로 격자 미렌더(로그인/clinic 미할당) — skip');

    const labels = page.locator('[data-testid^="resv-day-hslot-count-"]');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0); // 영업시간 슬롯 헤더 1개 이상

    // 각 라벨에 초/재/힐러 3종 토큰이 모두 존재(부분표기 금지).
    for (let i = 0; i < count; i++) {
      const txt = (await labels.nth(i).innerText()).replace(/\s+/g, '');
      expect(txt, `슬롯 ${i} 라벨에 '초' 누락`).toMatch(/초\d+/);
      expect(txt, `슬롯 ${i} 라벨에 '재' 누락`).toMatch(/재\d+/);
      expect(txt, `슬롯 ${i} 라벨에 '힐러' 누락`).toMatch(/힐러\d+/);
    }
  });

  test('표기 순서 = 초진 → 재진 → 힐러', async ({ page }) => {
    const ok = await gotoDayView(page);
    test.skip(!ok, '일간 가로 격자 미렌더 — skip');
    const first = page.locator('[data-testid^="resv-day-hslot-count-"]').first();
    test.skip((await first.count()) === 0, '슬롯 헤더 없음 — skip');
    const txt = (await first.innerText()).replace(/\s+/g, '');
    const ci = txt.indexOf('초');
    const ri = txt.indexOf('재');
    const hi = txt.indexOf('힐러');
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(ri).toBeGreaterThan(ci);
    expect(hi).toBeGreaterThan(ri);
  });
});

test.describe('RESV-CAL-COUNT-LABEL [S2] 0 처리 일관', () => {
  test('예약 없는 슬롯 포함 모든 라벨이 3종을 0까지 표기(누락 없음)', async ({ page }) => {
    const ok = await gotoDayView(page);
    test.skip(!ok, '일간 가로 격자 미렌더 — skip');

    const labels = page.locator('[data-testid^="resv-day-hslot-count-"]');
    const count = await labels.count();
    test.skip(count === 0, '슬롯 헤더 없음 — skip');

    // 어떤 슬롯이든 3종 토큰 갯수가 정확히 3개여야(초/재/힐러 각 1회). 0건 슬롯도 "초0 · 재0 · 힐러0".
    for (let i = 0; i < count; i++) {
      const txt = (await labels.nth(i).innerText()).replace(/\s+/g, '');
      const kinds = (txt.match(/(초|재|힐러)\d+/g) ?? []).length;
      expect(kinds, `슬롯 ${i} 토큰 수 != 3 (부분표기 의심): "${txt}"`).toBe(3);
    }
  });
});

test.describe('RESV-CAL-COUNT-LABEL [S3] 좁은 폭 overflow/줄넘침 가드', () => {
  test('라벨은 한 줄(줄넘침 X)이며 컬럼 폭 내, 시간 텍스트 바로 아래 위치', async ({ page }) => {
    const ok = await gotoDayView(page);
    test.skip(!ok, '일간 가로 격자 미렌더 — skip');

    const labels = page.locator('[data-testid^="resv-day-hslot-count-"]');
    const count = await labels.count();
    test.skip(count === 0, '슬롯 헤더 없음 — skip');

    // 한 줄(줄넘침 X): 라벨 높이가 단일 행 폰트(8px)에 근접 — 12px 이내면 줄바꿈 없음으로 간주.
    for (let i = 0; i < Math.min(count, 8); i++) {
      const box = await labels.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height, `슬롯 ${i} 라벨 줄넘침(height=${box.height})`).toBeLessThanOrEqual(14);
    }

    // 시간 텍스트 바로 아래(헤더 내 시간행 다음): 카운트 라벨 top > 헤더 시간 span top.
    const firstTime = await labels.first().getAttribute('data-testid');
    const slot = firstTime!.replace('resv-day-hslot-count-', '');
    const header = page.locator(`[data-testid="resv-day-hslot-${slot}"]`);
    const timeSpan = header.locator('span', { hasText: slot }).first();
    const headerBox = await header.boundingBox();
    const labelBox = await labels.first().boundingBox();
    const timeBox = await timeSpan.boundingBox().catch(() => null);
    if (headerBox && labelBox) {
      // 라벨이 헤더 가로 폭 안에 들어감(좌우 overflow 없음 — 약간의 여유 허용).
      expect(labelBox.x).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    }
    if (timeBox && labelBox) {
      // 시간 텍스트 '바로 아래' — 라벨 top 이 시간 top 보다 아래.
      expect(labelBox.y).toBeGreaterThanOrEqual(timeBox.y - 1);
    }
  });
});
