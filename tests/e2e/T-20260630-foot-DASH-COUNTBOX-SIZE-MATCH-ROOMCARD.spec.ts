import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD
 *
 * 현장(김주연 총괄, C0ATE5P6JTH): 풋 대시보드 상단 카운트박스(전체/신규/재진 3개)의
 *   박스 크기 + 폰트 크기를 우측 치료실 룸카드(C1~C10 = RoomSlot)와 동일 사이즈로 정렬.
 *
 * 구현 요지(순수 presentation, Tailwind 클래스만):
 *   - 룸카드 박스/폰트를 SSOT 토큰으로 추출:
 *       ROOM_CARD_BOX_CLASS        = 'rounded-lg border bg-white/60 p-1.5 min-h-[70px]'
 *       ROOM_CARD_LABEL_FONT_CLASS = 'text-xs font-semibold'
 *   - RoomSlot(룸카드 본체)과 카운트박스(TabsTrigger ×3)가 같은 상수를 재사용 — 하드코딩 중복 0(AC-1).
 *   - TabsList: 트레이 시각 제거(bg-transparent p-0) + items-stretch gap-1.5(룸카드 grid 갭과 동일).
 *   - TabsTrigger ×3 모두 동일 적용(AC-3). twMerge로 trigger 기본 px-3/py-1.5/text-sm/font-medium/rounded-md 덮어씀.
 *   - 카운트 값·쿼리·집계 미접촉(AC-4), 룸카드 자체 레이아웃 불변(AC-4·SSOT 동시 참조), DB 무변경.
 *
 * 시나리오:
 *   S1(source-integrity, 결정론): SSOT 상수 정의 + RoomSlot/카운트박스 양쪽 재사용 + 카운트 배선 불변.
 *   S2(live, best-effort): 카운트박스 박스 높이·폰트가 치료실 룸카드와 동등(±4px / 동일 px) + pageerror 0.
 *
 * FE-only · NO-DDL · 발송 0. 데이터 정책 자문 게이트 비대상.
 * 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상 — 접수/칸반(당일현황) 화면.
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// S1 — source-integrity (결정론, auth 불요)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-COUNTBOX-SIZE-MATCH-ROOMCARD — source-integrity', () => {
  test('S1-a: 룸카드 박스/폰트 SSOT 상수 정의(하드코딩 중복 금지의 단일 출처)', () => {
    expect(DASH).toMatch(/const ROOM_CARD_BOX_CLASS = 'rounded-lg border bg-white\/60 p-1\.5 min-h-\[70px\]';/);
    expect(DASH).toMatch(/const ROOM_CARD_LABEL_FONT_CLASS = 'text-xs font-semibold';/);
  });

  test('S1-b: 룸카드 본체(RoomSlot)가 SSOT 토큰을 재사용 — 룸카드 레이아웃 불변(AC-4)', () => {
    // 박스 클래스: 룸카드 div가 상수 참조(구 하드코딩 rounded-lg...min-h-[70px] 직접문자열 잔존 금지).
    expect(DASH).toMatch(/ROOM_CARD_BOX_CLASS, 'transition-colors relative'/);
    // 룸명(C1~C10) 라벨 폰트도 상수 참조.
    expect(DASH).toMatch(/cn\(ROOM_CARD_LABEL_FONT_CLASS, 'shrink-0'/);
  });

  test('S1-c: 카운트박스 TabsTrigger ×3 모두 SSOT 박스+폰트 재사용(AC-3 동일 적용)', () => {
    const triggers = DASH.match(/<TabsTrigger value="(all|new|returning)" className=\{[^}]*\}>/g) ?? [];
    expect(triggers.length, '전체/신규/재진 3개 트리거').toBe(3);
    for (const t of triggers) {
      expect(t, `SSOT 박스 토큰 미사용: ${t}`).toContain('ROOM_CARD_BOX_CLASS');
      expect(t, `SSOT 폰트 토큰 미사용: ${t}`).toContain('ROOM_CARD_LABEL_FONT_CLASS');
      expect(t).toContain('whitespace-nowrap');
      // 직전 티켓(BTN-match)의 하드코딩 사이즈 클래스 잔존 금지.
      expect(t).not.toContain('min-h-0');
      expect(t).not.toContain('h-full');
    }
    // TabsList: 룸카드 grid 갭(1.5)·균등 높이 정렬, 트레이 시각 제거.
    expect(DASH).toMatch(/<TabsList className="h-auto items-stretch gap-1\.5 bg-transparent p-0">/);
  });

  test('S1-d: 카운트 배선 불변(presentation-only — 값·집계 미접촉, AC-4)', () => {
    expect(DASH).toMatch(/전체 \{statusNewCount \+ statusReturningCount\}건/);
    expect(DASH).toMatch(/신규 \{statusNewCount\}건/);
    expect(DASH).toMatch(/재진 \{statusReturningCount\}건/);
    expect(DASH).toMatch(/const statusNewCount = activeNonTerminal\.filter/);
    expect(DASH).toMatch(/const statusReturningCount = activeNonTerminal\.filter/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-COUNTBOX-SIZE-MATCH-ROOMCARD — live', () => {
  test('S2-a: 카운트박스 박스 높이·폰트 ≈ 치료실 룸카드 + 카운트 표기 정상', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.waitForTimeout(2000);

    const header = page.locator('[data-dashboard-header]');
    await expect(header).toBeVisible({ timeout: 8000 });

    // 카운트박스(전체 탭) 박스 = TabsTrigger 컨테이너.
    const countBox = header.getByText(/전체\s*\d+건/).first();
    await expect(countBox).toBeVisible({ timeout: 8000 });
    const cbBox = await countBox.boundingBox();
    const cbFont = await countBox.evaluate((el) => getComputedStyle(el).fontSize);

    // 우측 치료실 룸카드(C1~C10 = RoomSlot) — data-room-type="treatment" 첫 카드.
    const roomCard = page.locator('[data-room-type="treatment"][data-room-name]').first();
    const hasRoom = await roomCard.count() > 0 && await roomCard.isVisible().catch(() => false);

    // 시각 비교 증거: 헤더(카운트박스) + 치료실 영역 스크린샷.
    await page.screenshot({ path: 'evidence/T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD_full.png', fullPage: false });
    await header.screenshot({ path: 'evidence/T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD_countbox.png' }).catch(() => {});

    if (hasRoom && cbBox) {
      const rcBox = await roomCard.boundingBox();
      // 룸명 라벨(C1 등) 폰트.
      const rcLabel = roomCard.locator('span').first();
      const rcFont = await rcLabel.evaluate((el) => getComputedStyle(el).fontSize).catch(() => cbFont);
      await roomCard.screenshot({ path: 'evidence/T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD_roomcard.png' }).catch(() => {});
      if (rcBox) {
        const diff = Math.abs(cbBox.height - rcBox.height);
        expect(diff, `카운트박스(${cbBox.height}px) vs 룸카드(${rcBox.height}px) 높이차 ${diff}px`).toBeLessThanOrEqual(4);
      }
      // 폰트 동일(SSOT 토큰 동일 → 동일 px 기대).
      expect(cbFont, `카운트박스 폰트(${cbFont}) vs 룸카드 라벨 폰트(${rcFont})`).toBe(rcFont);
    } else if (cbBox) {
      // 룸카드 미노출(데이터 없음 등) 시 절대 높이 가드: SSOT min-h-[70px] 적용(룸카드 박스 크기) 확인.
      expect(cbBox.height, `카운트박스 높이 ${cbBox.height}px (min-h-[70px] 적용 기대)`).toBeGreaterThanOrEqual(64);
    }

    // 가독성: 카운트 표기 정상(NaN/undefined 금지).
    const headerTxt = await header.innerText().catch(() => '');
    expect(headerTxt).toMatch(/전체\s*\d+건/);
    expect(headerTxt).toMatch(/신규\s*\d+건/);
    expect(headerTxt).toMatch(/재진\s*\d+건/);
    expect(headerTxt).not.toMatch(/NaN|undefined/);

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('S2-b: 3박스(전체/신규/재진) 높이 균등 + 라벨 1줄 유지(AC-3)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.waitForTimeout(1500);

    const header = page.locator('[data-dashboard-header]');
    await expect(header).toBeVisible({ timeout: 8000 });

    const boxes = [/전체\s*\d+건/, /신규\s*\d+건/, /재진\s*\d+건/];
    const heights: number[] = [];
    for (const re of boxes) {
      const el = header.getByText(re).first();
      await expect(el).toBeVisible();
      const b = await el.boundingBox();
      if (b) heights.push(b.height);
    }
    expect(heights.length).toBe(3);
    // 3박스 높이 동일(±2px).
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread, `3박스 높이 편차 ${spread}px (${heights.join('/')})`).toBeLessThanOrEqual(2);
  });
});
