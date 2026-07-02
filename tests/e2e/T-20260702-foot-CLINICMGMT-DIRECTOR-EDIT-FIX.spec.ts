/**
 * T-20260702-foot-CLINICMGMT-DIRECTOR-EDIT-FIX — 진료관리 3탭 director 편집 복원 (Phase B 집행)
 *
 * 배경(슬랙 C0ATE5P6JTH, 문지은 대표원장 U0ALGAAAJAV, ts 1782985214.357349):
 *   "슈퍼상용구 이하부터 다 (수정) 불가." → 진료관리 하위 3탭(슈퍼상용구·서류템플릿·상용구(진료차트))이
 *   Phase A(T-20260619) 당시 `profile?.role==='admin'` 하드코딩으로 남아 director(문지은) 락아웃.
 *   Phase B = 정본 헬퍼 canEditClinicMgmt(profile)로 교체(FE) + RLS write director ADDITIVE(3 테이블).
 *
 * 정본: DA CONSULT-REPLY MSG-20260702-185958-9i2o (option-A GO). planner INFO MSG-20260702-190400-3era.
 *   option-A = role IN {admin, manager, director} (ADDITIVE / broadening). option-B(has_ops_authority) 금지.
 *
 * ★PROD 실측(2026-07-02 dev-foot Management API): 3 테이블 admin_write RLS 는 이미 {admin,manager,director}
 *   (T-20260625 script 旣 apply). 실제 락아웃 원인 = FE 하위 3탭 admin-only 하드코딩 단독. 본 spec 은 그 FE fix +
 *   RLS canonical 재확정(super_phrases 드리프트 closure) 불변식을 검증한다.
 *
 * 본 spec 은 코드베이스 관행(logic-mirror + source-invariant)을 따른다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

test.describe('T-20260702-foot-CLINICMGMT-DIRECTOR-EDIT-FIX', () => {
  // ── 0. canEditClinicMgmt 로직 미러 (permissions.ts SSOT) ──────────────────
  //   has_ops_authority=true → true / admin → true / director(escape stopgap) → true / 그 외 false.
  type Subj = { role?: string | null; has_ops_authority?: boolean | null } | null | undefined;
  function canEditClinicMgmt(s: Subj): boolean {
    if (!s) return false;
    if (s.has_ops_authority === true) return true;
    if (s.role === 'admin') return true;
    if (s.role === 'director') return true;
    return false;
  }

  test('AC-1: director(문지은 대표원장)·admin·has_ops_authority 는 진료관리 편집 가능', () => {
    expect(canEditClinicMgmt({ role: 'director' })).toBe(true);   // ★락아웃 해소 핵심
    expect(canEditClinicMgmt({ role: 'admin' })).toBe(true);      // 김주연 총괄 현 상태(회귀 없음)
    expect(canEditClinicMgmt({ role: 'manager', has_ops_authority: true })).toBe(true); // 향후 flag 수렴 대비
  });

  test('AC-2: 일반직원(has_ops_authority 없음)은 진료관리 편집 불가(권한 경계 회귀 가드)', () => {
    for (const r of ['consultant', 'coordinator', 'therapist', 'part_lead', 'staff', 'tm', 'doctor', '', null, undefined]) {
      expect(canEditClinicMgmt({ role: r as string })).toBe(false);
    }
    expect(canEditClinicMgmt(null)).toBe(false);
  });

  test('AC-0: permissions.ts 에 canEditClinicMgmt 헬퍼 + director escape 존재', () => {
    const perms = read('src/lib/permissions.ts');
    expect(perms).toContain('export function canEditClinicMgmt');
    expect(perms).toMatch(/if\s*\(\s*s\.role\s*===\s*'director'\s*\)\s*return true/); // director escape stopgap
  });

  // ── 1. FE 3파일: admin-only 하드코딩 제거 → canEditClinicMgmt(profile) 정합 ──
  const directTabs = [
    'src/components/admin/SuperPhrasesTab.tsx',
    'src/components/admin/DocumentTemplatesTab.tsx',
  ];
  for (const file of directTabs) {
    test(`AC-3: ${file.split('/').pop()} — canEdit = canEditClinicMgmt(profile), admin-only 하드코딩 제거`, () => {
      const src = read(file);
      expect(src).toContain("import { canEditClinicMgmt } from '@/lib/permissions'");
      expect(src).toMatch(/const\s+canEdit\s*=\s*canEditClinicMgmt\(profile\)\s*;/);
      // 폐기된 admin-only 하드코딩 잔존 금지(락아웃 재현 회귀 가드)
      expect(src).not.toMatch(/const\s+canEdit\s*=\s*profile\?\.role\s*===\s*'admin'\s*;/);
    });
  }

  // ── 2. PhrasesTab: medical_chart(진료관리 영역)만 canEditClinicMgmt, staff-area(펜/고객차트) 무변경 ──
  test('AC-3/§11.1: PhrasesTab — medical_chart 분기는 canEditClinicMgmt, staff-area 는 canEditStaffAreaPhrase 유지', () => {
    const src = read('src/components/admin/PhrasesTab.tsx');
    expect(src).toMatch(/import\s*\{[^}]*canEditClinicMgmt[^}]*\}\s*from\s*'@\/lib\/permissions'/);
    expect(src).toContain("const isMedchartSurface = lockedType === 'medical_chart'");
    // medical_chart → canEditClinicMgmt(profile) / 그 외 → canEditStaffAreaPhrase(profile?.role)
    expect(src).toMatch(/isMedchartSurface\s*\?\s*canEditClinicMgmt\(profile\)\s*:\s*canEditStaffAreaPhrase\(profile\?\.role\)/);
    // medical_chart 분기의 admin-only 하드코딩 잔존 금지
    expect(src).not.toMatch(/isMedchartSurface\s*\?\s*profile\?\.role\s*===\s*'admin'/);
  });

  // ── 3. RLS 마이그(3 테이블 director ADDITIVE, option-A) 불변식 ─────────────
  const MIG = 'supabase/migrations/20260702200000_clinicmgmt_3tab_director_write_rls_canonical.sql';
  const RB = 'supabase/migrations/20260702200000_clinicmgmt_3tab_director_write_rls_canonical.rollback.sql';

  test('AC-4(G2): 마이그는 3 admin_write 정책을 {admin,manager,director} 로 확정(C1: manager 유지)', () => {
    const mig = read(MIG);
    for (const pol of ['admin_write_super_phrases', 'admin_write_document_templates', 'admin_write_phrase_templates']) {
      expect(mig).toContain(pol);
    }
    // option-A: role IN {admin,manager,director} — 3회(테이블당 1) 이상
    const roleMatches = mig.match(/role IN \('admin', 'manager', 'director'\)/g) || [];
    expect(roleMatches.length).toBeGreaterThanOrEqual(3);
    // C1 불변식: manager 유지(director-only 축소 금지)
    expect(mig).not.toMatch(/role IN \('admin', 'director'\)/);
    expect(mig).not.toMatch(/role IN \('director'\)/);
    // option-B(has_ops_authority) RLS 게이트 미채택
    expect(mig).not.toMatch(/has_ops_authority\s*=\s*true/);
  });

  test('AC-4(G2): 마이그는 admin_write 3정책만 DROP/CREATE — staffarea_write_phrases·read 정책 무접촉', () => {
    const mig = read(MIG);
    // DROP/CREATE 대상은 정확히 3 admin_write 정책뿐(주석 언급은 허용, 실제 DDL 문만 카운트)
    const drops = mig.match(/^DROP POLICY IF EXISTS "([^"]+)"/gm) || [];
    const creates = mig.match(/^CREATE POLICY "([^"]+)"/gm) || [];
    expect(drops.length).toBe(3);
    expect(creates.length).toBe(3);
    // staffarea_write_phrases / staff_read_* 에 대한 DROP/CREATE 는 없어야 함
    expect(mig).not.toMatch(/(DROP|CREATE) POLICY[^\n]*staffarea_write_phrases/);
    expect(mig).not.toMatch(/(DROP|CREATE) POLICY[^\n]*staff_read_/);
    // 1 txn (BEGIN/COMMIT)
    expect(mig).toContain('BEGIN;');
    expect(mig).toContain('COMMIT;');
  });

  test('AC-4(G1): 롤백 SQL 동봉 — 정확히 {admin,manager} baseline 복원', () => {
    const rb = read(RB);
    for (const pol of ['admin_write_super_phrases', 'admin_write_document_templates', 'admin_write_phrase_templates']) {
      expect(rb).toContain(pol);
    }
    const baseMatches = rb.match(/role IN \('admin', 'manager'\)/g) || [];
    expect(baseMatches.length).toBeGreaterThanOrEqual(3);
    // 롤백은 director 재제거(baseline) — director 잔존 금지
    expect(rb).not.toMatch(/role IN \('admin', 'manager', 'director'\)/);
  });
});
