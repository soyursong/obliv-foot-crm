/**
 * E2E spec — T-20260618-foot-ASSIGN-CONSULT-THERAPY-TABS
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   "상담·치료사 배정 화면 한 화면에 상담/치료가 섞여 보인다. 같은 화면 안에 [상담]/[치료] 탭 2개로
 *    파트별 구분. 사이드바는 단일 메뉴 그대로 유지."
 *
 * 설계 확정(AC-0 그라운딩):
 *   - 대상: src/pages/Assignments.tsx (AUTOASSIGN-BALANCE-TOSS 통합 뷰)
 *   - 페이지 데이터는 이미 role('consult'|'therapy') 축으로 구분됨(activeRole/getAssignmentRole).
 *   - 구현 = shadcn Tabs 재사용 + activeTab(role) 상태로 3개 영역(오늘 배정현황/당김후보/직원별 누적)
 *     을 active 탭 기준 role 필터만 적용. 배정·토스·당김·수동override·권한·route·nav 전부 불변.
 *   - 기본 active 탭 = consult(상담).
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식 인코딩(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 너비/탭 활성/필터 노출의 실렌더 확인은 supervisor 맥스튜디오 실브라우저 단계에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const LAYOUT = 'src/components/AdminLayout.tsx';
const APP = 'src/App.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 — 탭 분리 표시 (AC-1/2/3)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: shadcn Tabs 재사용 + [상담]/[치료] 트리거 2개 + active 상태 와이어링', () => {
  const src = read(PAGE);
  expect(src).toContain("from '@/components/ui/tabs'");
  expect(src).toContain('data-testid="assignments-role-tabs"');
  expect(src).toContain('data-testid="assignments-tab-consult"');
  expect(src).toContain('data-testid="assignments-tab-therapy"');
  // active 탭 상태가 Tabs value/onValueChange 에 묶임
  expect(src).toMatch(/value=\{activeTab\}/);
  expect(src).toMatch(/onValueChange=.*setActiveTab/);
});

test('AC-1: 기본 active 탭 = consult(상담)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/useState<AssignmentRole>\('consult'\)/);
});

test('AC-2/3: 오늘 배정현황 — active 탭 기준 role 필터 (상담/치료 분리 노출)', () => {
  const src = read(PAGE);
  // 전체 today rows 는 헤더 카운트 보존용, 테이블은 activeTab 필터
  expect(src).toContain('const allTodayRows = checkIns');
  expect(src).toMatch(/const todayRows = allTodayRows\.filter\(\(x\) => x\.role === activeTab\)/);
});

test('AC-2/3: 당김 후보 — active 탭 role 필터', () => {
  const src = read(PAGE);
  expect(src).toMatch(/x\.eligible && x\.role === activeTab/);
  // memo deps 에 activeTab 포함(탭 전환 시 재계산)
  expect(src).toMatch(/\}, \[checkIns, slotEnter, activeTab\]\)/);
});

test('AC-2/3: 직원별 당월 누적 — active 탭 역할(consultant/therapist) 필터', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const wantRole = activeTab === 'consult' \? 'consultant' : 'therapist'/);
  expect(src).toMatch(/\.filter\(\(st\) => st\.staff\.role === wantRole\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 동작 회귀 — 토스/당김/수동 override 로직 불변 (AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 토스/당김/수동 배정 핸들러 그대로 보존(로직 회귀 0)', () => {
  const src = read(PAGE);
  expect(src).toContain('const confirmToss = async');
  expect(src).toContain('const doPull = async');
  expect(src).toContain('const doManual = async');
  // 배정 로직 모듈 import 불변
  expect(src).toContain('tossAssignment');
  expect(src).toContain('pullAssignment');
  expect(src).toContain('manualAssign');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: 사이드바 단일 메뉴 유지 — nav/route 무변경
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 사이드바 /admin/assignments 단일 항목 유지 (메뉴 추가/분리 없음)', () => {
  const layout = read(LAYOUT);
  // 배정 nav 항목이 정확히 1개
  const occurrences = (layout.match(/\/admin\/assignments/g) ?? []).length;
  expect(occurrences).toBe(1);
});

test('AC-5: route 무변경 — /admin/assignments 단일 라우트', () => {
  const app = read(APP);
  expect(app).toContain('assignments');
  // 신규 consult/therapy 전용 route 가 추가되지 않음
  expect(app).not.toContain('assignments/consult');
  expect(app).not.toContain('assignments/therapy');
});
