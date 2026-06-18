/**
 * E2E spec — T-20260618-foot-STAFF-DISPLAYNAME-SELECT-400 (P1)
 *
 * 사고: 예약(Reservations)·고객(Customers) 화면에서 담당자명이 무음 미표시.
 *
 * 근본 원인(diag 확정, ASSIGN-STAFF-EMPTY-HOTFIX 와 동일 계열):
 *   staff 테이블에 display_name 컬럼이 DB에 없는데(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션)
 *   Reservations.tsx(담당자명 resolve)·Customers.tsx(담당자 컬럼 맵)가 select 에 display_name 포함
 *   → PostgREST 400 "column staff.display_name does not exist"
 *   → staffRows/data = null (?? [] graceful 로 크래시는 없음) → 담당자명 맵 빈 채로 미표시.
 *
 * 수정: 두 staff select 에서 display_name 제거. UI 는 display_name || name fallback 유지(무해).
 *   → Closing/CustomerChartPage/ReservationDetailPopup/Handover/Assignments 가 이미 적용한 검증된 패턴.
 *
 * 본 spec = 정본 소스 정적 단언으로 회귀 가드(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(예약/고객 담당자명 표시) 확인은 supervisor 맥스튜디오 실브라우저(갤탭) 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RESERVATIONS = 'src/pages/Reservations.tsx';
const CUSTOMERS = 'src/pages/Customers.tsx';

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
test('AC-1: Reservations.tsx staff select 에 display_name 미포함 (400 회귀 차단)', () => {
  const selects = staffSelects(read(RESERVATIONS));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) {
    expect(sel).not.toContain('display_name');
    // 담당자명 resolve 필수 컬럼은 보존
    expect(sel).toContain('id');
    expect(sel).toContain('name');
  }
});

test('AC-1: Customers.tsx staff select 에 display_name 미포함 (400 회귀 차단)', () => {
  const selects = staffSelects(read(CUSTOMERS));
  expect(selects.length).toBeGreaterThan(0);
  for (const sel of selects) {
    expect(sel).not.toContain('display_name');
    expect(sel).toContain('id');
    expect(sel).toContain('name');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 회귀 0 — UI 담당자명 fallback(display_name || name) 보존
//   마이그 적용 시 자동 호환. select 만 수정, 표시 로직 불변.
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: Reservations.tsx UI 담당자명 fallback(display_name || name) 보존', () => {
  const src = read(RESERVATIONS);
  expect(src).toMatch(/display_name \|\| .*name/);
});

test('AC-2: Customers.tsx UI 담당자명 fallback(display_name || name) 보존', () => {
  const src = read(CUSTOMERS);
  expect(src).toMatch(/display_name \|\| .*name/);
});
