/**
 * E2E spec — T-20260618-foot-AUTOASSIGN-RUN-FAIL-TABSCROLL (P1)
 *
 * 현장(김주연 총괄): 배정화면 2건
 *  [A] 자동배정이 실제로 안 걸림 — 직원 항목은 노출되는데 배정 미실행.
 *  [B] [상담]/[치료] 탭 배정 항목 스크롤 안 됨(화면 짤림).
 *
 * ── [A] 근본원인(REOPEN 런타임 재규명) ──
 *   (1차 진단 RC=display_name 400 은 hotfix 12fd3766 로 해소됐으나 현장 재현 실패 → 재진단)
 *   진짜 RC(repro 런타임 확정): 신규 balanced 자동배정 엔진(maybeAutoAssign, T-20260617)이
 *   Dashboard 슬롯 이동/상태변경 핸들러·셀프접수 Realtime echo 에만 wiring 돼 있고,
 *   실제 환자가 대기슬롯으로 진입하는 **체크인 생성 경로 2곳**에는 미연결이었음:
 *     - Dashboard.doCheckInForReservation (예약→체크인 직행): treatment_waiting/consult_waiting INSERT 후 maybeAutoAssign 미호출.
 *     - NewCheckInDialog.proceedCheckIn (수동 새 체크인): 레거시 assign_consultant_atomic/assigned_staff_id 만 → 치료사 자동배정 누락.
 *   ⇒ 예약/수동 체크인으로 들어온 신규 건이 미배정 유지. (당월 auto_assign 로그 0건 = 라이브 전이가 엔진을 한 번도 통과 못함.)
 *   repro 검증: 출근 풀 비어있지 않음(상담4·치료7) → pool 문제 아님 / 오늘 미배정 6건은 transition 없이 직접 INSERT 된 seed(별개).
 *   FIX = 두 생성 경로에 maybeAutoAssign 직접 호출 추가(best-effort·멱등, DB 무변경).
 *   본 spec = (1) display_name 재유입 회귀 차단 (2) 트리거 wiring 보존(슬롯+생성경로) (3) 공집합 진단로그 보강.
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
const NEWDIALOG = 'src/components/NewCheckInDialog.tsx';

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
// [A] REOPEN RC 회귀 가드 — 체크인 생성 경로 2곳이 대기슬롯 직행 시 maybeAutoAssign 호출
//   (1차 RC=display_name 해소 후에도 미배정 → 진짜 RC=생성경로 미wiring. 재발 차단.)
// ─────────────────────────────────────────────────────────────────────────────
test('A-5a: Dashboard.doCheckInForReservation 가 대기슬롯 직행 시 maybeAutoAssign 호출', () => {
  const src = read(DASH);
  // 예약→체크인 직행 핸들러 컨텍스트(nextStatus)에서 자동배정 트리거
  expect(src).toMatch(/maybeAutoAssign\(realId, nextStatus/);
});

test('A-5b: NewCheckInDialog.proceedCheckIn 가 balanced 엔진(maybeAutoAssign) 연결', () => {
  const src = read(NEWDIALOG);
  expect(src).toContain("import { maybeAutoAssign }");
  // 생성 직후 inserted id 로 대기슬롯(consult/treatment)일 때 호출
  expect(src).toMatch(/maybeAutoAssign\(insertedRow\.id, newStatus/);
  // id 회수를 위해 insert 가 .select('id').single() 로 바뀌었는지(미회수 시 호출 불가)
  expect(src).toMatch(/\.select\('id'\)\s*\.single\(\)/);
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
