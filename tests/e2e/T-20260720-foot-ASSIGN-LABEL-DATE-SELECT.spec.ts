/**
 * E2E spec — T-20260720-foot-ASSIGN-LABEL-DATE-SELECT
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1784542332.691399):
 *   "상담·치료사 배정 메뉴의 직원별 누적을 재구성.
 *    ① 항목명 [직원별 당월 누적] → [직원별 누적]
 *    ② [일누적](선택일 당일) / [당월누적](선택일 월 1일~선택일) 각각 분리 표기
 *    ③ 날짜 선택 UI 추가 → 선택일 기준 일/월 누적 연동(초기 default=오늘)
 *    ④ 상담 탭 + 치료 탭 두 탭 동일 적용"
 *
 * 설계 확정(AC-0 그라운딩):
 *   - 대상: src/pages/Assignments.tsx (③ 직원별 누적 카드).
 *   - 날짜 picker = 기존 CRM 컴포넌트(native <input type="date">) 재사용, max=오늘(미래 차단). 신규 npm 없음.
 *   - staffStats 는 선택일 경계(선택일 당일 / 선택월 1일~선택일)로 check_ins(정본)+assignment_actions(audit)
 *     를 client-side 필터해 day/month 두 구간을 각각 산출. DB 무변경(쿼리 하한만 선택월 1일로 파라미터화).
 *   - 상담/치료 카드는 activeTab(role) 필터를 공유하는 단일 렌더 → 날짜/라벨/분리표기가 두 탭에 자동 동일 적용.
 *   - 회귀0: 오늘 선택 시 [당월누적] = 기존 [직원별 당월 누적] 집계 경로(monthStart..now)와 동일 집합.
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(형제 foot spec 동형).
 * 실렌더/날짜 변경 시 값 연동은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 상담 탭 정상 동선 — 라벨 변경 + 분리표기 + 날짜선택 UI (AC-1/2/3)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 항목명 [직원별 당월 누적] → [직원별 누적] 변경', () => {
  const src = read(PAGE);
  // 카드 타이틀 텍스트가 '직원별 누적' 으로 렌더
  expect(src).toMatch(/<CardTitle className="text-sm">직원별 누적<\/CardTitle>/);
  // 구 라벨('직원별 당월 누적')이 렌더 타이틀로 남아있지 않음
  expect(src).not.toMatch(/<CardTitle className="text-sm">직원별 당월 누적<\/CardTitle>/);
});

test('AC-2: [일누적]/[당월누적] 2그룹 헤더로 분리 표기', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="accum-group-day"');
  expect(src).toContain('data-testid="accum-group-month"');
  // 그룹 헤더 텍스트
  expect(src).toMatch(/일누적/);
  expect(src).toMatch(/당월누적/);
  // 각 구간이 4지표(배정/재진/토스/당김) 를 독립 렌더 (day.* / month.*)
  expect(src).toContain('{st.day.assigned}');
  expect(src).toContain('{st.day.returning}');
  expect(src).toContain('{st.day.tossGiven}');
  expect(src).toContain('{st.day.pulled}');
  expect(src).toContain('{st.month.assigned}');
  expect(src).toContain('{st.month.returning}');
  expect(src).toContain('{st.month.tossGiven}');
  expect(src).toContain('{st.month.pulled}');
});

test('AC-3: 날짜 선택 UI 추가(native date input, max=오늘, 초기=오늘)', () => {
  const src = read(PAGE);
  // 상태 초기값 = 오늘(KST)
  expect(src).toMatch(/useState<string>\(\(\) => todaySeoulISODate\(\)\)/);
  // native date input 재사용 (신규 npm 없음)
  expect(src).toContain('data-testid="assignments-accum-date"');
  expect(src).toMatch(/type="date"/);
  expect(src).toMatch(/value=\{selectedDate\}/);
  expect(src).toMatch(/max=\{todaySeoulISODate\(\)\}/);
  expect(src).toMatch(/setSelectedDate\(e\.target\.value\)/);
});

test('AC-3: 선택일 기준 일/월 누적 연동 — staffStats 가 선택일 경계로 day/month 분기', () => {
  const src = read(PAGE);
  // 선택일 경계 산출
  expect(src).toContain('const selMonthStartMs');
  expect(src).toContain('const selDayStartMs');
  expect(src).toContain('const selDayEndExclMs');
  // 일누적 = 선택일 당일 [selDayStart, selDayEndExcl)
  expect(src).toMatch(/const inDay = \(ms: number\) => ms >= selDayStartMs && ms < selDayEndExclMs/);
  // 당월누적 = 선택월 1일 ~ 선택일 [selMonthStart, selDayEndExcl)
  expect(src).toMatch(/const inMonth = \(ms: number\) => ms >= selMonthStartMs && ms < selDayEndExclMs/);
  // useMemo 재계산 deps 에 selectedDate 포함(날짜 변경 시 연동 갱신)
  expect(src).toMatch(/\}, \[staff, actions, monthCheckIns, monthAxisOf, activeTab, selectedDate\]\)/);
  // 로드 쿼리 하한이 선택월 1일로 파라미터화 + load deps 에 selectedDate
  expect(src).toMatch(/const monthStart = `\$\{selectedDate\.slice\(0, 7\)\}-01T00:00:00\+09:00`/);
  expect(src).toMatch(/\}, \[clinic, profile\?\.id, selectedDate\]\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 치료 탭 동일 적용 (AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 상담/치료 두 탭 동일 적용 — 단일 카드가 activeTab(role) 필터 공유', () => {
  const src = read(PAGE);
  // 누적 카드는 mainTab !== 'list' 일 때(상담/치료 공통) 단일 렌더 → 라벨/분리/날짜가 두 탭 자동 동일.
  expect(src).toContain('data-testid="assignments-monthly-card"');
  // role 필터는 activeTab(consult|therapy) 로 분기(상담사/치료사)
  expect(src).toMatch(/const wantRole = activeTab === 'consult' \? 'consultant' : 'therapist'/);
  expect(src).toMatch(/\.filter\(\(st\) => st\.staff\.role === wantRole\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 엣지/회귀 (AC-5)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5(회귀0): 오늘 선택 시 [당월누적] = 기존 당월 집계 경로와 동일 집합', () => {
  const src = read(PAGE);
  // 당월 집계는 여전히 check_ins(정본) consultant_id/therapist_id + assignment_actions(audit) 로 파생.
  //   상한을 선택일 익일 00:00(exclusive) 로만 두므로 오늘 선택 시 monthStart..now 와 동치 → 회귀0.
  expect(src).toContain('.sort((x, y) => y.month.assigned - x.month.assigned)');
  // month 카운트는 배정=균등/재진 분기(monthAxisOf) 를 기존과 동일하게 사용
  expect(src).toMatch(/monthAxisOf\(ci, 'consult'\) === 'returning'/);
  expect(src).toMatch(/monthAxisOf\(ci, 'therapy'\) === 'returning'/);
  // 토스/당김 audit 파생 보존
  expect(src).toMatch(/a\.action_type === 'toss' && a\.from_staff_id/);
  expect(src).toMatch(/a\.action_type === 'pull_in' && a\.to_staff_id/);
});

test('AC-5(엣지): 월 초 1일 선택 시 일누적/당월누적 경계가 동일 시작점(선택월 1일)에서 겹침', () => {
  const src = read(PAGE);
  // 1일 선택 → selMonthStart == selDayStart → inDay ⊆ inMonth 이므로 동일 값 산출 가능(경계 파생이 동일 소스).
  //   (별도 분기 없이 경계식만으로 성립함을 소스로 확인)
  expect(src).toMatch(/new Date\(`\$\{selectedDate\.slice\(0, 7\)\}-01T00:00:00\+09:00`\)\.getTime\(\)/);
  expect(src).toMatch(/new Date\(`\$\{selectedDate\}T00:00:00\+09:00`\)\.getTime\(\)/);
});
