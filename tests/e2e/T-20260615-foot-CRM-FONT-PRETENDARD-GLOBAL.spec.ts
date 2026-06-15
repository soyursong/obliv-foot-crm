/**
 * E2E spec — T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL
 * 요청(김주연 총괄): "CRM 전체 폰트 셀프접수에 적용했던 폰트(Pretendard)로 변경"
 *
 * firsthand 조사로 드러난 진짜 메커니즘(티켓 가정 정정):
 *   - src/index.css 의 `.theme { --font-sans }` 토큰은 마크업 어디에도 `.theme` 클래스가
 *     부여된 적이 없어 무효였다(Geist도 실제로는 admin에 적용 안 됨).
 *   - `html { @apply font-sans }` 는 Tailwind 기본 sans 리터럴(ui-sans-serif…)을 굽어
 *     :root 의 --font-sans 토큰을 참조하지 않았다.
 *   ⇒ 실제 전역 적용을 위해 (a) 전역 :root 에 --font-sans/--font-heading=Pretendard 재정의,
 *      (b) html 규칙에서 var(--font-sans) 를 직접 지정(@apply 후행 override) 두 곳을 변경.
 *   ⇒ 참조처 사라진 `@import "@fontsource-variable/geist"`(dead) 제거.
 *   Pretendard 는 index.html 전역 CDN 旣로드 → 추가 import/패키지 0.
 *
 * AC-1 :root --font-sans=Pretendard, --font-heading 상속, Geist 흔적 0 (소스 불변식).
 * AC-2 셀프접수 폰트 소스(index.html Pretendard CDN) + 셀프접수 테마(.theme-brown) 무손상.
 *      (실 셀프접수는 별도 프로젝트 foot-checkin.pages.dev; 본 레포 /checkin 은 deprecated 리다이렉트 스텁)
 * AC-3 펜차트 Canvas 명시 폰트(ctx.font … "Malgun Gothic")는 명시 지정 → 변경/영향 없음.
 * AC-4 색 토큰(THEME-WHITE-RESTORE 작업분: white 배경/카드) 무손상.
 * AC-5 /admin 실렌더 — html·body computed font-family 가 Pretendard (셀프접수와 동일 서체).
 *
 * AC-1~4 는 소스 불변식(auth 불요·결정적), AC-5 는 실브라우저 렌더(로그인 표면, auth 불요).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INDEX_CSS = path.join(ROOT, 'src/index.css');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SRC_DIR = path.join(ROOT, 'src');

const readCss = () => fs.readFileSync(INDEX_CSS, 'utf8');

test.describe('T-20260615 CRM-FONT-PRETENDARD-GLOBAL — 어드민 전역 Pretendard 통일', () => {
  // ── AC-1: :root --font-sans=Pretendard, Geist 흔적 0 ────────────────────────────
  test('AC-1: :root --font-sans = Pretendard + --font-heading 상속 + Geist 흔적 0', () => {
    const css = readCss();
    expect(css).toMatch(/--font-sans:\s*'Pretendard',\s*sans-serif/);
    expect(css).toMatch(/--font-heading:\s*var\(--font-sans\)/);
    expect(css.toLowerCase()).not.toContain('geist');
  });

  // ── AC-2: 셀프접수 폰트 소스/테마 무손상 ─────────────────────────────────────────
  test('AC-2: index.html Pretendard CDN + .theme-brown 테마 무손상', () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    // 셀프접수가 쓰는 Pretendard 전역 CDN 로드 유지
    expect(html).toMatch(/pretendard.*\.css/i);
    // 셀프접수 브라운/베이지 테마 블록 보존
    expect(readCss()).toContain('.theme-brown');
  });

  // ── AC-3: 펜차트 Canvas 명시 폰트(Malgun Gothic) 보존 ──────────────────────────────
  test('AC-3: 펜차트 Canvas ctx.font "Malgun Gothic" 명시 지정 보존', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|ts)$/.test(e.name)) files.push(p);
      }
    };
    walk(SRC_DIR);
    // ctx.font 선언부터 같은 문장 안에 Malgun Gothic 이 명시(내부 큰따옴표 포함) 되어 있는지
    const hasExplicitCanvasFont = files.some((f) =>
      /ctx\.font\s*=\s*[^;]*Malgun Gothic/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(hasExplicitCanvasFont).toBe(true);
  });

  // ── AC-4: 색 토큰 무손상 ─────────────────────────────────────────────────────────
  test('AC-4: 색 토큰(흰색 배경/카드 복원분) 무손상', () => {
    const css = readCss();
    expect(css).toMatch(/--background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/--card:\s*oklch\(1 0 0\)/);
  });

  // ── AC-5: /admin 실렌더 — html·body 가 Pretendard ───────────────────────────────
  test('AC-5: /admin html·body computed font-family = Pretendard', async ({ page }) => {
    await page.goto('/admin');
    const r = await page.evaluate(async () => {
      try { await document.fonts.ready; } catch { /* noop */ }
      return {
        html: getComputedStyle(document.documentElement).fontFamily.toLowerCase(),
        body: getComputedStyle(document.body).fontFamily.toLowerCase(),
      };
    });
    expect(r.html).toContain('pretendard');
    expect(r.body).toContain('pretendard');
    // serif 흔적 없음 (회귀 가드)
    expect(r.body).not.toContain('georgia');
    expect(r.body).not.toContain('noto serif');
    console.log('[AC-5] /admin html:', r.html, '| body:', r.body);
  });
});
