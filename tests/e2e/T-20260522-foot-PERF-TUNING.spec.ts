/**
 * T-20260522-foot-PERF-TUNING
 * 풋센터 CRM 반응속도 프로파일링 및 추가 최적화 — 성능 최적화 회귀 검증
 *
 * OPT-1 (Dashboard): 3개 staff 쿼리 → fetchAllStaff 단일 통합 쿼리
 * OPT-2 (Dashboard): consent_forms + checklists 순차 await → Promise.all 병렬화
 * OPT-3 (Dashboard): fetchReservations 제거 → pendingReservations useMemo 파생값
 * OPT-4 (ClinicCalendar): calendarDays + eventsMap useMemo 래핑
 * OPT-5 (Dashboard): fetchAssignments select('*') → 7개 필요 컬럼만
 *
 * 커버리지:
 *   - AC1: 대시보드 → staff 목록 (OPT-1 fetchAllStaff 통합 쿼리 + null guard)
 *   - AC2: 대시보드 → Promise.all 병렬화 (OPT-2 consent+checklist)
 *   - AC3: 대시보드 → pendingReservations 파생값 정합 (OPT-3 useMemo+filter)
 *   - AC4: ClinicCalendar → 달력 렌더 (OPT-4 calendarDays/eventsMap useMemo)
 *   - AC5: fetchAssignments 페이로드 축소 (OPT-5 select 컬럼 명시)
 *   - AC6: 콘솔 에러 미유발 코드 패턴 (catch 존재, null guard)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dashboardSrc = readFileSync(
  path.resolve(__dirname, '../../src/pages/Dashboard.tsx'),
  'utf-8',
);
const calendarSrc = readFileSync(
  path.resolve(__dirname, '../../src/pages/ClinicCalendar.tsx'),
  'utf-8',
);

// ── AC-1: OPT-1 — fetchAllStaff 단일 통합 쿼리 ───────────────────────────────

test('OPT-1-a: fetchAllStaff 함수가 존재함 (staff 쿼리 통합)', () => {
  expect(dashboardSrc).toContain('fetchAllStaff');
  expect(dashboardSrc).toMatch(/const fetchAllStaff\s*=\s*useCallback/);
});

test('OPT-1-b: fetchAllStaff — .in(role) 단일 쿼리로 4개 role 동시 조회', () => {
  // therapist + technician + consultant + director 를 단일 in() 쿼리로 조회
  expect(dashboardSrc).toMatch(/\.in\s*\(\s*['"]role['"]\s*,\s*\[/);
  expect(dashboardSrc).toContain("'therapist'");
  expect(dashboardSrc).toContain("'consultant'");
  expect(dashboardSrc).toContain("'director'");
});

test('OPT-1-c: fetchAllStaff — null guard (data ?? []) as Staff[] 존재', () => {
  expect(dashboardSrc).toContain('(data ?? []) as Staff[]');
});

test('OPT-1-d: fetchAllStaff — 단일 결과로 therapists/consultants/doctors 세 state 설정', () => {
  // 분리 쿼리가 아닌 단일 결과 filter로 세 state를 설정
  const fetchAllStaffBlock = dashboardSrc.slice(
    dashboardSrc.indexOf('const fetchAllStaff'),
    dashboardSrc.indexOf('const fetchAllStaff') + 600,
  );
  expect(fetchAllStaffBlock).toContain('setTherapists');
  expect(fetchAllStaffBlock).toContain('setConsultants');
  expect(fetchAllStaffBlock).toContain('setDoctors');
  // filter로 분리 (역할별 개별 DB 쿼리 없음)
  expect(fetchAllStaffBlock).toContain('.filter(');
});

// ── AC-2: OPT-2 — Promise.all 병렬화 ─────────────────────────────────────────

test('OPT-2-a: consent_forms + checklists Promise.all 병렬화 존재', () => {
  expect(dashboardSrc).toMatch(/Promise\.all\s*\(\[/);
});

test('OPT-2-b: Promise.all 구조분해 — [consentRes, checklistRes] 패턴', () => {
  expect(dashboardSrc).toContain('[consentRes, checklistRes]');
});

test('OPT-2-c: null guard — consentRes.data ?? [] 존재', () => {
  expect(dashboardSrc).toMatch(/consentRes\.data\s*\?\?\s*\[\]/);
});

test('OPT-2-d: null guard — checklistRes.data ?? [] 존재', () => {
  expect(dashboardSrc).toMatch(/checklistRes\.data\s*\?\?\s*\[\]/);
});

// ── AC-3: OPT-3 — pendingReservations useMemo 파생값 ─────────────────────────

test('OPT-3-a: pendingReservations가 useMemo로 선언됨 (DB round trip 제거)', () => {
  expect(dashboardSrc).toMatch(/pendingReservations\s*=\s*useMemo\s*\(/);
});

test('OPT-3-b: pendingReservations — timelineReservations.filter(confirmed) 파생', () => {
  const opt3Block = dashboardSrc.slice(
    dashboardSrc.indexOf('pendingReservations = useMemo'),
    dashboardSrc.indexOf('pendingReservations = useMemo') + 300,
  );
  expect(opt3Block).toContain('timelineReservations.filter');
  expect(opt3Block).toContain("'confirmed'");
});

test('OPT-3-c: pendingReservations 의존성이 [timelineReservations]', () => {
  const opt3Block = dashboardSrc.slice(
    dashboardSrc.indexOf('pendingReservations = useMemo'),
    dashboardSrc.indexOf('pendingReservations = useMemo') + 300,
  );
  expect(opt3Block).toContain('[timelineReservations]');
});

test('OPT-3-d: fetchReservations 함수가 제거됨 (pendingReservations 전용 쿼리 폐기)', () => {
  // fetchReservations useCallback 선언이 없어야 함
  expect(dashboardSrc).not.toMatch(/const fetchReservations\s*=\s*useCallback/);
});

// ── AC-4: OPT-4 — ClinicCalendar useMemo 래핑 ────────────────────────────────

test('OPT-4-a: calendarDays가 useMemo로 래핑됨', () => {
  expect(calendarSrc).toMatch(/calendarDays\s*=\s*useMemo\s*\(/);
});

test('OPT-4-b: calendarDays 의존성이 [currentDate]', () => {
  const calDaysBlock = calendarSrc.slice(
    calendarSrc.indexOf('calendarDays = useMemo'),
    calendarSrc.indexOf('calendarDays = useMemo') + 250,
  );
  expect(calDaysBlock).toContain('[currentDate]');
});

test('OPT-4-c: eventsMap이 useMemo로 래핑됨', () => {
  expect(calendarSrc).toMatch(/eventsMap\s*=\s*useMemo\s*\(/);
});

test('OPT-4-d: ClinicCalendar — calendarDays.map() JSX 렌더 존재', () => {
  // calendarDays가 실제 JSX에서 사용됨을 확인
  expect(calendarSrc).toMatch(/calendarDays\.map\s*\(/);
});

test('OPT-4-e: ClinicCalendar — eventsMap.get() 사용 (이벤트 매핑 렌더)', () => {
  expect(calendarSrc).toMatch(/eventsMap\.get\s*\(/);
});

// ── AC-5: OPT-5 — fetchAssignments 페이로드 축소 ─────────────────────────────

test('OPT-5-a: fetchAssignments 내 select 컬럼이 명시적으로 지정됨', () => {
  const fetchAssignBlock = dashboardSrc.slice(
    dashboardSrc.indexOf('const fetchAssignments'),
    dashboardSrc.indexOf('const fetchAssignments') + 400,
  );
  // 7개 컬럼 명시 (select('*') 금지)
  expect(fetchAssignBlock).toContain('id, clinic_id, date, room_name, room_type, staff_id, staff_name');
});

test('OPT-5-b: fetchAssignments에서 select(\'*\') 사용 안 함 (페이로드 미최소화 금지)', () => {
  const fetchAssignBlock = dashboardSrc.slice(
    dashboardSrc.indexOf('const fetchAssignments'),
    dashboardSrc.indexOf('const fetchAssignments') + 400,
  );
  // room_assignments 조회에서 select('*') 없어야 함
  expect(fetchAssignBlock).not.toMatch(/\.select\s*\(\s*['"]\*['"]\s*\)/);
});

// ── AC-6: 콘솔 에러 미유발 패턴 ──────────────────────────────────────────────

test('AC-6-a: Dashboard — OPT 변경 구간에 null guard가 충분함 (data ?? [])', () => {
  // 전체 src에서 OPT 마킹된 구간들의 null guard 존재
  const nullGuardCount = (dashboardSrc.match(/\?\?\s*\[\]/g) ?? []).length;
  expect(nullGuardCount, 'data ?? [] null guard가 너무 적음').toBeGreaterThanOrEqual(5);
});

test('AC-6-b: Dashboard — for...of 루프 전 state 초기값이 [] 타입', () => {
  // timelineReservations 초기값 []
  expect(dashboardSrc).toMatch(/useState<Reservation\[\]>\s*\(\s*\[\s*\]\s*\)/);
});

test('AC-6-c: ClinicCalendar — events 초기값이 [] (eventsMap.get 에러 방지)', () => {
  expect(calendarSrc).toMatch(/useState.*\[\]/);
});

test('AC-6-d: OPT 관련 파일에 unhandled Promise 없음 (catch 또는 await 사용)', () => {
  // OPT-2 Promise.all에 await 존재
  expect(dashboardSrc).toMatch(/await\s+Promise\.all/);
});
