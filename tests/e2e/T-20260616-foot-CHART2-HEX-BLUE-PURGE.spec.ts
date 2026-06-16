/**
 * T-20260616-foot-CHART2-HEX-BLUE-PURGE
 *
 * 70ba418 이 Tailwind blue/indigo/sky 클래스를 slate 로 바꿨으나, 2번차트
 * (CustomerChartPage)의 헤더·배경·탭바·서브탭·텍스트에 하드코딩된 파란 hex 28건이
 * 누락되어 화면이 여전히 푸른 계열로 남아 있었다(현장 김주연 총괄 "레이아웃 컬러
 * 그대로 푸른계열").
 *
 * 본 티켓: 파란 6개 hex 를 무채색으로 전수 교체.
 *   #1e4e6e → #2d2d2d   (헤더 배경/텍스트, 16건)
 *   #c8d5de → #e8e8e8   (전체 배경, 1건)
 *   #d8e8f0 → #e2e8f0   (탭바, 4건)
 *   #e4eef4 → #f1f5f9   (서브탭, 1건)
 *   #eef3f7 → #f8fafc   (아주 연한 파랑, 2건)
 *   #334e65 → #475569   (텍스트, 4건)
 *
 * AC2 가드: green/red/amber 의미색(#dcfce7·#15803d·#bbf7d0·#fee2e2·#b91c1c·
 *   #fecaca·#facc15)은 절대 불변 — 파란 6개만 타깃.
 *
 * 검증 2층:
 *  (A) 소스 정적 가드 — 파란 6 hex 잔존 0, 의미색 잔존 그대로(오프라인, 항상 실행).
 *  (B) 실 브라우저 렌더 — 2번차트 진입 후 DOM 전체 computed style 에 옛 파란 rgb 6종이
 *      0건임을 단언 + 스크린샷(데이터 의존 → 결과 있을 때만 단언, 방어적).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/pages/CustomerChartPage.tsx',
);
const src = readFileSync(__srcPath, 'utf-8');

// 교체 타깃이던 파란 6 hex (소문자/대문자 양쪽 잔존 금지)
const OLD_BLUE_HEX = ['1e4e6e', 'c8d5de', 'd8e8f0', 'e4eef4', 'eef3f7', '334e65'];
// 절대 불변 의미색
const MEANING_HEX = ['dcfce7', '15803d', 'bbf7d0', 'fee2e2', 'b91c1c', 'fecaca', 'facc15'];
// 옛 파란 hex → rgb (런타임 computed style 매칭용)
const OLD_BLUE_RGB = [
  'rgb(30, 78, 110)', // #1e4e6e
  'rgb(200, 213, 222)', // #c8d5de
  'rgb(216, 232, 240)', // #d8e8f0
  'rgb(228, 238, 244)', // #e4eef4
  'rgb(238, 243, 247)', // #eef3f7
  'rgb(51, 78, 101)', // #334e65
];

// ──────────────────────────────────────────────────────────────────────
// (A) 소스 정적 가드 — 오프라인, 항상 실행
// ──────────────────────────────────────────────────────────────────────
test.describe('CHART2-HEX-BLUE-PURGE — 소스 정적 가드', () => {
  test('AC1: 파란 6 hex 잔존 0 (대소문자 무관)', () => {
    for (const h of OLD_BLUE_HEX) {
      const re = new RegExp(`#${h}`, 'gi');
      const n = (src.match(re) ?? []).length;
      expect(n, `#${h} 잔존`).toBe(0);
    }
  });

  test('AC2: green/red/amber 의미색은 그대로 보존(잔존 ≥1)', () => {
    for (const h of MEANING_HEX) {
      const re = new RegExp(`#${h}`, 'gi');
      const n = (src.match(re) ?? []).length;
      expect(n, `#${h} 의미색 소실`).toBeGreaterThan(0);
    }
  });

  test('교체 무채색이 기대 건수만큼 도입됨', () => {
    const count = (hex: string) => (src.match(new RegExp(`#${hex}`, 'gi')) ?? []).length;
    expect(count('2d2d2d')).toBeGreaterThanOrEqual(16); // ← #1e4e6e
    expect(count('e2e8f0')).toBeGreaterThanOrEqual(4); //  ← #d8e8f0
    expect(count('475569')).toBeGreaterThanOrEqual(4); //  ← #334e65
    expect(count('f8fafc')).toBeGreaterThanOrEqual(2); //  ← #eef3f7
    expect(count('f1f5f9')).toBeGreaterThanOrEqual(1); //  ← #e4eef4
  });
});

// ──────────────────────────────────────────────────────────────────────
// (B) 실 브라우저 렌더 — 2번차트 진입 후 파란 rgb 잔존 0 + 스크린샷
// ──────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
  }
}

test.describe('CHART2-HEX-BLUE-PURGE — 실 브라우저 렌더 가드', () => {
  test('S1: 2번차트 진입 후 옛 파란 rgb(6종) computed style 잔존 0', async ({ page }) => {
    await loginIfNeeded(page);
    // 고객관리 목록 진입 → 첫 행의 [2번차트 열기] 아이콘으로 2번차트(CustomerChartSheet) 직접 오픈.
    // (글로벌 검색-클릭 경로는 목록 전환만 되고 차트 미오픈 케이스가 있어 결정성 낮음 → 행 액션 사용.)
    await page.goto(`${BASE_URL}/admin/customers`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const chartDialog = page.getByRole('dialog', { name: '고객차트' });
    let chartOpened = false;

    // 관리 컬럼의 "2번차트(미니홈피) 열기" 버튼 (Customers.tsx L669) — 첫 행 클릭
    const openBtn = page.locator('button[title="2번차트(미니홈피) 열기"]').first();
    if (await openBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await openBtn.click();
      chartOpened = await chartDialog.isVisible({ timeout: 10000 }).catch(() => false);
    }

    if (!chartOpened) {
      // 데이터 의존: 검색 결과가 없는 dev-DB 면 최소 회귀(페이지 무손상)만 확인하고 스킵
      test.skip(true, 'dev-DB 에 차트 진입 가능한 고객 데이터 없음 — 소스 정적 가드(A)로 회귀 보장');
      return;
    }

    // 차트 로드 안정화
    await page.waitForTimeout(1500);

    // 스크린샷(증거) — supervisor 실QA·현장 확인용
    await chartDialog
      .screenshot({ path: 'evidence/T-20260616-foot-CHART2-HEX-BLUE-PURGE_S1_chart.png' })
      .catch(async () => {
        await page.screenshot({
          path: 'evidence/T-20260616-foot-CHART2-HEX-BLUE-PURGE_S1_chart.png',
          fullPage: false,
        });
      });

    // 차트 dialog 내부 모든 요소의 color/background/border 에서 옛 파란 rgb 매칭 수집
    const offenders = await chartDialog.evaluate(
      (root, blues: string[]) => {
        const hits: { tag: string; prop: string; val: string; cls: string }[] = [];
        const els = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
        for (const el of els) {
          const cs = getComputedStyle(el);
          for (const prop of ['color', 'backgroundColor', 'borderColor'] as const) {
            const v = cs[prop];
            if (blues.includes(v)) {
              hits.push({
                tag: el.tagName.toLowerCase(),
                prop,
                val: v,
                cls: (el.className || '').toString().slice(0, 60),
              });
            }
          }
        }
        return hits;
      },
      OLD_BLUE_RGB,
    );

    expect(
      offenders,
      `옛 파란 rgb 잔존 ${offenders.length}건:\n` +
        offenders.map((o) => `  <${o.tag} ${o.prop}=${o.val} class="${o.cls}">`).join('\n'),
    ).toEqual([]);
  });
});
