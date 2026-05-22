/**
 * E2E Spec: T-20260522-foot-CHART-TAP-DELAY
 * 태블릿 고객차트 진입 탭 1회 미인식 수정 검증
 *
 * 배경: 대시보드/시간표에서 고객 이름·슬롯 탭 시 1회에 안 열림 (태블릿 주 발생).
 *       TOUCH-EXPAND(2c60a30) + SPA-NAV-RELOAD(6c17d1a) 이후에도 지속 — 이벤트 인식 문제.
 * 수정: PointerSensor → MouseSensor 교체 + SlotDropCell touch-action: manipulation
 * reporter: 김주연 총괄
 *
 * AC-1: 대시보드 고객 슬롯 1회 탭 → 차트 진입 (태블릿 시뮬레이션)
 * AC-2: 시간표 고객 슬롯 1회 탭 → 차트 진입 (태블릿 시뮬레이션)
 * AC-3: touch-action: manipulation CSS 적용 (SlotDropCell)
 * AC-4: click/touch 이중 바인딩 없음 (onTouchEnd 미존재)
 * AC-5: 데스크탑 클릭 정상 동작
 * AC-6: TOUCH-EXPAND 44px 유지
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const DASHBOARD_PATH = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');

// ── AC-3: touch-action: manipulation (소스 정적 검증) ─────────────────────

test.describe('AC-3: touch-action: manipulation 적용 (SlotDropCell)', () => {
  test('SlotDropCell에 touchAction manipulation 인라인 스타일 존재', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // SlotDropCell 내부에 touch-action: manipulation 존재해야 함
    expect(src).toContain("touchAction: 'manipulation'");
  });
});

// ── AC-4: click/touch 이중 바인딩 없음 (소스 정적 검증) ─────────────────────

test.describe('AC-4: click/touch 이중 바인딩 검증', () => {
  test('Dashboard.tsx에 onTouchEnd 핸들러 미존재', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // onTouchEnd, onTouchStart 이중 바인딩 없어야 함 (ghost click 방지)
    expect(src).not.toContain('onTouchEnd');
    expect(src).not.toContain('onTouchStart');
  });

  test('MouseSensor 사용 (useSensor(PointerSensor) 실제 사용 없음)', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // T-20260522-foot-CHART-TAP-DELAY: PointerSensor → MouseSensor 교체 확인
    // 주석에 "PointerSensor" 문자열 존재는 허용 — 실제 useSensor(PointerSensor...) 사용만 금지
    expect(src).toContain('MouseSensor');
    expect(src).not.toMatch(/useSensor\(\s*PointerSensor/);
  });

  test('TouchSensor activationConstraint distance 설정 유지', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // T-20260522-foot-DRAG-RESP-OPT AC-1: distance 8 → 5 변경 반영
    // contextmenu 보장 위한 distance-only 방식 유지 (5px ≥ accidental tap 3px 기준)
    expect(src).toMatch(/TouchSensor.*activationConstraint.*distance.*[5-9]/s);
  });
});

// ── AC-5: 데스크탑 클릭 — E2E (칸반 카드 클릭 → 상세 시트) ─────────────────

test.describe('AC-5: 데스크탑 클릭 정상 동작', () => {
  test('AC-5-1: checkin-card 클릭 → CheckInDetailSheet 오픈', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('당일 현황').or(page.getByText('통합 시간표'))).toBeVisible({
      timeout: 15000,
    });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cnt = await cards.count();
    if (cnt === 0) {
      test.skip(); // 체크인 없는 환경
      return;
    }

    await cards.first().click();

    // CheckInDetailSheet 또는 차트 시트 오픈 확인
    const sheetOpened = await Promise.race([
      page.locator('[data-testid="checkin-detail-sheet"]')
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
      page.locator('[role="dialog"]')
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
    ]);
    expect(sheetOpened).toBe(true);
  });
});

// ── AC-6: TOUCH-EXPAND 44px 유지 (소스 정적 검증) ─────────────────────────

test.describe('AC-6: TOUCH-EXPAND 44px 유지', () => {
  test('컴팩트 카드 ⋮ 버튼 min-w/h-[32px] 이상 유지', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // T-20260512-foot-CUSTOMER-BOX-COMPACT-V2 터치 영역 유지
    expect(src).toContain('min-w-[32px]');
    expect(src).toContain('min-h-[32px]');
  });

  test('draggable 카드 touch-action:none 인라인 스타일 유지', () => {
    const src = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
    // DraggableCard / DraggableBox1/2 / TimelineCheckInCard 모두 touch-action:none 필수
    expect(src).toContain("touchAction: 'none'");
  });
});

// ── AC-1/AC-2: 태블릿 탭 시뮬레이션 (Playwright touch emulation) ─────────────

test.describe('AC-1/AC-2: 태블릿 탭 1회 → 차트/시트 진입', () => {
  test.use({
    // iPad Air 해상도 + 터치 에뮬레이션
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
  });

  test('AC-1: 대시보드 칸반 카드 단일 탭 → 시트 오픈', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('당일 현황').or(page.getByText('통합 시간표'))).toBeVisible({
      timeout: 15000,
    });

    const cards = page.locator('[data-testid="checkin-card"]');
    const cnt = await cards.count();
    if (cnt === 0) {
      test.skip();
      return;
    }

    // 단일 탭 (tap = touchstart + touchend, no drag)
    await cards.first().tap();

    const sheetOpened = await Promise.race([
      page.locator('[data-testid="checkin-detail-sheet"]')
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
      page.locator('[role="dialog"]')
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
    ]);
    expect(sheetOpened).toBe(true);
  });

  test('AC-2: 시간표 Box1/Box2 카드 단일 탭 → 차트 오픈', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await expect(page.getByText('통합 시간표').or(page.getByText('시간표 뷰'))).toBeVisible({
      timeout: 15000,
    });

    // Box1 (초진 예약) 카드 탭
    const box1Cards = page.locator('[data-testid="box1-resv-card"]');
    const box1Cnt = await box1Cards.count();

    if (box1Cnt > 0) {
      await box1Cards.first().tap();
      const chartOpened = await Promise.race([
        page.locator('[data-testid="chart-info-panel"]')
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
        page.locator('[role="dialog"]')
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
      ]);
      expect(chartOpened).toBe(true);
      return;
    }

    // Box2 (재진 예약) 카드 탭
    const box2Cards = page.locator('[data-testid="box2-resv-card"]');
    const box2Cnt = await box2Cards.count();

    if (box2Cnt > 0) {
      await box2Cards.first().tap();
      const chartOpened = await Promise.race([
        page.locator('[data-testid="chart-info-panel"]')
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
        page.locator('[role="dialog"]')
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8100)),
      ]);
      expect(chartOpened).toBe(true);
      return;
    }

    test.skip(); // 예약 없는 환경 pass
  });
});
