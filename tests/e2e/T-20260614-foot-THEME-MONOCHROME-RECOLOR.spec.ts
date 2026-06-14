import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ESM 스코프 — __dirname 미정의. Playwright 는 레포 루트에서 실행되므로 cwd 기준.

/**
 * T-20260614-foot-THEME-MONOCHROME-RECOLOR (A안 확정 — planner NEW-TASK MSG-20260614-201105)
 * 김주연 총괄 A/B → A안(의미색 carve-out 후 sweep) 확정.
 *   확정 5색: Vanilla #F8F4EE · Soft Dune #E4DDCC · Classic Taupe #C5BEA3 · Umber #443A35 · Black #252525.
 *
 * 방침:
 *  - 장식 teal-* (1029건/99파일, 압도적 장식) → tailwind 팔레트 단일 오버라이드로 warm-monochrome 리맵(sweep).
 *  - 의미색 carve-out(AC4, 절대 미치환):
 *      ① 칸반 11단계 teal 단계(treatment_waiting·preconditioning) → status.ts 에서 teal 기본 HEX pin(램프 비종속).
 *      ② 재진(emerald) ③ 선체험(green) ④ 치료사 역할칩(green) ⑤ laser(emerald) → teal 미사용 → 자동 보존.
 *  - 셀프접수 .theme-brown / .dark 비침범(불변).
 *
 * 본 spec 은 auth 불요(unit 프로젝트). 정적 소스 가드 + 컴파일 CSS 가드 + 공개 /login 실브라우저 렌더(AC5).
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

test.describe('THEME-MONOCHROME-RECOLOR — 정적 소스 가드 (auth 불요)', () => {
  test('AC2/AC8(A안): tailwind teal-* 가 확정 5색 warm-monochrome 램프로 오버라이드돼 있다', () => {
    // 전역 teal 램프 오버라이드 존재(장식 sweep)
    expect(tw).toMatch(/\bteal:\s*\{/);
    // 확정 5색 앵커 hex 가 teal 램프에 주입돼 있어야 함
    expect(tw).toMatch(/#F8F4EE/i); // 50 Vanilla
    expect(tw).toMatch(/#E4DDCC/i); // 200 Soft Dune
    expect(tw).toMatch(/#C5BEA3/i); // 400 Classic Taupe
    expect(tw).toMatch(/#443A35/i); // 800 Umber
    expect(tw).toMatch(/#252525/i); // 950 Black
  });

  test('AC4(carve-out①): 칸반 teal 단계가 teal 기본 HEX 로 pin 돼 램프 비종속이다', () => {
    // treatment_waiting / preconditioning 은 teal-* 유틸이 아니라 기본 HEX 로 고정(레인보우 보존)
    expect(status).toMatch(/treatment_waiting:\s*'bg-\[#ccfbf1\] text-\[#115e59\]'/);
    expect(status).toMatch(/preconditioning:\s*'bg-\[#2dd4bf\] text-white'/);
    // teal-* 유틸로 회귀하면 전역 램프에 끌려가 단계색이 무너짐 → 금지
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

  test('AC1: :root 토큰이 warm-monochrome 로 교체되어 있다 (순백/순흑 아님)', () => {
    expect(css).not.toMatch(/--background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/THEME-MONOCHROME-RECOLOR/);
    expect(css).toMatch(/--background:\s*oklch\(0\.965 0\.008 80\)/);
    expect(css).toMatch(/--primary:\s*oklch\(0\.33 0\.012 60\)/); // Umber 액센트
  });

  test('AC4: 의미색(칸반 status + 셀프접수 brown)은 보존된다', () => {
    expect(css).toMatch(/--status-laser:/);
    expect(css).toMatch(/--status-preconditioning:/);
    expect(css).toMatch(/--destructive:\s*oklch\(0\.577 0\.245 27\.325\)/); // 의미 빨강 유지
    expect(css).toMatch(/\.theme-brown\s*\{/); // 셀프접수 brown 테마 비침범
    expect(css).toMatch(/\.dark\s*\{/);
  });
});

test.describe('THEME-MONOCHROME-RECOLOR — 컴파일 CSS 가드 (빌드 산출물)', () => {
  // dist 가 있으면(빌드 후) 컴파일된 CSS 에서 장식 teal 시안 누수 0 + 칸반 pin 보존 + 의미색 보존 검증.
  test('빌드 CSS: 장식 teal 시안 누수 0 · 칸반 pin/의미색 보존', () => {
    const distAssets = join(ROOT, 'dist', 'assets');
    if (!existsSync(distAssets)) test.skip(true, 'dist 미존재(빌드 전) — 정적 소스 가드로 대체');
    const cssFile = readdirSync(distAssets).find((f) => /^index-.*\.css$/.test(f));
    if (!cssFile) test.skip(true, 'compiled css 미발견');
    const compiled = readFileSync(join(distAssets, cssFile!), 'utf8');

    // 장식 teal 구 시안(teal-600/500/700)이 컴파일 CSS 에 남아있으면 sweep 실패
    expect(compiled).not.toMatch(/rgb\(13 148 136\)/);  // 구 teal-600
    expect(compiled).not.toMatch(/rgb\(20 184 166\)/);  // 구 teal-500
    expect(compiled).not.toMatch(/#0f766e/i);           // 구 teal-700
    // warm 램프 반영(teal-600 → Umber 계열 #6e6353)
    expect(compiled).toMatch(/#6e6353/i);
    // 칸반 pin HEX 보존(레인보우)
    expect(compiled).toContain('#ccfbf1');
    expect(compiled).toContain('#2dd4bf');
    expect(compiled).toContain('#115e59');
    // emerald 의미색(laser/재진) 보존
    expect(compiled).toMatch(/#10b981/i); // emerald-500
  });
});

test.describe('THEME-MONOCHROME-RECOLOR — 공개 로그인 실렌더 (AC5)', () => {
  test('Public: 로그인 화면 body 배경이 warm(Vanilla) 톤으로 렌더된다', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const probe = await page.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    }));

    expect(probe.bg).toMatch(/0\.965/);
    expect(probe.bg).not.toMatch(/oklch\(1 0 0\)/);
    expect(probe.primary).toMatch(/0\.33/);

    await page.screenshot({
      path: 'evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR_login-render.png',
      fullPage: true,
    });
  });
});
