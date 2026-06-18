/**
 * E2E spec — T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL (P1)
 *
 * 현장(김주연 총괄): 배정화면 2건
 *  [A] 자동배정이 실제로 안 걸림 — 직원 항목은 노출되는데 배정 미실행.
 *  [B] [상담]/[치료] 탭 배정 항목 스크롤 안 됨(화면 짤림).
 *
 * ── [A] 근본원인(diag 런타임 확정) ──
 *   ASSIGN-STAFF-EMPTY-HOTFIX 와 동일 RC: fetchActiveStaff 가 staff.display_name(DB 미존재)
 *   을 select → PostgREST 400 → staff=[] → 후보풀 공집합 → pickLeastLoaded([])=null →
 *   maybeAutoAssign 가 조용히 {assigned:false} 반환(쓰기·로그 없음). 당월 auto_assign 로그 0건.
 *   ⇒ P0 hotfix(commit 12fd3766) 가 fetchActiveStaff 의 display_name 을 제거하며 이미 해소.
 *   diag simulate(post-hotfix): 오늘 미배정 5건 전부 chosen 산출(상담풀4·치료풀7) = 엔진 정상.
 *   본 spec = (1) display_name 재유입 회귀 차단 (2) 트리거 wiring 보존 (3) 공집합 진단로그 보강.
 *   "출근후보 공집합 → 미배정 유지"는 o2k7 설계상 의도된 동작(전직원 fallback 도입 금지).
 *
 * ── [B] 목록만 스크롤(헤더 sticky 고정) ──
 *   3개 카드(오늘배정/당김후보/직원누적) CardContent 컨테이너에 max-h + overflow-auto,
 *   thead sticky top-0 → 탭바·카드헤더는 고정되고 목록만 스크롤. 순수 FE CSS.
 *
 * 정본 소스 정적 단언 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 스크롤·자동배정 실호출)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const DASH = 'src/pages/Dashboard.tsx';

function staffSelects(src: string): string[] {
  const out: string[] = [];
  const re = /\.from\('staff'\)[\s\S]*?\.select\(\s*'([^']*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// [A] 자동배정 RC 회귀 가드 — display_name 재유입 차단(후보풀 공집합 사고 재발 방지)
// ─────────────────────────────────────────────────────────────────────────────
test('A-1: autoAssign.fetchActiveStaff staff select 에 display_name 미포함(400→staff[]→풀공집합 차단)', () => {
  const selects = staffSelects(read(AUTOASSIGN));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) {
    expect(sel).not.toContain('display_name');
    expect(sel).toContain('role'); // 후보풀 필터 필수
    expect(sel).toContain('name'); // 출근자 이름 매칭 필수
  }
});

test('A-2: Assignments.tsx staff select 에 display_name 미포함', () => {
  const selects = staffSelects(read(PAGE));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) expect(sel).not.toContain('display_name');
});

// ─────────────────────────────────────────────────────────────────────────────
// [A] 자동배정 트리거 wiring 보존 — Dashboard 슬롯 진입/INSERT 시 maybeAutoAssign 호출
// ─────────────────────────────────────────────────────────────────────────────
test('A-3: Dashboard 가 상담대기/치료대기 진입 시 maybeAutoAssign 호출(트리거 보존)', () => {
  const src = read(DASH);
  expect(src).toContain("import { maybeAutoAssign }");
  // 상태전이 훅(두 경로) + 셀프접수 INSERT 훅
  expect(src).toMatch(/maybeAutoAssign\(row\.id, newStatus/);
  expect(src).toMatch(/maybeAutoAssign\(ci\.id, newStatus/);
  expect(src).toMatch(/maybeAutoAssign\(newRow\.id, 'consult_waiting'/);
  expect(src).toMatch(/maybeAutoAssign\(newRow\.id, 'treatment_waiting'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// [A] 공집합 무음실패 진단로그 보강 — staff/pool 0 일 때 console.warn 으로 가시화
// ─────────────────────────────────────────────────────────────────────────────
test('A-4: maybeAutoAssign 가 chosen 없을 때(공집합) 진단 console.warn 남김', () => {
  const src = read(AUTOASSIGN);
  // !chosen 분기에서 staff/working/pool 크기를 로그
  expect(src).toMatch(/console\.warn\(\s*`\[autoAssign\] no-assign/);
  expect(src).toMatch(/staff=\$\{staff\.length\}/);
  expect(src).toMatch(/pool=\$\{pool\.length\}/);
  // 전직원 fallback(설계 위반) 도입 안 함 — 출근후보 없으면 미배정 유지
  expect(src).toContain('미배정 유지');
});

// ─────────────────────────────────────────────────────────────────────────────
// [B] 탭 항목 스크롤 — 3개 카드 컨테이너 max-h + overflow-auto, thead sticky 고정
// ─────────────────────────────────────────────────────────────────────────────
test('B-1: 배정 목록 컨테이너 3곳 모두 max-h + overflow-auto (목록만 스크롤)', () => {
  const src = read(PAGE);
  const scrollers = src.match(/max-h-\[\d+vh\]\s+overflow-auto/g) ?? [];
  // 오늘배정 + 당김후보 + 직원누적 = 3
  expect(scrollers.length).toBe(3);
  expect(src).toContain('max-h-[42vh] overflow-auto'); // 오늘 배정 현황(주 목록)
  expect((src.match(/max-h-\[32vh\] overflow-auto/g) ?? []).length).toBe(2);
});

test('B-2: thead 가 sticky top-0 + 불투명 배경(스크롤 시 헤더 고정·비침 방지)', () => {
  const src = read(PAGE);
  const stickyHeads = src.match(/<thead className="sticky top-0 z-10 border-y bg-muted /g) ?? [];
  expect(stickyHeads.length).toBe(3);
  // 반투명 bg-muted/40(비침) 잔존 금지
  expect(src).not.toContain('bg-muted/40');
});

test('B-3: 탭바/카드헤더는 스크롤 컨테이너 밖(고정 유지) — Tabs·CardHeader 보존', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-role-tabs"');
  // 탭은 max-h 컨테이너 앞에 위치(헤더 고정)
  const tabsIdx = src.indexOf('assignments-role-tabs');
  const firstScrollIdx = src.indexOf('max-h-[42vh] overflow-auto');
  expect(tabsIdx).toBeGreaterThan(0);
  expect(tabsIdx).toBeLessThan(firstScrollIdx);
});
