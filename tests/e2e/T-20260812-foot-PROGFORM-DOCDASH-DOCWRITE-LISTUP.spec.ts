/**
 * E2E Spec — T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP (P2, FE-only read-linkage, §11 gate satisfied)
 *
 * 요청(김주연 총괄, C0ATE5P6JTH, MSG-20260812-131538-y023 후반부):
 *   "해당 서류 최종적으로 원장님께서 발행해주는거니 진료대시보드 → 서류작성 탭에도 리스트업 해줘"
 *   경과분석지(6배수 도래 환자 대상, SONGDO-FORM-DOWNLOAD로 생성) = 원장 최종 발행 서류 →
 *   원장 동선(진료대시보드 → 서류작성 탭)에도 발행 대상을 리스트업(발행 동선 일원화).
 *
 * §11 medical_confirm_gate: 진료대시보드=의사공간. 문지은 대표원장 컨펌(MSG-20260812-142118-tgmv,
 *   thread 1786511989.307569) → confirm_status:confirmed·게이트 satisfied.
 *
 * ── REOPEN(2026-08-14) → A안 확정(김주연 총괄, MSG-20260814-205244-mtye) ──
 *   재신고 '증발' 근본원인(dev-foot RCA MSG-20260814-204034-wzox): 기존 canSeeProgressDocs 가
 *   hasOpsAuthority(admin/manager)+director 만 통과 → coordinator(코디) 미통과로 섹션 전체 미표출.
 *   A안 = read/write 게이트 분리:
 *     · READ(명단 조회)  = canSeeProgressDocs → 치료테이블 §③ 경과분석 탭과 '동일 read 범위'(코디/총괄 포함)로 완화.
 *     · WRITE(발행 버튼) = canIssueProgressDocs → 개별 발행하기·일괄처리는 원장(+admin/manager)만.
 *   db_change=false — FE 노출/활성 게이트만(backing SELECT RLS role-agnostic·clinic-scoped, 완화에 RLS 불요).
 *
 * 수용 기준(A안 DoD override):
 *   AC1 — 서류작성 탭에 경과분석지 발행 대상 리스트업(ProgressTargetsSection SSOT 재사용).
 *   AC2 — 리스트업 모집단이 PROGCHK 필터(활성 패키지 & (used+1)%6==0)와 정합(동일 SSOT 함수).
 *   AC3(read)  — canSeeProgressDocs = 치료테이블 경과분석 접근 집합(coordinator 포함).
 *   AC3(write) — canIssueProgressDocs = 원장+admin/manager 만(coordinator 제외). 발행 버튼 게이트.
 *   AC4 — 서류작성 탭 기존 항목(DocRequestQueue·OpinionDocTab) regression 0.
 *   AC5 — 순수 read-linkage(DoctorTools 변경에 write/RPC/DDL 0).
 *
 * 실행: npx playwright test T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP.spec.ts --project=unit
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSixMultipleTarget } from '../../src/lib/progressSixMultiple';
import {
  canSeeProgressDocs,
  canIssueProgressDocs,
  PROGRESS_DOCS_VIEW_ROLES,
  PROGRESS_DOCS_ISSUE_ROLES,
} from '../../src/lib/permissions';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOOLS_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/DoctorTools.tsx'), 'utf-8');
const PROGSECTION_SRC = () =>
  readFileSync(join(HERE, '../../src/components/treatment/ProgressTargetsSection.tsx'), 'utf-8');

// ── A. 순수 로직 — PROGCHK 모집단 정합(AC2, 시나리오 2) ────────────────────────────────
test.describe('A. PROGCHK 6배수 필터 — 서류작성 탭 리스트업 모집단 정합(AC2)', () => {
  test('6의 배수 도래(다음 회차 6·12·18·24)만 대상 — 서류작성 탭·경과분석 탭 동일 기준', () => {
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 12 })).toBe(true); // 다음=6
    expect(isSixMultipleTarget({ usedSessions: 11, totalSessions: 12 })).toBe(true); // 다음=12
    expect(isSixMultipleTarget({ usedSessions: 17, totalSessions: 24 })).toBe(true); // 다음=18
  });

  test('6배수 아닌 회차(예: 3회 완료→다음 4회차)는 미노출 — 시나리오 2 반례', () => {
    expect(isSixMultipleTarget({ usedSessions: 3, totalSessions: 12 })).toBe(false); // 다음=4
    expect(isSixMultipleTarget({ usedSessions: 0, totalSessions: 12 })).toBe(false); // 다음=1
    expect(isSixMultipleTarget({ usedSessions: 6, totalSessions: 12 })).toBe(false); // 다음=7
  });

  test('tier0(체험/Re:Born·total_sessions<=0) 배제 — 6배수여도 미대상', () => {
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: 0 })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: null })).toBe(false);
    expect(isSixMultipleTarget({ usedSessions: 5, totalSessions: undefined })).toBe(false);
  });
});

// ── B. A안 read/write 게이트 분리 — 실 predicate 함수 동작(AC3) ──────────────────────────
test.describe('B. read/write 게이트 분리 — canSeeProgressDocs / canIssueProgressDocs', () => {
  test('AC3(read) — 명단 조회: coordinator(코디)/총괄(manager) 포함 — 치료테이블 경과분석 탭과 동일 범위', () => {
    // 재신고 근본원인 = coordinator 미통과 '증발'. A안 완화로 coordinator 이제 통과.
    expect(canSeeProgressDocs('coordinator')).toBe(true);
    expect(canSeeProgressDocs('manager')).toBe(true);   // 총괄
    expect(canSeeProgressDocs('director')).toBe(true);   // 원장
    expect(canSeeProgressDocs('admin')).toBe(true);
    expect(canSeeProgressDocs('consultant')).toBe(true);
    expect(canSeeProgressDocs('therapist')).toBe(true);
    // 치료테이블 경과분석 접근 집합 밖(technician/part_lead/staff/tm)은 미노출(동일 read 범위 경계).
    expect(canSeeProgressDocs('technician')).toBe(false);
    expect(canSeeProgressDocs('part_lead')).toBe(false);
    expect(canSeeProgressDocs('staff')).toBe(false);
    expect(canSeeProgressDocs('tm')).toBe(false);
    // null-safe
    expect(canSeeProgressDocs(null)).toBe(false);
    expect(canSeeProgressDocs(undefined)).toBe(false);
    expect(canSeeProgressDocs({ role: null })).toBe(false);
    // 조회 집합 = 치료테이블 RoleGuard SSOT 집합
    expect([...PROGRESS_DOCS_VIEW_ROLES].sort()).toEqual(
      ['admin', 'consultant', 'coordinator', 'director', 'manager', 'therapist'].sort(),
    );
  });

  test('AC3(write) — 발행: 원장(director)+admin/manager 만 — coordinator/상담/치료사 제외', () => {
    expect(canIssueProgressDocs('director')).toBe(true);  // 원장
    expect(canIssueProgressDocs('admin')).toBe(true);
    expect(canIssueProgressDocs('manager')).toBe(true);
    // 발행 write 는 코디/상담/치료사 제외(명단은 보되 발행 버튼 미노출).
    expect(canIssueProgressDocs('coordinator')).toBe(false);
    expect(canIssueProgressDocs('consultant')).toBe(false);
    expect(canIssueProgressDocs('therapist')).toBe(false);
    expect(canIssueProgressDocs(null)).toBe(false);
    expect(canIssueProgressDocs({ role: null })).toBe(false);
    expect([...PROGRESS_DOCS_ISSUE_ROLES].sort()).toEqual(['admin', 'director', 'manager'].sort());
  });

  test('read ⊇ write — 발행 권한자는 조회도 가능(게이트 정합)', () => {
    for (const r of PROGRESS_DOCS_ISSUE_ROLES) {
      expect(canSeeProgressDocs(r)).toBe(true);
    }
  });
});

// ── C. 정적 소스 가드 — SSOT 재사용 + 게이트 배선 + AC4 무접촉 + read-only ────────────────
test.describe('C. DoctorTools / ProgressTargetsSection — 소스 가드', () => {
  test('AC1 — 서류작성(opinion_doc) 탭에 ProgressTargetsSection 을 SSOT 재사용(병렬 리스트 신설 없음)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/import\s+ProgressTargetsSection\s+from\s+'@\/components\/treatment\/ProgressTargetsSection'/);
    expect(src).toMatch(/<ProgressTargetsSection\s+date=\{seoulISODate\(new Date\(\)\)\}\s+nameInteraction=\{nameInteraction\}/);
    expect(src).toMatch(/data-testid="docdash-progress-form-section"/);
    // 병렬 리스트 신설 금지 — 자체 packages/package_sessions 6배수 쿼리 재구현 없음.
    expect(src).not.toMatch(/from\('packages'\)/);
    expect(src).not.toMatch(/from\('package_sessions'\)/);
    expect(src).not.toMatch(/isSixMultipleTarget/);
  });

  test('AC3(read) 배선 — DoctorTools 는 SSOT canSeeProgressDocs 로 섹션 노출 제어', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/import\s+\{\s*canSeeProgressDocs\s*\}\s+from\s+'@\/lib\/permissions'/);
    expect(src).toMatch(/const\s+showProgressDocs\s*=\s*canSeeProgressDocs\(profile\)/);
    expect(src).toMatch(/showProgressDocs\s*&&\s*\(/);
    // 인라인 role=== 재도입 금지(STEP6 SSOT 이관 유지).
    expect(src).not.toMatch(/role\s*===\s*'director'/);
  });

  test('AC3(write) 배선 — ProgressTargetsSection 은 canIssueProgressDocs 로 발행 버튼 게이트', () => {
    const src = PROGSECTION_SRC();
    expect(src).toMatch(/canIssueProgressDocs/);
    expect(src).toMatch(/const\s+canIssue\s*=\s*canIssueProgressDocs\(profile\)/);
    // 발행 버튼(개별/일괄)이 canIssue 게이트 하에 렌더.
    expect(src).toMatch(/canIssue\s*&&/);
    // 발행하기 버튼은 canIssue 블록 안(data-testid 보존).
    expect(src).toMatch(/data-testid="progress-issue-btn"/);
    expect(src).toMatch(/data-testid="progress-bulk-action-btn"/);
  });

  test('AC4 — 서류작성 탭 기존 항목(DocRequestQueue·OpinionDocTab) 무접촉(regression 0)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/<DocRequestQueue\s*\/>/);
    expect(src).toMatch(/<OpinionDocTab\s*\/>/);
    expect(src).toMatch(/data-testid="tab-opinion-doc"/);
    expect(src).toMatch(/data-testid="tab-call-dashboard"/);
  });

  test('AC5 — 순수 read-linkage: DoctorTools 변경에 write/RPC/DDL 0 (db_change=false)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  test('이름 인터랙션 — 좌클릭=2번차트 open(useChart 단일 게이트), 우클릭=no-op(preventDefault)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/const\s*\{\s*openChart\s*\}\s*=\s*useChart\(\)/);
    expect(src).toMatch(/onLeftClick:\s*\(customerId\)\s*=>\s*\{\s*\n?\s*if\s*\(customerId\)\s*openChart\(customerId\)/);
  });

  test('모집단 SSOT — ProgressTargetsSection 은 progressSixMultiple(isSixMultipleTarget)로 6배수 판정(단일 근거)', () => {
    const src = PROGSECTION_SRC();
    expect(src).toMatch(/from\s+'@\/lib\/progressSixMultiple'/);
    expect(src).toMatch(/isSixMultipleTarget\(/);
  });
});
