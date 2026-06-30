import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY
 * supersedes_visual: T-20260629-foot-CHART2-IDVERIFY-PASTEL-SHRINK (배경 파스텔 → dot-only 재정의)
 *
 * 2번 차트(고객정보) 주민번호 행 신분증 확인 배지 2종 —
 *   박스 full-background 색(파스텔 핑크/그린) 제거 → 무채색 glass/silver 박스(.idverify-glass +
 *   연한 실버 border #C7CDD4 + 중립 텍스트) + 색팔레트는 왼쪽 dot에만 계승.
 *   - 확인 필요(미입력) : dot = 파스텔 핑크(bg-pink-300, animate-pulse). 박스 핑크 배경 제거.
 *   - 확인 완료(검증후) : dot = 파스텔 그린(bg-firstvisit-500). 박스 그린 배경 제거.
 * 표시 조건·텍스트·위치·dot 색 불변. 시각 처리(배경→dot)만 재정의. 참고 시안 IMG_8730.
 *
 * 런타임 렌더는 인증·시드 환경 의존이 커서, 본 spec은 소스 정합 가드로
 * className 변경이 회귀 없이 유지되는지 검증한다 (현장 클릭 시나리오 1·2 변환).
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
  'utf-8',
);
const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');

// '신분증 확인 필요' 버튼 블록 (확인 필요 상태)
function needBlock(): string {
  const anchor = '신분증 확인 필요';
  const idx = SRC.indexOf(anchor);
  expect(idx, '신분증 확인 필요 위치 확정').toBeGreaterThan(-1);
  const start = SRC.lastIndexOf('<button', idx);
  return SRC.slice(start, idx + anchor.length);
}

// '신분증 확인 완료' 배지 span 블록 (확인 완료 상태)
// dot 토큰 bg-firstvisit-500 기준으로 외곽 span을 슬라이스.
function doneBlock(): string {
  const marker = 'bg-firstvisit-500';
  const m = SRC.indexOf(marker);
  expect(m, 'bg-firstvisit-500(완료 배지 dot) 위치 확정').toBeGreaterThan(-1);
  const innerSpan = SRC.lastIndexOf('<span', m); // dot span
  const outerSpan = SRC.lastIndexOf('<span', innerSpan - 1); // 배지 외곽 span
  const text = '신분증 확인 완료';
  const textIdx = SRC.indexOf(text, m);
  return SRC.slice(outerSpan, textIdx + text.length);
}

// ── 시나리오 1: 확인 필요 = 무채색 glass 박스 + 핑크 dot ──
test('AC1 확인 필요 박스 = glass/silver 무채색 (.idverify-glass + border #C7CDD4 + 중립 텍스트)', () => {
  const b = needBlock();
  expect(b).toContain('idverify-glass');
  expect(b).toContain('border-[#C7CDD4]');
  expect(b).toContain('text-gray-700');
});

test('AC1 dot 색 계승 — 왼쪽 dot만 파스텔 핑크(bg-pink-300, animate-pulse)', () => {
  const b = needBlock();
  expect(b).toContain('bg-pink-300');
  expect(b).toContain('animate-pulse');
});

test('AC3 확인 필요 박스 full-background 색 제거 — bg-pink-100/text-pink-400/border-pink-200 미사용', () => {
  const b = needBlock();
  expect(b).not.toContain('bg-pink-100');
  expect(b).not.toContain('text-pink-400');
  expect(b).not.toContain('border-pink-200');
});

// ── 시나리오 2: 확인 완료 = 무채색 glass 박스 + 그린 dot ──
test('AC2 확인 완료 박스 = glass/silver 무채색 (.idverify-glass + border #C7CDD4 + 중립 텍스트)', () => {
  const b = doneBlock();
  expect(b).toContain('idverify-glass');
  expect(b).toContain('border-[#C7CDD4]');
  expect(b).toContain('text-gray-700');
});

test('AC2 dot 색 계승 — 왼쪽 dot만 파스텔 그린(bg-firstvisit-500)', () => {
  const b = doneBlock();
  expect(b).toContain('bg-firstvisit-500');
});

test('AC3 확인 완료 박스 full-background 색 제거 — #E7EEDA/#566A3D/#D7E0C4 인라인 배경 제거', () => {
  const b = doneBlock();
  expect(b).not.toContain('#E7EEDA'); // 박스 배경
  expect(b).not.toContain('#566A3D'); // 박스 텍스트색
  expect(b).not.toContain('backgroundColor');
});

// ── AC3: .idverify-glass 클래스 정의 + 무채색(실버/유리) ──
test('AC3 .idverify-glass 클래스 정의 — backdrop-filter blur + box-shadow(볼록감)', () => {
  expect(CSS).toContain('.idverify-glass');
  const start = CSS.indexOf('.idverify-glass');
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1);
  expect(block).toContain('backdrop-filter');
  expect(block).toContain('box-shadow');
});

test('AC3 .idverify-glass 무채색 — 핑크/그린 색조 미포함(rgba 실버 계열만)', () => {
  const start = CSS.indexOf('.idverify-glass');
  const block = CSS.slice(start, CSS.indexOf('}', start) + 1);
  // 무채색 가드: 파스텔 핑크/그린 hex 미사용
  expect(block).not.toContain('#E7EEDA');
  expect(block).not.toContain('pink');
  expect(block).not.toContain('firstvisit');
});

// ── AC4·AC5: 텍스트·전환 로직·위치 불변 (회귀 가드) ──
test('AC4 두 배지 텍스트 그대로 유지', () => {
  expect(SRC).toContain('신분증 확인 필요');
  expect(SRC).toContain('신분증 확인 완료');
});

test('AC5 표시/전환 로직 불변 — verified 분기 + markIdVerified + disabled 조건', () => {
  const b = needBlock();
  expect(b).toContain('markIdVerified()');
  expect(b).toContain('disabled={!latestCheckIn}');
  expect(SRC).toMatch(/verified\s*\?/);
});
