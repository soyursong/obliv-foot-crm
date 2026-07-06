/**
 * T-20260706-foot-INTAKE-REVISIT-JUDGE-365  (P1, NEW-TASK MSG-20260706-092955-7y7q)
 *
 * 초진/재진 **분류 기준**을 stored customers.visit_type(완료 시 영구 'returning' 승격)에서
 * **동적 365일 date-diff(서버 KST)** 로 교체. 대표 확정(MSG-jo9e, B안 + 365일) 근거.
 *
 *   재진(returning) = 최근 '완료(done)' 방문일 기준 365일 이내(경계 포함)
 *   초진취급(new)    = 365일 초과 · 완료이력 무(無)
 *   종로 오리진점 풋센터 한정(clinicId 스코프) — 타 지점 방문 미포함.
 *
 * ⚠ 범위: '분류 기준'만 교체. 라우팅 목적지(상담대기 vs 치료대기) 매핑 불변.
 * ⚠ 부모 T-20260522-foot-INTAKE-BRANCH 소유(초진 팝업·주민번호·건보동의서) 무접촉.
 * db_change=false · 무-DDL · 비-PII.
 *
 * 검증(순수 함수 + 배선 정적):
 *   AC-1  경계값(365/366) off-by-one — 정확히 365일=재진, 366일=초진취급.
 *   AC-2  무이력/파싱실패 → 초진취급.
 *   AC-3  diffDaysISO 정확성(KST 자정 정규화, 월경계 포함).
 *   AC-4  RETURNING_WINDOW_DAYS = 365 상수 고정.
 *   AC-5  NewCheckInDialog 배선 — 기존 고객 선택 시 recency 판정 사용(무조건 'returning' 하드코딩 부재).
 *   AC-6  라우팅 매핑 불변 회귀가드 — new→receiving / returning→treatment_waiting.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  classifyVisitByRecency,
  diffDaysISO,
  RETURNING_WINDOW_DAYS,
} from '../../src/lib/visitRecency';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIALOG = path.resolve(__dirname, '../../src/components/NewCheckInDialog.tsx');
const POPUP = path.resolve(__dirname, '../../src/components/ReservationDetailPopup.tsx');
const readDialog = () => fs.readFileSync(DIALOG, 'utf-8');
const readPopup = () => fs.readFileSync(POPUP, 'utf-8');

// ── 오늘 기준을 고정해 경계 케이스를 결정적으로 검증 (KST 날짜 문자열) ──
const TODAY = '2026-07-06';

/** todayISO 에서 N일 전 KST 날짜(YYYY-MM-DD) */
function daysAgoISO(todayISO: string, n: number): string {
  const t = Date.parse(`${todayISO}T00:00:00Z`);
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

test.describe('T-20260706 INTAKE-REVISIT-JUDGE-365 — 순수 판정', () => {
  // ── AC-1: 경계값(365/366) off-by-one ──
  test('AC-1: 정확히 365일 전 완료방문 = 재진(경계 포함), 366일 = 초진취급', () => {
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 365), TODAY)).toBe('returning');
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 366), TODAY)).toBe('new');
    // 경계 인접
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 364), TODAY)).toBe('returning');
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 367), TODAY)).toBe('new');
  });

  test('AC-1b: 최근/당일 방문은 재진, 1일 전도 재진', () => {
    expect(classifyVisitByRecency(TODAY, TODAY)).toBe('returning'); // diff=0
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 1), TODAY)).toBe('returning');
    expect(classifyVisitByRecency(daysAgoISO(TODAY, 30), TODAY)).toBe('returning');
  });

  // ── AC-2: 무이력/파싱실패 → 초진취급 ──
  test('AC-2: 완료이력 무(null/undefined/빈문자열/깨진값) → 초진취급(new)', () => {
    expect(classifyVisitByRecency(null, TODAY)).toBe('new');
    expect(classifyVisitByRecency(undefined, TODAY)).toBe('new');
    expect(classifyVisitByRecency('', TODAY)).toBe('new');
    expect(classifyVisitByRecency('not-a-date', TODAY)).toBe('new');
  });

  // ── AC-3: diffDaysISO 정확성 ──
  test('AC-3: diffDaysISO — KST 자정 정규화 일수차(월/년 경계 포함)', () => {
    expect(diffDaysISO('2026-07-06', '2026-07-06')).toBe(0);
    expect(diffDaysISO('2026-07-05', '2026-07-06')).toBe(1);
    expect(diffDaysISO('2026-06-30', '2026-07-01')).toBe(1); // 월 경계
    expect(diffDaysISO('2025-07-06', '2026-07-06')).toBe(365); // 1년(비윤년 구간)
    expect(diffDaysISO('2024-07-06', '2025-07-06')).toBe(365);
    expect(Number.isNaN(diffDaysISO('bad', '2026-07-06'))).toBe(true);
  });

  // ── AC-4: 윈도우 상수 고정 ──
  test('AC-4: RETURNING_WINDOW_DAYS = 365 (대표 확정값)', () => {
    expect(RETURNING_WINDOW_DAYS).toBe(365);
  });
});

test.describe('T-20260706 INTAKE-REVISIT-JUDGE-365 — 배선/회귀 정적 가드', () => {
  // ── AC-5: NewCheckInDialog 배선 ──
  test('AC-5: 기존 고객 선택 핸들러가 recency 판정(resolveVisitTypeByRecency)을 사용', () => {
    const src = readDialog();
    expect(src).toContain("import { resolveVisitTypeByRecency } from '@/lib/visitRecency'");
    expect(src).toContain('const handlePatientSelect = async (p: PatientMatch)');
    expect(src).toContain('await resolveVisitTypeByRecency(p.id, clinicId)');
    // 판정 결과로 visitType 확정
    expect(src).toMatch(/const resolved = await resolveVisitTypeByRecency\(p\.id, clinicId\);\s*\n\s*setVisitType\(resolved\)/);
  });

  test('AC-5b: 회귀 차단 — 기존 고객=무조건 재진 하드코딩 부재(옛 동작 재유입 방지)', () => {
    const src = readDialog();
    // 옛 코드: handlePatientSelect 동기 + setVisitType('returning') 직후 toast 로 끝나는 형태.
    // 낙관적 선반영 1건은 허용하나, 최종 확정이 recency 여야 함(위 AC-5 가 강제).
    // 완전 동기 핸들러로의 회귀(async 제거) 차단.
    expect(src).not.toContain('const handlePatientSelect = (p: PatientMatch) => {');
  });

  // ── AC-6: 라우팅 매핑 불변(분류 기준만 교체) ──
  test('AC-6: 라우팅 목적지 매핑 불변 — new→receiving / returning→treatment_waiting', () => {
    const src = readDialog();
    // 초진/재진 → 상태 매핑이 그대로 유지되는지(분류 기준 교체가 라우팅을 건드리지 않음)
    expect(src).toContain("visitType === 'returning'");
    expect(src).toContain("'treatment_waiting'");
    expect(src).toContain("'receiving'");
  });

  // ── AC-7: 예약 [접수] 경로(ReservationDetailPopup.doCheckIn)도 recency 판정 사용 ──
  test('AC-7: 예약→체크인 전환(doCheckIn)이 stored reservation.visit_type 대신 recency 판정 사용', () => {
    const src = readPopup();
    expect(src).toContain("import { resolveVisitTypeByRecency } from '@/lib/visitRecency'");
    // 식별 고객 + non-experience 예약에 한해 recency 판정으로 effVisitType 도출
    expect(src).toMatch(/const effVisitType: VisitType =[\s\S]{0,160}resolveVisitTypeByRecency\(reservation\.customer_id, reservation\.clinic_id\)/);
    // insert 및 status 라우팅이 effVisitType 을 사용(stored reservation.visit_type 직결 회귀 차단)
    expect(src).toContain('visit_type: effVisitType,');
    expect(src).toMatch(/status: effVisitType === 'returning'\s*\?\s*'treatment_waiting'/);
    // 라우팅 매핑 불변(effVisitType 로 입력만 교체, 매핑 문구 보존)
    expect(src).toContain("'receiving'");
  });

  test('AC-7b: experience/미식별 예약은 stored visit_type 보존(과잉 재분류 차단)', () => {
    const src = readPopup();
    expect(src).toContain("reservation.visit_type !== 'experience'");
    expect(src).toContain('reservation.customer_id && reservation.visit_type');
  });
});
