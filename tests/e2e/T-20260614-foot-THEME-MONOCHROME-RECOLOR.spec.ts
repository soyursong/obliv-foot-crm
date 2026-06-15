import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ESM 스코프 — __dirname 미정의. Playwright 는 레포 루트에서 실행되므로 cwd 기준.

/**
 * T-20260614-foot-THEME-MONOCHROME-RECOLOR (StepF 재오픈 정정 — 2026-06-15 김주연 총괄)
 *
 * 재오픈 배경: 직전 warm-monochrome 배포가 배경/카드/일반영역까지 Vanilla(#F8F4EE)·Soft Dune(#E4DDCC)
 *   베이지로 깔아 "너무 베이지함" → 일반영역=순수 흰색/중립 그레이 복원, 베이지·브라운은
 *   버튼·활성탭·포커스 등 강조 포인트에만 최소 유지.
 *
 * 정정 방침:
 *  - :root 일반영역 토큰(background/card/popover/secondary/muted/accent/border) → 흰색·중립 그레이(hue 0).
 *  - tailwind teal-* light-end(50~300, 배경/면/보더에 압도적 사용) → 중립 그레이로 복원(베이지 제거).
 *  - 강조 포인트는 warm 유지: --primary=Umber, --ring=Taupe, teal dark-end(400~950)=Taupe/Umber/Black.
 *  - 의미색 carve-out(AC4, 절대 미치환): status.ts 칸반 pin·emerald 재진/laser·green 선체험/역할칩.
 *  - 셀프접수 .theme-brown / .dark 비침범(불변).
 *
 * 본 spec 은 auth 불요(unit 프로젝트). 정적 소스 가드 + 컴파일 CSS 가드 + 공개 /login 실브라우저 렌더(AC5).
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

test.describe('THEME-MONOCHROME-RECOLOR(재오픈) — 정적 소스 가드 (auth 불요)', () => {
  test('AC1/AC7(재오픈): teal light-end(50~300)가 중립 그레이로 복원돼 베이지가 제거됐다', () => {
    expect(tw).toMatch(/\bteal:\s*\{/);
    // light-end = 중립 그레이(흰색 계열)
    expect(tw).toMatch(/50:\s*"#FAFAFA"/i);
    expect(tw).toMatch(/100:\s*"#F4F4F5"/i);
    expect(tw).toMatch(/200:\s*"#E5E5E5"/i);
    expect(tw).toMatch(/300:\s*"#D4D4D4"/i);
    // 베이지(Vanilla/Soft Dune/구 light-end)는 램프에서 제거 — 잔존 시 실패
    expect(tw).not.toMatch(/#F8F4EE/i); // Vanilla 제거
    expect(tw).not.toMatch(/#F0EADE/i);
    expect(tw).not.toMatch(/#E4DDCC/i); // Soft Dune 제거
    expect(tw).not.toMatch(/#D6CDB8/i);
  });

  test('AC2(재오픈): teal dark-end(400~950) warm 브라운 포인트는 유지된다', () => {
    expect(tw).toMatch(/#C5BEA3/i); // 400 Classic Taupe(밝은 강조 포인트)
    expect(tw).toMatch(/#6E6353/i); // 600 주 포인트
    expect(tw).toMatch(/#554A3D/i); // 700 강조 텍스트/hover
    expect(tw).toMatch(/#443A35/i); // 800 Umber(버튼/활성탭)
    expect(tw).toMatch(/#252525/i); // 950 Black
  });

  test('AC4(carve-out①): 칸반 teal 단계가 teal 기본 HEX 로 pin 돼 램프 비종속이다', () => {
    expect(status).toMatch(/treatment_waiting:\s*'bg-\[#ccfbf1\] text-\[#115e59\]'/);
    expect(status).toMatch(/preconditioning:\s*'bg-\[#2dd4bf\] text-white'/);
    expect(status).not.toMatch(/treatment_waiting:\s*'bg-teal-/);
    expect(status).not.toMatch(/preconditioning:\s*'bg-teal-/);
  });

  test('AC4(carve-out②③④⑤): 재진·laser·역할칩·선체험 의미색(emerald/green)이 보존돼 있다', () => {
    expect(status).toMatch(/laser:\s*'bg-emerald-500 text-white'/);          // ⑤ laser
    expect(status).toMatch(/returning:\s*'bg-emerald-100 text-emerald-700'/); // ② 재진
    expect(status).toMatch(/therapist:\s*'bg-green-100 text-green-800 border-green-300'/); // ④ 역할칩
    expect(status).toMatch(/green:\s*'선체험'/);                              // ③ 선체험(라벨)
    expect(status).toMatch(/green:\s*'bg-green-500'/);                        // ③ 선체험(도트)
  });

  test('AC1(재오픈): :root 일반영역 토큰이 순수 흰색/중립 그레이로 복원됐다', () => {
    expect(css).toMatch(/THEME-MONOCHROME-RECOLOR/);
    // 배경/카드/팝오버 = 순수 흰색
    expect(css).toMatch(/--background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/--card:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/--popover:\s*oklch\(1 0 0\)/);
    // 보조면/muted/accent/border = 중립 그레이(채도 0)
    expect(css).toMatch(/--secondary:\s*oklch\(0\.968 0 0\)/);
    expect(css).toMatch(/--muted:\s*oklch\(0\.968 0 0\)/);
    expect(css).toMatch(/--accent:\s*oklch\(0\.96 0 0\)/);
    expect(css).toMatch(/--border:\s*oklch\(0\.92 0 0\)/);
    // 강조 포인트는 warm 유지: primary=Umber, ring=Taupe
    expect(css).toMatch(/--primary:\s*oklch\(0\.33 0\.012 60\)/);
    expect(css).toMatch(/--ring:\s*oklch\(0\.70 0\.030 88\)/);
  });

  test('AC4: 의미색(칸반 status + 셀프접수 brown)은 보존된다', () => {
    expect(css).toMatch(/--status-laser:/);
    expect(css).toMatch(/--status-preconditioning:/);
    expect(css).toMatch(/--destructive:\s*oklch\(0\.577 0\.245 27\.325\)/); // 의미 빨강 유지
    expect(css).toMatch(/\.theme-brown\s*\{/); // 셀프접수 brown 테마 비침범
    expect(css).toMatch(/\.dark\s*\{/);
  });
});

test.describe('THEME-MONOCHROME-RECOLOR(재오픈) — 컴파일 CSS 가드 (빌드 산출물)', () => {
  test('빌드 CSS: 베이지 누수 0 · 흰색 배경 · warm 포인트/칸반 pin/의미색 보존', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFile = readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
    if (!cssFile) test.skip(true, 'compiled css 미발견');
    const compiled = readFileSync(join(distAssets, cssFile!), 'utf8');

    // 베이지(Vanilla/Soft Dune/구 light-end) 누수 0 — 잔존 시 "너무 베이지함" 회귀
    expect(compiled).not.toMatch(/#f8f4ee/i);
    expect(compiled).not.toMatch(/#f0eade/i);
    expect(compiled).not.toMatch(/#e4ddcc/i);
    expect(compiled).not.toMatch(/#d6cdb8/i);
    // 구 그린 teal 시안 누수 0(직전 sweep 회귀 방지)
    expect(compiled).not.toMatch(/rgb\(13 148 136\)/);  // 구 teal-600
    expect(compiled).not.toMatch(/#0f766e/i);           // 구 teal-700
    // 순수 흰색 배경 토큰 반영
    expect(compiled).toMatch(/--background:\s*oklch\(1 0 0\)/);
    // warm 포인트(teal dark-end) 보존
    expect(compiled).toMatch(/#6e6353/i);
    // 칸반 pin HEX 보존(레인보우)
    expect(compiled).toContain('#ccfbf1');
    expect(compiled).toContain('#2dd4bf');
    expect(compiled).toContain('#115e59');
    // emerald 의미색(laser/재진) 보존
    expect(compiled).toMatch(/#10b981/i); // emerald-500
  });
});

test.describe('THEME-MONOCHROME-RECOLOR(재오픈) — 공개 로그인 실렌더 (AC5)', () => {
  test('Public: 로그인 화면 배경이 순수 흰색으로 렌더되고 primary 는 Umber 포인트다', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const probe = await page.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    }));

    // 배경 = 순수 흰색 oklch(1 0 0)
    expect(probe.bg).toMatch(/oklch\(1 0 0\)/);
    // 강조 포인트 primary = Umber(0.33) 유지
    expect(probe.primary).toMatch(/0\.33/);

    await page.screenshot({
      path: 'evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR_login-render.png',
      fullPage: true,
    });
  });
});
