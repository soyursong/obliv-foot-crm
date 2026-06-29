/**
 * E2E spec — T-20260629-foot-ASSIGNMONTHLY-SCROLL-REMOVE (P2/UX)
 *
 * 현장: 상담·치료사 배정 > 치료사 탭 > '직원별 당월 누적' 카드 테이블이
 *   작은 스크롤 영역(max-h-[32vh] overflow-auto)에 갇혀 답답.
 * FIX: 해당 카드(data-testid="assignments-monthly-card") 의 스크롤/높이 제한 제거 →
 *   직원 수만큼 전체 펼침. 스크롤 컨테이너가 사라지므로 thead 의 sticky top-0 z-10 도 정리.
 *
 * 비범위(회귀 가드 포함): 데이터/집계/컬럼 무변경, 다른 탭·카드 스크롤 보존,
 *   페이지네이션/가상스크롤 미도입.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 전체 펼침)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

/** '직원별 당월 누적' 카드(monthly-card) 블록만 잘라낸다 — 다른 카드 오염 방지. */
function monthlyCardBlock(src: string): string {
  const start = src.indexOf('data-testid="assignments-monthly-card"');
  expect(start).toBeGreaterThan(0);
  // 카드 닫힘까지 넉넉히(다음 </Card> 까지) — 단언 대상은 CardContent 내부뿐이라 충분.
  const end = src.indexOf('</Card>', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test('M-1: monthly-card 내부에 max-h-[*vh] overflow-auto 스크롤 컨테이너가 없다(전체 펼침)', () => {
  const block = monthlyCardBlock(read(PAGE));
  expect(block).not.toMatch(/max-h-\[\d+vh\]/);
  expect(block).not.toContain('overflow-auto');
});

test('M-2: monthly-card 의 thead 가 sticky 가 아니다(스크롤 컨테이너 정리에 맞춰 sticky 제거)', () => {
  const block = monthlyCardBlock(read(PAGE));
  // 카드 안의 thead 가 sticky top-0 z-10 을 더 이상 들고 있지 않음.
  expect(block).not.toMatch(/<thead className="sticky top-0 z-10/);
  // 헤더 배경/구분선 스타일은 보존(가독성) — border-y bg-muted 유지.
  expect(block).toMatch(/<thead className="border-y bg-muted/);
});

test('M-3: 비범위 보존 — 당월 누적 컬럼/집계(배정·재진·토스·당김) 6열 헤더 그대로', () => {
  const block = monthlyCardBlock(read(PAGE));
  for (const col of ['직원', '역할', '배정(균등)', '재진', '토스', '당김']) {
    expect(block).toContain(col);
  }
});

test('M-4: 다른 카드 스크롤 보존 — 페이지 전체에 max-h overflow-auto 스크롤러가 남아있음(확산/전체제거 아님)', () => {
  const src = read(PAGE);
  const scrollers = src.match(/max-h-\[\d+vh\]\s+overflow-auto/g) ?? [];
  // monthly 만 제거 — 오늘배정/당김후보 등 다른 카드 스크롤러는 유지.
  expect(scrollers.length).toBeGreaterThanOrEqual(2);
});

test('M-5: 비범위 보존 — 페이지네이션/가상스크롤 미도입', () => {
  const src = read(PAGE);
  expect(src).not.toMatch(/react-window|react-virtual|Pagination|usePagination/);
});
