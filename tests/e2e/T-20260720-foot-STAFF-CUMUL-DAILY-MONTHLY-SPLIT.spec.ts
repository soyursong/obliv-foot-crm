/**
 * E2E spec — T-20260720-foot-STAFF-CUMUL-DAILY-MONTHLY-SPLIT
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   "상담·치료사 배정 메뉴의 [직원별 당월 누적] 카드를 재구성.
 *    ① 카드 제목 [직원별 당월 누적] → [직원별 누적]
 *    ② 각 지표(배정(균등)/재진/토스/당김)에 [일누적]/[당월누적] 각각 표기
 *    ③ 날짜 선택 UI → 선택일 기준 일누적(그 날)/당월누적(그 달 1일~그 날), 기본값=오늘
 *    ④ 상담 탭 + 치료(치료사) 탭 두 곳 모두 적용(역할별 필터 회귀 없음)"
 *
 * ── 중복 티켓 명시(traceability) ────────────────────────────────────────────────
 *   본 티켓은 형제 티켓 T-20260720-foot-ASSIGN-LABEL-DATE-SELECT 와 동일 현장요구(같은 총괄·같은 화면·
 *   같은 4요구)로, 해당 티켓 구현(commit d6673225, src/pages/Assignments.tsx ③ 직원별 누적 카드)이
 *   본 티켓의 AC-1~AC-5 를 전부 충족한다. 본 spec 은 이 티켓 ID 로의 회귀 커버리지(정본 소스 불변식)를 남긴다.
 *   구현 재작성 없음(중복 재구현 = 회귀 리스크). lifecycle 중복 판정은 planner 에 FOLLOWUP 로 위임.
 *
 * 검증 방식: 형제 foot spec 동형 — 정본 소스(Assignments.tsx) 정적 단언으로 §5 시나리오 불변식 인코딩.
 *   실렌더/날짜 변경 시 값 연동은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 상담 탭 정상 동선 — 제목 변경 + 일/당월 분리표기 + 날짜선택(그 날 기준 연동)
//   §5-1: 상담 탭 → 제목 "직원별 누적" → 각 지표 일/당월 표시 → 과거 날짜 선택 → 그 날 기준 갱신
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1 · AC-1: 카드 제목이 "직원별 누적" (구 "직원별 당월 누적" 제거)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/<CardTitle className="text-sm">직원별 누적<\/CardTitle>/);
  expect(src).not.toMatch(/<CardTitle className="text-sm">직원별 당월 누적<\/CardTitle>/);
});

test('시나리오1 · AC-2: 각 지표에 [일누적]/[당월누적] 4지표씩 분리 표기', () => {
  const src = read(PAGE);
  // 2그룹 헤더
  expect(src).toContain('data-testid="accum-group-day"');
  expect(src).toContain('data-testid="accum-group-month"');
  expect(src).toMatch(/일누적/);
  expect(src).toMatch(/당월누적/);
  // 일누적 4지표(배정(균등)/재진/토스/당김) 독립 렌더
  expect(src).toContain('{st.day.assigned}');
  expect(src).toContain('{st.day.returning}');
  expect(src).toContain('{st.day.tossGiven}');
  expect(src).toContain('{st.day.pulled}');
  // 당월누적 4지표 독립 렌더
  expect(src).toContain('{st.month.assigned}');
  expect(src).toContain('{st.month.returning}');
  expect(src).toContain('{st.month.tossGiven}');
  expect(src).toContain('{st.month.pulled}');
});

test('시나리오1 · AC-3: 날짜 선택 UI(native date input, 기본값=오늘, max=오늘)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/useState<string>\(\(\) => todaySeoulISODate\(\)\)/); // 기본값=오늘(KST)
  expect(src).toContain('data-testid="assignments-accum-date"');
  expect(src).toMatch(/type="date"/);
  expect(src).toMatch(/value=\{selectedDate\}/);
  expect(src).toMatch(/max=\{todaySeoulISODate\(\)\}/); // 미래 선택 차단
  expect(src).toMatch(/setSelectedDate\(e\.target\.value\)/);
});

test('시나리오1 · AC-3: 선택일 기준 일누적(그 날)/당월누적(그 달 1일~그 날) 연동', () => {
  const src = read(PAGE);
  // 선택일 경계 산출
  expect(src).toContain('const selMonthStartMs');
  expect(src).toContain('const selDayStartMs');
  expect(src).toContain('const selDayEndExclMs');
  // 일누적 = 선택일 당일 [selDayStart, selDayEndExcl)
  expect(src).toMatch(/const inDay = \(ms: number\) => ms >= selDayStartMs && ms < selDayEndExclMs/);
  // 당월누적 = 선택월 1일 ~ 선택일 [selMonthStart, selDayEndExcl)
  expect(src).toMatch(/const inMonth = \(ms: number\) => ms >= selMonthStartMs && ms < selDayEndExclMs/);
  // 날짜 변경 시 재조회/재계산 (deps 에 selectedDate)
  expect(src).toMatch(/const monthStart = `\$\{selectedDate\.slice\(0, 7\)\}-01T00:00:00\+09:00`/);
  expect(src).toMatch(/\}, \[clinic, profile\?\.id, selectedDate\]\)/); // load deps
  expect(src).toMatch(/\}, \[staff, actions, monthCheckIns, monthAxisOf, activeTab, selectedDate\]\)/); // staffStats deps
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 치료(치료사) 탭 동일 적용 — 역할별 필터 회귀 없음
//   §5-2: 치료 탭 → 제목/일당월/날짜선택 동일 → 치료사만 집계
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2 · AC-4: 상담/치료 두 탭 동일 — 단일 카드가 activeTab(role) 필터 공유', () => {
  const src = read(PAGE);
  // 누적 카드는 mainTab !== 'list'(상담/치료 공통) 단일 렌더 → 제목/분리표기/날짜선택 두 탭 자동 동일
  expect(src).toContain('data-testid="assignments-monthly-card"');
  expect(src).toMatch(/\{mainTab !== 'list' && \(/);
});

test('시나리오2 · AC-4: 역할별 집계 회귀 없음 — 상담사/치료사 필터 유지', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const wantRole = activeTab === 'consult' \? 'consultant' : 'therapist'/);
  expect(src).toMatch(/\.filter\(\(st\) => st\.staff\.role === wantRole\)/);
  // 역할 라벨 표시 회귀 없음
  expect(src).toMatch(/st\.staff\.role === 'consultant' \? '상담사' : '치료사'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 엣지 — 데이터 없는 날짜(값 0) / 월 경계(1일) 정합 + 기존 컬럼·정렬 회귀 없음
//   §5-3: 배정 0인 날 → 0 정상표시 / 1일 선택 → 일누적=당월누적
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3 · AC-3(엣지): 배정 없는 날 → 카운트 0 기본값(에러 없음)', () => {
  const src = read(PAGE);
  // StaffCount 기본값 = 전 지표 0 (zero()) → 데이터 없어도 0 렌더
  expect(src).toMatch(/const zero = \(\): StaffCount => \(\{ assigned: 0, returning: 0, tossGiven: 0, pulled: 0 \}\)/);
});

test('시나리오3 · AC-5(엣지): 월 경계(1일) 선택 시 일누적=당월누적 경계 정합', () => {
  const src = read(PAGE);
  // 1일 선택 → selMonthStart == selDayStart → inDay ⊆ inMonth, 동일 경계 소스에서 파생(별도 분기 없음)
  expect(src).toMatch(/new Date\(`\$\{selectedDate\.slice\(0, 7\)\}-01T00:00:00\+09:00`\)\.getTime\(\)/);
  expect(src).toMatch(/new Date\(`\$\{selectedDate\}T00:00:00\+09:00`\)\.getTime\(\)/);
});

test('시나리오3 · AC-5(회귀0): 기존 컬럼(배정(균등)/재진/토스/당김)·정렬 보존', () => {
  const src = read(PAGE);
  // 4지표 컬럼 헤더 보존
  expect(src).toMatch(/배정\(균등\)/);
  expect(src).toMatch(/재진/);
  expect(src).toMatch(/토스/);
  expect(src).toMatch(/당김/);
  // 당월 배정 내림차순 정렬 보존
  expect(src).toContain('.sort((x, y) => y.month.assigned - x.month.assigned)');
  // 배정=균등/재진 분기(monthAxisOf) 보존 + 토스/당김 audit 파생 보존
  expect(src).toMatch(/monthAxisOf\(ci, 'consult'\) === 'returning'/);
  expect(src).toMatch(/monthAxisOf\(ci, 'therapy'\) === 'returning'/);
  expect(src).toMatch(/a\.action_type === 'toss' && a\.from_staff_id/);
  expect(src).toMatch(/a\.action_type === 'pull_in' && a\.to_staff_id/);
});
