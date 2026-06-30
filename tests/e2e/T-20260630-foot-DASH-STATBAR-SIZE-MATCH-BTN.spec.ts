import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-DASH-STATBAR-SIZE-MATCH-BTN
 *
 * 현장(김주연 총괄, C0ATE5P6JTH): 풋 대시보드 상단 통계바(전체/신규/재진 카운트 박스)의
 *   높이+폰트를 같은 행 우측 '슬롯편집'/'배치 편집' 버튼 사이즈에 맞춰 통일 + 세로중앙 정렬.
 *
 * 기준 버튼(reference, 무수정): px-2 py-1 text-xs font-medium border → 높이 ≈ 26px.
 *
 * 구현 요지(순수 presentation, Tailwind 클래스만):
 *   - TabsList: h-11(44px) → h-[26px] + p-0.5  (버튼 높이에 맞춰 트레이 박스 축소)
 *   - TabsTrigger ×3: min-h-[44px] 제거 → h-full min-h-0 py-0 (컨테이너 높이로 fill), px-2.5→px-2(버튼 동일), font-medium 명시.
 *   - 행(flex items-center)이라 세로중앙 정렬은 자동.
 *   - 카운트 값·쿼리·RPC·집계 로직 미접촉, DB 무변경.
 *
 * 가드: 가독성(숫자/라벨 잘림·겹침 0), 반응형(모바일/태블릿 헤더 행 파손 0), 카운트·버튼 동작 회귀 0.
 *
 * 시나리오:
 *   S1(source-integrity, 결정론): TabsList/TabsTrigger 사이즈 클래스가 버튼 기준으로 통일 + 카운트 배선 불변.
 *   S2(live, best-effort): 통계바 박스 높이가 슬롯편집/배치편집 버튼 높이와 동등(±4px) + 모바일·태블릿 1줄 유지 + pageerror 0.
 *
 * FE-only · NO-DDL · 발송 0. 데이터 정책 자문 게이트 비대상. 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상(접수/칸반 화면).
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// S1 — source-integrity (결정론, auth 불요)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-STATBAR-SIZE-MATCH-BTN — source-integrity', () => {
  test('S1-a: TabsList 트레이 높이를 버튼 기준으로 축소(h-11 제거 → h-[26px] p-0.5)', () => {
    expect(DASH).toMatch(/<TabsList className="h-\[26px\] p-0\.5">/);
    // 구 44px 트레이 잔존 금지.
    expect(DASH).not.toMatch(/<TabsList className="h-11">/);
  });

  test('S1-b: TabsTrigger ×3 — min-h-[44px] 제거 + h-full min-h-0 py-0 px-2(버튼 동일) + 폰트 통일', () => {
    const triggers = DASH.match(/<TabsTrigger value="(all|new|returning)" className="[^"]*"/g) ?? [];
    expect(triggers.length, '전체/신규/재진 3개 트리거').toBe(3);
    for (const t of triggers) {
      // 44px 강제 높이 제거(버튼 높이로 fill).
      expect(t, `min-h-[44px] 잔존: ${t}`).not.toContain('min-h-[44px]');
      expect(t).toContain('h-full');
      expect(t).toContain('min-h-0');
      expect(t).toContain('py-0');
      // 버튼과 동일 가로 패딩.
      expect(t).toContain('px-2 ');
      expect(t).not.toContain('px-2.5');
      // 폰트 통일(버튼: text-xs font-medium).
      expect(t).toContain('text-xs');
      expect(t).toContain('font-medium');
      // 라벨 잘림/줄바꿈 방지 유지.
      expect(t).toContain('whitespace-nowrap');
    }
  });

  test('S1-c: 카운트 배선 불변(presentation-only — 값·집계 미접촉)', () => {
    // 라벨/카운트 표현식은 직전 티켓 그대로 유지.
    expect(DASH).toMatch(/전체 \{statusNewCount \+ statusReturningCount\}건/);
    expect(DASH).toMatch(/신규 \{statusNewCount\}건/);
    expect(DASH).toMatch(/재진 \{statusReturningCount\}건/);
    // 카운트 정의는 기존 재사용 — 신규 fetch/집계 추가 없음.
    expect(DASH).toMatch(/const statusNewCount = activeNonTerminal\.filter/);
    expect(DASH).toMatch(/const statusReturningCount = activeNonTerminal\.filter/);
  });

  test('S1-d: 기준 버튼(슬롯편집/배치편집) 사이즈 불변 — px-2 py-1 text-xs font-medium', () => {
    // 슬롯편집 버튼.
    expect(DASH).toMatch(/data-testid="slot-batch-edit-btn"[\s\S]{0,320}?px-2 py-1 rounded-md text-xs font-medium border/);
    // 배치편집 토글 버튼.
    expect(DASH).toMatch(/handleLayoutEditToggle[\s\S]{0,360}?px-2 py-1 rounded-md text-xs font-medium border/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-STATBAR-SIZE-MATCH-BTN — live', () => {
  test('S2-a: 통계바 박스 높이 ≈ 슬롯편집 버튼 높이(±4px) + 카운트 표기 정상', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.waitForTimeout(2000);

    const header = page.locator('[data-dashboard-header]');
    await expect(header).toBeVisible({ timeout: 8000 });

    // 통계바 트레이(전체 탭이 들어있는 박스) — TabsList.
    const statTab = header.getByText(/전체\s*\d+건/).first();
    await expect(statTab).toBeVisible({ timeout: 8000 });
    const tabBox = await statTab.boundingBox();

    // 기준 버튼(슬롯편집)이 노출돼 있으면 높이 비교(오늘 날짜에서만 노출).
    const slotBtn = page.getByTestId('slot-batch-edit-btn');
    if (await slotBtn.count() > 0 && await slotBtn.isVisible().catch(() => false)) {
      const btnBox = await slotBtn.boundingBox();
      if (tabBox && btnBox) {
        const diff = Math.abs(tabBox.height - btnBox.height);
        expect(diff, `통계바(${tabBox.height}px) vs 슬롯편집 버튼(${btnBox.height}px) 높이차 ${diff}px`).toBeLessThanOrEqual(4);
      }
    } else {
      // 버튼 미노출(비-오늘 등) 시 절대 높이 가드(축소 적용 확인 — 구 44px가 아님).
      if (tabBox) expect(tabBox.height, `통계바 높이 ${tabBox.height}px`).toBeLessThanOrEqual(32);
    }

    // 가독성: 카운트 표기 정상(NaN/undefined 금지).
    const headerTxt = await header.innerText().catch(() => '');
    expect(headerTxt).toMatch(/전체\s*\d+건/);
    expect(headerTxt).toMatch(/신규\s*\d+건/);
    expect(headerTxt).toMatch(/재진\s*\d+건/);
    expect(headerTxt).not.toMatch(/NaN|undefined/);

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('S2-b: 반응형 — 모바일/태블릿 폭에서 통계바 라벨 1줄 유지 + 행 파손 0', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }
    await page.waitForTimeout(1500);

    const header = page.locator('[data-dashboard-header]');
    await expect(header).toBeVisible({ timeout: 8000 });

    for (const vp of [{ w: 768, h: 1024, name: '태블릿' }, { w: 390, h: 844, name: '모바일' }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(400);

      const statTab = header.getByText(/전체\s*\d+건/).first();
      await expect(statTab, `${vp.name}: 전체 탭 미노출`).toBeVisible();
      const box = await statTab.boundingBox();
      // 라벨 줄바꿈(2줄)되면 박스 높이가 폭증 → 1줄 유지 가드.
      if (box) expect(box.height, `${vp.name}: 통계바 라벨 줄바꿈 의심(높이 ${box.height}px)`).toBeLessThanOrEqual(40);
    }
  });
});
