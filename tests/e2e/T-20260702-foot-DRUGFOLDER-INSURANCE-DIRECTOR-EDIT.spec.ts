/**
 * T-20260702-foot-DRUGFOLDER-INSURANCE-DIRECTOR-EDIT (P1) — 처방세트 '급여여부' director 편집 복원
 *
 * 배경(슬랙 C0ATE5P6JTH, 문지은 대표원장 U0ALGAAAJAV):
 *   "나 진료관리 수정이 하나도 안되네 왜 막은거야" + 김주연 총괄 "원장님 권한 풀어줘".
 *   sibling(T-20260702-foot-CLINICMGMT-DIRECTOR-EDIT-FIX, deployed 4f27fec8)이 진료관리 3핵심탭 director
 *   편집을 복구했으나, DrugFoldersTab(처방세트 탭) '급여여부(insurance_status)' 편집이 미커버 잔여였다.
 *
 * ★RC 확정 (PROD 라이브 스냅샷 2026-07-18, _probe.mjs / READ-ONLY):
 *   is_admin_or_manager() PROD body = current_user_role() IN ('admin','manager','director')  ← director 이미 포함
 *   prescription_codes_admin_all [ALL] USING/WITH CHECK = is_admin_or_manager()             ← director 이미 write 가능
 *   ⇒ 급여여부 write RLS 는 이미 director 정합. 실제 락아웃 = FE 하드코딩 `role==='admin'` 단독.
 *   ⇒ RLS/DDL 변경 불필요(sibling 4f27fec8 의 "PROD 이미 정합, 실제원인=FE 하드코딩" 판례와 동형).
 *   급여여부 write 대상 = prescription_codes.insurance_status (InsuranceStatusPanel SSOT).
 *
 * Fix = FE 단독: DrugFoldersTab.canManageInsurance 를 admin-only 하드코딩 → canEditClinicMgmt(profile) 정합.
 *   canEditClinicMgmt = {admin, director(대표원장), has_ops_authority} true / 일반직원 false → 회귀 가드 정합.
 *
 * 본 spec 은 코드베이스 관행(logic-mirror + source-invariant)을 따른다. FE-only 이므로 마이그 불변식 대신
 *   "RLS 이미 director 정합" source-invariant(migration SSOT)로 회귀 가드를 건다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

test.describe('T-20260702-foot-DRUGFOLDER-INSURANCE-DIRECTOR-EDIT', () => {
  // ── 0. canEditClinicMgmt 로직 미러 (permissions.ts SSOT) ──────────────────
  type Subj = { role?: string | null; has_ops_authority?: boolean | null } | null | undefined;
  function canEditClinicMgmt(s: Subj): boolean {
    if (!s) return false;
    if (s.has_ops_authority === true) return true;
    if (s.role === 'admin') return true;
    if (s.role === 'director') return true;
    return false;
  }

  test('AC-1: 급여여부 편집 = director(문지은 대표원장)·admin(총괄)·has_ops_authority 가능', () => {
    expect(canEditClinicMgmt({ role: 'director' })).toBe(true);   // ★락아웃 해소 핵심(문지은 대표원장)
    expect(canEditClinicMgmt({ role: 'admin' })).toBe(true);      // 김주연 총괄 현 상태(회귀 없음)
    expect(canEditClinicMgmt({ role: 'manager', has_ops_authority: true })).toBe(true);
  });

  test('AC-2: 일반직원(has_ops_authority 없음)은 급여여부 편집 불가(권한 경계 회귀 가드)', () => {
    for (const r of ['consultant', 'coordinator', 'therapist', 'part_lead', 'staff', 'tm', 'doctor', 'technician', '', null, undefined]) {
      expect(canEditClinicMgmt({ role: r as string })).toBe(false);
    }
    expect(canEditClinicMgmt(null)).toBe(false);
  });

  // ── 1. FE: DrugFoldersTab — canManageInsurance = canEditClinicMgmt(profile), admin-only 하드코딩 제거 ──
  test('AC-3: DrugFoldersTab.canManageInsurance = canEditClinicMgmt(profile) (admin-only 하드코딩 제거)', () => {
    const src = read('src/components/admin/DrugFoldersTab.tsx');
    expect(src).toContain("import { canEditClinicMgmt } from '@/lib/permissions'");
    expect(src).toMatch(/const\s+canManageInsurance\s*=\s*canEditClinicMgmt\(profile\)\s*;/);
    // 폐기된 admin-only 하드코딩 잔존 금지(락아웃 재현 회귀 가드)
    expect(src).not.toMatch(/const\s+canManageInsurance\s*=\s*profile\?\.role\s*===\s*'admin'\s*;/);
  });

  // ── 2. permissions.ts SSOT: canEditClinicMgmt 헬퍼 + director escape 존재 ──
  test('AC-0: permissions.ts 에 canEditClinicMgmt 헬퍼 + director escape stopgap 존재', () => {
    const perms = read('src/lib/permissions.ts');
    expect(perms).toContain('export function canEditClinicMgmt');
    expect(perms).toMatch(/if\s*\(\s*s\.role\s*===\s*'director'\s*\)\s*return true/);
  });

  // ── 3. RLS source-invariant: 급여여부 write RLS 는 이미 director 정합(FE-only 정당성) ──
  //   급여여부 write = prescription_codes_admin_all(is_admin_or_manager) / is_admin_or_manager=admin/manager/director.
  //   본 티켓은 RLS 변경 없음 → 마이그 신규 추가 없음. 아래 불변식이 그 전제를 SSOT 로 고정한다.
  test('AC-4(RC): is_admin_or_manager() 정본 = admin/manager/director (director 이미 포함)', () => {
    const sep = read('supabase/migrations/20260426000000_rls_role_separation.sql');
    // is_admin_or_manager() 함수 body 에 director 포함
    expect(sep).toMatch(/current_user_role\(\)\s+IN\s*\('admin','manager','director'\)/);
  });

  test('AC-4(RC): prescription_codes write 정책 = is_admin_or_manager (director 이미 write 가능)', () => {
    const canon = read('supabase/migrations/20260617150000_prescription_codes_write_rls_canonical.sql');
    expect(canon).toContain('prescription_codes_admin_all');
    expect(canon).toMatch(/USING\s*\(is_admin_or_manager\(\)\)/);
    expect(canon).toMatch(/WITH CHECK\s*\(is_admin_or_manager\(\)\)/);
  });

  // ── 4. InsuranceStatusPanel: write 대상 = prescription_codes.insurance_status, RLS 이중가드 유지 ──
  test('AC-5: InsuranceStatusPanel write = prescription_codes.insurance_status, canWrite 게이트 유지(RLS 이중가드)', () => {
    const panel = read('src/components/admin/InsuranceStatusPanel.tsx');
    expect(panel).toContain("from('prescription_codes')");
    expect(panel).toMatch(/insurance_status/);
    // canWrite prop 게이트 유지(호출부 canManageInsurance 전달 → 이중가드)
    expect(panel).toMatch(/canWrite/);
  });
});
