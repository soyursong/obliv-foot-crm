import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-20260629-foot-CHART2-IDVERIFY-PASTEL-SHRINK (canonical)
 * supersedes: CHART2-RRN-IDBADGE-PASTEL-SHRINK, RRN-VERIFY-BADGE-PASTEL-SHRINK
 *
 * 2번 차트(고객정보) 주민번호 행 신분증 확인 배지 2종 — 파스텔 톤 + 절반 축소 (FE-only).
 * - 확인 필요(미입력) : 진한레드 → 파스텔 핑크/로즈 (bg-rose-100 text-rose-400 border-rose-200)
 * - 확인 완료(검증후)  : 파스텔 그린(firstvisit 컨벤션) 유지, 크기만 절반
 * 두 배지 모두 폰트/패딩/아이콘(●) 약 50% 축소. 표시 조건·텍스트·위치·전환 로직 불변.
 *
 * 런타임 렌더는 인증·시드 환경 의존이 커서, 본 spec은 소스 정합 가드로
 * className 변경이 회귀 없이 유지되는지 검증한다 (현장 클릭 시나리오 1·2 변환).
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
  'utf-8',
);

// '신분증 확인 필요' 버튼 블록 (확인 필요 상태)
function needBlock(): string {
  const anchor = '신분증 확인 필요';
  const idx = SRC.indexOf(anchor);
  expect(idx, '신분증 확인 필요 위치 확정').toBeGreaterThan(-1);
  const start = SRC.lastIndexOf('<button', idx);
  return SRC.slice(start, idx + anchor.length);
}

// '신분증 확인 완료' 배지 span 블록 (확인 완료 상태)
// title 문구('...신분증 확인 완료 처리')와 구분 위해 배지 고유 토큰 bg-firstvisit-500 기준으로 슬라이스.
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

// ── 시나리오 1: 확인 필요 배지 = 파스텔 핑크/로즈 + 절반 ──
test('AC1 확인 필요 배지 = 파스텔 로즈(bg-rose-100/text-rose-400/border-rose-200)', () => {
  const b = needBlock();
  expect(b).toContain('bg-rose-100');
  expect(b).toContain('text-rose-400');
  expect(b).toContain('border-rose-200');
});

test('AC1 진한레드 하드코딩 제거 — #FEE2E2/#B91C1C/bg-red-500 미사용', () => {
  const b = needBlock();
  expect(b).not.toContain('#FEE2E2');
  expect(b).not.toContain('#B91C1C');
  expect(b).not.toContain('bg-red-500');
});

test('AC3 확인 필요 배지 절반 사이즈 — px-1.5/py-0.5/font-medium, px-2.5·py-1·font-semibold 제거', () => {
  const b = needBlock();
  expect(b).toContain('text-xs');
  expect(b).toContain('px-1.5');
  expect(b).toContain('py-0.5');
  expect(b).not.toContain('px-2.5');
  expect(b).not.toMatch(/\bpy-1\b/);
  expect(b).not.toContain('font-semibold');
});

// ── 시나리오 2: 확인 완료 배지 = 파스텔 그린(firstvisit) + 절반 ──
test('AC2 확인 완료 배지 = 파스텔 그린(firstvisit 컨벤션) 유지', () => {
  const b = doneBlock();
  // firstvisit 파스텔 그린 토큰 유지 (진한 초록·새 팔레트 도입 아님)
  expect(b).toContain('#E7EEDA');
  expect(b).toContain('bg-firstvisit-500');
});

test('AC3 확인 완료 배지 절반 사이즈 — px-1.5/py-0.5/font-medium, px-2.5·py-1·font-semibold 제거', () => {
  const b = doneBlock();
  expect(b).toContain('px-1.5');
  expect(b).toContain('py-0.5');
  expect(b).toContain('font-medium');
  expect(b).not.toContain('px-2.5');
  expect(b).not.toMatch(/\bpy-1\b/);
  expect(b).not.toContain('font-semibold');
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
  // 상태 전환 분기(verified ? 완료 : 필요) 보존
  expect(SRC).toMatch(/verified\s*\?/);
});
