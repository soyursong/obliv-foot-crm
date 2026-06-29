/**
 * E2E spec — T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE
 *
 * 경과분석 플랜(설정) 탭 이동(문지은 대표원장 confirm 2026-06-29, 의료화면 게이트 해소):
 *   AC-1: 진료관리(ClinicManagement.tsx, 의사 전용)에서 '경과분석 플랜'(progress_plans) 탭 제거.
 *         accessibleTabs 배열·TabsTrigger·TabsContent + dead import(ProgressPlansTab, TrendingUp 아이콘) 클린업.
 *   AC-2/3: 치료테이블(TreatmentTable.tsx, /admin/treatment-table)에 ProgressPlansTab 이식 = ④번째 탭(맨 뒤).
 *           기능(조회·표시·CRUD 액션) 동일 유지 — 컴포넌트 import·렌더만 이동.
 *   AC-4: 기존 라우트 /admin/treatment-table 재사용(신규 라우트 0). 권한 admin/manager/director 동일.
 *   AC-5: 진료관리에서 경과분석 플랜 미노출 / 치료테이블에서 정상 노출·동작.
 *
 *   ⚠ 명칭 구분(feature-loss 차단): ③='경과분석'(오늘 대상자, RELOCATE-TREATBL deployed) / ④='경과분석 플랜'(설정, 본건).
 *      서로 다른 탭 — '제거만' 하면 설정 기능 소실 → 제거 + ④ 이식 둘 다 검증.
 *
 * 데이터: ProgressPlansTab/package_progress_plans 물리 보존(렌더 위치만 이동). 신규 테이블/컬럼/enum/RLS 0 → NO-DDL. db_change=false.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 본문 현장 클릭 시나리오 3종을 코드 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const clinicMgmt = () => read('src/pages/ClinicManagement.tsx');
const treatTable = () => read('src/pages/TreatmentTable.tsx');
const appTsx = () => read('src/App.tsx');

test.describe('T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE', () => {
  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 진료관리에서 경과분석 플랜 탭 제거 (AC-1, AC-5) ──────────────
  test('시나리오1: 진료관리 — progress_plans 탭(trigger/content/배열/import) 전부 제거', () => {
    const c = clinicMgmt();
    // 탭 트리거·콘텐츠 제거 (현장에서 '경과분석 플랜' 탭이 진료관리에 더 이상 없음)
    expect(c).not.toContain('value="progress_plans"');
    expect(c).not.toContain('data-testid="tab-progress-progress-plans"');
    expect(c).not.toContain('data-testid="tab-progress-plans"');
    // dead import 클린업: ProgressPlansTab 컴포넌트 import 폐지
    expect(c).not.toContain("import ProgressPlansTab from '@/components/admin/ProgressPlansTab'");
    expect(c).not.toContain('<ProgressPlansTab />');
    // accessibleTabs 배열에서 'progress_plans' 활성 엔트리 제거(주석 외 실코드 부재)
    expect(c).not.toMatch(/^\s*'progress_plans',\s*$/m);
  });

  test('시나리오1: 진료관리 — TrendingUp 아이콘 dead import 정리(미사용 잔재 0)', () => {
    const c = clinicMgmt();
    // 경과분석 플랜만 TrendingUp 을 쓰던 surface → 제거 후 아이콘 import 도 회수
    expect(c).not.toContain('TrendingUp');
  });

  test('시나리오1: 진료관리 — 기존 잔존 탭 보존(회귀: 묶음처방/처방세트/상병명/서류 템플릿)', () => {
    const c = clinicMgmt();
    expect(c).toContain('value="diagnosis_names"');
    expect(c).toContain('value="drug_folders"');
    expect(c).toContain('value="prescriptions"');
    expect(c).toContain('value="documents"');
    expect(c).toContain('value="super_phrases"');
  });

  // ── 시나리오 2: 치료테이블 ④번째 탭으로 이식 (AC-2/3, AC-5) ──────────────────
  test('시나리오2: 치료테이블 — 경과분석 플랜이 ④번째(맨 뒤) 탭으로 이식', () => {
    const t = treatTable();
    // ProgressPlansTab import·렌더 이식
    expect(t).toContain("import ProgressPlansTab from '@/components/admin/ProgressPlansTab'");
    expect(t).toContain('<ProgressPlansTab />');
    // ④ 탭 트리거(신규 value=plan, testid=tab-progress-plans)
    expect(t).toContain('value="plan"');
    expect(t).toContain('data-testid="tab-progress-plans"');
    expect(t).toContain('경과분석 플랜');
    // SectionTab 타입에 'plan' 추가
    expect(t).toContain("'history' | 'exam' | 'progress' | 'plan'");
  });

  test('시나리오2: 치료테이블 — 탭 순서 ①이력 ②검사 ③경과분석 ④경과분석 플랜(맨 뒤)', () => {
    const t = treatTable();
    const idxHistory = t.indexOf('data-testid="tab-doctor-history"');
    const idxExam = t.indexOf('data-testid="tab-exam-targets"');
    const idxProgress = t.indexOf('data-testid="tab-progress-targets"');
    const idxPlan = t.indexOf('data-testid="tab-progress-plans"');
    expect(idxHistory).toBeGreaterThan(-1);
    expect(idxExam).toBeGreaterThan(-1);
    expect(idxProgress).toBeGreaterThan(-1);
    expect(idxPlan).toBeGreaterThan(-1);
    // ④경과분석 플랜이 ③경과분석보다 뒤(맨 뒤)
    expect(idxPlan).toBeGreaterThan(idxProgress);
    expect(idxProgress).toBeGreaterThan(idxExam);
    expect(idxExam).toBeGreaterThan(idxHistory);
  });

  test('시나리오2: 명칭 혼동 방지 — ③경과분석(tab-progress-targets)과 ④경과분석 플랜(tab-progress-plans) 공존', () => {
    const t = treatTable();
    // 두 탭은 별개 surface — 둘 다 존재(③ 제거 후 ④로 대체된 게 아님)
    expect(t).toContain('data-testid="tab-progress-targets"'); // ③ 경과분석(오늘 대상자, RELOCATE)
    expect(t).toContain('data-testid="tab-progress-plans"');   // ④ 경과분석 플랜(설정, 본건)
    expect(t).toContain('ProgressTargetsSection'); // ③ 컴포넌트 보존
    expect(t).toContain('ProgressPlansTab');       // ④ 컴포넌트 이식
  });

  // ── 시나리오 3: 라우트·권한 재사용 + feature 보존 (AC-4) ──────────────────────
  test('시나리오3: 라우트 재사용 — /admin/treatment-table 신규 라우트 0, 권한 admin/manager/director 동일', () => {
    const app = appTsx();
    // 기존 treatment-table 라우트 단일 유지(신규 라우트·신규 경로 미추가)
    expect(app).toContain('path="treatment-table"');
    expect(app).toContain("roles={['admin', 'manager', 'director']}");
    // progress-plan 전용 신규 라우트가 추가되지 않음
    expect(app).not.toContain('path="progress-plans"');
    expect(app).not.toContain('path="progress-plan"');
  });

  test('회귀0: 치료테이블 기존 2섹션·날짜선택기 보존', () => {
    const t = treatTable();
    expect(t).toContain('DoctorHistorySection');
    expect(t).toContain('ExamTargetsSection');
    expect(t).toContain('data-testid="treatment-date-nav"');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 진료관리에서 경과분석 플랜 탭 제거 확인
 *   1. admin 로그인 → 서비스관리 > 진료관리(/admin/clinic-management)
 *   2. 탭 목록에 [경과분석 플랜] 탭이 더 이상 없음
 *   3. 기존 탭(상병명/처방세트/묶음처방/서류 템플릿 등)은 정상 노출·동작
 *
 * [시나리오2] 치료테이블 ④경과분석 플랜 탭 동선
 *   1. admin 로그인 → 사이드바 [치료 테이블] → /admin/treatment-table
 *   2. 탭 = ①진료 환자 이력 ②균검사&피검사 대상자 ③경과분석 ④경과분석 플랜(맨 뒤)
 *   3. [경과분석 플랜] 탭 클릭 → 회차tier별 체크포인트 목록이 정상 표시
 *   4. 추가/수정/삭제(CRUD) 액션이 진료관리에 있던 때와 동일하게 동작
 *   5. ③경과분석(오늘 대상자)과 ④경과분석 플랜(설정)이 서로 다른 탭으로 공존(명칭 혼동 없음)
 *
 * [시나리오3] 라우트·권한 동일성
 *   1. /admin/treatment-table 단일 라우트로 접근(신규 경로 없음)
 *   2. admin/manager/director 만 진입(consultant/coordinator/therapist 차단 — 기존 가드 유지)
 *
 * 비고: NO-DDL. ProgressPlansTab/package_progress_plans 물리 보존(렌더 위치만 이동). db_change=false.
 *   ADDITIVE/이동만 → DA CONSULT/supervisor DDL-diff 불요. 의료화면 confirm 게이트 해소(문지은 대표원장 "네", 2026-06-29 22:59).
 */
