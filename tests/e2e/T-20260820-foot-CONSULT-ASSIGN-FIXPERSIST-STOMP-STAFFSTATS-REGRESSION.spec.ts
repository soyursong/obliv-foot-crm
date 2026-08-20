/**
 * Unit/regression spec — T-20260820-foot-CONSULT-ASSIGN-FIXPERSIST-STOMP-STAFFSTATS-REGRESSION (P0·hotfix)
 *
 * 증상② 초진 누적 배정(staffStats) 게이트 정밀화 — Option A
 *   (김주연 총괄 confirm 2026-08-20 17:37 · DA da_decision_foot_staffstats_chojin_assign_gate_expand).
 *
 * 배경: 기존 게이트 = consult_notify_status IS NOT NULL([확정] 클릭)만 초진 집계. notify 발송 blackout
 *   (상담대기방 알림 EF 장애 등) 기간엔 상담을 실제 진행한 자동배정 건이 NULL 로 남아 미계수(under-count).
 * 변경: (consult_notify_status IS NOT NULL) OR (상담단계를 실제로 지남 = hasPassedConsult(ci.status)).
 *   → notify NULL 이어도 상담단계를 지난 배정은 초진 집계에 포함(오늘 blackout 미계수 22건 복구 + 재발 방어).
 *
 * ⚠ OR-확장만 = 08-07 confirm 게이트(notify IS NOT NULL) 계수분 보존(narrowing 아님·회귀0).
 * db_change=false: 코드 로직만, 기존 데이터·write 무접촉.
 *
 * '상담단계 지남' 범위(DA): NEW_PATIENT_STAGES 에서 'consultation'(상담 시작) 이후 전 단계.
 *   pre-consult(registered/receiving/consult_waiting)는 상담 미개시 → 제외(false-positive 방지).
 *   cancelled/checklist(deprecated)는 staffStats 상위 필터에서 이미 배제 → 집합 미포함.
 *
 * 순수 함수 런타임 단언 + Assignments.tsx 게이트 정적 소스 가드(auth/DB/server/page 불요·결정론).
 * 실 갤탭 초진 집계 == 실제 배정 수 정합은 supervisor field-soak / 배포 후 검증 의무.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasPassedConsult,
  CONSULT_PASSED_STATUSES,
  NEW_PATIENT_STAGES,
} from '../../src/lib/status';
import type { CheckInStatus } from '../../src/lib/types';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 순수 함수 — hasPassedConsult / CONSULT_PASSED_STATUSES 경계
// ─────────────────────────────────────────────────────────────────────────────
test('상담단계 지남: consultation 이후 전 단계는 true (blackout 미계수 복구축)', () => {
  const passed: CheckInStatus[] = [
    'consultation',
    'exam_waiting',
    'examination',
    'treatment_waiting',
    'preconditioning',
    'laser_waiting',
    'healer_waiting',
    'laser',
    'payment_waiting',
    'done',
  ];
  for (const s of passed) {
    expect(hasPassedConsult(s)).toBe(true);
  }
});

test('pre-consult(상담 미개시) 단계·NULL 은 false (false-positive 방지)', () => {
  const notPassed: (CheckInStatus | null | undefined)[] = [
    'registered',
    'receiving',
    'consult_waiting',
    null,
    undefined,
  ];
  for (const s of notPassed) {
    expect(hasPassedConsult(s)).toBe(false);
  }
});

test('CONSULT_PASSED_STATUSES 는 cancelled/checklist 를 포함하지 않는다(상위 필터가 배제)', () => {
  expect(CONSULT_PASSED_STATUSES).not.toContain('cancelled' as CheckInStatus);
  expect(CONSULT_PASSED_STATUSES).not.toContain('checklist' as CheckInStatus);
});

test('범위 근거 정합: CONSULT_PASSED_STATUSES == NEW_PATIENT_STAGES 의 consultation 이후 전 단계', () => {
  const idx = NEW_PATIENT_STAGES.indexOf('consultation');
  expect(idx).toBeGreaterThan(-1);
  const expected = NEW_PATIENT_STAGES.slice(idx);
  expect(CONSULT_PASSED_STATUSES).toEqual(expected);
});

// ─────────────────────────────────────────────────────────────────────────────
// Assignments.tsx staffStats 게이트 — OR 확장 정적 소스 가드
// ─────────────────────────────────────────────────────────────────────────────
test('게이트: consultant 분기가 notify ∪ hasPassedConsult 로 OR-확장', () => {
  const src = read(PAGE);
  // 실제 게이트 코드 = 술어 결합 형태로만 등장(주석 언급은 앞) → lastIndexOf 로 코드 라인 앵커.
  const anchor = src.lastIndexOf('|| hasPassedConsult(ci.status)');
  expect(anchor).toBeGreaterThan(-1);
  const block = src.slice(anchor - 260, anchor + 40);
  // 게이트가 consultant 역할 한정이고, 08-07 notify branch 보존(회귀0) + 상담단계 branch OR 로 결합.
  expect(block).toContain("s.role === 'consultant'");
  expect(block).toContain('consult_notify_status != null');
  expect(block).toContain('||'); // OR 확장(narrowing 아님)
});

test('게이트: 치료(therapy)축은 hasPassedConsult 미적용(상담축 한정·불변)', () => {
  const src = read(PAGE);
  const therapyBlock = src.slice(src.indexOf('if (ci.therapist_id)'));
  const firstBump = therapyBlock.slice(0, therapyBlock.indexOf('bumpAssign'));
  expect(firstBump).not.toContain('hasPassedConsult');
  expect(firstBump).not.toContain('consult_notify_status');
});
