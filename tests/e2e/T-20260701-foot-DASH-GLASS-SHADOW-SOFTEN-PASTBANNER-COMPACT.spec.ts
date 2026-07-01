/**
 * E2E (렌더 스모크 + 스타일 invariant) — T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT
 * 김주연 총괄 후속 미세조정(유리축 3차 refine, reporter-driven). 순수 FE/CSS — db_change=false.
 *
 * 요청A — 유리/볼록 요소의 "바깥으로 드리우는 outer drop-shadow만" 추가 축소:
 *   .live-glass-board / .idverify-glass 의 non-inset(=outer) box-shadow 레이어 blur/spread 축소 + alpha 하향.
 *   ⚠ disambiguation: inset 볼록(bulge)·gradient·backdrop-filter 는 무접촉 유지 — 볼록 회귀(더 강하게) 금지.
 *   AC-A1 outer 그림자 blur 더 좁아짐 · AC-A2 outer 그림자 alpha 더 연해짐 · AC-A3 inset(볼록) 잔존 무변경.
 *   (.live-glass 는 inset-only = outer drop-shadow 부재 → 대상 아님, 무변경.)
 * 요청B — 과거날짜 배너("과거 날짜 조회 중 — 읽기 전용") 모노톤 유지 + 추가 컴팩트:
 *   무채색(gray) 유지 + 세로높이/패딩 추가 축소(py-px, text-[11px], gap/아이콘/mt↓). 노랑 무회귀·텍스트 온전.
 *
 * 비파괴: 라이브 데이터, 시드 없음. 대상 미노출 시 graceful skip. exempt=ef_only(순수 시각).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|admin|$)/, { timeout: 10000 });
  }
}

/** box-shadow 문자열을 콤마 최상위(괄호 무시)로 레이어 분해. */
function splitShadowLayers(boxShadow: string): string[] {
  const layers: string[] = [];
  let depth = 0, cur = '';
  for (const ch of boxShadow) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { layers.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) layers.push(cur.trim());
  return layers;
}

/** outer(=non-inset) 레이어들의 최대 blur(px)·최대 그림자 alpha(무채색 실버/블루그레이) 산출. */
function outerShadowMetrics(boxShadow: string): { maxOuterBlur: number; maxOuterShadowAlpha: number; outerCount: number } {
  const outer = splitShadowLayers(boxShadow).filter((l) => !/\binset\b/.test(l));
  let maxOuterBlur = 0, maxOuterShadowAlpha = 0;
  for (const l of outer) {
    const lengths = [...l.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Math.abs(parseFloat(m[1])));
    // 관례상 3번째 length = blur. 없으면 0.
    if (lengths.length >= 3) maxOuterBlur = Math.max(maxOuterBlur, lengths[2]);
    // 무채색 그림자(rgb 100~199 대역: 120/131/146, 150/160/174) alpha 만 집계 — 흰 하이라이트 제외.
    const sm = l.match(/rgba?\(\s*1[0-9]{2}[^)]*?,\s*([01]?\.?\d+)\s*\)/);
    if (sm) maxOuterShadowAlpha = Math.max(maxOuterShadowAlpha, parseFloat(sm[1]));
  }
  return { maxOuterBlur, maxOuterShadowAlpha, outerCount: outer.length };
}

test.describe('T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT — 바깥 그림자 추가 완화 + 배너 추가 컴팩트', () => {
  // ── 시나리오 1: outer drop-shadow 추가 축소 + inset(볼록) 무변경 잔존 (요청A) ──────────────
  test('S1: glass outer 그림자 더 좁고 연함 + inset 볼록 잔존 + 노랑 무회귀', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 배포된 glass 클래스의 box-shadow 를 CSSOM 에서 직접 대조(라이브 요소 부재 대비).
    const glassRules = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          const r = rule as CSSStyleRule;
          if (!r.selectorText) continue;
          for (const sel of ['.live-glass', '.live-glass-board', '.idverify-glass']) {
            if (r.selectorText.split(',').map((s) => s.trim()).includes(sel)) {
              const bs = r.style.getPropertyValue('box-shadow');
              if (bs) out[sel] = bs;
            }
          }
        }
      }
      return out;
    });

    const found = Object.keys(glassRules);
    expect(found.length, 'glass 클래스 규칙이 CSSOM 에 존재해야 함').toBeGreaterThan(0);

    // outer drop-shadow 를 가진 표면(board/idverify)만 완화 상한 검증.
    const OUTER_BLUR_CAP = 5;      // 3차 refine 후 outer blur ≤ 5px (board 8→5, idverify 2→1.5)
    const OUTER_ALPHA_CAP = 0.1;   // 3차 refine 후 outer 그림자 alpha ≤ 0.10 (0.16/0.12 → 0.09/0.07/0.05)
    for (const sel of ['.live-glass-board', '.idverify-glass']) {
      if (!glassRules[sel]) continue;
      const bs = glassRules[sel];
      const { maxOuterBlur, maxOuterShadowAlpha, outerCount } = outerShadowMetrics(bs);
      expect(outerCount, `${sel} outer 레이어 존재`).toBeGreaterThan(0);
      // AC-A1: outer blur 더 좁아짐.
      expect(maxOuterBlur, `${sel} outer blur ≤${OUTER_BLUR_CAP}px`).toBeLessThanOrEqual(OUTER_BLUR_CAP);
      // AC-A2: outer 그림자 alpha 더 연해짐.
      expect(maxOuterShadowAlpha, `${sel} outer 그림자 alpha ≤${OUTER_ALPHA_CAP}`).toBeLessThanOrEqual(OUTER_ALPHA_CAP);
      // AC-A3: inset(볼록) 잔존 — 평면화(볼록 완전 제거) 금지.
      expect(bs, `${sel} inset 볼록 잔존`).toContain('inset');
    }

    // .live-glass 는 inset-only(볼록 유지) → outer drop-shadow 부재가 정상(비대상·무변경).
    if (glassRules['.live-glass']) {
      const { outerCount } = outerShadowMetrics(glassRules['.live-glass']);
      expect(outerCount, '.live-glass 는 inset-only(outer 없음)').toBe(0);
      expect(glassRules['.live-glass'], '.live-glass inset 볼록 유지').toContain('inset');
    }

    // 노랑(#FFFDE7) 무회귀.
    for (const sel of found) {
      expect(glassRules[sel].toUpperCase(), `${sel} 힐러 노랑 무유입`).not.toContain('FFFDE7');
    }

    expect(consoleErrors, `콘솔 에러 0 (실제=${consoleErrors.join(' | ')})`).toHaveLength(0);
  });

  // ── 시나리오 2: 과거날짜 배너 모노톤 유지 + 추가 컴팩트 + 텍스트 온전 (요청B) ──────────────
  test('S2: 과거 날짜 배너 = 무채색(모노톤) + 추가 컴팩트(py-px/text-[11px]) + 텍스트 잘림 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    const pastBanner = page.getByText('과거 날짜 조회 중 — 읽기 전용');

    // 어제 날짜 셀을 눌러 과거 배너 강제 노출 시도.
    const y = new Date(); y.setDate(y.getDate() - 1);
    const p = (n: number) => String(n).padStart(2, '0');
    const ydKey = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
    const yesterdayCell = page.getByTestId(`cal-day-${ydKey}`);
    if (await yesterdayCell.isVisible({ timeout: 6000 }).catch(() => false)) {
      await yesterdayCell.click();
      await page.waitForTimeout(500);
    }

    if (!(await pastBanner.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.info().annotations.push({ type: 'note', text: '과거날짜 배너 미노출(달력 접힘/셀 없음) → 스타일 검증 skip' });
      return;
    }

    const box = pastBanner.locator('xpath=ancestor-or-self::div[contains(@class,"rounded")][1]');
    const cls = (await box.getAttribute('class')) ?? '';

    // AC-B1: 모노톤 유지 — amber(컬러) 잔재 0, gray 계열 사용.
    expect(cls, 'amber(컬러) 무회귀').not.toContain('amber');
    expect(cls, '무채색 gray 계열 유지').toContain('gray');

    // AC-B2: 추가 컴팩트 — py-px + 소형 텍스트 + w-fit + 이전(px-4/py-2/py-0.5/text-sm) 미사용.
    expect(cls, '세로 패딩 최소(py-px)').toContain('py-px');
    expect(cls, '컨텐츠 폭 축소(w-fit)').toContain('w-fit');
    expect(cls, '큰 패딩(px-4) 미사용').not.toContain('px-4');
    expect(cls, '큰 세로패딩(py-2) 미사용').not.toContain('py-2');
    // 세로 높이 완화 — 실제 렌더 높이가 상한(28px) 이하.
    const h = await box.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    expect(h, `배너 세로높이 컴팩트(≤28px, 실제=${h})`).toBeLessThanOrEqual(28);

    // AC-B3: 텍스트 온전(잘림 없음).
    const txt = (await pastBanner.textContent())?.trim() ?? '';
    expect(txt, '문구 온전').toContain('과거 날짜 조회 중 — 읽기 전용');
    const clipped = await box.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    expect(clipped, '가로 텍스트 클립 없음').toBe(false);
  });
});
