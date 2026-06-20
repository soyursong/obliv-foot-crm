/**
 * E2E spec — T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX (P1 = AC-1)
 *
 * 현장(김주연 총괄): 배정 3건. 본 spec 은 P1 격상된 AC-1 우선 커버.
 *  [AC-1] 금일 내방객 자동 배정된 건이 '직원별 당월 누적'에 카운트 안 됨(버그).
 *
 * ── AC-1 근본원인(런타임 코드 진단 확정 RC=B '기록경로 불일치') ──
 *   '직원별 당월 누적'(Assignments.tsx staffStats)은 assignment_actions 테이블을 SSOT 로 집계한다
 *   (auto_assign/manual/toss/pull_in 전부 포함 — 집계 필터 누락 아님 → 후보 A 배제).
 *   그러나 NewCheckInDialog.proceedCheckIn 의 체크인 생성 시 consultant_id 가 INSERT 시점에
 *   '직접' 세팅되는 2경로가 assignment_actions 로그를 안 남겼다:
 *     - 초진(new)   : assign_consultant_atomic RPC(레거시 균등) → consultant_id 직접 INSERT
 *     - 재진(returning): customers.assigned_staff_id(담당 실장 자동연동) → consultant_id 직접 INSERT
 *   이후 maybeAutoAssign(line 324)은 consultant_id 가 이미 set 이라 멱등 skip(consult 로그 안 남김),
 *   초진(receiving)은 아예 비-트리거. ⇒ 이 자동세팅 consult 건들이 당월 누적에서 누락.
 *   FIX = INSERT 성공 후 consultantId 가 set 이면 logAssignment(auto_assign, role=consult)도 함께 기록 →
 *         집계 정본(assignment_actions) 정합. 재진 axis='returning'(재진 칼럼), 초진/체험=consult 축 파생.
 *         (서버이관 SERVERSIDE-REVIEW 와 무모순: 정본 경로=assignment_actions 로 통일.)
 *
 * 정본 소스 정적 단언 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 실배정→당월누적 카운트 증가)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const NEWDIALOG = 'src/components/NewCheckInDialog.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: '당월 누적' 집계 SSOT = assignment_actions (후보 A '집계 필터 누락' 아님 회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: 당월 누적(staffStats)이 assignment_actions 를 월 단위로 집계하고 auto_assign 을 포함한다', () => {
  const src = read(PAGE);
  // 당월 actions 로드(SSOT)
  expect(src).toMatch(/\.from\('assignment_actions'\)/);
  expect(src).toMatch(/\.gte\('created_at', monthStart\)/);
  // 배정 카운트 분기에 auto_assign 포함(자동배정이 집계에서 제외되지 않음)
  expect(src).toMatch(/a\.action_type === 'auto_assign'/);
  // 재진 축은 returning 칼럼, 그 외는 균등(assigned)
  expect(src).toMatch(/a\.axis === 'returning'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 RC=B FIX: INSERT 시점 consultant 자동세팅이 assignment_actions 정본에 로그를 남긴다
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-2: NewCheckInDialog 가 logAssignment·deriveConsultAxis 를 autoAssign 정본에서 import', () => {
  const src = read(NEWDIALOG);
  expect(src).toMatch(/import\s*\{[\s\S]*logAssignment[\s\S]*\}\s*from\s*'@\/lib\/autoAssign'/);
  expect(src).toMatch(/import\s*\{[\s\S]*deriveConsultAxis[\s\S]*\}\s*from\s*'@\/lib\/autoAssign'/);
});

test('AC1-3: INSERT 성공 후 consultantId set 이면 auto_assign(role=consult) 로그를 정본에 남긴다', () => {
  const src = read(NEWDIALOG);
  // consultantId 가 있을 때만 로그(미배정 시 no-op)
  expect(src).toMatch(/if \(insertedRow\?\.id && consultantId\)/);
  // logAssignment 호출 + action_type auto_assign + role consult
  expect(src).toMatch(/logAssignment\(\{/);
  expect(src).toMatch(/actionType: 'auto_assign'/);
  expect(src).toMatch(/role: 'consult'/);
  // 토스/당김이 아니라 received staff = 배정 대상 consultant
  expect(src).toMatch(/toStaffId: assignedConsultantId/);
});

test('AC1-4: 재진은 axis=returning(재진 칼럼), 그 외는 deriveConsultAxis 로 균등 축 파생', () => {
  const src = read(NEWDIALOG);
  // returning 분기는 균등 제외 축
  expect(src).toMatch(/let axis = 'returning'/);
  // 비-재진은 고객 visit_type/lead_source/visit_route 로 축 파생
  expect(src).toMatch(/if \(visitType !== 'returning'\)/);
  expect(src).toMatch(/deriveConsultAxis\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 무결성: logAssignment 정본은 assignment_actions INSERT 한 곳(이중 경로 분기 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-5: logAssignment 가 assignment_actions 단일 정본에 insert(집계 SSOT 일원화)', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/export async function logAssignment/);
  expect(src).toMatch(/\.from\('assignment_actions'\)\s*\.insert\(/);
  // auto_assign 도 동일 정본 경로(maybeAutoAssign)에서 logAssignment 사용
  expect(src).toMatch(/actionType: 'auto_assign'/);
});
