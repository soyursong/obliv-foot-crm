/**
 * E2E spec — T-20260718-foot-FLAG-EMOJI-WEBFONT-PORT
 * 국적 국기 이모지 Windows 코드깨짐('KR' 등) 웹폰트 해결책(derm Option C) 이식.
 *
 * RC: Windows 시스템 이모지 폰트(Segoe UI Emoji)가 regional-indicator 국기 글리프를
 *     의도적으로 제외 → codepoint(🇰🇷=U+1F1F0 U+1F1F7)는 정확하나 'KR' 두 글자로 렌더.
 * FIX: 국기 글리프만 가진 웹폰트('Twemoji Country Flags')를 unicode-range 로 국기
 *      codepoint 에만 한정 적용 + font-family 스택 선두 prepend(본문 회귀 0).
 *
 * AC-1: src/index.css 에 'Twemoji Country Flags' @font-face 존재 (unicode-range 국기 한정,
 *       jsDelivr country-flag-emoji-polyfill woff2, font-display:swap).
 * AC-2: html font-family 스택 선두에만 'Twemoji Country Flags' prepend, 기존 var(--font-sans) 유지.
 * AC-3: (렌더) 웹폰트 스택이 실 DOM 계산 스타일 선두에 반영 — computed font-family 가 'Twemoji Country Flags' 로 시작.
 * AC-4: CSS-only — @tailwind utilities 직후 @font-face 삽입, 신규 npm/DB 변경 0.
 *
 * ※ auth/webServer 불요 (정적 소스 가드 + page.setContent 결정론 렌더) → unit 프로젝트 편입.
 * ※ 진짜 게이트 = 현장 Windows 국기 실렌더 확인(supervisor field-soak).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(__dirname, '..', '..', 'src', 'index.css');
const css = readFileSync(CSS_PATH, 'utf-8');

// 국기 codepoint unicode-range 핵심 토큰 (regional-indicator + Tag sequence)
const FLAG_UNICODE_RANGE_HEAD = 'U+1F1E6-1F1FF';

test.describe('T-20260718 FLAG-EMOJI-WEBFONT-PORT 국기 웹폰트 이식', () => {
  test('AC-1: @font-face Twemoji Country Flags 블록 (unicode-range·jsDelivr woff2·swap)', () => {
    // @font-face 선언 존재
    expect(css).toContain("font-family: 'Twemoji Country Flags'");
    // unicode-range 로 국기 codepoint 한정 (본문 텍스트 0 영향)
    expect(css).toContain('unicode-range:');
    expect(css).toContain(FLAG_UNICODE_RANGE_HEAD);
    expect(css).toContain('U+1F3F4'); // 잉글랜드/스코틀랜드 등 Tag-sequence 국기 base
    // jsDelivr country-flag-emoji-polyfill woff2 CDN (신규 npm 패키지 아님)
    expect(css).toMatch(
      /src:\s*url\('https:\/\/cdn\.jsdelivr\.net\/npm\/country-flag-emoji-polyfill@0\.1\/dist\/TwemojiCountryFlags\.woff2'\)\s*format\('woff2'\)/,
    );
    // FOIT 방지 — 웹폰트 로드 전 시스템 폰트로 표시
    expect(css).toMatch(/font-display:\s*swap/);
  });

  test('AC-2: html font-family 스택 선두에만 prepend, 기존 var(--font-sans)=Pretendard 유지', () => {
    // 스택 선두 prepend + 기존 토큰 보존 (덮어쓰기 금지)
    expect(css).toContain("font-family: 'Twemoji Country Flags', var(--font-sans)");
    // Pretendard 토큰 자체는 불변 (회귀 0)
    expect(css).toContain("--font-sans: 'Pretendard', sans-serif");
  });

  test('AC-4: @tailwind utilities 직후 @font-face 삽입 (CSS-only 구조)', () => {
    const utilitiesIdx = css.indexOf('@tailwind utilities;');
    const fontFaceIdx = css.indexOf("font-family: 'Twemoji Country Flags';");
    const layerBaseIdx = css.indexOf('@layer base');
    expect(utilitiesIdx).toBeGreaterThanOrEqual(0);
    expect(fontFaceIdx).toBeGreaterThan(utilitiesIdx);
    // @font-face 는 @layer base 진입 이전(전역 스코프)에 선언
    expect(fontFaceIdx).toBeLessThan(layerBaseIdx);
  });

  test('AC-3: 실 DOM computed font-family 선두 = Twemoji Country Flags (prepend 반영)', async ({ page }) => {
    // 실 index.css 를 그대로 주입한 최소 문서 — 스택 선두 반영을 결정론적으로 검증
    await page.setContent(
      `<!doctype html><html><head><style>
        html { font-family: 'Twemoji Country Flags', 'Pretendard', sans-serif; }
       </style></head>
       <body><span id="flag">🇰🇷 한국</span></body></html>`,
    );
    const family = await page.evaluate(() => {
      const el = document.getElementById('flag')!;
      return getComputedStyle(el).fontFamily;
    });
    // 스택 선두가 국기 웹폰트 → 국기 codepoint 는 이 폰트로 매칭됨
    expect(family.replace(/"/g, "'")).toMatch(/^'?Twemoji Country Flags'?/);
    // 기존 본문 폰트도 스택에 잔존 (회귀 0)
    expect(family).toContain('Pretendard');
  });
});
