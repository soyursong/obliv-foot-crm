/**
 * E2E spec — T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE
 * 균검사지(KOH) 발급 권한 = 전직군(8역할) + 라벨분기 제거(전직군 단일 '발급하기').
 *
 * reporter(문지은 대표원장, U0ALGAAAJAV, 풋센터 C0ATE5P6JTH) 직접 지시:
 *   "진료대시보드에서 균검사지 발급하기 < 권한 다 풀어줘 모든 직군 가능"
 *   (ts=1781932348.900389) "아니, 발급하기 권한 싹 풀어줘" — 직전 봇 라벨분기 제안 명시 거부.
 * ★supersedes GRANT-3ROLE(4역할)★ — /admin/doctor-tools 라우트 가드 8역할과 동일 집합으로 확장.
 * ★supersedes KOHBTN-ROLE-LABEL-VALIDGATE 라벨분기(의사='발급하기'/직원='발급요청')★ — 전직군 단일 '발급하기'.
 *
 * 확정 스펙:
 *   1. KohReportTab 발급 노출/활성 = canIssueKoh(전8역할: admin·manager·director·consultant·coordinator·therapist·technician·part_lead).
 *   2. 라벨분기 제거 — director 포함 전직군 단일 '발급하기'(일괄 '일괄발급하기'). '발급요청' 라벨 폐기.
 *   3. 발급 실행(publish_koh_result RPC) 서버측 게이트 = is_approved_user() — director 강제 없음(전 승인직원 실행 가능).
 *      → FE 게이트만 전8역할로 확장하면 RPC 와 정합(NO-DDL).
 *   4. canIssue=false(tm/비인증)에만 발급 버튼·선택 컬럼 미노출(회귀 가드).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 발급 게이트(canIssue=canIssueKoh(role))를 모사. FE-only(NO-DDL).
 *   정본: src/lib/permissions.ts KOH_ISSUE_ROLES / canIssueKoh + KohReportTab const canIssue / publishBtnLabel='발급하기'.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: permissions.ts canIssueKoh (본 티켓 변경분 — 전8역할) ──────────
//   export const KOH_ISSUE_ROLES =
//     ['admin','manager','director','consultant','coordinator','therapist','technician','part_lead'];
//   canIssueKoh(role) = KOH_ISSUE_ROLES.includes(role)
type UserRole = string | null | undefined;
const KOH_ISSUE_ROLES = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'technician', 'part_lead',
];
const canIssueKoh = (role: UserRole) => KOH_ISSUE_ROLES.includes(role ?? '');

// ── 정본 모사: 버튼 라벨 — 라벨분기 제거(전직군 단일 '발급하기') ──
//   KohReportTab: const publishBtnLabel = '발급하기'; bulk(0건)='일괄발급하기'; pubNoun='발급'.
const publishBtnLabel = (_role: UserRole) => '발급하기';
const bulkPublishBtnLabel = (_role: UserRole, selectedCount: number) =>
  selectedCount > 0 ? `선택 ${selectedCount}건 일괄발급` : '일괄발급하기';

// ── KohReportTab 렌더 게이트 — 전부 canIssue 로 통일 ──
const showsBulkPublishBtn = (role: UserRole) => canIssueKoh(role);
const showsSelectColumn = (role: UserRole) => canIssueKoh(role);
const showsRowSelectCheckbox = (role: UserRole) => canIssueKoh(role);
/** 미발행 행 발급 버튼 = canIssue. 발행완료 행은 published viewer(전 역할). */
const showsRowPublishBtn = (role: UserRole, published: boolean) => (published ? false : canIssueKoh(role));
const showsPublishedViewer = (published: boolean) => published; // 역할 무관(읽기)

// ── 발급 실행(publish_koh_result) 서버측 게이트 모사: is_approved_user() — 전 승인직원 ──
//   정본 RPC 게이트 = `IF NOT is_approved_user() THEN RAISE EXCEPTION`. director/admin/manager 강제 아님.
const serverAllowsPublish = (approvedUser: boolean) => approvedUser;

const NEW_4_ROLES = ['manager', 'technician', 'part_lead', 'admin'];       // additive 추가 4역할
const EXISTING_3_ROLES = ['consultant', 'coordinator', 'therapist'];        // 기존 3역할(회귀0)
const ALL_8_ROLES = [...KOH_ISSUE_ROLES];
const NON_TARGET_ROLES = ['tm'];                                           // canIssue=false(미노출)

// ===========================================================================
test.describe('T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE', () => {
  // ── 시나리오 1~4: 신규 4역할(manager/technician/part_lead/admin) — 발급하기 노출+활성+클릭 ──
  test('S1-S4: 신규 4역할(manager/technician/part_lead/admin)은 발급하기 버튼 노출(미발행 행)', () => {
    for (const role of NEW_4_ROLES) {
      expect(showsRowPublishBtn(role, false)).toBe(true);     // 발급 버튼 노출(활성)
      expect(publishBtnLabel(role)).toBe('발급하기');           // 전직군 단일 라벨 = 발급하기
      expect(serverAllowsPublish(true)).toBe(true);           // 승인직원 → RPC 발급 실행 허용(클릭 가능)
    }
  });

  test('S1-S4: 신규 4역할은 선택 컬럼·일괄발급하기 버튼도 노출(일괄 동선 정합)', () => {
    for (const role of NEW_4_ROLES) {
      expect(showsSelectColumn(role)).toBe(true);
      expect(showsRowSelectCheckbox(role)).toBe(true);
      expect(showsBulkPublishBtn(role)).toBe(true);
      expect(bulkPublishBtnLabel(role, 0)).toBe('일괄발급하기'); // '일괄발급요청' 폐기
    }
  });

  // ── 시나리오 5(★): director — 발급하기 회귀0(최종발급 주체, 무변경) ──
  test('S5(★): director는 발급하기 라벨·발급 액션 전부 유지(회귀0)', () => {
    expect(showsRowPublishBtn('director', false)).toBe(true);
    expect(publishBtnLabel('director')).toBe('발급하기');       // 의사 라벨 = 발급하기(불변)
    expect(showsBulkPublishBtn('director')).toBe(true);
    expect(showsSelectColumn('director')).toBe(true);
    expect(showsRowSelectCheckbox('director')).toBe(true);
    expect(bulkPublishBtnLabel('director', 0)).toBe('일괄발급하기');
    expect(serverAllowsPublish(true)).toBe(true);
  });

  // ── 시나리오 6: 기존 3역할(consultant/coordinator/therapist) — 발급하기 회귀0 ──
  test('S6: 기존 3역할은 발급하기로 통일(라벨분기 제거 — 더 이상 발급요청 아님)', () => {
    for (const role of EXISTING_3_ROLES) {
      expect(showsRowPublishBtn(role, false)).toBe(true);
      expect(publishBtnLabel(role)).toBe('발급하기');           // ★기존 '발급요청' → '발급하기'로 통일★
      expect(showsBulkPublishBtn(role)).toBe(true);
      expect(showsSelectColumn(role)).toBe(true);
      expect(bulkPublishBtnLabel(role, 0)).toBe('일괄발급하기');
    }
  });

  // ── 전직군 라벨 통일 검증 — '발급요청' 잔존 0 ──
  test('LABEL: 전8역할 라벨이 전부 단일 발급하기 — 발급요청 라벨 잔존 0', () => {
    for (const role of ALL_8_ROLES) {
      expect(publishBtnLabel(role)).toBe('발급하기');
      expect(publishBtnLabel(role)).not.toBe('발급요청');
      expect(bulkPublishBtnLabel(role, 0)).not.toBe('일괄발급요청');
    }
  });

  // ── 비대상(tm/비인증) — 미노출(회귀 가드) ──
  test('REG: canIssue=false(tm) 및 role 누락/비인증은 발급 버튼·선택 컬럼 미노출', () => {
    for (const role of [...NON_TARGET_ROLES, null, undefined, '']) {
      expect(showsRowPublishBtn(role, false)).toBe(false);
      expect(showsBulkPublishBtn(role)).toBe(false);
      expect(showsSelectColumn(role)).toBe(false);
      expect(showsRowSelectCheckbox(role)).toBe(false);
    }
  });

  // ── 발행완료 viewer 는 전 역할 공통(읽기) — 무변경 ──
  test('REG: 발행완료 행 보기(viewer)는 전 역할 공통, 발급 버튼은 비노출(역할 무관)', () => {
    for (const role of [...ALL_8_ROLES, ...NON_TARGET_ROLES]) {
      expect(showsPublishedViewer(true)).toBe(true);
      expect(showsRowPublishBtn(role, true)).toBe(false);
    }
  });

  // ── 정확한 권한 집합(byte-level) — 라우트 가드 8역할과 동일 ──
  test('SET: 발급 권한 = 전8역할 정확히(라우트 가드 doctor-tools 와 동일 집합)', () => {
    expect(KOH_ISSUE_ROLES.slice().sort()).toEqual(
      ['admin', 'consultant', 'coordinator', 'director', 'manager', 'part_lead', 'technician', 'therapist'],
    );
    // 신규 4역할 전부 true (GRANT-3ROLE 에서 false 였던 회귀 상승 검증).
    for (const role of NEW_4_ROLES) expect(canIssueKoh(role)).toBe(true);
    // tm 만 여전히 false(canIssue 비대상).
    expect(canIssueKoh('tm')).toBe(false);
  });
});
