import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-20260629-foot-CHART2-RRN-IDBADGE-PASTEL-SHRINK
 * 2번차트 고객정보 탭 rrn행 '신분증 확인 필요' 뱃지 스타일 변경 (FE-only).
 * (1) 색상: 진한레드(#FEE2E2/#B91C1C) → 파스텔 bg-red-100 text-red-400 (은은).
 * (2) 사이즈: 절반 수준 — text-xs + py-0.5 + px-1.5 (폰트·패딩·높이 축소).
 * 표시/숨김 로직(rrn 미입력 조건) 불변 — className만 교체.
 *
 * 런타임 렌더는 인증·시드 환경 의존이 커서, 본 spec은 소스 정합 가드로
 * className 변경이 회귀 없이 유지되는지 검증한다.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
  'utf-8',
);

// '신분증 확인 필요' 버튼 블록만 슬라이스 (확인 완료 배지와 분리)
function idVerifyNeededButtonBlock(): string {
  const anchor = '신분증 확인 필요';
  const idx = SRC.indexOf(anchor);
  expect(idx, '신분증 확인 필요 문자열 위치 확정').toBeGreaterThan(-1);
  // 버튼 시작(<button)부터 anchor 직후까지
  const start = SRC.lastIndexOf('<button', idx);
  return SRC.slice(start, idx + anchor.length);
}

test('파스텔 색상 적용 — bg-red-100 / text-red-400 / border-red-200', () => {
  const block = idVerifyNeededButtonBlock();
  expect(block).toContain('bg-red-100');
  expect(block).toContain('text-red-400');
  expect(block).toContain('border-red-200');
});

test('진한레드 하드코딩 제거 — #FEE2E2 / #B91C1C / bg-red-500 미사용', () => {
  const block = idVerifyNeededButtonBlock();
  expect(block).not.toContain('#FEE2E2');
  expect(block).not.toContain('#B91C1C');
  expect(block).not.toContain('bg-red-500');
});

test('절반 사이즈 — text-xs / py-0.5 / px-1.5 적용, px-2.5·py-1 제거', () => {
  const block = idVerifyNeededButtonBlock();
  expect(block).toContain('text-xs');
  expect(block).toContain('py-0.5');
  expect(block).toContain('px-1.5');
  expect(block).not.toContain('px-2.5');
  expect(block).not.toMatch(/\bpy-1\b/);
  expect(block).not.toContain('font-semibold');
});

test('표시/숨김·동작 로직 불변 — onClick markIdVerified / disabled 조건 유지', () => {
  const block = idVerifyNeededButtonBlock();
  expect(block).toContain('markIdVerified()');
  expect(block).toContain('disabled={!latestCheckIn}');
});

test('확인 완료 배지(firstvisit 파스텔)는 미변경 — 회귀 가드', () => {
  // 완료 배지는 본 티켓 범위 밖. firstvisit 앵커 스타일 유지 확인.
  expect(SRC).toContain('신분증 확인 완료');
  expect(SRC).toContain('bg-firstvisit-500');
});
