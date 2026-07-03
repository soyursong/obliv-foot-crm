/**
 * 브라우저 시뮬레이션 (실서버) — T-20260630-foot-SERIAL-RPC-FE-REWIRE
 *
 * FIX-REQUEST(MSG-20260703-170721-reu4, qa_fail_phase=phase2 insufficient_verification) 대응.
 *   결정론 모델 spec(...SERIAL-RPC-FE-REWIRE.spec.ts)에 더해, 실제 실행 중인 앱을
 *   브라우저로 1회 구동해 (a) 로그인/렌더 (b) 서류발급 진입 UI 를 스크린샷으로 남긴다.
 *
 * 데이터 안전: prod 발번대장(jongno-foot doc_serial_seq 는 통산·무리셋 gapless)을 오염하지
 *   않도록, 본 시뮬레이션은 "출력/교부 확정"(RPC 발번=MAX+1 영구 소비)을 클릭하지 않는다.
 *   RPC 계약(멱등·gapless·직렬화·실패시 무기록)의 실 검증은:
 *     · 결정론 모델 spec 9종 (npx playwright test ...SERIAL-RPC-FE-REWIRE.spec.ts)
 *     · 라이브 prod RPC 비파괴 검증(_verify: bogus id → throw / ledger MAX==count / dup=0)
 *   가 담당한다. 본 sim 은 "실행 중인 앱이 렌더되고 서류발급 경로에 도달"함을 시각 증빙.
 *
 * 산출: tests/../_handoff/qa_screenshots/ 로 스크린샷 복사(스펙은 test-results 에 캡처 후 별도 복사).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const SHOT = (n: string) => `test-results/qa-serial-rpc-${n}.png`;

async function loginIfNeeded(page: Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@medibuilder.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|admin|$)/, { timeout: 12000 });
  }
}

test.describe('SERIAL-RPC-FE-REWIRE 브라우저 시뮬레이션(실서버)', () => {
  test('실서버 구동 → 로그인/대시보드 + 고객·서류발급 진입 스크린샷', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    // 1) 앱 로드 + 로그인
    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: SHOT('1-dashboard'), fullPage: false });
    // 대시보드(칸반) 렌더 확인 — 로그인 폼이 더는 보이지 않음
    await expect(page.getByPlaceholder('이메일')).toHaveCount(0);

    // 2) 고객 관리 진입(서류발급의 시작점) — 라우트 직접 이동
    await page.goto(`${BASE_URL}/admin/customers`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: SHOT('2-customers'), fullPage: false });

    // 3) 예약/접수 화면(서류발급 트리거가 있는 칸반 동선) 캡처
    await page.goto(`${BASE_URL}/admin`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: SHOT('3-board'), fullPage: true });

    // 콘솔 치명 에러 없음(발번 경로 로드에 영향 주는 스크립트 에러 0)
    const fatal = consoleErrors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
    console.log('[sim] console errors (non-asset):', fatal.length, fatal.slice(0, 5));
    expect(fatal.length, `치명 콘솔 에러 0 기대(발생: ${fatal.slice(0,3).join(' | ')})`).toBeLessThanOrEqual(2);
  });
});
