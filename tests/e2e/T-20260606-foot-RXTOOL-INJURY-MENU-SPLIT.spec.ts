/**
 * E2E spec — T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT
 *
 * 문지은 대표원장(6/6, C0ATE5P6JTH) 요청 4건 — 진료도구 재구성:
 *   AC-1 진료(관리)에 상병 추가 + 서비스관리 상병과 동기화(단일 SSOT, 중복 데이터셋 금지)
 *   AC-2 "서비스 관리 > 진료관리" 신설 + 어드민성 도구 이전(상용구·슈퍼상용구·처방세트·
 *        상병명·진료세트·수가세트·서류템플릿·빠른처방버튼·경과분석플랜·금기증)
 *   AC-3 진료관리 권한 게이팅 — [SUPERSEDED] 원안은 admin/manager/director 한정이었으나
 *        T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN (commit 7fed414) 으로 직원 포함 개방.
 *        진료관리=서비스관리와 동일 role(직원 포함). 아래 AC-3 단언은 STAFF-OPEN 모델로 갱신됨.
 *   AC-4 기존 진료도구 = 진료알림판·진료환자목록 2개만 잔존.
 *
 * 본 spec 은 구조 불변식을 정본 그대로 인코딩해 회귀를 가드한다(데이터·로그인 비의존, 빠른 회귀).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CLINIC_MGMT = 'src/pages/ClinicManagement.tsx';
const DOCTOR_TOOLS = 'src/pages/DoctorTools.tsx';
const APP = 'src/App.tsx';
const LAYOUT = 'src/components/AdminLayout.tsx';
const SERVICES = 'src/pages/Services.tsx';
const DX_TAB = 'src/components/admin/DiagnosisNamesTab.tsx';
const CHART = 'src/components/MedicalChartPanel.tsx';

// 진료관리로 이전된 어드민성 탭 value 목록
// T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: '상용구'(phrases)·'수가세트'(fee_set_templates) 2개는
//   '서비스관리 > 상용구관리' 서브탭으로 재이전됨 → 진료관리(ClinicManagement) 잔류 목록에서 제외.
const MOVED_TABS = [
  'super_phrases',
  'prescriptions',
  'diagnosis_names',
  'treatment_sets',
  'documents',
  'quick_rx',
  'progress_plans',
] as const;

// ── AC-1: 상병 = services category_label='상병' 단일 SSOT (중복 데이터셋 신설 금지) ──
test('AC-1: 상병명 관리 탭이 진료관리에 존재 + services category_label=상병 단일 SSOT 참조', () => {
  const cm = read(CLINIC_MGMT);
  expect(cm).toContain('DiagnosisNamesTab');
  expect(cm).toContain('value="diagnosis_names"');
  expect(cm).toContain('상병명 관리');

  // 상병 정본은 services 테이블의 category_label='상병' — 별도 마스터 테이블 신설 금지
  const dx = read(DX_TAB);
  expect(dx).toContain("category_label");
  expect(dx).toContain("'상병'");
  expect(dx).toContain("from('services')");
  expect(dx).not.toContain('diagnosis_categories'); // 두번째 마스터 금지
  expect(dx).not.toContain('clinic_diagnoses');
});

// ── AC-2: "서비스 관리 > 진료관리" 신설 + 어드민성 도구 이전 ──
//   ⚠️ T-20260607-foot-NAV-SVCMGMT-SUBTAB-RENAME(후속) 으로 진료관리는 AdminLayout top-level NAV 가
//      아니라 Services(/admin/services) 화면 내 서브탭(svc-top-tab-clinic)으로 편입됨(이동만, 기능 유지).
//      라우트/RoleGuard 는 그대로 보존(lockout 없음). 본 AC-2 는 라우트 보존 + 서브탭 진입점으로 현행화.
test('AC-2: clinic-management 라우트 보존 + 서비스관리 화면 내 진료관리 서브탭 진입점', () => {
  const app = read(APP);
  // 라우트 등록 보존 (deep-link "관리 화면으로" 연속성 + RoleGuard 이중가드)
  expect(app).toContain('path="clinic-management"');
  expect(app).toContain('ClinicManagement');

  // 진료관리는 서비스관리 서브탭으로 노출 (NAV-SVCMGMT-SUBTAB-RENAME 이후 단일 진입점)
  const svc = read(SERVICES);
  expect(svc).toContain("import('@/pages/ClinicManagement')"); // 기존 페이지 재사용(이동만)
  expect(svc).toContain('data-testid="svc-top-tab-clinic"');
  expect(svc).toContain('진료관리');
});

test('AC-2: 어드민성 9개 탭이 모두 진료관리로 이전됨 (+ 금기증 admin 한정)', () => {
  const cm = read(CLINIC_MGMT);
  for (const t of MOVED_TABS) {
    expect(cm, `진료관리에 ${t} 탭 존재`).toContain(`value="${t}"`);
  }
  // 금기증 관리 — admin 한정 노출 유지
  expect(cm).toContain('ContraindicationsTab');
  expect(cm).toContain('value="contraindications"');
  expect(cm).toMatch(/isAdmin\s*&&[\s\S]*contraindications/);
});

// ── AC-3 [SUPERSEDED→STAFF-OPEN]: 진료관리 = 서비스관리와 동일 role(직원 포함) 개방 ──
//   superseded by T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN (commit 7fed414)
//   원안(admin/manager/director 한정 + 직원 차단)은 폐기. 진료관리 가시성은 서비스관리 진입권과 동일하게 직원 개방.
//   재정합: T-20260615-foot-CLINICMGMT-SPEC-ALIGN-SUPERSEDE (라우트 이중성 해소 + 본 spec 갱신).
test('AC-3 [STAFF-OPEN]: 서브탭 가시성 = 직원 개방 (canViewClinicMgmt=!!profile?.role, director-gating 부재)', () => {
  const svc = read(SERVICES);
  // STAFF-OPEN: 진료관리 서브탭은 로그인 프로필이 있으면 노출(직원 포함). 별도 role 화이트리스트 게이트 없음.
  expect(svc).toContain('canViewClinicMgmt = !!profile?.role');
  // 폐기된 director-gating 상수가 잔존하면 안 됨(stale 회귀 가드)
  expect(svc).not.toContain("CLINIC_MGMT_ROLES = ['admin', 'manager', 'director']");
});

test('AC-3 [STAFF-OPEN]: 라우트 가드 = 서비스관리 진입 role ∪ director (서브탭 열림↔직접 URL 정합)', () => {
  const app = read(APP);
  // clinic-management RoleGuard 추출
  const m = app.match(/path="clinic-management"[^>]*RoleGuard roles=\{(\[[^\]]*\])\}/);
  expect(m, 'clinic-management RoleGuard 매칭').not.toBeNull();
  const roles = m![1];

  // STAFF-OPEN 정합: 서비스관리 진입권(admin/manager/consultant/coordinator/therapist) 직원 포함 +
  //   director(진료차트 '관리 화면으로' 직접 진입 연속성) 보존. 서브탭은 열려 있는데 라우트만 막히는 이중성 제거.
  for (const r of ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist']) {
    expect(roles, `clinic-management 라우트에 ${r} 포함(직원 개방 정합)`).toContain(`'${r}'`);
  }

  // 서비스관리 진입 role 집합이 clinic-management 라우트 집합의 부분집합인지 검증(서브탭 도달자=라우트 진입 가능, lockout 없음)
  const svcGuard = app.split('\n').find((l) => l.includes('path="services"')) ?? '';
  for (const r of ['admin', 'manager', 'consultant', 'coordinator', 'therapist']) {
    if (svcGuard.includes(`'${r}'`)) {
      expect(roles, `서비스관리 진입 role ${r} 은 clinic-management 라우트도 진입 가능해야(서브탭↔라우트 정합)`).toContain(`'${r}'`);
    }
  }
});

// ── AC-4: 진료도구 = 진료성 탭(진료알림판·진료환자목록 + KOH 리포트)만 잔존, 어드민성 도구 0건 ──
//   원안은 'call_dashboard·patient_list 2개만' 락인이었으나 T-20260611-foot-KOH-REPORT-TAB(deployed)
//   으로 균검사지(koh_report) read-only 진료 리포트 탭이 정당 추가됨 → '진료성 탭만 잔존(어드민성 0)' 으로 정합.
test('AC-4: 진료도구에는 진료성 탭(call_dashboard·patient_list·koh_report)만, 어드민성 탭 0건', () => {
  const dt = read(DOCTOR_TOOLS);
  // 잔존 진료성 탭
  expect(dt).toContain('value="call_dashboard"');
  expect(dt).toContain('value="patient_list"');
  expect(dt).toContain('value="koh_report"'); // T-20260611-foot-KOH-REPORT-TAB(deployed) 정당 추가
  expect(dt).toContain('진료 알림판');
  expect(dt).toContain('진료 환자 목록');
  // 설명문 — 진료성 탭 안내(문구 변동에 robust, 핵심 키워드 + '확인합니다' 부분 매칭)
  expect(dt).toContain('진료 알림판');
  expect(dt).toContain('진료 환자 목록');
  expect(dt).toContain('확인합니다');
  // 어드민성 탭은 진료도구에서 제거됨
  for (const t of MOVED_TABS) {
    expect(dt, `진료도구에서 ${t} 제거`).not.toContain(`value="${t}"`);
  }
  expect(dt).not.toContain('contraindications');
  // 어드민 탭 컴포넌트 import 잔존 금지(번들 누수 방지)
  expect(dt).not.toContain('SuperPhrasesTab');
  expect(dt).not.toContain('PrescriptionSetsTab');
  expect(dt).not.toContain('ContraindicationsTab');
});

// ── 동선 정합: 진료차트 '관리 화면으로' → 진료관리로 진입(분리 후 단일화) ──
test('연동: MedicalChartPanel 관리 화면 진입이 clinic-management 로 라우팅', () => {
  const chart = read(CHART);
  expect(chart).toContain('/admin/clinic-management');
  expect(chart).toContain('/admin/clinic-management?tab=');
  // 구 경로(doctor-tools?tab=)로의 관리 진입은 잔존하지 않아야
  expect(chart).not.toContain('/admin/doctor-tools?tab=');
});
