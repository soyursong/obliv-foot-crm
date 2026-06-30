import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-20260629-foot-RRN-VERIFY-BADGE-PASTEL-SHRINK (P2)
 *
 * /chart/{id} → 고객정보 탭 → 주민번호(rrn) 행 '신분증 확인 필요' 배지 추가 톤다운.
 * 선행 CHART2-IDVERIFY-PASTEL-SHRINK가 로즈 파스텔+절반 사이즈로 만들어둔 뒤,
 * 현장 재요청으로 색을 한 단계 더 저채도(로즈→파스텔 핑크)로 톤다운.
 *
 * 변경 경계(불가침):
 *  - 배지 노출 조건/로직 미접촉 (신분증 미확인 시 노출 현행 유지)
 *  - 주민번호 마스킹·RLS·저장/편집 로직 일절 미접촉 (스타일 클래스만)
 *  - 배지 텍스트 문구 유지
 *
 * 런타임 렌더는 인증·시드 의존이 커서, 본 spec은 소스 정합 가드로
 * 클래스 교체가 회귀 없이 유지되는지 검증한다 (현장 시나리오 2종 변환).
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

// ── 시나리오 1: 신분증 미확인 고객 차트를 열면 파스텔 핑크 색이 보인다 ──
// supersedes_visual(T-20260701-foot-CHART2-IDVERIFY-DOT-ONLY): 박스 파스텔 핑크 배경 →
//   무채색 glass/silver 박스 + 왼쪽 dot만 파스텔 핑크로 재정의. 색은 dot(bg-pink-300)에 계승.
test('S1 확인 필요 배지 파스텔 핑크 색 계승 — dot(bg-pink-300)으로 이동(DOT-ONLY 재정의)', () => {
  const b = needBlock();
  // 박스 full-background 파스텔 핑크는 DOT-ONLY 로 제거됨
  expect(b).not.toContain('bg-pink-100');
  expect(b).not.toContain('text-pink-400');
  // 색은 왼쪽 dot에 계승
  const block = SRC.slice(SRC.indexOf('신분증 확인 필요') - 800, SRC.indexOf('신분증 확인 필요'));
  expect(block).toContain('bg-pink-300');
});

test('S1 이전 로즈/진한레드 톤 잔존 없음 — rose-*·#FEE2E2·#B91C1C·bg-red-500 미사용', () => {
  const b = needBlock();
  expect(b).not.toContain('bg-rose-100');
  expect(b).not.toContain('text-rose-400');
  expect(b).not.toContain('border-rose-200');
  expect(b).not.toContain('#FEE2E2');
  expect(b).not.toContain('#B91C1C');
  expect(b).not.toContain('bg-red-500');
});

// ── 시나리오 2: 배지가 입력 필드 옆에서 절반 크기(저밀도)로 자리 잡는다 ──
test('S2 절반 사이즈 유지 — text-xs/px-1.5/py-0.5/font-medium, 큰 패딩·세미볼드 제거', () => {
  const b = needBlock();
  expect(b).toContain('text-xs');
  expect(b).toContain('px-1.5');
  expect(b).toContain('py-0.5');
  expect(b).toContain('font-medium');
  expect(b).not.toContain('px-2.5');
  expect(b).not.toMatch(/\bpy-1\b/);
  expect(b).not.toContain('font-semibold');
});

// ── 보존 경계(불가침) 회귀 가드 ──
test('GUARD 노출 조건/전환 로직 불변 — verified 분기·markIdVerified·disabled 조건', () => {
  const b = needBlock();
  expect(b).toContain('markIdVerified()');
  expect(b).toContain('disabled={!latestCheckIn}');
  expect(SRC).toMatch(/verified\s*\?/);
});

test('GUARD 배지 텍스트 문구 유지', () => {
  expect(SRC).toContain('신분증 확인 필요');
});
