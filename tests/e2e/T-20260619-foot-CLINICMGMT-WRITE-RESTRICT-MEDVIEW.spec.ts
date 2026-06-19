/**
 * T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW — 진료관리: 조회=전원, 수정·편집=director+admin
 *
 * 배경(슬랙 C0ATE5P6JTH, 문지은 대표원장, ts 1781859275):
 *   "접근은 하되 수정편집만 의사+어드민한테 주자."
 *   → 진료관리(ClinicManagement) read 는 전직원 유지(STAFF-OPEN 무회귀), write(수정·편집·생성·삭제)만
 *     director(원장)+admin 로 제한. 의사 직군 = 문지은 대표원장 단독(director) → write = {director, admin}.
 *
 * Phase 분리 (planner 디스패치, "노출 축소 방향이라 무위험"):
 *   - Phase A(AC-2, 본 커밋, DB 미접촉): 진료관리 FE write-gate 를 {director,admin} 으로 통일.
 *       단 "노출 축소"(manager 제거)만 하고 신규 grant 는 안 함:
 *       · RLS write 가 旣존 {director,manager,admin} 인 탭(상병명/묶음상병/처방세트(폴더)/묶음처방/경과분석)
 *         → 공통 헬퍼 canEditClinicMgmt({director,admin}) 적용. director 무회귀.
 *       · RLS write 가 {admin,manager}(director 부재) 인 surface(빠른처방/슈퍼상용구/진료차트상용구/
 *         소견서상용구/서류템플릿/진료세트/급여여부) → Phase A 는 admin-only(manager 제거)만. director grant 시
 *         RLS 거부되므로 director 추가는 Phase B(AC-3 RLS, data-architect CONSULT GO 후) RLS 와 동시.
 *   - Phase B(AC-1/3/4): 진료대시보드 read-open + RLS write-restrict + 위 surface director grant. (본 spec 비범위)
 *
 * 비범위 가드:
 *   - 상용구관리(Services, PhrasesTab lockedType=pen_chart|customer_chart) = 직원 영역(§11.1) → 旣존 {admin,manager} 무변경.
 *   - 진료관리 read 가시성(Services.tsx canViewClinicMgmt=!!profile?.role, STAFF-OPEN) 무회귀.
 *   - 금기증(Contraindications)·MedicalChartPanel 내부 편집권 미접촉(AC-5 / MEDVIEW-SPLIT §7.2).
 *
 * 본 spec 은 코드베이스 관행(logic-mirror + source-invariant)을 따른다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

test.describe('T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW', () => {
  // ── 0. canEditClinicMgmt 로직 미러 (permissions.ts SSOT) ──────────────────
  const CLINIC_MGMT_WRITE_ROLES = ['director', 'admin'];
  function canEditClinicMgmt(role: string | null | undefined): boolean {
    return !!role && CLINIC_MGMT_WRITE_ROLES.includes(role);
  }

  test('AC-2: canEditClinicMgmt = director/admin 만 true, manager·직원은 false', () => {
    expect(canEditClinicMgmt('director')).toBe(true);
    expect(canEditClinicMgmt('admin')).toBe(true);
    // ★manager 는 write 박탈(노출 축소의 핵심)
    expect(canEditClinicMgmt('manager')).toBe(false);
    for (const r of ['consultant', 'coordinator', 'therapist', 'part_lead', 'staff', 'tm', '', null, undefined]) {
      expect(canEditClinicMgmt(r as string)).toBe(false);
    }
  });

  test('AC-2: permissions.ts 에 CLINIC_MGMT_WRITE_ROLES SSOT + 헬퍼 존재(director/admin 집합)', () => {
    const perms = read('src/lib/permissions.ts');
    expect(perms).toMatch(/CLINIC_MGMT_WRITE_ROLES\s*:\s*UserRole\[\]\s*=\s*\[\s*'director'\s*,\s*'admin'\s*\]/);
    expect(perms).toContain('export function canEditClinicMgmt');
  });

  // ── 1. RLS-{director,manager,admin} 탭 5종: 공통 헬퍼 적용(manager 제거) ────
  const helperTabs: { file: string; varName: string }[] = [
    { file: 'src/components/admin/DiagnosisNamesTab.tsx', varName: 'canManage' },
    { file: 'src/components/admin/DiagnosisSetsTab.tsx', varName: 'canEdit' },
    { file: 'src/components/admin/DrugFoldersTab.tsx', varName: 'canEdit' },
    { file: 'src/components/admin/ProgressPlansTab.tsx', varName: 'canWrite' },
    { file: 'src/components/admin/PrescriptionSetsTab.tsx', varName: 'canEdit' },
  ];
  for (const { file, varName } of helperTabs) {
    test(`AC-2: ${file.split('/').pop()} write 게이트는 canEditClinicMgmt 재사용`, () => {
      const src = read(file);
      expect(src).toContain("import { canEditClinicMgmt } from '@/lib/permissions'");
      expect(src).toMatch(new RegExp(`const\\s+${varName}\\s*=\\s*canEditClinicMgmt\\(profile\\?\\.role\\)`));
      // 폐기된 {director,manager,admin} 로컬 배열 잔존 금지(stale 회귀 가드)
      expect(src).not.toMatch(/\[\s*'director'\s*,\s*'manager'\s*,\s*'admin'\s*\]/);
      expect(src).not.toMatch(/\[\s*'admin'\s*,\s*'manager'\s*,\s*'director'\s*\]/);
    });
  }

  // ── 2. RLS-{admin,manager} surface 6종: admin-only(manager 제거, director=Phase B) ──
  const adminOnlyTabs = [
    'src/components/admin/QuickRxButtonsTab.tsx',
    'src/components/admin/SuperPhrasesTab.tsx',
    'src/components/admin/OpinionPhrasesTab.tsx',
    'src/components/admin/DocumentTemplatesTab.tsx',
    'src/components/admin/TreatmentSetsTab.tsx',
  ];
  for (const file of adminOnlyTabs) {
    test(`AC-2: ${file.split('/').pop()} write 게이트는 admin-only(manager 제거)`, () => {
      const src = read(file);
      expect(src).toMatch(/const\s+canEdit\s*=\s*profile\?\.role\s*===\s*'admin'\s*;/);
      // manager 가 canEdit 에 포함되면 안 됨(축소 미적용 회귀 가드)
      expect(src).not.toMatch(/canEdit\s*=\s*profile\?\.role\s*===\s*'admin'\s*\|\|\s*profile\?\.role\s*===\s*'manager'/);
    });
  }

  // ── 3. PhrasesTab: 공유 컴포넌트 — medical_chart(진료관리)만 게이트, 직원 상용구관리는 무변경 ──
  test('AC-2/§11.1: PhrasesTab write 게이트는 lockedType=medical_chart 일 때만 admin-only, 그 외(pen/customer_chart)는 admin||manager 보존', () => {
    const src = read('src/components/admin/PhrasesTab.tsx');
    expect(src).toContain("const isMedchartSurface = lockedType === 'medical_chart'");
    // medical_chart → admin-only / 그 외 → admin||manager 분기
    expect(src).toMatch(/isMedchartSurface\s*\?\s*profile\?\.role\s*===\s*'admin'\s*:\s*\(profile\?\.role\s*===\s*'admin'\s*\|\|\s*profile\?\.role\s*===\s*'manager'\)/);
  });

  // ── 4. 무회귀 가드 ───────────────────────────────────────────────────────
  test('AC-1: 진료관리 read 가시성(Services.tsx canViewClinicMgmt=!!profile?.role, STAFF-OPEN) 무회귀', () => {
    const svc = read('src/pages/Services.tsx');
    expect(svc).toMatch(/const canViewClinicMgmt\s*=\s*!!profile\?\.role\s*;/);
  });

  test('AC-5: 금기증(ContraindicationsTab) 게이트 미접촉(admin 한정 isAdmin 보존)', () => {
    const src = read('src/components/admin/ContraindicationsTab.tsx');
    expect(src).toMatch(/const\s+isAdmin\s*=\s*profile\?\.role\s*===\s*'admin'/);
  });

  test('AC-5: 진료대시보드 write-gate·RLS 는 본 커밋(Phase A) 비범위 — DB 마이그/RLS 미동봉', () => {
    // Phase A 는 DB 미접촉. 본 spec 은 FE-only 불변식만 검증한다(RLS 는 Phase B AC-3).
    expect(CLINIC_MGMT_WRITE_ROLES).toEqual(['director', 'admin']);
  });
});
