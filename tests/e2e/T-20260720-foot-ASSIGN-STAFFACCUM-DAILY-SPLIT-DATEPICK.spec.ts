/**
 * E2E spec — T-20260720-foot-ASSIGN-STAFFACCUM-DAILY-SPLIT-DATEPICK
 *
 * 현장(김주연 총괄) 요구 — 상담·치료사 배정 [직원별 (당월) 누적] 카드 재구성:
 *   1) 항목명 [직원별 당월 누적] → [직원별 누적]
 *   2) 값 분리: [일누적](선택일 하루) + [당월누적](선택일이 속한 월) 각각 별도 표시
 *   3) 날짜 picker 추가 — 날짜 변경 시 [일누적] 즉시 갱신, [당월누적]은 선택월 기준
 *   4) 상담 탭 + 치료 탭 두 곳 모두 동일 적용
 *
 * ── 중복 티켓 명시(traceability) ────────────────────────────────────────────────
 *   본 티켓은 형제 티켓 T-20260720-foot-ASSIGN-LABEL-DATE-SELECT(구현 commit d6673225) 및
 *   T-20260720-foot-STAFF-CUMUL-DAILY-MONTHLY-SPLIT(회귀 spec)과 동일 현장요구·동일 화면·동일 4요구다.
 *   구현(src/pages/Assignments.tsx ③ '직원별 누적' 카드)이 이미 main 에 존재하며 본 티켓 AC 를 전부 충족한다.
 *   재구현하지 않는다(중복 재구현 = 회귀 리스크). 본 spec 은 본 티켓 ID 로의 회귀 커버리지만 남기고,
 *   lifecycle 중복 판정(close-as-duplicate)은 planner 에 FOLLOWUP 로 위임한다.
 *
 * 검증 방식: 형제 foot spec 동형 — 정본 소스(Assignments.tsx) 정적 단언으로 §5 시나리오 불변식 인코딩.
 *   실렌더·날짜변경 값연동은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const src = () => readFileSync(join(ROOT, 'src/pages/Assignments.tsx'), 'utf8');

// 시나리오 1 — 상담 탭 정상 동선: 라벨 변경 + 일/당월 분리 + 날짜 picker 즉시 갱신
test('S1 · 요구1: 카드 제목 "직원별 누적" (구 "직원별 당월 누적" 제거)', () => {
  const s = src();
  expect(s).toMatch(/<CardTitle className="text-sm">직원별 누적<\/CardTitle>/);
  expect(s).not.toMatch(/<CardTitle className="text-sm">직원별 당월 누적<\/CardTitle>/);
});

test('S1 · 요구2: [일누적]/[당월누적] 별도 그룹 + 4지표(배정/재진/토스/당김) 각각 렌더', () => {
  const s = src();
  expect(s).toContain('data-testid="accum-group-day"');
  expect(s).toContain('data-testid="accum-group-month"');
  expect(s).toMatch(/일누적/);
  expect(s).toMatch(/당월누적/);
  // T-20260726-foot-ASSIGN-STAFFCUMUL-REVAMP supersede: 4지표 → 5지표. 카운트=명단 length 파생 클릭셀(testid).
  for (const scope of ['day', 'month']) {
    expect(s).toContain(`accum-${scope}-assigned-`);
    expect(s).toContain(`accum-${scope}-returning-`);
    expect(s).toContain(`accum-${scope}-toss-`);
    expect(s).toContain(`accum-${scope}-pull-`);
  }
  expect(s).toContain('st.day.assigned');
  expect(s).toContain('st.month.assigned');
});

test('S1 · 요구3: 날짜 picker(native date, 기본=오늘 KST, max=오늘) + 변경 시 재집계', () => {
  const s = src();
  expect(s).toContain('data-testid="assignments-accum-date"');
  expect(s).toMatch(/useState<string>\(\(\) => todaySeoulISODate\(\)\)/);
  expect(s).toMatch(/type="date"/);
  expect(s).toMatch(/value=\{selectedDate\}/);
  expect(s).toMatch(/max=\{todaySeoulISODate\(\)\}/);
  expect(s).toMatch(/setSelectedDate\(e\.target\.value\)/);
  // [일누적] = 선택일 당일(deps 에 selectedDate → 즉시 갱신). T-20260726 supersede: [당월누적] = 기준일(오늘) 당월 강제.
  expect(s).toMatch(/const inDay = \(ms: number\) => ms >= selDayStartMs && ms < selDayEndExclMs/);
  expect(s).toMatch(/const inMonth = \(ms: number\) => ms >= nowMonthStartMs && ms < nowMonthEndExclMs/);
  expect(s).not.toContain('const selMonthStartMs');
  expect(s).toMatch(
    /\}, \[staff, actions, monthCheckIns, monthCustomers, monthAxisOf, activeTab, selectedDate\]\)/,
  );
});

// 시나리오 2 — 치료(치료사) 탭 동일 적용, 역할 필터 회귀 없음
test('S2 · 요구4: 상담/치료 두 탭 동일 카드 + 역할(상담사/치료사) 필터 유지', () => {
  const s = src();
  expect(s).toContain('data-testid="assignments-monthly-card"');
  expect(s).toMatch(/\{mainTab !== 'list' && \(/);
  expect(s).toMatch(/const wantRole = activeTab === 'consult' \? 'consultant' : 'therapist'/);
  expect(s).toMatch(/\.filter\(\(st\) => st\.staff\.role === wantRole\)/);
});

// 시나리오 3 — 엣지: 기록 없는 직원 빈 명단 / 독립 경계(일=선택일, 월=기준일 당월)
test('S3 · 엣지: 기록 없는 직원 → 빈 명단 기본값(에러 없음)', () => {
  // T-20260726 supersede: zero() = 전 지표 빈 배열 → length=0 렌더.
  expect(src()).toMatch(
    /const zero = \(\): StaffCount => \(\{ assigned: \[\], returning: \[\], tossGiven: \[\], pulled: \[\] \}\)/,
  );
});

test('S3 · 엣지(supersede): 일누적=선택일 / 당월누적=기준일(오늘) 당월 — 독립 경계 (T-20260726 변경4)', () => {
  const s = src();
  expect(s).toMatch(/new Date\(`\$\{selectedDate\}T00:00:00\+09:00`\)\.getTime\(\)/);
  expect(s).toContain('const todayIso = todaySeoulISODate();');
  expect(s).toMatch(/new Date\(`\$\{todayIso\.slice\(0, 7\)\}-01T00:00:00\+09:00`\)/);
});
