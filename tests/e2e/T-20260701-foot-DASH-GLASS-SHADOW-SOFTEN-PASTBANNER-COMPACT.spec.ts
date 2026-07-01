/**
 * 정적 소스 가드 (auth·server 불요, unit 프로젝트) — T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT
 * 김주연 총괄 후속 미세조정(유리축 3차 refine, reporter-driven). 순수 FE/CSS — db_change=false.
 *
 * ─ 왜 정적 소스 가드인가 (FIX-REQUEST MSG-20260701-204705-zyhy 대응) ───────────────────────────
 *   본 티켓은 순수 CSS/JSX 시각 조정으로, 검증 대상(box-shadow 값·배너 유틸 클래스)이 소스에 그대로
 *   인코딩되어 있다 = 런타임 렌더를 거치지 않고 소스 리터럴이 곧 산출물이다. 직전 spec 은 /admin 진입 +
 *   로그인(auth.setup → TEST_PASSWORD)을 강제해 supervisor QA 워크트리(/private/tmp/… — .env.local 은
 *   gitignore 라 워크트리에 복사되지 않음 → TEST_PASSWORD 미주입)에서 실행 불가였다. 시크릿을 git 에
 *   심을 수 없으므로(§S2), 동일 산출물을 auth 없이 검증하도록 unit 프로젝트 정적 가드로 전환한다.
 *   (선례: TABLET-DUAL-LAYOUT·COLOR-CONVENTION-UNIFY 도 auth.setup 우회 위해 unit 편입.)
 *   실 렌더(그림자 은은함·배너 높이 ≤절반)는 supervisor 갤탭 field-soak 로 최종 확인.
 *
 * 요청A — 유리/볼록 요소의 "바깥으로 드리우는 outer drop-shadow만" 추가 축소:
 *   .live-glass-board / .idverify-glass 의 non-inset(=outer) box-shadow 레이어 blur/spread 축소 + alpha 하향.
 *   ⚠ disambiguation: inset 볼록(bulge)·gradient·backdrop-filter 는 무접촉 유지 — 볼록 회귀(더 강하게) 금지.
 *   AC-A1 outer 그림자 blur 더 좁아짐 · AC-A2 outer 그림자 alpha 더 연해짐 · AC-A3 inset(볼록) 잔존 무변경.
 *   (.live-glass 는 inset-only = outer drop-shadow 부재 → 대상 아님, 무변경.)
 * 요청B — 과거날짜 배너("과거 날짜 조회 중 — 읽기 전용") 모노톤 유지 + 추가 컴팩트:
 *   무채색(gray) 유지 + 세로높이/패딩 추가 축소(py-px, text-[11px], gap/아이콘/mt↓). 노랑 무회귀·텍스트 온전.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'src', 'index.css');
const DASH_PATH = path.join(ROOT, 'src', 'pages', 'Dashboard.tsx');

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

/** src/index.css 에서 정확한 선택자 블록의 box-shadow 선언값을 추출(주석 제거 후). */
function boxShadowOf(css: string, selector: string): string | null {
  // `.live-glass` 가 `.live-glass-board` 를 오탐하지 않도록 `\s*{` 경계로 정확 선택자만 매칭.
  const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`);
  const block = css.match(re);
  if (!block) return null;
  // 블록 안의 /* … */ 주석 제거 후 box-shadow 값만.
  const noComments = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const bs = noComments.match(/box-shadow\s*:\s*([^;]+);/);
  return bs ? bs[1].replace(/\s+/g, ' ').trim() : null;
}

test.describe('T-20260701-foot-DASH-GLASS-SHADOW-SOFTEN-PASTBANNER-COMPACT — 정적 소스 가드(바깥 그림자 완화 + 배너 컴팩트)', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const dash = fs.readFileSync(DASH_PATH, 'utf8');

  // ── 시나리오 1: outer drop-shadow 추가 축소 + inset(볼록) 무변경 잔존 (요청A) ──────────────
  test('S1: glass outer 그림자 더 좁고 연함 + inset 볼록 잔존 + live-glass inset-only + 노랑 무회귀', () => {
    const OUTER_BLUR_CAP = 5;      // 3차 refine 후 outer blur ≤ 5px (board 8→5, idverify 2→1.5)
    const OUTER_ALPHA_CAP = 0.1;   // 3차 refine 후 outer 그림자 alpha ≤ 0.10 (0.16/0.12 → 0.09/0.07/0.05)

    for (const sel of ['.live-glass-board', '.idverify-glass']) {
      const bs = boxShadowOf(css, sel);
      expect(bs, `${sel} box-shadow 선언 존재`).toBeTruthy();
      const { maxOuterBlur, maxOuterShadowAlpha, outerCount } = outerShadowMetrics(bs!);
      expect(outerCount, `${sel} outer 레이어 존재`).toBeGreaterThan(0);
      // AC-A1: outer blur 더 좁아짐.
      expect(maxOuterBlur, `${sel} outer blur ≤${OUTER_BLUR_CAP}px`).toBeLessThanOrEqual(OUTER_BLUR_CAP);
      // AC-A2: outer 그림자 alpha 더 연해짐.
      expect(maxOuterShadowAlpha, `${sel} outer 그림자 alpha ≤${OUTER_ALPHA_CAP}`).toBeLessThanOrEqual(OUTER_ALPHA_CAP);
      // AC-A3: inset(볼록) 잔존 — 평면화(볼록 완전 제거) 금지.
      expect(bs, `${sel} inset 볼록 잔존`).toContain('inset');
    }

    // .live-glass 는 inset-only(볼록 유지) → outer drop-shadow 부재가 정상(비대상·무변경).
    const lg = boxShadowOf(css, '.live-glass');
    expect(lg, '.live-glass box-shadow 선언 존재').toBeTruthy();
    expect(outerShadowMetrics(lg!).outerCount, '.live-glass 는 inset-only(outer 없음)').toBe(0);
    expect(lg, '.live-glass inset 볼록 유지').toContain('inset');

    // 노랑(#FFFDE7) 무회귀 — 세 선택자 전부.
    for (const sel of ['.live-glass', '.live-glass-board', '.idverify-glass']) {
      const bs = boxShadowOf(css, sel);
      if (bs) expect(bs.toUpperCase(), `${sel} 힐러 노랑 무유입`).not.toContain('FFFDE7');
    }
  });

  // ── 시나리오 2: 과거날짜 배너 모노톤 유지 + 추가 컴팩트 + 텍스트 온전 (요청B) ──────────────
  test('S2: 과거 날짜 배너 = 무채색(모노톤) + 추가 컴팩트(py-px/text-[11px]/w-fit) + 노랑·큰패딩 무회귀', () => {
    const BANNER_TEXT = '과거 날짜 조회 중 — 읽기 전용';
    const idx = dash.indexOf(BANNER_TEXT);
    expect(idx, '과거날짜 배너 문구 소스 존재').toBeGreaterThan(0);

    // 배너 문구 직전 window 에서 배너 컨테이너 div 의 className 리터럴 추출.
    // (마지막 매치는 내부 Clock 아이콘 className 이므로, 구조 클래스 'rounded' 를 가진 컨테이너를 선택.)
    const win = dash.slice(Math.max(0, idx - 600), idx);
    const classMatches = [...win.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    expect(classMatches.length, '배너 className 리터럴 존재').toBeGreaterThan(0);
    const containers = classMatches.filter((c) => c.includes('rounded'));
    expect(containers.length, '배너 컨테이너(rounded) className 존재').toBeGreaterThan(0);
    const cls = containers[containers.length - 1];

    // AC-B1: 모노톤 유지 — amber(컬러) 잔재 0, gray 계열 사용, 노랑(yellow) 무회귀.
    expect(cls, 'amber(컬러) 무회귀').not.toContain('amber');
    expect(cls, 'yellow(노랑) 무회귀').not.toContain('yellow');
    expect(cls, '무채색 gray 계열 유지').toContain('gray');

    // AC-B2: 추가 컴팩트 — py-px + 소형 텍스트(text-[11px]) + w-fit, 이전 큰 값 미사용.
    expect(cls, '세로 패딩 최소(py-px)').toContain('py-px');
    expect(cls, '컨텐츠 폭 축소(w-fit)').toContain('w-fit');
    expect(cls, '소형 텍스트(text-[11px])').toContain('text-[11px]');
    expect(cls, '텍스트 온전(whitespace-nowrap)').toContain('whitespace-nowrap');
    expect(cls, '큰 가로패딩(px-4) 미사용').not.toContain('px-4');
    expect(cls, '큰 세로패딩(py-2) 미사용').not.toContain('py-2');
    expect(cls, '이전 세로패딩(py-0.5) 미사용').not.toContain('py-0.5');
    expect(cls, '이전 텍스트크기(text-xs) 미사용').not.toContain('text-xs');
    expect(cls, '이전 상단마진(mt-1.5) 미사용').not.toContain('mt-1.5');

    // AC-B3: 아이콘 축소(h-2.5 w-2.5) — 배너 스코프 내 Clock 아이콘.
    const scope = dash.slice(Math.max(0, idx - 600), idx + 40);
    expect(scope, '아이콘 축소(h-2.5 w-2.5)').toContain('h-2.5 w-2.5');
  });
});
