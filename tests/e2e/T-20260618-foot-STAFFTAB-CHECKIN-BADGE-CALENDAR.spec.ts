/**
 * E2E spec — T-20260618-foot-STAFFTAB-CHECKIN-BADGE-CALENDAR (P1)
 *
 * 요청(김주연 총괄): 직원·공간 > 직원 탭에서 파트별 등록 직원 + 오늘 출근 여부를 한눈에.
 *   배정화면(/admin/assignments)에 직원이 안 뜨는 조건(직원등록 AND 구글시트 출근자)을
 *   직원 탭에서 사전 파악하게 해 자가진단 보조.
 *
 * Core(이번 배포):
 *   - StaffTab: 각 활성 직원 행에 출근(녹)/미출근(회) 배지 + 헤더 '오늘 출근 N명' 요약.
 *   - 출근 판정 = fetchTodayWorkingStaffIds(clinic.id, staffList) 재사용
 *     (배정화면 Assignments.tsx L140 과 동일 소스 = 구글시트 근무 캘린더 read). 신규 조회 로직 추가 금지.
 *   - graceful: 시트 장애/무출근 → 빈 Set → 직원 목록(staff 테이블 기반)은 정상 렌더,
 *     전원 '미출근' 표식(공백/에러 화면 절대 금지).
 *
 * 옵션2(근무캘린더 전직원 확장)는 이번 범위 제외 → DutyRosterTab 무변경.
 *
 * 본 spec = 정본 소스 정적 단언으로 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(배지 색/요약 표시) 확인은 supervisor 맥스튜디오 실브라우저 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Staff.tsx';

// StaffTab 본문만 잘라낸다(RoomTab/ClinicSettingsTab 오염 방지).
function staffTabBody(src: string): string {
  const start = src.indexOf('function StaffTab(');
  const end = src.indexOf('function CreateStaffDialog(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 출근/미출근 배지 + 요약 렌더 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 직원 행 출근/미출근 배지 + 헤더 출근 요약 렌더', () => {
  const body = staffTabBody(read(PAGE));
  // 행 배지: workingIds 멤버십으로 출근/미출근 분기
  expect(body).toContain('workingIds.has(s.id)');
  expect(body).toContain('출근');
  expect(body).toContain('미출근');
  expect(body).toContain('data-testid={`staff-checkin-badge-${s.id}`}');
  // 헤더 요약: 오늘 출근 N명
  expect(body).toContain('data-testid="staff-working-summary"');
  expect(body).toMatch(/오늘 출근 \{workingCount\}명/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 동일 소스 일치 — 배정화면과 같은 fetchTodayWorkingStaffIds 재사용 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 배정화면과 동일 소스(fetchTodayWorkingStaffIds) 재사용 — 신규 조회 로직 없음', () => {
  const src = read(PAGE);
  // import 재사용
  expect(src).toMatch(/import \{ fetchTodayWorkingStaffIds \} from '@\/lib\/autoAssign'/);
  const body = staffTabBody(src);
  // 동일 시그니처로 호출(clinic.id, staffList)
  expect(body).toContain('fetchTodayWorkingStaffIds(clinic.id, staffList)');
  // workingCount 는 활성 직원 + workingIds 로 파생(배정화면 '출근 N명'과 동일 소스)
  expect(body).toMatch(/s\.active && workingIds\.has\(s\.id\)/);
  // 직원 탭 내부에 dutySheet 등 별도 시트 직접조회 신규 추가 없음
  expect(body).not.toContain('fetchTodayAttendeeNames');
  expect(body).not.toContain('DUTY_SHEET_GIDS');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: graceful — 시트 장애여도 직원 목록 정상(공백/에러 금지) (AC-3)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3(graceful): 출근 쿼리 try/catch→빈 Set, 직원 목록은 staff 테이블 기반 독립 렌더', () => {
  const body = staffTabBody(read(PAGE));
  // workingIds 쿼리: 예외 시 빈 Set 폴백
  expect(body).toContain("queryKey: ['staff-working-ids', clinic.id]");
  expect(body).toMatch(/catch\s*\{\s*return new Set<string>\(\);/);
  // 기본값도 빈 Set (데이터 미도착 시 crash 방지)
  expect(body).toMatch(/data: workingIds = new Set<string>\(\)/);
  // 직원 목록 자체는 별도 staff 쿼리(workingIds 와 독립) → 출근 정보 없어도 카드는 렌더
  expect(body).toContain("queryKey: ['staff', clinic.id]");
  // 배지는 활성 직원에만(s.active 가드) — 비활성/빈 Set 이어도 분기만 바뀔 뿐 렌더 유지
  expect(body).toMatch(/\{s\.active && \(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 회귀 0 — 직원 CRUD/비활성토글 핸들러 불변 (AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 직원 CRUD/비활성토글/refresh 보존(배지 렌더만 additive)', () => {
  const body = staffTabBody(read(PAGE));
  expect(body).toContain('const handleToggleActive = async');
  expect(body).toContain('const confirmDeactivate = async');
  expect(body).toContain('CreateStaffDialog');
  expect(body).toContain('EditStaffDialog');
  // refresh 는 staff + working 쿼리 둘 다 무효화(CRUD 후 이름매칭 재계산)
  expect(body).toContain("qc.invalidateQueries({ queryKey: ['staff', clinic.id] })");
  expect(body).toContain("qc.invalidateQueries({ queryKey: ['staff-working-ids', clinic.id] })");
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5: 옵션2 미포함 — 근무캘린더(DutyRosterTab) 무변경 (AC-5)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 옵션2(근무캘린더 전직원 확장) 미착수 — DutyRosterTab 임포트만, 본 티켓서 미수정', () => {
  const src = read(PAGE);
  // DutyRosterTab 은 외부 컴포넌트 그대로 사용(이 페이지에서 전직원 확장 로직 추가 안 함)
  expect(src).toContain("import { DutyRosterTab } from '@/components/DutyRosterTab'");
  // duty_roster 직접 쿼리를 Staff.tsx 에 신규 추가하지 않음(옵션2 scope 격리)
  expect(src).not.toContain("from('duty_roster')");
});
