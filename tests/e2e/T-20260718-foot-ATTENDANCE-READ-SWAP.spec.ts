/**
 * T-20260718-foot-ATTENDANCE-READ-SWAP — 배정화면 '출근 N명' read-swap (SSOT-CRM carve-out)
 *
 * 모기 티켓 T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM 에서 기반(AC-1 staff_attendance 테이블 +
 * AC-3 sheet→DB sync EF/cron)이 PROD live·검증 완료. 본 티켓은 남은 AC-2(배정화면 read-swap) +
 * AC-2b(stale-guard fallback) + AC-4(회귀금지)를 carve-out 구현한다.
 *
 * 배정화면 '출근'의 데이터 소스를 구글시트 직접 read → staff_attendance(DB SSOT) read 로 전환하되,
 * DB 가 비어있으면(sync 지연·미커버 clinic=송도 등) 시트 read 로 자동 폴백(회귀0)한다.
 *
 * 현장 3 클릭 시나리오의 불변식을 정적 소스 검증한다(라이브 env 비의존, 레포 dominant 패턴).
 * supervisor full QA(코드 리뷰 + E2E 실행 + 배정화면 실렌더)가 라이브 렌더 검증을 담당.
 *   S1 정상 동선(DB read 반영)  S2 stale-guard fallback(시트 폴백 + source=fallback 로그)  S3 회귀(AC-4)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ENGINE = read('src/lib/autoAssign.ts');
const ENGINE_CODE = stripComments(ENGINE);
const PAGE_CODE = stripComments(read('src/pages/Assignments.tsx'));
const MIG = read('supabase/migrations/20260618200000_staff_attendance_ssot.sql');

// `fetchTodayWorkingStaffIds` 본문만 슬라이스(회귀·소스순서 검증을 함수 스코프로 한정) ─────────
const SWAP_START = ENGINE_CODE.indexOf('export async function fetchTodayWorkingStaffIds');
const SWAP_END = ENGINE_CODE.indexOf('export async function', SWAP_START + 1);
const SWAP_FN = ENGINE_CODE.slice(SWAP_START, SWAP_END === -1 ? undefined : SWAP_END);

// ── S1: 정상 동선 (staff_attendance DB read 우선 반영) ───────────────────────────
test.describe('S1 — 정상 동선: staff_attendance DB SSOT read 우선', () => {
  test('accessor 가 staff_attendance 를 date·status=present 로 read (AC-2)', () => {
    expect(ENGINE_CODE).toContain("from('staff_attendance')");
    expect(ENGINE_CODE).toMatch(/\.eq\('status',\s*'present'\)/);
    expect(ENGINE_CODE).toMatch(/\.eq\('date',\s*date\)/);
    expect(ENGINE_CODE).toMatch(/\.eq\('clinic_id',\s*clinicId\)/);
  });

  test('DB present 행이 있으면 그 집합을 채택(시트 read 안 함) — 소스 우선순위', () => {
    // fetchTodayWorkingStaffIds 본문에서 DB read 가 시트 폴백보다 먼저 호출된다.
    const dbAt = SWAP_FN.indexOf('fetchAttendancePresentStaffIds');
    const sheetAt = SWAP_FN.indexOf('fetchWorkingStaffIdsFromSheet');
    expect(dbAt).toBeGreaterThan(-1);
    expect(sheetAt).toBeGreaterThan(-1);
    expect(dbAt).toBeLessThan(sheetAt); // DB 먼저 시도 → 있으면 return, 없을 때만 시트
    expect(SWAP_FN).toMatch(/if \(dbIds && dbIds\.size > 0\)[\s\S]*?return dbIds;/);
  });

  test('DB 채택 시 source=staff_attendance 관측 로그', () => {
    expect(SWAP_FN).toMatch(/logAttendanceSource\('staff_attendance'/);
    expect(ENGINE_CODE).toMatch(/\[attendance-read\] source=\$\{source\}/);
  });

  test('기반 SSOT 테이블/컬럼 계약 일치 (present 카운트 = status=present)', () => {
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS staff_attendance');
    expect(MIG).toMatch(/status\s+TEXT\s+NOT NULL DEFAULT 'present'/);
    expect(MIG).toMatch(/CHECK \(status IN \('present', 'off', 'leave'\)\)/);
  });
});

// ── S2: stale-guard fallback (DB 비면 시트 read 폴백 + source=fallback 로그) ───────
test.describe('S2 — stale-guard fallback: DB 비면 시트 폴백(회귀0)', () => {
  test('DB 비었음(0행) 또는 read 에러 시 시트 read 폴백 (AC-2b)', () => {
    // DB read 헬퍼: 에러/예외 시 null 반환 → 폴백 트리거
    expect(ENGINE_CODE).toMatch(/async function fetchAttendancePresentStaffIds/);
    expect(ENGINE_CODE).toMatch(/if \(error\) return null;/);
    // 폴백은 기존 시트 이름매칭 경로를 그대로 재사용
    expect(ENGINE_CODE).toMatch(/async function fetchWorkingStaffIdsFromSheet/);
    expect(SWAP_FN).toMatch(/const sheetIds = await fetchWorkingStaffIdsFromSheet\(today, list\);/);
    expect(SWAP_FN).toMatch(/return sheetIds;/);
  });

  test('폴백 발동 시 source=fallback 관측 로그 (송도 등 미커버 clinic 자연 커버)', () => {
    expect(SWAP_FN).toMatch(/logAttendanceSource\('fallback'/);
  });

  test('폴백 경로가 시트 read 를 그대로 사용(파서·이름매칭 무변경 = 회귀0)', () => {
    expect(ENGINE_CODE).toMatch(/fetchTodayAttendeeNames\(today, DUTY_SHEET_GIDS, allNames\)/);
    // 시트 read 도 graceful — throw 하지 않고 빈 set
    const sheetStart = ENGINE_CODE.indexOf('async function fetchWorkingStaffIdsFromSheet');
    const sheetEnd = ENGINE_CODE.indexOf('export async function fetchTodayWorkingStaffIds');
    const sheetFn = ENGINE_CODE.slice(sheetStart, sheetEnd);
    expect(sheetFn).toMatch(/catch \{[\s\S]*?names = \[\];/);
  });
});

// ── S3: 회귀 (AC-4 — 소스 전환만, 소비 계약·알고리즘 불변) ──────────────────────────
test.describe('S3 — 회귀 금지(AC-4): 반환 계약·후보풀·소비측 불변', () => {
  test('반환 타입 Set<string> 불변 — 후보풀·Handover 소비 계약 유지', () => {
    expect(ENGINE_CODE).toMatch(/export async function fetchTodayWorkingStaffIds\([\s\S]*?\): Promise<Set<string>>/);
  });

  test('자동배정 후보풀이 동일 accessor 를 소비(후보 집합 동일성)', () => {
    // 엔진 후보 풀 = fetchTodayWorkingStaffIds(불변) ∩ 역할 매칭 — 알고리즘 무변경
    expect(ENGINE_CODE).toMatch(/const workingIds = await fetchTodayWorkingStaffIds\(checkIn\.clinic_id, staff\)/);
    expect(ENGINE_CODE).toMatch(/role === targetRole && workingIds\.has\(s\.id\)/);
  });

  test('배정화면이 동일 accessor 로 workingIds 세팅(출근 N명 표시 SSOT 불변)', () => {
    expect(PAGE_CODE).toMatch(/const working = await fetchTodayWorkingStaffIds\(clinic\.id, staffList\)/);
    expect(PAGE_CODE).toMatch(/setWorkingIds\(working\)/);
  });

  test('active staff 교집합 — inactive/삭제 staff row 유입 차단(후보풀 오염 방지)', () => {
    expect(ENGINE_CODE).toMatch(/const activeIds = new Set\(staffList\.map\(\(s\) => s\.id\)\)/);
    expect(ENGINE_CODE).toMatch(/if \(activeIds\.has\(r\.staff_id\)\) ids\.add\(r\.staff_id\)/);
  });

  test('배정 로직·토스·당김·임시off 등 인접 동선 미접촉(소스 전환만)', () => {
    // read-swap 은 fetchTodayWorkingStaffIds 내부에 국한 — 배정 알고리즘 시그니처 불변
    expect(ENGINE_CODE).toContain('export async function maybeAutoAssign');
    expect(ENGINE_CODE).toContain('export async function tossAssignment');
    expect(ENGINE_CODE).toContain('export async function pullAssignment');
  });
});
