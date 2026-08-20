// T-20260820-foot-DASH-TIMER-FONTMONO-WEIGHT500-NOTREFLECTED-DIAG
// leg1: 실 브라우저 computed 값 + 렌더 폭 실측으로 "500 미반영" 원인 확정.
//   핵심: 고정폭(mono) 스택엔 500 face가 없어 400으로 스냅됨을 렌더 폭 비교로 증명.
//   (getComputedStyle.fontWeight 는 지정값(500)을 그대로 반환 → 폭 실측이 진짜 증거)
// leg2: 4개 시안(현재/ⓐ/ⓑ/ⓒ) 실 대시보드 폰트로 렌더 → 스크린샷.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockup = 'file://' + path.join(__dirname, 'T-20260820-foot-DASH-TIMER-FONTMONO-WEIGHT500-NOTREFLECTED-DIAG_mockup.html');

const browser = await chromium.launch();
// 갤럭시탭(Android Chrome) 근사 뷰포트
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(mockup, { waitUntil: 'networkidle' });
await page.waitForTimeout(600); // 웹폰트 확정

// ── 굵기 실측 유틸 ──
//   ⚠ 고정폭(mono) 폰트는 굵기와 무관하게 advance width 동일(설계) → 폭 비교는 mono에 무효.
//   굵기 적용 여부는 canvas 렌더 후 '잉크 농도(어두운 픽셀 합)'로 계측해야 정직하다.
//   metric = Σ(255 - alpha·luma) : 굵을수록 잉크량↑. weight 미적용이면 400과 동일.
const probe = await page.evaluate(async () => {
  const SANS = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim();
  const MONO = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const ink = (family, weight) => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 40;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.textBaseline = 'middle';
    g.font = `${weight} 22px ${family}`;
    g.fillText('03:42', 4, 20);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i + 3]; // alpha 누적 = 잉크량
    return sum;
  };
  await document.fonts.ready;
  const fontUsed = (sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    return { computedFontWeight: cs.fontWeight, family: cs.fontFamily };
  };
  return {
    mono: { ink400: ink(MONO, 400), ink500: ink(MONO, 500), ink700: ink(MONO, 700) },
    genericMono: { ink400: ink('monospace', 400), ink500: ink('monospace', 500), ink700: ink('monospace', 700) },
    sans: { ink400: ink(SANS, 400), ink500: ink(SANS, 500), ink700: ink(SANS, 700) },
    current: fontUsed('[data-id="cur"]'),
    optionA: fontUsed('[data-id="a"]'),
    resolvedMono: MONO, resolvedSans: SANS,
  };
});

// 잉크량 상대 증가율(400 대비). 0%면 굵기 미적용.
const pct = (base, v) => Math.round(((v - base) / base) * 1000) / 10;
const deltas = {
  'mono 500 vs 400 잉크 증가율(%)': pct(probe.mono.ink400, probe.mono.ink500),
  'mono 700 vs 400 잉크 증가율(%)': pct(probe.mono.ink400, probe.mono.ink700),
  'genericMono 500 vs 400 (%)': pct(probe.genericMono.ink400, probe.genericMono.ink500),
  'genericMono 700 vs 400 (%)': pct(probe.genericMono.ink400, probe.genericMono.ink700),
  'sans(Pretendard) 500 vs 400 (%)': pct(probe.sans.ink400, probe.sans.ink500),
  'sans(Pretendard) 700 vs 400 (%)': pct(probe.sans.ink400, probe.sans.ink700),
};

console.log('=== leg1 실측 (텍스트 "03:42" @22px, canvas 잉크량 Σalpha) ===');
console.log(JSON.stringify(probe, null, 2));
console.log('\n=== 굵기 적용 판정 (400 대비 잉크 증가율) ===');
console.log(JSON.stringify(deltas, null, 2));
console.log('\n판독: 잉크 증가율 ~0% = 그 굵기가 화면에 반영 안 됨.');
console.log('  · 고정폭(mono)에서 500 증가율이 0%에 수렴하면 → 500 face 부재로 400 폴백(=현장 증상).');
console.log('  · 본문(Pretendard/sans)에서 500이 뚜렷한 +증가율 → 500 실제 반영됨(시안 ⓐ 근거).');
console.log('  · getComputedStyle.fontWeight 는 두 경우 모두 "500" 반환 → 폭·computed 값은 증거로 부적합, 잉크량이 진짜 증거.');

const shotPath = path.join(__dirname, 'T-20260820-foot-DASH-TIMER-FONTMONO-WEIGHT500-NOTREFLECTED-DIAG_mockup.png');
await page.screenshot({ path: shotPath, fullPage: true });
console.log('\n스크린샷:', shotPath);

await browser.close();
