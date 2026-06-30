/**
 * E2E spec — T-20260630-foot-DOCFORM-POPUP-BACKDROP-SHAKE
 *
 * 소견서·진단서 팝업(OpinionEditorDialog, @base-ui Dialog) 오픈 시 뒷화면 흔들림(layout shift) 제거.
 * 문지은 대표원장 보고("소견서/진단서 팝업 뜰 때 뒷화면이 미친듯이 흔들림").
 *
 * Root cause: @base-ui Dialog 는 modal 오픈 시 scroll-lock 으로 문서 overflow 를 hidden 처리한다.
 *   데스크탑 classic 스크롤바 환경에서 base-ui 가 무거운 preventScrollInsetScrollbars 경로(body width/
 *   height/position 재작성)를 타며 가로폭이 점프 → 뒷화면이 좌우로 흔들림.
 * Fix: html 에 `scrollbar-gutter: stable` 상시 설정 → 스크롤바 gutter 가 항상 예약되어 overflow 토글
 *   시 폭 변화 0. overlay 스크롤바(macOS·갤탭 Android)에서는 시각적 no-op → 태블릿 인셋 부작용 없음.
 *   전 모달(Dialog/Sheet) 균일 적용 = 분리 hack 아님(동일 surface 회귀 관점).
 *
 *   AC1: 팝업 오픈 시 뒷화면 흔들림(가로 점프/layout shift) 없음 — gutter 상시 예약.
 *   AC2: 팝업 자체 동작(열림/닫힘/입력/발행) 불변 — Dialog 프리미티브 로직 무변경.
 *   AC3: 팝업 닫을 때도 흔들림 없음 — gutter 가 상시 예약이므로 close 시에도 폭 불변.
 *
 * 검증은 정적 분석(로그인/데이터 비의존, 결정론). 실 layout-shift 는 브라우저 런타임 영역이나,
 * 픽스의 충분조건(gutter 상시 예약)이 전역 CSS 에 존재함을 단언한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── 시나리오 1: 전역 CSS — html 에 scrollbar-gutter: stable 상시 예약 (AC1/AC3) ──
test('시나리오1: index.css html 블록에 scrollbar-gutter: stable 존재', () => {
  const css = read('src/index.css');
  // html 블록(@layer base) 안에 gutter 예약 선언이 있음.
  const htmlBlockStart = css.indexOf('html {');
  expect(htmlBlockStart).toBeGreaterThan(-1);
  const htmlBlock = css.slice(htmlBlockStart, css.indexOf('}', htmlBlockStart));
  expect(/scrollbar-gutter:\s*stable/.test(htmlBlock)).toBe(true);
});

// ── 시나리오 2: 팝업 프리미티브 로직 무변경 — Dialog 동작 보존 (AC2) ──
test('시나리오2: OpinionEditorDialog 는 공용 Dialog(@base-ui) 그대로 사용 — 동작 분기 없음', () => {
  const tab = read('src/components/doctor/OpinionDocTab.tsx');
  // 소견서/진단서 작성 팝업은 공용 Dialog/DialogContent 사용(픽스는 CSS 전역, 팝업 코드 무변경).
  expect(tab.includes('<DialogContent')).toBe(true);
  expect(tab.includes('data-testid="opinion-dialog"')).toBe(true);

  const dialog = read('src/components/ui/dialog.tsx');
  // 프리미티브는 base-ui Dialog 그대로 — scroll-lock 우회/오버라이드 hack 미도입.
  expect(dialog.includes("from '@base-ui/react/dialog'")).toBe(true);
  // 인라인 body overflow 조작 등 평행 hack 이 dialog.tsx 에 들어가지 않았음.
  expect(dialog.includes("document.body.style")).toBe(false);
});

// ── 시나리오 3: 픽스가 전역(전 모달 균일) — 분리 추정패치 아님 ──
test('시나리오3: gutter 픽스는 html 전역 — Dialog·Sheet 등 모든 모달에 균일 적용', () => {
  const css = read('src/index.css');
  // 픽스는 특정 다이얼로그 className 스코프가 아니라 html 전역 1곳.
  const matches = css.match(/scrollbar-gutter:\s*stable/g) ?? [];
  expect(matches.length).toBe(1);
  // 티켓 주석 근거 명기(회귀 추적성).
  expect(css.includes('DOCFORM-POPUP-BACKDROP-SHAKE')).toBe(true);
});
