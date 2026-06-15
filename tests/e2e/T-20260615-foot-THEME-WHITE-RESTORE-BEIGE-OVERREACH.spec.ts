import { test, expect } from '@playwright/test';

/**
 * T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH
 *
 * 배경: 6/14 THEME-MONOCHROME-RECOLOR 가 베이지(Vanilla/Soft Dune)를 base 면 전반에 깔아
 *   김주연 총괄(원 팔레트 확정자)이 "모노톤 요청했는데 베이지 범벅" 컴플레인.
 *   → 직전 RECOLOR 재오픈 정정(commit ad7dbcf)에서 base 를 화이트/중립 그레이로 복원,
 *     베이지·브라운(Umber/Taupe)은 최소 액센트로 격하했다.
 *
 * 본 spec 은 그 정정 상태를 :root 토큰 계약으로 락(회귀 가드)하고, 주요 운영화면 5종을
 *   authed 실브라우저로 fullPage 렌더해 "면=화이트/중립, 베이지=포인트만" 을 객관 증거로 남긴다.
 *
 * AC 매핑:
 *   AC1 base 면(background/card/popover) = 순수 흰색 oklch(1 0 0)
 *   AC2 면/구분선(secondary/muted/border/input/accent) = 무채(chroma 0) 중립 그레이
 *   AC3 warm(primary=Umber/ring=Taupe) = 최소 chroma 액센트로만 잔존(범벅 0)
 *   AC4 의미색(status / chart / destructive) carve-out 불변(RECOLOR A안 유지)
 *   AC5 .theme-brown(셀프접수)/.dark 비침범 — :root base 변경이 이 스코프로 새지 않음
 *   AC6 5화면 실렌더 스샷 (evidence/)
 *
 * 사전조건: webServer(8089) 자동 기동 + setup 의존(.auth/user.json).
 */

// oklch(L C H) 문자열에서 C(chroma) 추출. 무채색이면 C==0.
function chromaOf(oklch: string): number {
  const m = oklch.trim().match(/oklch\(\s*[\d.]+\s+([\d.]+)/i);
  return m ? parseFloat(m[1]) : NaN;
}

const SCREENS: { name: string; path: string; label: string }[] = [
  { name: 'dashboard', path: '/admin', label: '대시보드' },
  { name: 'reservations', path: '/admin/reservations', label: '예약관리' },
  { name: 'customers', path: '/admin/customers', label: '고객관리(차트)' },
  { name: 'stats', path: '/admin/stats', label: '통계' },
  { name: 'settings', path: '/admin/settings', label: '설정' },
];

test.describe('THEME-WHITE-RESTORE — :root 토큰 계약 가드', () => {
  test('AC1/AC2/AC3/AC4: base=흰색·면=중립·warm=최소액센트·의미색 보존', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    expect(page.url(), '인증 후 로그인으로 튕김(.auth 상태 확인)').not.toContain('/login');

    const t = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      return {
        background: v('--background'),
        card: v('--card'),
        popover: v('--popover'),
        secondary: v('--secondary'),
        muted: v('--muted'),
        accent: v('--accent'),
        border: v('--border'),
        input: v('--input'),
        primary: v('--primary'),
        ring: v('--ring'),
        statusLaser: v('--status-laser'),
        statusPreconditioning: v('--status-preconditioning'),
        chart1: v('--chart-1'),
        destructive: v('--destructive'),
      };
    });

    // AC1 — base 면은 순수 흰색
    expect(t.background).toMatch(/oklch\(1 0 0\)/);
    expect(t.card).toMatch(/oklch\(1 0 0\)/);
    expect(t.popover).toMatch(/oklch\(1 0 0\)/);

    // AC2 — 면/구분선은 무채(chroma 0) 중립 그레이 (베이지 hue 제거)
    for (const [k, val] of Object.entries({
      secondary: t.secondary,
      muted: t.muted,
      accent: t.accent,
      border: t.border,
      input: t.input,
    })) {
      expect(chromaOf(val), `${k}(${val}) 는 무채(chroma 0) 여야 함`).toBe(0);
    }

    // AC3 — warm 액센트는 잔존하되 "최소"(낮은 chroma). 면 토큰보다 채도는 있되 과하지 않다.
    //   primary=Umber, ring=Taupe. 범벅 방지 상한선(0.08) 가드.
    const pc = chromaOf(t.primary);
    const rc = chromaOf(t.ring);
    expect(pc, `primary(${t.primary}) chroma 는 0 초과(warm 잔존)`).toBeGreaterThan(0);
    expect(pc, `primary chroma 는 ≤0.08(범벅 방지)`).toBeLessThanOrEqual(0.08);
    expect(rc, `ring(${t.ring}) chroma 는 0 초과(warm 잔존)`).toBeGreaterThan(0);
    expect(rc, `ring chroma 는 ≤0.08(범벅 방지)`).toBeLessThanOrEqual(0.08);

    // AC4 — 의미색 carve-out 불변: 채도 있는 색으로 보존되어야 함(무채로 깎이지 않음)
    expect(chromaOf(t.statusLaser), 'status-laser 의미색 보존').toBeGreaterThan(0.1);
    expect(chromaOf(t.statusPreconditioning), 'status-preconditioning 의미색 보존').toBeGreaterThan(0.1);
    expect(chromaOf(t.chart1), 'chart-1 의미색 보존').toBeGreaterThan(0.05);
    expect(chromaOf(t.destructive), 'destructive 의미색 보존').toBeGreaterThan(0.2);
  });

  for (const s of SCREENS) {
    test(`AC6: ${s.label}(${s.path}) 실렌더 — base 화이트, 베이지 범벅 없음`, async ({ page }) => {
      await page.goto(s.path);
      await page.waitForLoadState('networkidle');
      expect(page.url(), `${s.path} 인증 후 로그인으로 튕김`).not.toContain('/login');

      // 실제로 칠해지는 base 면 색을 찾는다. body/html 은 투명(rgba 0)일 수 있으므로
      //   bg-background 가 적용된 첫 불투명 조상 면을 골라 베이지(노란기) 여부를 검사한다.
      const surface = await page.evaluate(() => {
        const candidates = [
          document.body,
          document.documentElement,
          document.getElementById('root'),
          document.querySelector('main'),
          document.querySelector('[class*="bg-background"]'),
        ].filter(Boolean) as Element[];
        for (const el of candidates) {
          const bg = getComputedStyle(el).backgroundColor;
          const m = bg.match(/rgba?\(([^)]+)\)/);
          if (!m) continue;
          const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
          const alpha = parts.length >= 4 ? parts[3] : 1;
          if (alpha > 0) return { bg, r: parts[0], g: parts[1], b: parts[2] };
        }
        return null;
      });

      // 면을 못 찾으면(전부 투명) 토큰으로 폴백 검증 — --background 가 흰색이면 통과.
      if (surface) {
        const { bg, r, g, b } = surface;
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${s.label} base 면(${bg}) 무채(R/G/B 편차≤4, 베이지 노란기 아님)`).toBeLessThanOrEqual(4);
        expect(Math.min(r, g, b), `${s.label} base 면이 밝은 면(≥245)`).toBeGreaterThanOrEqual(245);
      } else {
        const bgToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
        expect(bgToken, `${s.label} base 토큰 흰색 폴백`).toMatch(/oklch\(1 0 0\)/);
      }

      await page.screenshot({
        path: `evidence/T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH_${s.name}.png`,
        fullPage: true,
      });
    });
  }
});
