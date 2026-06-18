/**
 * E2E spec — T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX (P0)
 *
 * 사고: 배정화면([상담]/[치료] 탭) 직원 항목이 전혀 안 뜸 → 현장 즉시 불가.
 *
 * 근본 원인(diag 확정):
 *   staff 테이블에 display_name 컬럼이 DB에 없는데(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션)
 *   Assignments.tsx 와 autoAssign.ts(fetchActiveStaff)가 select 에 display_name 을 포함
 *   → PostgREST 400 "column staff.display_name does not exist"
 *   → staff = [] → 배정 풀(poolFor)·통계(staffStats)·드롭다운 전부 0건.
 *   (원인 A=구글시트 공집합/B=role 표류 아님. role 값은 정상: consultant 6·therapist 10)
 *
 * 수정: 두 staff select 에서 display_name 제거. UI 는 display_name ?? name fallback 유지(무해).
 *   → Closing/CustomerChartPage/ReservationDetailPopup/Handover 가 이미 적용한 검증된 패턴.
 *
 * 본 spec = 정본 소스 정적 단언으로 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(탭별 직원 표시) 확인은 supervisor 맥스튜디오 실브라우저 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const AUTOASSIGN = 'src/lib/autoAssign.ts';

// staff select 절을 추출(.from('staff') 직후 .select('...') 문자열들)
function staffSelects(src: string): string[] {
  const out: string[] = [];
  const re = /\.from\('staff'\)[\s\S]*?\.select\(\s*'([^']*)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 근본 원인 회귀 가드 — staff select 에 display_name 미포함
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: Assignments.tsx staff select 에 display_name 미포함 (400 회귀 차단)', () => {
  const selects = staffSelects(read(PAGE));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) {
    expect(sel).not.toContain('display_name');
    // 배정 필수 컬럼은 보존
    expect(sel).toContain('role');
    expect(sel).toContain('name');
  }
});

test('AC-1: autoAssign.ts fetchActiveStaff staff select 에 display_name 미포함', () => {
  const selects = staffSelects(read(AUTOASSIGN));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) {
    expect(sel).not.toContain('display_name');
    expect(sel).toContain('role');
    expect(sel).toContain('name');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: graceful — 시트 장애(출근자 공집합)여도 목록 자체는 노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2(graceful): 직원별 누적은 role 만으로 노출(출근 여부 무관) — workingIds 의존 없음', () => {
  const src = read(PAGE);
  // staffStats 는 role 필터만 사용(출근 점은 표시용 부가). workingIds 로 풀에서 탈락시키지 않음.
  expect(src).toMatch(/\.filter\(\(st\) => st\.staff\.role === wantRole\)/);
  expect(src).toMatch(/const wantRole = activeTab === 'consult' \? 'consultant' : 'therapist'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 0 — 탭/토스/당김 로직 불변 (HOTFIX 는 select 만 수정)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 탭/토스/당김/수동 핸들러·UI fallback 보존(로직 회귀 0)', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="assignments-tab-consult"');
  expect(src).toContain('data-testid="assignments-tab-therapy"');
  expect(src).toContain('const confirmToss = async');
  expect(src).toContain('const doPull = async');
  expect(src).toContain('const doManual = async');
  // UI 표시는 display_name ?? name fallback 유지(마이그 적용 시 자동 호환)
  expect(src).toMatch(/display_name \?\? .*name/);
});
