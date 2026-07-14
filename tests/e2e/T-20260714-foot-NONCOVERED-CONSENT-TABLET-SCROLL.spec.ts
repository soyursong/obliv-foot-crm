/**
 * T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL
 * 비급여동의서 서명 화면 — 태블릿 스크롤 불가 → 하단 내용·서명버튼 미노출 픽스
 *
 * planner NEW-TASK (MSG-20260714-111411-1qwc): CSS 한정, DB변경0, risk=GO.
 *   증상: 동의서 목록 → "비급여동의서" 클릭 → 서명 뷰에서 태블릿 스크롤 불가.
 *         PC 정상 / 태블릿(iPad 768×1024) 재현. 하단 내용·[서명 완료] 버튼 미노출.
 *   RC  : ConsentFormDialog 의 DialogContent 가 `-translate-y-1/2` 중앙정렬 fixed 팝업에
 *         `max-h-[90vh] overflow-y-auto` (팝업 전체 단일 스크롤)를 사용.
 *         태블릿 브라우저 크롬 포함 vh 과대계산 → 90vh 박스가 가시 뷰포트를 초과 →
 *         푸터([서명 완료])가 화면 밖으로 밀려 접근 불가. PC 는 vh==가시영역이라 정상.
 *   FIX : (1) 90vh → 90dvh (동적 뷰포트 = 가시영역, 데스크톱에선 dvh==vh → PC 회귀 0)
 *         (2) flex 컬럼 구조 — 헤더/푸터 shrink-0, 본문만 flex-1 min-h-0 overflow-y-auto.
 *              → 본문이 아무리 길어도 [서명 완료] 푸터는 박스 하단에 항상 고정 노출.
 *
 * 시나리오 (티켓 본문 현장 클릭 시나리오 2종):
 *   S1 (태블릿 정상 동선, 768×1024): 긴 동의문에서 본문 스크롤 가능 + [서명 완료] 항상 노출.
 *   S2 (PC 회귀, 1280×800): 동일 구조에서 레이아웃/푸터 이상 없음(회귀 0).
 *   + 대조 가드: 구(旧) 단일 스크롤 구조는 초기 렌더에서 푸터가 폴드 아래로 밀림(픽스 당위).
 *   + 소스 정적 가드: ConsentFormDialog.tsx 가 dvh + flex 컬럼 + shrink-0 푸터 채택, 旧 90vh 제거.
 *
 * ※ page.setContent 실 DOM 측정(auth/server/로그인 불요) → unit 프로젝트 편입(skip 0).
 *   운영 번들 + 갤탭 실기기 field-soak 은 supervisor 별도 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/components/ConsentFormDialog.tsx',
);
const src = readFileSync(__srcPath, 'utf-8');

// ConsentFormDialog 함수 본문(return 렌더 트리) 슬라이스
function dialogRenderBlock(): string {
  const start = src.indexOf('export function ConsentFormDialog(');
  const end = src.indexOf('// ── ConsentFormButtons', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── 수정안(fixed) 구조: flex 컬럼 + dvh + shrink-0 푸터 ─────────────────────────
// 본문만 스크롤, 헤더/푸터 고정. 실제 배포 구조를 그대로 미러.
const FIXED_HTML = `
  <!doctype html><html><head><style>
    *{box-sizing:border-box;margin:0;padding:0} body{font:14px sans-serif}
    .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5)}
    /* DialogContent = max-w-lg max-h-[90dvh] p-0 flex flex-col overflow-hidden (중앙정렬) */
    .popup{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
           width:100%;max-width:32rem;max-height:90dvh;
           display:flex;flex-direction:column;overflow:hidden;background:#fff;border-radius:.75rem}
    .hd{flex-shrink:0;padding:1rem 1rem 0}          /* DialogHeader shrink-0 */
    .body{flex:1 1 0%;min-height:0;overflow-y:auto;padding:.5rem 1rem}  /* 본문만 스크롤 */
    .ft{flex-shrink:0;border-top:1px solid #eee;padding:.75rem 1rem;display:flex;justify-content:flex-end;gap:.5rem}
    .content{height:1800px}                          /* 아주 긴 동의문 + 서명 캔버스 모사 */
    button{height:2.75rem;padding:0 1rem}
  </style></head><body>
    <div class="backdrop"></div>
    <div class="popup" id="popup">
      <div class="hd" id="hd">비급여 진료비 확인 동의서</div>
      <div class="body" id="body"><div class="content"></div></div>
      <div class="ft" id="ft">
        <button id="cancel">취소</button>
        <button id="sign">서명 완료</button>
      </div>
    </div>
  </body></html>`;

// ── 구(旧) 구조: 팝업 전체 단일 스크롤(90vh), 푸터가 스크롤 흐름 안 ─────────────
const OLD_HTML = `
  <!doctype html><html><head><style>
    *{box-sizing:border-box;margin:0;padding:0} body{font:14px sans-serif}
    .popup{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
           width:100%;max-width:32rem;max-height:90vh;overflow-y:auto;background:#fff;padding:1rem}
    .content{height:1800px}
    .ft{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.75rem}
    button{height:2.75rem;padding:0 1rem}
  </style></head><body>
    <div class="popup" id="popup">
      <div id="hd">비급여 진료비 확인 동의서</div>
      <div class="content"></div>
      <div class="ft" id="ft"><button id="cancel">취소</button><button id="sign">서명 완료</button></div>
    </div>
  </body></html>`;

// 뷰포트 안에 요소가 실제로 보이는가(클리핑 없이) — bbox 존재 + 뷰포트 세로 범위 내
async function footerFullyInViewport(page: import('@playwright/test').Page, vh: number) {
  const box = await page.locator('#sign').boundingBox();
  expect(box, '[서명 완료] 버튼 bounding box 존재(=렌더/클리핑 없음)').not.toBeNull();
  expect(box!.height).toBeGreaterThan(0);
  return box!.y >= 0 && box!.y + box!.height <= vh + 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 태블릿 정상 동선 (iPad 768×1024)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 태블릿(768×1024) 정상 동선', () => {
  test('AC-1: 긴 동의문에서 본문 스크롤 가능', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(FIXED_HTML);

    const canScroll = await page.evaluate(() => {
      const b = document.getElementById('body')!;
      return { overflow: b.scrollHeight - b.clientHeight, before: b.scrollTop };
    });
    // 본문이 스크롤 가능한 오버플로를 실제로 가짐
    expect(canScroll.overflow).toBeGreaterThan(0);

    // 본문 위에서 휠 → 끝까지 스크롤 이동됨(하단 내용 도달)
    await page.mouse.move(384, 500);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
    const after = await page.evaluate(() => document.getElementById('body')!.scrollTop);
    expect(after).toBeGreaterThan(0);
  });

  test('AC-2: [서명 완료] 버튼이 내용 아래 고정 위치로 항상 노출·클릭 가능', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(FIXED_HTML);

    // 초기(스크롤 전)에도 푸터가 가시 뷰포트 안에 완전히 노출
    expect(await footerFullyInViewport(page, 1024), '초기 렌더 시 [서명 완료] 뷰포트 내 노출').toBeTruthy();

    // 본문을 끝까지 스크롤해도 푸터(shrink-0)는 그대로 하단 고정 노출
    await page.mouse.move(384, 500);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
    expect(await footerFullyInViewport(page, 1024), '스크롤 후에도 [서명 완료] 고정 노출').toBeTruthy();

    // 실제 클릭 가능(가려짐 없음)
    await expect(page.locator('#sign')).toBeVisible();
    await page.locator('#sign').click();
  });

  test('대조: 구(旧) 단일-스크롤(90vh) 구조는 초기 렌더에서 푸터가 폴드 아래로 밀림(픽스 당위)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.setContent(OLD_HTML);
    // 1800px 내용이 스크롤 흐름에 포함 → 초기 스크롤 위치(0)에서 [서명 완료]는 뷰포트 밖(하단)
    const inView = await footerFullyInViewport(page, 1024);
    expect(inView, '旧 구조: 초기 렌더 시 [서명 완료]가 뷰포트 밖 → 미노출 재현').toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — PC 회귀 (1280×800) : 회귀 0
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 PC(1280×800) 회귀 0', () => {
  test('AC-3: 동일 구조에서 [서명 완료] 정상 노출 + 본문 렌더 이상 없음', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(FIXED_HTML);

    // 헤더·본문·푸터 모두 렌더 + 푸터 뷰포트 내 노출
    await expect(page.locator('#hd')).toBeVisible();
    await expect(page.locator('#body')).toBeVisible();
    expect(await footerFullyInViewport(page, 800), 'PC: [서명 완료] 뷰포트 내 정상 노출').toBeTruthy();

    // 본문 스크롤도 정상 동작(회귀 없이 유지)
    await page.mouse.move(640, 400);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
    const after = await page.evaluate(() => document.getElementById('body')!.scrollTop);
    expect(after).toBeGreaterThan(0);
    // 스크롤 후에도 푸터 고정 노출(데스크톱 dvh==vh → 위치 불변)
    expect(await footerFullyInViewport(page, 800)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 정적 가드 — 실제 배포 컴포넌트가 dvh + flex 컬럼 + shrink-0 푸터 채택
// ─────────────────────────────────────────────────────────────────────────────
test.describe('소스 정적 가드 (ConsentFormDialog.tsx)', () => {
  test('DialogContent = max-h-[90dvh] + flex flex-col (旧 90vh 단일 스크롤 제거)', () => {
    const block = dialogRenderBlock();
    // 픽스: dvh 채택 + flex 컬럼
    expect(block).toContain('max-h-[90dvh]');
    expect(block).toContain('flex flex-col');
    // 회귀 가드: 서명 다이얼로그 렌더에 旧 90vh / 팝업 전체 overflow-y-auto 잔존 금지
    expect(block).not.toContain('max-h-[90vh]');
    expect(block).not.toContain('max-w-lg max-h-[90vh] overflow-y-auto');
  });

  test('본문만 스크롤(flex-1 min-h-0 overflow-y-auto) + 헤더/푸터 shrink-0 고정', () => {
    const block = dialogRenderBlock();
    // 본문 스크롤 영역
    expect(block).toContain('flex-1 min-h-0 overflow-y-auto');
    // 헤더·푸터 shrink-0 (스크롤 흐름 밖 고정)
    expect(block).toContain('shrink-0');
    // DialogFooter 가 shrink-0 + border-t 로 하단 고정
    const ftIdx = block.indexOf('<DialogFooter');
    expect(ftIdx).toBeGreaterThan(-1);
    const ftTag = block.slice(ftIdx, block.indexOf('>', ftIdx));
    expect(ftTag).toContain('shrink-0');
  });

  test('티켓 마커 주석 존재(추적성)', () => {
    expect(src).toContain('T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL');
  });
});
