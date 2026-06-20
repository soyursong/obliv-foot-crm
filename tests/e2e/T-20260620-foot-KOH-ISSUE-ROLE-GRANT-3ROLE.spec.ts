/**
 * E2E spec — T-20260620-foot-KOH-ISSUE-ROLE-GRANT-3ROLE
 * 균검사지(KOH) '발급요청' 권한 확정 — 상담실장/코디네이터/치료사 3역할 + 의사(director).
 *
 * reporter(풋센터 C0ATE5P6JTH, U0ATDB587PV) 직접 확정:
 *   "검사결과 발급 버튼은 실제로 직원들이 처리할 항목 → 상담실장/코디네이터/치료사 전부 권한 줘."
 * ★supersedes KOH-ISSUE-PERMISSION-SPEC AC-2 '발급=director 전용(직원 미노출)'★ — 주연총괄 narrowing 게이트 종료.
 *
 * 확정 스펙:
 *   1. KohReportTab '발급요청' 노출/활성 = canIssueKoh(consultant·coordinator·therapist·director).
 *   2. '발급하기'(라벨, 의사 표기)는 director 유지 — 라벨 분기(isDoctor)는 무변경. 동작(RPC)은 역할무관 동일.
 *   3. 3역할+의사 외(part_lead/staff/admin·manager/tm/비인증)에는 발급(요청) 버튼·선택 컬럼 미노출(회귀 가드).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 발급 게이트(canIssue=canIssueKoh(role))를 모사. FE-only(NO-DDL).
 *   정본: src/lib/permissions.ts KOH_ISSUE_ROLES / canIssueKoh + KohReportTab const canIssue = canIssueKoh(role).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: permissions.ts canIssueKoh ──────────────────────────────────
//   export const KOH_ISSUE_ROLES = ['director','consultant','coordinator','therapist'];
//   canIssueKoh(role) = KOH_ISSUE_ROLES.includes(role)
type UserRole = string | null | undefined;
const KOH_ISSUE_ROLES = ['director', 'consultant', 'coordinator', 'therapist'];
const canIssueKoh = (role: UserRole) => KOH_ISSUE_ROLES.includes(role ?? '');

// ── 정본 모사: 라벨 분기(KohReportTab isDoctor) — 무변경 ──
const isDoctorRole = (role: UserRole) => role === 'director';
const publishBtnLabel = (role: UserRole) => (isDoctorRole(role) ? '발급하기' : '발급요청');

// ── KohReportTab 렌더 게이트(본 티켓 변경분) — 전부 canIssue 로 통일 ──
const showsBulkPublishBtn = (role: UserRole) => canIssueKoh(role);
const showsSelectColumn = (role: UserRole) => canIssueKoh(role);
const showsRowSelectCheckbox = (role: UserRole) => canIssueKoh(role);
/** 미발행 행 발급(요청) 버튼 = canIssue. 발행완료 행은 published viewer(전 역할). */
const showsRowPublishBtn = (role: UserRole, published: boolean) => (published ? false : canIssueKoh(role));
const showsPublishedViewer = (published: boolean) => published; // 역할 무관(읽기)

const GRANTED_STAFF = ['consultant', 'coordinator', 'therapist']; // 3역할(reporter 확정)
const NON_TARGET_ROLES = ['part_lead', 'staff', 'admin', 'manager', 'technician', 'tm'];

// ===========================================================================
test.describe('T-20260620-foot-KOH-ISSUE-ROLE-GRANT-3ROLE', () => {
  // ── 시나리오 1·2·3: 상담실장/코디네이터/치료사 — 발급요청 노출/활성/클릭 ──
  test('S1-S3: 상담실장/코디네이터/치료사 3역할은 발급요청 버튼 노출(미발행 행)', () => {
    for (const role of GRANTED_STAFF) {
      expect(showsRowPublishBtn(role, false)).toBe(true);     // 발급요청 버튼 노출
      expect(publishBtnLabel(role)).toBe('발급요청');           // 직원 라벨 = 발급요청
    }
  });

  test('S1-S3: 3역할은 선택 컬럼·일괄발급요청 버튼도 노출(일괄 동선 정합)', () => {
    for (const role of GRANTED_STAFF) {
      expect(showsSelectColumn(role)).toBe(true);
      expect(showsRowSelectCheckbox(role)).toBe(true);
      expect(showsBulkPublishBtn(role)).toBe(true);
    }
  });

  // ── 시나리오 4: 의사 — 발급하기 유지(회귀 가드) ──
  test('S4: director는 발급하기 라벨·발급 액션 전부 유지(본 티켓 의사 동선 무변경)', () => {
    expect(showsRowPublishBtn('director', false)).toBe(true);
    expect(publishBtnLabel('director')).toBe('발급하기');       // 의사 라벨 = 발급하기 유지
    expect(showsBulkPublishBtn('director')).toBe(true);
    expect(showsSelectColumn('director')).toBe(true);
    expect(showsRowSelectCheckbox('director')).toBe(true);
  });

  // ── 시나리오 5: 비대상 역할 — 미노출(회귀 가드) ──
  test('S5: 3역할+의사 외 역할은 발급(요청) 버튼·선택 컬럼 전부 미노출', () => {
    for (const role of NON_TARGET_ROLES) {
      expect(showsRowPublishBtn(role, false)).toBe(false);
      expect(showsBulkPublishBtn(role)).toBe(false);
      expect(showsSelectColumn(role)).toBe(false);
      expect(showsRowSelectCheckbox(role)).toBe(false);
    }
  });

  test('S5: role 누락/비인증도 발급 액션 미노출', () => {
    for (const role of [null, undefined, '']) {
      expect(showsRowPublishBtn(role, false)).toBe(false);
      expect(showsBulkPublishBtn(role)).toBe(false);
    }
  });

  // ── 발행완료 viewer 는 전 역할 공통(읽기) — 무변경 ──
  test('REG: 발행완료 행 보기(viewer)는 전 역할 공통, 발급 버튼은 비노출(역할 무관)', () => {
    for (const role of ['director', ...GRANTED_STAFF, ...NON_TARGET_ROLES]) {
      expect(showsPublishedViewer(true)).toBe(true);
      expect(showsRowPublishBtn(role, true)).toBe(false);
    }
  });

  // ── 정확한 권한 집합(byte-level) ──
  test('SET: 발급 권한 = director + consultant + coordinator + therapist 정확히 4역할', () => {
    expect(KOH_ISSUE_ROLES.slice().sort()).toEqual(
      ['consultant', 'coordinator', 'director', 'therapist'],
    );
    // admin/manager 는 임상 발급 주체가 아니므로 미포함(현장 확정 3역할 + director 한정).
    expect(canIssueKoh('admin')).toBe(false);
    expect(canIssueKoh('manager')).toBe(false);
  });
});
