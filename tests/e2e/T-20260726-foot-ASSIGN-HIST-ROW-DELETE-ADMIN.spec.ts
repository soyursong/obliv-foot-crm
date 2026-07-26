/**
 * E2E spec — T-20260726-foot-ASSIGN-HIST-ROW-DELETE-ADMIN
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1785029897.172259):
 *   "상담·치료사 배정 > 직원별 누적 > 배정 이력 탭 — 관리자(admin) 계정만 개별 이력 행 삭제."
 *   배경: 2번차트 담당자를 '미정'으로 바꿔도 배정 이력은 자동 제외되지 않음(방문 기록 기반 별도 관리)
 *         → 잘못 기록된 이력을 관리자가 수동 정리 필요.
 *
 * ── surface 해석 ──────────────────────────────────────────────────────────────
 *   '직원별 누적 > 배정 이력'(행 목록, 삭제 시 누적 1 감소) = 직원별 누적 건수셀
 *   drill-down 다이얼로그(REVAMP 변경5, drillDialog). 이 팝업이 누적을 구성하는 배정
 *   명단(성함+차트번호)이며, 여기 배정(초진/재진) 행이 삭제 대상.
 *   (금일 배분 이력 카드의 삭제 = 별건 T-20260725-...-R2B, 오늘분·admin/manager/director.
 *    본 건은 누적/과거 이력 정정용 + admin 한정으로 축이 다름.)
 *
 * ── 설계 결정(WARN 반영) ──────────────────────────────────────────────────────
 *   [삭제 방식] soft-delete 재사용(softHideCheckIn → check_ins.deleted_at). hard-DELETE 금지.
 *              → 스키마 무변경(deleted_at/deleted_by 는 R2B 에서 旣 신설). data-architect
 *                CONSULT/DDL 게이트 비대상(WARN-1 soft-delete 우선 권고 부합).
 *   [권한] FE = admin 한정(isAdmin, canEditDistribution 의 admin/manager/director 와 구분).
 *          서버(AC3) = check_ins UPDATE RLS(is_admin_or_manager) 가 staff/counselor 차단.
 *   [대상 행] 배정(초진/재진) = AssignDrillItem.checkInId 존재 → 삭제 노출.
 *            토스/당김 = audit 액션(checkInId=null) → 삭제 비대상.
 *   [집계 정합 AC4] 삭제 후 load() → staffStats 재계산(monthCheckIns .is(deleted_at,null))
 *                 + drillDialog.items 낙관적 제거. REVAMP 컬럼재편본과 동일 소스.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec(R2B) 동형.
 * 실렌더(admin 삭제→숨김 영속 / 스탭 미노출·서버 403 / 확인창 취소)는
 * supervisor 맥스튜디오 실브라우저 단계에서 3 시나리오로 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const ENGINE = 'src/lib/autoAssign.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 관리자 정상 삭제 동선
//   admin → 직원별 누적 건수셀 → drill 팝업 배정 이력 행 → 삭제 버튼 → 확인 → 행 사라짐 → 누적 1 감소
// ─────────────────────────────────────────────────────────────────────────────
test('AC1: drill-down 배정 이력 행에 삭제 버튼 렌더 (admin + 배정 행 한정)', () => {
  const src = read(PAGE);
  // 삭제 버튼 testid
  expect(src).toContain('data-testid={`accum-drill-delete-btn-${it.key}`}');
  // 노출 조건 = admin && checkIn( 배정 초진/재진 행 )
  expect(src).toMatch(/const canDeleteRow = isAdmin && !!it\.checkInId;/);
  expect(src).toMatch(/\{canDeleteRow && \(\s*\n?\s*<Button/);
  // 클릭 → 즉시 삭제 아님, 확인 다이얼로그 타깃 세팅
  expect(src).toMatch(/onClick=\{[\s\S]*?setDrillDeleteTarget\(\{/);
});

test('AC2: 확인 다이얼로그(drillDeleteTarget) — 취소/삭제 + 되살림 안내', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid="accum-drill-delete-confirm-btn"');
  expect(src).toContain('data-testid="accum-drill-delete-cancel-btn"');
  expect(src).toContain('배정 이력 삭제');
  // soft-hide(복원 가능) 안내 + 누적 반영 안내
  expect(src).toMatch(/화면에서만 숨겨지며 되살릴 수 있습니다/);
  expect(src).toMatch(/직원별 누적 수치에서 빠집니다/);
  // 확인 → doSoftHideDrill
  expect(src).toMatch(/onClick=\{\(\) => void doSoftHideDrill\(\)\}/);
});

test('AC4: 삭제 후 누적 셀 실시간 반영 — load() 재조회 + 팝업 행 낙관적 제거', () => {
  const src = read(PAGE);
  const start = src.indexOf('const doSoftHideDrill = async');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n  };', start));
  // (a) 팝업 items 에서 해당 행 즉시 제거(행 사라짐)
  expect(body).toMatch(/setDrillDialog\(\(prev\) =>[\s\S]*?items: prev\.items\.filter\(\(it\) => it\.key !== drillDeleteTarget\.itemKey\)/);
  // (b) load() 재조회 → staffStats 재계산(누적 1 감소, AC4)
  expect(body).toMatch(/void load\(\);/);
  // 누적 정본 = monthCheckIns( deleted_at IS NULL 필터 ) → 삭제행 자동 제외
  expect(src).toMatch(/\.is\('deleted_at', null\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 일반 스탭 권한 차단 (FE 미노출 + 서버측 차단)
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-FE: 삭제 버튼은 admin 한정(isAdmin) — 일반 스탭/치료사 미노출', () => {
  const src = read(PAGE);
  // admin 한정 플래그 정의 (canEditDistribution 의 3역할과 구분)
  expect(src).toMatch(/const isAdmin = profile\?\.role === 'admin';/);
  // 삭제 노출 게이트가 isAdmin 을 포함
  expect(src).toMatch(/const canDeleteRow = isAdmin && /);
});

test('AC3-서버: soft-hide 는 check_ins UPDATE(RLS is_admin_or_manager) — staff/counselor 서버 차단', () => {
  // FE 숨김만으로 불충분(AC3) → 서버측은 softHideCheckIn 의 check_ins UPDATE RLS 가 담당.
  //   is_admin_or_manager 정책이 staff/counselor 의 UPDATE 를 거부 → 스탭 토큰 직접 호출 시 0-row(거부).
  const eng = read(ENGINE);
  const start = eng.indexOf('export async function softHideCheckIn');
  expect(start).toBeGreaterThan(-1);
  const body = eng.slice(start, eng.indexOf('export async function', start + 1));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // hard-DELETE 부재 — deleted_at UPDATE 만
  expect(code).not.toMatch(/\.delete\(\)/);
  expect(code).toMatch(/\.from\('check_ins'\)/);
  expect(code).toMatch(/\.update\(\{[\s\S]*?deleted_at:[\s\S]*?deleted_by:/);
  // rows-affected 검증 — RLS 거부 시 0-row 를 성공으로 오인 차단(AC3 서버 차단 관측성)
  expect(body).toMatch(/\.select\('id'\)/);
  expect(body).toMatch(/if \(!data \|\| data\.length === 0\)\s*\n?\s*return \{[\s\S]*?ok: false/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 엣지 케이스
// ─────────────────────────────────────────────────────────────────────────────
test('엣지-취소: 취소 시 doSoftHideDrill 미실행(타깃 해제만) → 행 유지·수치 불변', () => {
  const src = read(PAGE);
  // 취소 버튼 = setDrillDeleteTarget(null) 만(삭제 실행 없음). 취소 Button 블록에 testid + 해제 onClick 공존.
  const cancelIdx = src.indexOf('data-testid="accum-drill-delete-cancel-btn"');
  expect(cancelIdx).toBeGreaterThan(-1);
  const cancelBlock = src.slice(cancelIdx - 200, cancelIdx + 60);
  expect(cancelBlock).toMatch(/onClick=\{\(\) => setDrillDeleteTarget\(null\)\}/);
});

test('엣지-soft-delete: 삭제 실행자 = profile.id(deleted_by 감사) + hard-DELETE 아님', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const doSoftHideDrill = async \(\)/);
  expect(src).toMatch(/softHideCheckIn\(\{\s*\n?\s*checkInId: drillDeleteTarget\.checkInId,\s*\n?\s*deletedBy: profile\?\.id \?\? null,/);
});

test('엣지-대상격리: 토스/당김 행(checkInId=null)은 삭제 비대상', () => {
  const src = read(PAGE);
  // 배정(초진/재진) 행만 checkInId 세팅
  expect(src).toMatch(/checkInId: ci\.id,/);
  // 토스/당김 item 은 checkInId: null (spread 상속 차단)
  expect(src).toMatch(/\{ \.\.\.itemFromCi\(ci\), key: a\.id, date: seoulISODate\(a\.created_at\), checkInId: null \}/);
  expect(src).toMatch(/name: '\(고객 정보 없음\)'[\s\S]*?checkInId: null/);
  // 인터페이스에 checkInId 필드 존재
  expect(src).toMatch(/checkInId: string \| null;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀: 기존 drill 팝업(2번차트 링크) + 금일배분 삭제(R2B) 공존
// ─────────────────────────────────────────────────────────────────────────────
test('회귀: drill 2번차트 링크 + 금일배분 삭제(R2B) 공존', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`accum-drill-chart-link-${it.key}`}'); // 변경5 유지
  expect(src).toContain('data-testid="accum-drill-list"'); // drill 리스트 유지
  expect(src).toContain('data-testid={`dist-delete-btn-${r.id}`}'); // R2B 금일배분 삭제 유지(별건)
});
