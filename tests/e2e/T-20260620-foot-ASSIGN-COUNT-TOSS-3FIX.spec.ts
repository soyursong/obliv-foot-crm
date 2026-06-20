/**
 * E2E spec — T-20260620-foot-ASSIGN-COUNT-TOSS-3FIX (상담·치료사 배정 3건)
 *
 * 현장(김주연 총괄): deployed AUTOASSIGN-BALANCE-TOSS 사용 후 refinement 3건.
 *   [AC-1] 금일 자동 배정된 건이 '직원별 당월 누적'에 카운트 안 됨(버그).
 *   [AC-2] 토스(재배정) 확정 모달에 담당 선택칸 부재→랜덤. 사유+미배정/담당변경(수동) 추가.
 *   [AC-3] 당월 누적 상단에 '금일 배분 이력' 노출.
 *
 * ── AC-1 근본원인(런타임 DB 진단 확정) = RC=B '기록경로 부재' ──
 *   '당월 누적' SSOT 였던 assignment_actions 테이블이 prod 에 미적용(마이그
 *   20260618120000_assignment_autoassign.sql 미실행)이었다. → auto/manual 배정은 check_ins.{role}_id
 *   에 확정 기록되나 audit INSERT(logAssignment)는 best-effort 로 조용히 실패 → 당월 누적 0.
 *   (선행 커밋 d2c0bac3 가 NewCheckInDialog logAssignment 를 넣었으나 테이블 부재로 무효였다.)
 *   FIX(2축):
 *     ① DB: 해당 ADDITIVE 마이그 prod 적용(테이블+RLS+인덱스 / customers.assigned_consultant_id).
 *     ② 집계: 배정/재진 누적 카운트를 audit 가 아닌 check_ins(자동·수동 공통 정본) 기준으로 통합 →
 *        audit 유실/지연과 무관하게 1건당 1회 정확(역할별 분리). 토스/당김은 audit count 유지.
 *   (서버이관 SERVERSIDE-REVIEW 와 무모순: 배정 현재상태 정본=check_ins, 이벤트 이력=assignment_actions.)
 *
 * 정본 소스 정적 단언 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(갤탭 실배정→당월누적/금일이력 카운트)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';
const NEWDIALOG = 'src/components/NewCheckInDialog.tsx';
const MIG = 'supabase/migrations/20260618120000_assignment_autoassign.sql';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 ② 집계: 배정/재진 누적 = check_ins(정본) 기준 (자동·수동 공통, audit 유실 무관)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: 당월 누적 배정/재진 카운트가 check_ins(monthCheckIns) 정본을 집계한다', () => {
  const src = read(PAGE);
  // 당월 check_ins 전체 로드(정본)
  expect(src).toMatch(/setMonthCheckIns/);
  expect(src).toMatch(/\.gte\('checked_in_at', monthStart\)/);
  // staffStats 가 monthCheckIns 의 consultant_id/therapist_id 를 직접 카운트(역할별 분리)
  expect(src).toMatch(/for \(const ci of monthCheckIns\)/);
  expect(src).toMatch(/if \(ci\.consultant_id\)/);
  expect(src).toMatch(/if \(ci\.therapist_id\)/);
  // 재진 축은 returning 칼럼, 그 외는 균등(assigned)
  expect(src).toMatch(/=== 'returning'\) st\.returning \+= 1/);
});

test('AC1-2: 토스/당김 누적은 assignment_actions(audit) 기준 유지(이벤트 카운트)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/a\.action_type === 'toss' && a\.from_staff_id/);
  expect(src).toMatch(/a\.action_type === 'pull_in' && a\.to_staff_id/);
  // 당월 audit 로드도 유지(토스/당김·방식 표시용)
  expect(src).toMatch(/\.from\('assignment_actions'\)/);
  expect(src).toMatch(/\.gte\('created_at', monthStart\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 ① DB: assignment_actions 정본 테이블이 마이그에 ADDITIVE 로 정의(prod 적용됨)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-3: assignment_actions 테이블/RLS/reason·to_staff_id(nullable) 가 ADDITIVE 마이그에 정의', () => {
  const src = read(MIG);
  expect(src).toMatch(/CREATE TABLE IF NOT EXISTS assignment_actions/);
  expect(src).toMatch(/reason\s+TEXT/); // AC-2 토스사유 — 신규컬럼 불요
  expect(src).toMatch(/to_staff_id\s+UUID REFERENCES staff\(id\)/); // 미배정 시 NULL 허용(NOT NULL 아님)
  expect(src).toMatch(/ENABLE ROW LEVEL SECURITY/);
});

test('AC1-4: INSERT 시점 consult 자동세팅도 logAssignment 정본(assignment_actions)에 기록(테이블 적용 후 유효)', () => {
  const src = read(NEWDIALOG);
  expect(src).toMatch(/import\s*\{[\s\S]*logAssignment[\s\S]*\}\s*from\s*'@\/lib\/autoAssign'/);
  expect(src).toMatch(/if \(insertedRow\?\.id && consultantId\)/);
  expect(src).toMatch(/actionType: 'auto_assign'/);
  expect(src).toMatch(/role: 'consult'/);
});

test('AC1-5: logAssignment 가 assignment_actions 단일 정본에 insert', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/export async function logAssignment/);
  expect(src).toMatch(/\.from\('assignment_actions'\)\s*\.insert\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 토스 확정 모달 — 미배정/담당변경(수동선택)+사유. 랜덤 자동재배정 제거.
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: tossAssignment 가 mode(reassign|unassign) 를 명시적으로 받고 랜덤 least-loaded 를 쓰지 않는다', () => {
  const src = read(AUTOASSIGN);
  expect(src).toMatch(/mode: 'reassign' \| 'unassign'/);
  // reassign 은 수동 지정 toStaffId 필수, unassign 은 null 로 되돌림
  expect(src).toMatch(/opts\.mode === 'unassign' \? null/);
  expect(src).toMatch(/재배정할 담당자를 선택해주세요/);
  // toss 핸들러 안에서 pickLeastLoaded(랜덤 자동선택) 미사용
  const tossBlock = src.slice(src.indexOf('export async function tossAssignment'));
  const tossOnly = tossBlock.slice(0, tossBlock.indexOf('export async function pullAssignment'));
  expect(tossOnly).not.toMatch(/pickLeastLoaded/);
});

test('AC2-2: 토스 모달에 방식 토글(미배정/변경)·수동 담당 select·사유 입력이 있다', () => {
  const src = read(PAGE);
  expect(src).toMatch(/data-testid="toss-mode-reassign"/);
  expect(src).toMatch(/data-testid="toss-mode-unassign"/);
  expect(src).toMatch(/data-testid="toss-staff-select"/);
  expect(src).toMatch(/data-testid="toss-reason-input"/);
  // 수동 후보 = 당일 출근(poolFor) 목록, 현재 담당 제외
  expect(src).toMatch(/poolFor\(tossTarget\.role\)/);
  expect(src).toMatch(/s\.id !== tossTarget\.fromStaffId/);
});

test('AC2-3: confirmToss 가 mode+선택 담당을 tossAssignment 로 전달(reassign 시 담당 미선택 차단)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/mode: tossMode/);
  expect(src).toMatch(/toStaffId: tossMode === 'reassign' \? tossToStaffId : null/);
  expect(src).toMatch(/tossMode === 'reassign' && !tossToStaffId/);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 당월 누적 상단 '금일 배분 이력'(read-only) — 고객/담당/방식(자동·수동)/시각
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-1: 금일 배분 이력 섹션이 당월 누적 카드 위에 read-only 로 존재한다', () => {
  const src = read(PAGE);
  expect(src).toMatch(/data-testid="assignments-today-distribution-card"/);
  // 당월 누적 카드보다 먼저 렌더(상단)
  const idxToday = src.indexOf('assignments-today-distribution-card');
  const idxMonthly = src.indexOf('assignments-monthly-card');
  expect(idxToday).toBeGreaterThan(-1);
  expect(idxMonthly).toBeGreaterThan(-1);
  expect(idxToday).toBeLessThan(idxMonthly);
});

test('AC3-2: 금일 이력은 오늘 배정된 check_ins(정본)에서 파생, 방식은 audit 최신 action 으로 표기', () => {
  const src = read(PAGE);
  expect(src).toMatch(/todayDistribution/);
  // 방식(자동/수동/토스/당김) 라벨 매핑
  expect(src).toMatch(/auto_assign: '자동'/);
  expect(src).toMatch(/manual: '수동'/);
  // AC-1 정본과 동일 소스(monthCheckIns)에서 오늘분 필터
  expect(src).toMatch(/for \(const ci of monthCheckIns\)/);
});
