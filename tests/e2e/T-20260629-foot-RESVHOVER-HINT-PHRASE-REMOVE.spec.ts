/**
 * T-20260629-foot-RESVHOVER-HINT-PHRASE-REMOVE
 * 예약관리/대시보드 성함 hover 카드 도움말 문구 제거.
 *  - CustomerHoverCard 성함 span 의 네이티브 title 툴팁("클릭 → 고객차트 열기 · 우클릭/롱프레스 → 메뉴 · 호버 → 간단정보")이
 *    hover 시 간단정보 카드(포털)와 겹쳐 고객번호/메모를 가림 → title 속성(도움말 한 줄)만 삭제.
 *
 * 거동 회귀 0: title 속성만 제거. onClick=고객차트 / onContextMenu(우클릭·롱프레스)=메뉴 / hover=간단정보 카드 전부 무변경.
 * 발송·DB 변경 없음(NO-DDL, FE 텍스트 only). 선례: T-20260620-foot-CUSTLIST-HINT-PHRASE-REMOVE.
 *
 * 검증:
 *  S1(소스): CustomerHoverCard 성함 span 에서 도움말 문구/title 속성 부재 (환경 무관 권위 검증).
 *  S2(소스): 동작 배선 유지 — onClick / onContextMenu / 호버 포털(customer-hover-card) 핸들러 전부 생존.
 *  S3(DOM, best-effort): 예약관리 성함 span 에 title 속성 부재 + hover 시 간단정보 카드 표시.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const HOVER_CARD_SRC = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|admin|$)/, { timeout: 10000 });
  }
}

// ── 시나리오 1: 도움말 문구 제거 (소스 권위 검증, 환경 무관) ──────────────────
test.describe('S1: 도움말 문구(title 툴팁) 제거', () => {
  test('S1-1: 성함 span 의 "호버 → 간단정보" 도움말 문구가 소스에서 제거됨', () => {
    expect(HOVER_CARD_SRC, '도움말 문구 잔존(title 미제거)').not.toContain('호버 → 간단정보');
    expect(HOVER_CARD_SRC).not.toContain('클릭 → 고객차트 열기 · 우클릭/롱프레스 → 메뉴');
  });

  test('S1-2: 성함 span 에 title 속성 자체가 부재', () => {
    // CustomerHoverCard 의 트리거 span 영역에 title= 속성이 남아있지 않아야 함.
    expect(HOVER_CARD_SRC, 'title 속성 잔존').not.toMatch(/title=\{onClick \?/);
    expect(HOVER_CARD_SRC).not.toMatch(/title=["'][^"']*간단정보/);
  });
});

// ── 시나리오 2: 동작 회귀가드 (소스 권위 검증) ───────────────────────────────
test.describe('S2: 동작 배선 유지 (클릭/우클릭·롱프레스/hover 무변경)', () => {
  test('S2-1: onClick(=고객차트 열기) 핸들러 생존', () => {
    expect(HOVER_CARD_SRC, 'onClick 배선 소실').toContain('onClick={(e) => {');
    expect(HOVER_CARD_SRC).toContain('onClick();');
  });

  test('S2-2: onContextMenu(우클릭·롱프레스 → 메뉴) 핸들러 생존', () => {
    expect(HOVER_CARD_SRC, 'onContextMenu 배선 소실').toContain('onContextMenu={onContextMenu}');
  });

  test('S2-3: hover 간단정보 카드(포털) 렌더 경로 생존', () => {
    expect(HOVER_CARD_SRC, 'hover 포털 소실').toContain("data-testid=\"customer-hover-card\"");
    expect(HOVER_CARD_SRC).toContain('visible && createPortal');
    // 카드 내용 필드(차트번호/성함/전화/메모) 렌더 경로 — onMouseEnter 트리거 생존
    expect(HOVER_CARD_SRC).toContain('onMouseEnter={handleMouseEnter}');
  });
});

// ── 시나리오 3: 예약관리 DOM 회귀 (best-effort, 데이터 없으면 skip) ──────────
test.describe('S3: 예약관리 DOM 회귀가드', () => {
  test.beforeEach(async ({ page }) => {
    // 상대경로 navigation → playwright.config baseURL(8089, 관리형 webServer) 사용.
    // (이전: 절대 BASE_URL 기본값 localhost:5173 + 라우트 /reservations 오기재로
    //  webServer(8089)·앱 라우트(/admin/reservations) 불일치 → ERR_CONNECTION_REFUSED 거짓 red.)
    await page.goto('/');
    await loginIfNeeded(page);
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  });

  test('S3-1: 예약관리 성함 span 에 title 속성 부재', async ({ page }) => {
    const name = page.getByTestId('customer-hover-card-name-clickable').first();
    const fallback = page.getByTestId('customer-hover-card-name').first();
    const target = (await name.count()) > 0 ? name : fallback;
    if ((await target.count()) === 0) {
      test.skip(true, '연결된 고객 예약 없음 — DOM 검증 스킵(소스 S1 으로 보장)');
      return;
    }
    await expect(target).not.toHaveAttribute('title', /.+/);
  });

  test('S3-2: 성함 hover → 간단정보 카드 표시(동작 유지)', async ({ page }) => {
    const name = page.getByTestId('customer-hover-card-name-clickable').first();
    const fallback = page.getByTestId('customer-hover-card-name').first();
    const target = (await name.count()) > 0 ? name : fallback;
    if ((await target.count()) === 0) {
      test.skip(true, '연결된 고객 예약 없음 — DOM 검증 스킵');
      return;
    }
    await target.hover();
    await expect(page.getByTestId('customer-hover-card')).toBeVisible({ timeout: 3000 });
  });
});
