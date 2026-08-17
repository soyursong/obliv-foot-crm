/**
 * E2E Spec — T-20260817-foot-PROGANALYSIS-DOCDASH-TAB-MIRROR (P2, FE-only placement/mirror)
 *
 * 요청(총괄 U0ATDB587PV, C0ATE5P6JTH):
 *   "치료테이블 - 경과분석 해당 메뉴 그대로 진료대시보드 추가 탭으로 생성해줘 /
 *    실질적인 발행은 대표원장님께서 해주실거야"
 *   원장이 실제 서류 발행/열람을 하는 곳(진료대시보드)에서도 경과분석 메뉴를 곧바로 쓸 수 있게,
 *   치료테이블 > 경과분석 메뉴를 진료대시보드에 추가 탭으로 '그대로(as-is)' 미러 노출.
 *
 * 스코프 = placement(배치)만 추가 — 신규 로직 authoring 0. 기존 경과분석 컴포넌트/필터/데이터훅 재사용:
 *   · 경과분석(대상자) = ProgressTargetsSection (치료테이블 §③와 동일 컴포넌트·6배수 필터 SSOT)
 *   · 경과분석 플랜(설정) = ProgressPlansTab (치료테이블과 동일 컴포넌트, useClinic 자체 사용)
 *
 * 불변식(무변경):
 *   · 원본 '치료테이블 > 경과분석' 메뉴 그대로 유지(이동 아님, 미러/추가 노출).
 *   · 경과분석 대상 산출 로직·필터·권한 게이팅 무변경.
 *   · 진료대시보드 기존 탭(진료 알림판/진료 환자 목록/균검사지/서류작성) 레이아웃·동작 무회귀.
 *
 * 수용 기준:
 *   AC1 — 진료대시보드에 '경과분석' 탭 신설(TabsTrigger value=progress_analysis).
 *   AC2 — 경과분석 탭이 원본 메뉴 구조 그대로: 하위 서브탭 2개(경과분석 targets / 경과분석 플랜 plan).
 *   AC3 — 컴포넌트 SSOT 재사용: ProgressTargetsSection·ProgressPlansTab 를 치료테이블과 동일 import·렌더(복제 0).
 *   AC4 — 원본(TreatmentTable > 경과분석 progress 탭) 무접촉(미러가 원본을 깨지 않음).
 *   AC5 — 진료대시보드 기존 탭 regression 0(트리거·컨텐츠 보존).
 *   AC6 — 순수 placement: DoctorTools 변경에 write/RPC/DDL 0(db_change=false).
 *
 * 실행: npx playwright test T-20260817-foot-PROGANALYSIS-DOCDASH-TAB-MIRROR.spec.ts --project=unit
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOOLS_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/DoctorTools.tsx'), 'utf-8');
const TREATTABLE_SRC = () =>
  readFileSync(join(HERE, '../../src/pages/TreatmentTable.tsx'), 'utf-8');

// ── AC1: 경과분석 탭 신설 ──────────────────────────────────────────────────────────
test.describe('AC1 — 진료대시보드에 경과분석 탭 신설', () => {
  test('TabsTrigger value=progress_analysis(라벨 "경과분석") 추가', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/<TabsTrigger\s+value="progress_analysis"[^>]*data-testid="tab-progress-analysis"/);
    // 탭 컨텐츠도 존재
    expect(src).toMatch(/<TabsContent\s+value="progress_analysis">/);
  });
});

// ── AC2: 원본 메뉴 구조 그대로(하위 서브탭 2개) ────────────────────────────────────
test.describe('AC2 — 경과분석 탭 = 원본 구조 그대로(서브탭 2개)', () => {
  test('하위 서브탭: 경과분석(targets) / 경과분석 플랜(plan)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/data-testid="docdash-progress-subtabs"/);
    expect(src).toMatch(/<TabsTrigger\s+value="targets"[^>]*data-testid="tab-docdash-progress-targets"/);
    expect(src).toMatch(/<TabsTrigger\s+value="plan"[^>]*data-testid="tab-docdash-progress-plans"/);
    // 서브탭 상태 기본 'targets'(오늘 대상자)
    expect(src).toMatch(/useState<'targets'\s*\|\s*'plan'>\('targets'\)/);
  });

  test('날짜선택기 — 오늘 기본 + 전/후 이동(미래 차단), 대상자 서브탭에서만 노출', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/data-testid="docdash-progress-date-nav"/);
    expect(src).toMatch(/data-testid="docdash-progress-date-prev"/);
    expect(src).toMatch(/data-testid="docdash-progress-date-next"/);
    // 미래 이동 차단 가드(next <= today)
    expect(src).toMatch(/if\s*\(next\s*<=\s*today\)\s*setProgressDate\(next\)/);
    // 날짜선택기는 targets 서브탭에서만
    expect(src).toMatch(/progressSub\s*===\s*'targets'\s*&&/);
  });
});

// ── AC3: 컴포넌트 SSOT 재사용(복제 0) ──────────────────────────────────────────────
test.describe('AC3 — SSOT 재사용: ProgressTargetsSection / ProgressPlansTab', () => {
  test('치료테이블과 동일 컴포넌트 import(복제 아님)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/import\s+ProgressTargetsSection\s+from\s+'@\/components\/treatment\/ProgressTargetsSection'/);
    expect(src).toMatch(/import\s+ProgressPlansTab\s+from\s+'@\/components\/admin\/ProgressPlansTab'/);
  });

  test('경과분석 탭에서 두 컴포넌트를 그대로 렌더(date/nameInteraction 계약 동일)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/<ProgressTargetsSection\s+date=\{progressDate\}\s+nameInteraction=\{nameInteraction\}/);
    expect(src).toMatch(/<ProgressPlansTab\s*\/>/);
    // 병렬 6배수 쿼리 재구현/신규 로직 authoring 금지(SSOT 필터는 컴포넌트 내부).
    expect(src).not.toMatch(/from\('packages'\)/);
    expect(src).not.toMatch(/from\('package_sessions'\)/);
    expect(src).not.toMatch(/isSixMultipleTarget/);
  });

  test('진료대시보드 = 치료테이블과 동일한 ProgressTargetsSection·ProgressPlansTab 컴포넌트 참조(surface drift 0)', () => {
    const dash = DOCTOOLS_SRC();
    const treat = TREATTABLE_SRC();
    // 양 화면이 같은 import 경로를 참조 = 단일 컴포넌트 공유.
    expect(treat).toMatch(/import\s+ProgressTargetsSection\s+from\s+'@\/components\/treatment\/ProgressTargetsSection'/);
    expect(treat).toMatch(/import\s+ProgressPlansTab\s+from\s+'@\/components\/admin\/ProgressPlansTab'/);
    expect(dash).toMatch(/import\s+ProgressTargetsSection\s+from\s+'@\/components\/treatment\/ProgressTargetsSection'/);
    expect(dash).toMatch(/import\s+ProgressPlansTab\s+from\s+'@\/components\/admin\/ProgressPlansTab'/);
  });
});

// ── AC4: 원본 메뉴 무접촉 ──────────────────────────────────────────────────────────
test.describe('AC4 — 원본(치료테이블 > 경과분석) 무접촉', () => {
  test('TreatmentTable progress 부모 탭 + 서브탭(targets/plan) 그대로 유지', () => {
    const src = TREATTABLE_SRC();
    expect(src).toMatch(/<TabsTrigger\s+value="progress"[^>]*data-testid="tab-progress"/);
    expect(src).toMatch(/data-testid="tab-progress-targets"/);
    expect(src).toMatch(/data-testid="tab-progress-plans"/);
    expect(src).toMatch(/<ProgressTargetsSection\s+date=\{date\}\s+nameInteraction=\{nameInteraction\}/);
    expect(src).toMatch(/<ProgressPlansTab\s*\/>/);
  });
});

// ── AC5: 진료대시보드 기존 탭 regression 0 ─────────────────────────────────────────
test.describe('AC5 — 진료대시보드 기존 탭 무회귀', () => {
  test('기존 4개 탭(진료 알림판/진료 환자 목록/균검사지/서류작성) 트리거·컨텐츠 보존', () => {
    const src = DOCTOOLS_SRC();
    expect(src).toMatch(/data-testid="tab-call-dashboard"/);
    expect(src).toMatch(/data-testid="tab-patient-list"/);
    expect(src).toMatch(/data-testid="tab-koh-report"/);
    expect(src).toMatch(/data-testid="tab-opinion-doc"/);
    // 기존 컨텐츠 컴포넌트 무접촉
    expect(src).toMatch(/<DoctorCallDashboard\s*\/>/);
    expect(src).toMatch(/<DoctorPatientList\s*\/>/);
    expect(src).toMatch(/<KohReportTab\s*\/>/);
    expect(src).toMatch(/<DocRequestQueue\s*\/>/);
    expect(src).toMatch(/<OpinionDocTab\s*\/>/);
    // 서류작성 탭 경과분석지 발행 대상 리스트업(PROGFORM-DOCDASH-DOCWRITE-LISTUP) 보존
    expect(src).toMatch(/data-testid="docdash-progress-form-section"/);
    // 기본 탭 = 진료 알림판 유지
    expect(src).toMatch(/useState\('call_dashboard'\)/);
  });
});

// ── AC6: 순수 placement(db_change=false) ───────────────────────────────────────────
test.describe('AC6 — 순수 placement: write/RPC/DDL 0', () => {
  test('DoctorTools 변경에 mutation/RPC 0 (read-only)', () => {
    const src = DOCTOOLS_SRC();
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/\.rpc\(/);
  });
});
