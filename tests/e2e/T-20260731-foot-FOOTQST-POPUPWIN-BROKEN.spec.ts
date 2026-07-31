/**
 * E2E spec — T-20260731-foot-FOOTQST-POPUPWIN-BROKEN
 * 발건강 질문지 [별도창] 버튼 클릭 시 별도창(팝업/새 탭)이 안 열리는 버그 회귀 가드.
 *
 * 현장 리포트(김주연 총괄, C0ATE5P6JTH thread 1785470002.958289 / 재현 스샷 20260731_131240.png):
 *   "발건강 질문지 별도창 보기 버튼 눌러도 별도창이 안 열림 → 현장 사용 불가."
 *
 * ── 근본원인 ──
 *   openHealthQDocumentWindow() 가 window.open('', '_blank', 'width=900,height=1000,noopener')
 *   로 호출됐다. HTML 사양상 features 문자열에 'noopener' 가 있으면 window.open() 은 *항상 null*
 *   을 반환한다. → 반환 핸들(win)이 언제나 null → document.write 로 문서를 쓰는 정상 경로가 죽고
 *   blob fallback 만 타게 되어, 갤탭 브라우저에서 빈화면/차단으로 "별도창이 안 열림" 관측.
 *
 * ── 수정 ──
 *   features 에서 'noopener' 제거 → 반환된 win 핸들에 직접 document.write.
 *   핸들 확보 실패(진짜 팝업차단) 시에만 blob URL + anchor-click fallback.
 *
 * 이 스펙은 (1) 실제 소스가 features 에 'noopener' 를 다시 넣지 못하게 소스 레벨로 가드하고,
 *   (2) 오픈 제어흐름(정상/팝업차단)을 순수 미러로 결정론적으로 검증한다(sibling FOOTQ-VIEWER 관례).
 *
 * AC-1: [별도창] 클릭 → 별도창 정상 오픈(document.write 경로 실행, 빈화면/404 아님).
 * AC-2: 팝업차단 환경(핸들 null)에서도 blob fallback 으로 오픈.
 * AC-3: features 문자열에 'noopener' 재유입 금지(정확히 이 버그의 회귀 가드).
 * AC-4: 저장/조회 로직 무변경 — read-only(문서 write 만, 제출 데이터 변형 경로 없음).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../../src/lib/healthQDocument.ts'), 'utf-8');

// ── 오픈 제어흐름 미러 (src/lib/healthQDocument.ts openHealthQDocumentWindow 와 1:1) ──
// 실제 함수는 브라우저 전용 의존을 체인으로 끌어와 node import 불가 → 제어흐름을 순수 미러링.
interface FakeWin {
  document: { open: () => void; write: (h: string) => void; close: () => void } | null;
  _written: string[];
  _opened: boolean;
  _close: boolean;
}
function makeWin(): FakeWin {
  const w: FakeWin = {
    _written: [], _opened: false, _close: false,
    document: {
      open: () => { w._opened = true; },
      write: (h: string) => { w._written.push(h); },
      close: () => { w._close = true; },
    },
  };
  return w;
}

interface OpenTrace { primaryDocWrite: boolean; blobFallback: boolean; anchorFallback: boolean; wroteHtml: boolean; }

/**
 * openHealthQDocumentWindow 제어흐름 미러.
 * @param openImpl (url, features) => win|null  — window.open 대역
 * @param secondOpenReturnsNull  blob fallback 의 두번째 window.open 이 null(완전차단) 반환하는지
 */
function runOpenFlow(
  html: string,
  openImpl: (url: string, target: string, features?: string) => FakeWin | null,
  secondOpenReturnsNull = false,
): OpenTrace {
  const trace: OpenTrace = { primaryDocWrite: false, blobFallback: false, anchorFallback: false, wroteHtml: false };
  const win = openImpl('', '_blank', 'width=900,height=1000');
  if (win && win.document) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    trace.primaryDocWrite = true;
    trace.wroteHtml = win._written.includes(html);
    return trace;
  }
  // fallback — blob URL
  trace.blobFallback = true;
  const tab = secondOpenReturnsNull ? null : openImpl('blob:fake', '_blank');
  if (!tab) trace.anchorFallback = true;
  return trace;
}

test.describe('T-20260731-foot-FOOTQST-POPUPWIN-BROKEN — 별도창 오픈 회귀 가드', () => {
  // AC-3(★근본원인 회귀 가드): 실제 소스 features 문자열에 'noopener' 재유입 금지.
  test('AC-3 window.open features 에 noopener 없음 (별도창 null-반환 버그 회귀 방지)', () => {
    // openHealthQDocumentWindow 내부의 window.open('', '_blank', ...) 호출을 정확히 매치
    const m = SRC.match(/window\.open\(\s*''\s*,\s*'_blank'\s*,\s*'([^']*)'\s*\)/);
    expect(m, "window.open('', '_blank', '<features>') 호출을 찾지 못함").not.toBeNull();
    const features = m![1];
    expect(features, `features='${features}' 에 noopener 재유입`).not.toContain('noopener');
    // 폭넓게: 파일 어디에도 features 인자로서의 noopener 가 없어야 함
    expect(SRC).not.toMatch(/window\.open\([^)]*noopener[^)]*\)/);
  });

  // AC-1: 정상 환경 → 핸들 확보 → document.write 정상 경로 실행(별도창 렌더).
  test('AC-1 별도창 정상 오픈 — document.write 경로 실행 + HTML 기록', () => {
    const html = '<!DOCTYPE html><html><body>발건강질문지</body></html>';
    const opened: FakeWin[] = [];
    const trace = runOpenFlow(html, () => { const w = makeWin(); opened.push(w); return w; });
    expect(trace.primaryDocWrite).toBe(true);   // 정상 경로
    expect(trace.blobFallback).toBe(false);      // fallback 안 탐
    expect(trace.wroteHtml).toBe(true);          // 빈화면 아님 — 문서 write 됨
    expect(opened[0]._opened && opened[0]._close).toBe(true);
  });

  // AC-2: 팝업차단(핸들 null) → blob fallback 으로 오픈.
  test('AC-2 팝업차단(핸들 null) → blob fallback 오픈', () => {
    const html = '<html><body>x</body></html>';
    let call = 0;
    const trace = runOpenFlow(html, () => {
      call += 1;
      return call === 1 ? null : makeWin(); // 첫 open null(차단) → 두번째(blob) 성공
    });
    expect(trace.primaryDocWrite).toBe(false);
    expect(trace.blobFallback).toBe(true);
    expect(trace.anchorFallback).toBe(false); // 두번째 open 성공 → anchor 최후fallback 불필요
  });

  // AC-2(강화): 두번째 open 도 null(완전차단) → anchor-click 최후 fallback.
  test('AC-2b 완전차단 → anchor-click 최후 fallback', () => {
    const html = '<html><body>x</body></html>';
    const trace = runOpenFlow(html, () => null, /*secondOpenReturnsNull*/ true);
    expect(trace.blobFallback).toBe(true);
    expect(trace.anchorFallback).toBe(true);
  });

  // AC-4: read-only — 소스에 제출 데이터 변형(supabase write) 경로 없음.
  test('AC-4 read-only — 문서 오픈 함수에 DB write 경로 없음', () => {
    // openHealthQDocumentWindow 는 문서 HTML 을 write 할 뿐 supabase insert/update/delete 안 함.
    const fn = SRC.slice(SRC.indexOf('export function openHealthQDocumentWindow'));
    expect(fn).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(fn).not.toMatch(/supabase/);
  });
});
