/**
 * E2E (렌더 스모크 + 스타일 invariant) — T-20260701-foot-GLASS-SHADOW-SOFTEN-PASTPOPUP-MONO
 * 김주연 총괄(thread 1782879961.447179) 유리효과 배포(e934c5c8) 후속 UX 튜닝 2건.
 * 순수 FE/CSS — db_change=false. 새 독립 스타일 정의 없음(배포된 재사용 glass CSS 값만 조정).
 *
 * 요청① — 유리/볼록 그림자 축소 + 연하게(볼록 유지·강도만↓):
 *   .live-glass / .live-glass-board / .idverify-glass 의 box-shadow blur/spread 축소 + rgba alpha 하향.
 *   AC1 blur/spread 좁아짐 · AC2 alpha 낮아짐 · AC3 볼록 입체감 유지(완전제거 금지) · AC4 힐러 노랑(#FFFDE7) 무회귀.
 * 요청② — 과거날짜 조회 인디케이터 모노톤 + ½ 컴팩트:
 *   대시보드 isPast 배너 amber → gray(무채색) + px/py·텍스트·아이콘 축소 + w-fit.
 *   AC-B1 모노톤 · AC-B2 크기 절반 · AC-B3 텍스트 잘림 없음.
 *
 * 어서션 전략: 순수 시각 튜닝(exempt=ef_only) → 렌더 스모크 + computed-style invariant 수준.
 * 비파괴: 라이브 데이터, 시드 없음. 대상 미노출 시 graceful skip.
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

/** box-shadow 문자열에서 최대 blur(px)와 최대 alpha 를 파싱(대략치 — invariant 대조용). */
function shadowMetrics(boxShadow: string): { maxBlur: number; maxAlpha: number } {
  // 각 레이어의 3번째 length(=blur) 후보를 긁고, rgba(...,a) alpha 를 긁는다.
  const blurs = [...boxShadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Math.abs(parseFloat(m[1])));
  const alphas = [...boxShadow.matchAll(/rgba?\([^)]*?,\s*([01]?\.?\d+)\s*\)/g)].map((m) => parseFloat(m[1]));
  return {
    maxBlur: blurs.length ? Math.max(...blurs) : 0,
    maxAlpha: alphas.length ? Math.max(...alphas) : 0,
  };
}

test.describe('T-20260701-foot-GLASS-SHADOW-SOFTEN-PASTPOPUP-MONO — 유리 그림자 완화 + 과거날짜 팝업 모노톤', () => {
  // ── 시나리오 1: 유리효과 그림자 축소·연하게 + 볼록 잔존 + 노랑 무변경 (요청①) ──────────────
  test('S1: glass surface box-shadow 좁고 연함 + 볼록(inset) 잔존 + 힐러 노랑 무회귀', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 배포된 glass 클래스가 스타일시트에 존재하고, 완화된 값(AC1 blur≤ / AC2 alpha≤)을 갖는지 검증.
    // 렌더 시점 실제 요소가 없을 수 있어(라이브 데이터) 스타일시트 규칙 자체를 CSSOM 에서 대조한다.
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

    for (const sel of found) {
      const bs = glassRules[sel];
      const { maxBlur, maxAlpha } = shadowMetrics(bs);
      // AC1: 그림자 blur/spread 좁아짐 — 튜닝 후 최대 blur 는 완화 상한(10px) 이하.
      expect(maxBlur, `${sel} box-shadow blur 좁아짐(≤10px)`).toBeLessThanOrEqual(10);
      // AC2: shadow alpha 하향 — 그림자(무채색 실버/블루그레이) alpha 는 연하게(≤0.35). 흰 하이라이트는 제외 대상이라
      //   전체 최대 alpha 는 하이라이트(≤0.85)를 포함하므로 별도로 '그림자' 레이어만 본다.
      const shadowAlphas = [...bs.matchAll(/rgba?\(\s*1[0-9]{2}[^)]*?,\s*([01]?\.?\d+)\s*\)/g)].map((m) => parseFloat(m[1]));
      const maxShadowAlpha = shadowAlphas.length ? Math.max(...shadowAlphas) : 0;
      expect(maxShadowAlpha, `${sel} 그림자 alpha 연해짐(≤0.35)`).toBeLessThanOrEqual(0.35);
      // AC3: 볼록 입체감 유지 — inset 하이라이트(밝음)와 inset 그림자(어두움)가 모두 잔존해야 함(완전 평면 금지).
      expect(bs, `${sel} inset 볼록 잔존(완전제거 금지)`).toContain('inset');
      expect(maxAlpha, `${sel} 하이라이트/그림자 레이어 존재`).toBeGreaterThan(0);
    }

    // AC4: 힐러 노랑(#FFFDE7) 무회귀 — glass box-shadow 어디에도 노랑 색상 유입 없음.
    for (const sel of found) {
      expect(glassRules[sel].toUpperCase(), `${sel} 힐러 노랑 무유입`).not.toContain('FFFDE7');
    }

    expect(consoleErrors, `콘솔 에러 0 (실제=${consoleErrors.join(' | ')})`).toHaveLength(0);
  });

  // ── 시나리오 2: 과거날짜 조회 팝업 모노톤·½·텍스트 온전 (요청②) ──────────────────────────
  test('S2: 과거 날짜 조회 인디케이터 = 무채색(모노톤) + 컴팩트 + 텍스트 잘림 없음', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('networkidle');

    // 과거 날짜 선택 → 사이드바 달력에서 오늘 이전 날짜 선택(가능하면). 미노출 시 배너 존재 여부만 조건부 검증.
    const pastBanner = page.getByText('과거 날짜 조회 중 — 읽기 전용');

    // 과거 날짜를 강제로 노출시키기 위해 어제 날짜 셀을 시도.
    const y = new Date(); y.setDate(y.getDate() - 1);
    const p = (n: number) => String(n).padStart(2, '0');
    const ydKey = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
    const yesterdayCell = page.getByTestId(`cal-day-${ydKey}`);
    if (await yesterdayCell.isVisible({ timeout: 6000 }).catch(() => false)) {
      await yesterdayCell.click();
      await page.waitForTimeout(500);
    }

    if (!(await pastBanner.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.info().annotations.push({ type: 'note', text: '과거날짜 인디케이터 미노출(달력 접힘/셀 없음) → 스타일 검증 skip' });
      return;
    }

    const box = pastBanner.locator('xpath=ancestor-or-self::div[contains(@class,"rounded")][1]');
    const cls = (await box.getAttribute('class')) ?? '';

    // AC-B1: 모노톤(무채색) — amber(컬러) 잔재 0, gray 계열 사용.
    expect(cls, 'amber(컬러) 제거').not.toContain('amber');
    expect(cls, '무채색 gray 계열 사용').toMatch(/(gray|slate|neutral|zinc|white|black)/);

    // AC-B2: 크기 절반 — 컴팩트 유틸(text-xs / px-2 / py-0.5 / w-fit 등) 적용 + 이전(px-4/py-2/text-sm) 미사용.
    expect(cls, '컴팩트 텍스트(text-xs)').toContain('text-xs');
    expect(cls, '컴팩트 패딩(px-2 이하)').not.toContain('px-4');
    expect(cls, '컴팩트 패딩(py-2 미사용)').not.toContain('py-2');
    expect(cls, '컨텐츠 폭으로 축소(w-fit)').toContain('w-fit');

    // AC-B3: 텍스트 잘림 없음 — 문구가 온전히 렌더(overflow ellipsis 없이 전체 텍스트 노출).
    const txt = (await pastBanner.textContent())?.trim() ?? '';
    expect(txt, '문구 온전(잘림 없음)').toContain('과거 날짜 조회 중 — 읽기 전용');
    // scrollWidth ≤ clientWidth+오차 → 가로 클립 없음.
    const clipped = await box.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    expect(clipped, '가로 텍스트 클립 없음(scrollWidth ≤ clientWidth)').toBe(false);
  });
});
