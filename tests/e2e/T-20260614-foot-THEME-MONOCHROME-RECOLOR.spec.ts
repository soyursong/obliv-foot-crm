import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ESM 스코프 — __dirname 미정의. Playwright 는 레포 루트에서 실행되므로 cwd 기준.

/**
 * T-20260614-foot-THEME-MONOCHROME-RECOLOR (StepD)
 * 김주연 총괄 확정 5색 warm-monochrome 팔레트 적용 회귀 락.
 *   Vanilla #F8F4EE · Soft Dune #E4DDCC · Classic Taupe #C5BEA3 · Umber #443A35 · Black #252525.
 *
 * 방침:
 *  - 브랜드 메인 teal-* (장식 1600+건) → tailwind 팔레트 단일 오버라이드로 warm-monochrome 리맵.
 *  - 의미색 emerald-*(재진·success)·green-*(완료·선체험·재진)·--status-*(칸반) 은 유지(AC4).
 *  - 셀프접수 .theme-brown / .dark 비침범(불변).
 *
 * 본 spec 은 auth 불요(unit 프로젝트). 정적 소스 가드 + 공개 /login 실브라우저 렌더(AC5).
 */

const ROOT = process.cwd();
const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const status = readFileSync(join(ROOT, 'src', 'lib', 'status.ts'), 'utf8');

test.describe('THEME-MONOCHROME-RECOLOR — 정적 소스 가드 (auth 불요)', () => {
  // 정정(planner FIX MSG-20260614-153740): 전역 teal 램프 리맵은 '의미색 치환' → 보류(HOLD).
  //   teal-* 는 칸반 단계(treatment_waiting/preconditioning) 의미색이기도 하므로,
  //   김주연 총괄 A/B 결정 전까지 Tailwind 기본 teal 램프를 유지(의미색 보존)한다.
  test('AC4(정정): tailwind 에 전역 teal 램프 오버라이드가 없다 (의미색 보류)', () => {
    // teal 팔레트 블록이 config 에 재정의되어 있지 않아야 함(기본 램프 유지 = 칸반 의미색 보존)
    expect(tw).not.toMatch(/\bteal:\s*\{/);
    // warm 앵커 hex 가 teal 램프로 주입돼 있지 않아야 함
    expect(tw).not.toMatch(/#F8F4EE|#C5BEA3|#443A35/i);
  });

  test('AC4(정정): status.ts 칸반 단계 의미색(teal/emerald)이 보존돼 있다', () => {
    expect(status).toMatch(/treatment_waiting:\s*'bg-teal-100 text-teal-800'/);
    expect(status).toMatch(/preconditioning:\s*'bg-teal-400 text-white'/);
    expect(status).toMatch(/laser:\s*'bg-emerald-500 text-white'/);
    expect(status).toMatch(/returning:\s*'bg-emerald-100 text-emerald-700'/);
  });

  test('AC1: :root 토큰이 warm-monochrome 로 교체되어 있다 (순백/순흑 아님)', () => {
    // 기본 배경이 순백 oklch(1 0 0) 이 아니라 Vanilla warm 톤
    expect(css).not.toMatch(/--background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/THEME-MONOCHROME-RECOLOR/);
    // 배경/전경 warm 톤 토큰 존재
    expect(css).toMatch(/--background:\s*oklch\(0\.965 0\.008 80\)/);
    expect(css).toMatch(/--primary:\s*oklch\(0\.33 0\.012 60\)/); // Umber 액센트
  });

  test('AC4: 의미색(칸반 status + 셀프접수 brown)은 보존된다', () => {
    // 칸반 11단계 status 토큰 유지
    expect(css).toMatch(/--status-laser:/);
    expect(css).toMatch(/--status-preconditioning:/);
    expect(css).toMatch(/--destructive:\s*oklch\(0\.577 0\.245 27\.325\)/); // 의미 빨강 유지
    // 셀프접수 brown 테마 비침범
    expect(css).toMatch(/\.theme-brown\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });
});

test.describe('THEME-MONOCHROME-RECOLOR — 공개 로그인 실렌더 (AC5)', () => {
  test('Public: 로그인 화면 body 배경이 warm(Vanilla) 톤으로 렌더된다', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // --background / --primary 토큰이 실제 브라우저에 warm-monochrome 으로 적용됐는지 검증.
    // (브라우저 getComputedStyle 은 색공간을 oklch 로 보고할 수 있어 픽셀 rgb 비교 대신 토큰 변수 검증)
    const probe = await page.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    }));

    // 배경 토큰: warm Vanilla (L 0.965) — 순백 oklch(1 0 0) 회귀 방지
    expect(probe.bg).toMatch(/0\.965/);
    expect(probe.bg).not.toMatch(/oklch\(1 0 0\)/);
    // primary 토큰: Umber 다크 액센트 (L 0.33)
    expect(probe.primary).toMatch(/0\.33/);

    await page.screenshot({
      path: 'evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR_login-render.png',
      fullPage: true,
    });
  });
});
