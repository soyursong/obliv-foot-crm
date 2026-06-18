/**
 * E2E spec — T-20260618-foot-MENUSCROLL-EXISTPATIENT-Q (P2)
 *
 * 현장(김주연 총괄): /admin/assignments [치료] 탭에서 '직원별 당월 누적' 내용이 안 보임.
 *   세로 스크롤이 없어 화면 아래로 내려갈 수 없음(새로고침 후에도 미동작).
 *
 * ── 진짜 RC(실렌더 잘림 지점 규명) ──
 *   AdminLayout page-content-area(line 576)는 overflow-hidden — 각 페이지가 자체 스크롤을 담당하는 패턴.
 *   형제 페이지(Staff.tsx:81 / Closing.tsx:1140)는 최상위 div에 `h-full overflow-auto`로 자체 스크롤 보유.
 *   그런데 Assignments.tsx 최상위 div는 `space-y-4 p-4`만 → 자체 스크롤 없음.
 *   세 카드(①오늘배정 42vh + ②당김후보 32vh + ③직원누적 32vh)에 헤더/탭/gap 합산 시 100vh 초과 →
 *   ③ '직원별 당월 누적' 카드가 fold 아래로 밀리고, 부모 overflow-hidden이 클립 → 도달 불가('현장 미체감').
 *   이전 TABSCROLL 수정은 카드 '내부 목록' 스크롤(max-h+overflow-auto)만 추가 → 페이지 레벨 스크롤은 여전히 부재였음.
 *   FIX = 최상위 div에 `h-full overflow-auto` 추가(형제 페이지 동형 패턴). 순수 FE CSS, DB/로직 무변경.
 *
 * 정본 소스 정적 단언 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 ③카드 스크롤 도달)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 페이지 레벨 자체 스크롤 — ③ '직원별 당월 누적' 도달 가능
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1/2: Assignments 최상위 컨테이너가 h-full overflow-auto (페이지 자체 세로 스크롤)', () => {
  const src = read(PAGE);
  // return 직후 최상위 div가 h-full overflow-auto 보유 (overflow-hidden 부모 안 자체 스크롤)
  expect(src).toMatch(/<div className="h-full overflow-auto space-y-4 p-4" data-testid="assignments-scroll-root">/);
});

test('AC-1/2: 최상위 컨테이너에 height 제약 없는 옛 패턴(`space-y-4 p-4`만) 잔존 금지(재발 차단)', () => {
  const src = read(PAGE);
  // 'className="space-y-4 p-4"' 단독(h-full overflow-auto 없는 형태) 잔존 시 스크롤 미동작 재발
  expect(src).not.toMatch(/className="space-y-4 p-4">/);
});

test("AC-2: ③ '직원별 당월 누적' 섹션이 페이지에 존재(스크롤로 도달 대상)", () => {
  const src = read(PAGE);
  expect(src).toContain('직원별 당월 누적');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 콘텐츠 짧을 때 불필요 스크롤바 비노출 — overflow-auto(scroll 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 페이지 스크롤이 overflow-auto (overflow-scroll/항상노출 금지)', () => {
  const src = read(PAGE);
  // 최상위 컨테이너 div 클래스 문자열 단독 추출(주석 오염 방지)
  const m = src.match(/<div className="(h-full overflow-auto space-y-4 p-4)" data-testid="assignments-scroll-root">/);
  expect(m).not.toBeNull();
  const cls = m![1];
  expect(cls).toContain('overflow-auto');
  expect(cls).not.toContain('overflow-scroll');
  expect(cls).not.toContain('overflow-y-scroll');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 다른 탭/패널 레이아웃 회귀 없음 — 카드 내부 목록 스크롤 3곳 보존
//   (이전 TABSCROLL 자산 유지 — 페이지 스크롤 추가가 카드 sticky 헤더 스크롤을 깨지 않음)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 카드 내부 목록 스크롤 3곳(max-h+overflow-auto) 보존(TABSCROLL 회귀 없음)', () => {
  const src = read(PAGE);
  const inner = src.match(/max-h-\[\d+vh\]\s+overflow-auto/g) ?? [];
  expect(inner.length).toBe(3);
  expect(src).toContain('max-h-[42vh] overflow-auto');
  expect((src.match(/max-h-\[32vh\] overflow-auto/g) ?? []).length).toBe(2);
});

test('AC-4: 상담/치료 탭 분리(activeTab) 보존 — 레이아웃 회귀 없음', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-role-tabs"');
  expect(src).toContain('data-testid="assignments-tab-consult"');
  expect(src).toContain('data-testid="assignments-tab-therapy"');
});
