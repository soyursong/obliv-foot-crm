/**
 * E2E spec — T-20260620-foot-KOH-ISSUE-PERMISSION-SPEC
 * 균검사지(KOH) 발급 권한 모델 (대표원장 확인 권위 스펙, 문지은 대표원장 U0ALGAAAJAV).
 *
 * ★SUPERSEDED (AC-2 부분): T-20260620-foot-KOH-ISSUE-ROLE-GRANT-3ROLE 이 발급요청 권한 대상을 재확정★
 *   reporter(C0ATE5P6JTH) 확정: KohReportTab '발급요청' = 상담실장/코디네이터/치료사 3역할 + 의사(director).
 *   본 스펙의 'AC-2 발급=director 전용' 시뮬레이션은 canIssueKoh(4역할)로 정정됨(아래). AC-1(발급요청 동선)은 불변.
 *
 * 권한 모델(원본, AC-2는 superseded):
 *   · 발급요청(검사지 발급 신청) = 직원(전직원 default / 치료사 narrowing은 주연총괄 컨펌) — 2번차트 KohRequestToggle 동선.
 *   · 발급(요청) 버튼(진료대시보드 KohReportTab) = canIssueKoh(3역할+의사). 라벨만 의사='발급하기' / 직원='발급요청'.
 *   · 발행완료 viewer 는 전 역할 공통(읽기) 유지.
 *
 * RC(그라운딩, 진행로그 (a) 확정):
 *   (a) 발급요청 = 단순 surface/라벨 분리 (2단계 요청상태 영속화 아님) → FE-only, NO-DDL.
 *       요청상태는 旣 check_in_services.koh_requested(ADDITIVE, 20260615190000)로 영속화됨.
 *   (b) 진료대시보드(DoctorTools.tsx <h1>진료대시보드</h1>)는 전체 공개 — 치료사 등 직원도 진입 가능.
 *       → 직원이 균검사지 탭 진입 시, '발급요청'(직원기능)이 의사화면에 노출되던 것이 KOHBTN deploy_hold 충돌.
 *
 * 본 티켓 신규 actionable:
 *   AC-1 직원 발급요청 동선 = KohRequestToggle + request_koh_for_customer RPC(is_approved_user, 전직원 default)로 旣 충족.
 *        역할 게이트 단일 지점 = RPC is_approved_user(). 주연총괄 치료사 narrowing 시 이 1지점만 조정(FE 재구조화 불요).
 *   AC-2 진료대시보드 발급 액션(단건/일괄 발급 + 선택 컬럼) = director 전용 렌더. 비-director는 발급 액션 미노출.
 *        발행완료 행 보기(viewer)는 전 역할 공통(읽기) 유지. 명단·상태·조갑부위는 미변경(불명확 스킵 가드).
 *
 * NOTOUCH: f600d896(라벨 분기) / 825dc2be(AC-4 enable-gate) 재작업 금지. 발행 RPC 시멘틱 무변경(KOHTEST-LIFECYCLE AC-5).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — KohReportTab 발급 액션 렌더 게이트(isDoctor)를 모사. FE-only(NO-DDL).
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 역할 파생 (KohReportTab.tsx — const isDoctor = profile?.role === 'director') ──
type UserRole = string | null | undefined;
const isDoctorRole = (role: UserRole) => role === 'director';

// ★T-20260620-foot-KOH-ISSUE-ROLE-GRANT-3ROLE 이 본 스펙 AC-2(발급=director 전용)를 supersede★
//   reporter(C0ATE5P6JTH) 확정: 발급요청 = 상담실장/코디네이터/치료사 3역할 + 의사. 라벨(발급하기/발급요청)만 isDoctor 분기.
//   ↓ 발급 렌더 게이트는 canIssueKoh(4역할)로 갱신 — director-only 였던 旣 시뮬레이션을 정정.
//   AC-1(직원 발급요청 = 2번차트 KohRequestToggle 동선, canRequestKoh)은 본 변경과 무관(불변).
const KOH_ISSUE_ROLES = ['director', 'consultant', 'coordinator', 'therapist'];
const canIssueKoh = (role: UserRole) => KOH_ISSUE_ROLES.includes(role ?? '');

// ── AC-2(superseded by ROLE-GRANT-3ROLE): 발급 액션 렌더 게이트 = canIssueKoh(3역할+의사) ──
//   일괄발급 버튼 / 선택 컬럼(전체선택·행선택) / 단건 발급 버튼 = canIssue 한정.
//   발행완료 viewer 는 전 역할 공통(읽기). 미발행 행의 발급 버튼은 canIssue 역할만.
const showsBulkPublishBtn = (role: UserRole) => canIssueKoh(role);
const showsSelectColumn = (role: UserRole) => canIssueKoh(role);
const showsRowSelectCheckbox = (role: UserRole) => canIssueKoh(role);
/** 미발행 행 발급 버튼 = canIssue 역할. 발행완료 행은 published viewer(전 역할). */
const showsRowPublishBtn = (role: UserRole, published: boolean) => (published ? false : canIssueKoh(role));
const showsPublishedViewer = (published: boolean) => published; // 역할 무관(읽기)

// ── 정본 모사: 명단 read-only 표면(역할 무관 노출 유지 — 불명확 스킵 가드) ──
const showsKohList = (_role: UserRole) => true;            // 균검사지 명단 자체는 전체 공개 탭에 노출
const showsStatusBadge = (_role: UserRole) => true;        // 신청/미신청 상태 배지(읽기)
const showsNailSiteEditor = (_role: UserRole) => true;     // 조갑부위(불명확 → 스킵, 미변경)

// ── AC-1: 직원 발급요청 동선 게이트 (request_koh_for_customer RPC: is_approved_user) ──
//   전직원 default = 승인 사용자 누구나(치료사 포함). 역할 필터 단일 지점.
const APPROVED_ROLES_DEFAULT = ['director', 'consultant', 'coordinator', 'therapist', 'technician', 'admin', 'manager', 'staff'];
const canRequestKoh = (role: string, approvedRoles: string[] = APPROVED_ROLES_DEFAULT) => approvedRoles.includes(role);

const STAFF_ROLES = ['therapist', 'consultant', 'coordinator', 'technician', 'admin', 'manager', 'staff'];
// ROLE-GRANT-3ROLE 분할: 발급 권한 부여 3역할 vs 비대상(발급 미노출).
const KOH_GRANTED_STAFF = ['consultant', 'coordinator', 'therapist'];
const NON_ISSUE_STAFF = ['technician', 'admin', 'manager', 'staff'];

// ===========================================================================
test.describe('T-20260620-foot-KOH-ISSUE-PERMISSION-SPEC', () => {
  // ── AC-2 시나리오 2: 의사 발급하기(진료대시보드) ──
  test('AC2-S2: director는 진료대시보드에서 발급 액션(단건/일괄/선택 컬럼) 전부 노출', () => {
    expect(showsBulkPublishBtn('director')).toBe(true);
    expect(showsSelectColumn('director')).toBe(true);
    expect(showsRowSelectCheckbox('director')).toBe(true);
    expect(showsRowPublishBtn('director', false)).toBe(true); // 미발행 행 → 발급하기 노출
  });

  // ── AC-2(superseded by ROLE-GRANT-3ROLE) 시나리오 3 ──
  //   旣 '직원 전원 미노출' → reporter 확정으로 3역할(상담실장/코디네이터/치료사)은 발급요청 노출, 그 외만 미노출.
  test('AC2-S3a(superseded): 발급권한 3역할은 발급요청 노출 / 비대상 직원만 미노출', () => {
    for (const role of KOH_GRANTED_STAFF) {
      expect(showsRowPublishBtn(role, false)).toBe(true);  // ROLE-GRANT-3ROLE: 발급요청 노출
      expect(showsBulkPublishBtn(role)).toBe(true);
      expect(showsSelectColumn(role)).toBe(true);
      expect(showsRowSelectCheckbox(role)).toBe(true);
    }
    for (const role of NON_ISSUE_STAFF) {
      expect(showsBulkPublishBtn(role)).toBe(false);
      expect(showsSelectColumn(role)).toBe(false);
      expect(showsRowSelectCheckbox(role)).toBe(false);
      expect(showsRowPublishBtn(role, false)).toBe(false); // 비대상 역할은 발급 미노출(회귀 가드)
    }
  });

  test('AC2-S3b: role 누락/비인증도 발급 액션 미노출(director 외 전부 비노출)', () => {
    for (const role of [null, undefined, '']) {
      expect(showsBulkPublishBtn(role)).toBe(false);
      expect(showsRowPublishBtn(role, false)).toBe(false);
    }
  });

  test('AC2-S3c: 발행완료 행 보기(viewer)는 전 역할 공통(읽기) — 직원도 결과보고서 확인 가능', () => {
    for (const role of ['director', ...STAFF_ROLES]) {
      expect(showsPublishedViewer(true)).toBe(true);          // 발행완료 → viewer(역할 무관)
      expect(showsRowPublishBtn(role, true)).toBe(false);     // 발행완료 행엔 발급 버튼 없음(역할 무관)
    }
  });

  test('AC2-S3d: 명단·상태·조갑부위(불명확 스킵)는 역할 무관 미변경 — 명단 자체는 비노출 안 함', () => {
    for (const role of ['director', ...STAFF_ROLES]) {
      expect(showsKohList(role)).toBe(true);
      expect(showsStatusBadge(role)).toBe(true);
      expect(showsNailSiteEditor(role)).toBe(true); // 모호 직원기능 강행 금지(reporter '불명확하면 스킵')
    }
  });

  // ── AC-1 시나리오 1: 직원 발급요청(전직원 default) ──
  test('AC1-S1a: 발급요청은 전직원 default — 승인 사용자 누구나(치료사 포함) 가능', () => {
    for (const role of APPROVED_ROLES_DEFAULT) {
      expect(canRequestKoh(role)).toBe(true);
    }
  });

  test('AC1-S1b: 역할 필터 단일 지점 — 주연총괄 치료사 narrowing 시 approvedRoles만 조정(FE 재구조화 불요)', () => {
    // 주연총괄 컨펌 후 '치료사만' 시나리오를 가정: approvedRoles 1지점만 변경.
    const therapistOnly = ['therapist'];
    expect(canRequestKoh('therapist', therapistOnly)).toBe(true);
    expect(canRequestKoh('coordinator', therapistOnly)).toBe(false);
    // 단일 지점(RPC is_approved_user 모사)만 바뀌면 됨 — FE 발급요청 동선 코드는 불변.
    expect(canRequestKoh('coordinator')).toBe(true); // default(전직원)에서는 여전히 허용
  });

  // ── 권한 모델 정합 (superseded by ROLE-GRANT-3ROLE) ──
  test('MODEL(superseded): 발급요청 = 3역할+의사 진료대시보드 노출 / 라벨만 의사=발급하기 분기', () => {
    // 발급(요청) = 진료대시보드 canIssue(3역할+의사).
    expect(showsRowPublishBtn('director', false)).toBe(true);
    expect(showsRowPublishBtn('therapist', false)).toBe(true);   // ROLE-GRANT-3ROLE: 치료사 노출
    expect(showsRowPublishBtn('coordinator', false)).toBe(true);
    expect(showsRowPublishBtn('staff', false)).toBe(false);      // 비대상 직원은 미노출
    // 직원 발급요청(2번차트 KohRequestToggle 동선)도 전직원 default 가능(별 레이어, 불변).
    expect(canRequestKoh('therapist')).toBe(true);
    // 발급요청 버튼이 이제 진료대시보드에도 3역할 노출.
    expect(showsBulkPublishBtn('therapist')).toBe(true);
  });

  // ── NOTOUCH 회귀: 발행 게이트·동작은 역할 무관 단일 경로(2단계 승인 아님, KOHTEST-LIFECYCLE 보존) ──
  test('REG: 발행(publish_koh_result) 동작은 역할 무관 단일 — 발급은 director 액션, 요청상태 영속화는 별 레이어', () => {
    // 발급 '버튼 노출'만 역할 게이트(AC-2). 실제 발행 RPC 는 역할 파라미터 없음(旣 동작 무변경).
    // koh_requested(요청상태)는 旣 ADDITIVE 컬럼 — 본 티켓 신규 스키마 0(FE-only).
    expect(showsRowPublishBtn('director', false)).toBe(true);
    expect(showsPublishedViewer(true)).toBe(true);
  });
});
