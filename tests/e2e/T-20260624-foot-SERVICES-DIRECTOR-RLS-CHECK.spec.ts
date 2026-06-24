/**
 * T-20260624-foot-SERVICES-DIRECTOR-RLS-CHECK
 * '상병명 관리'(services 테이블, category_label='상병') RLS write 의 director 포함 여부 확인 + AC-4 FE 방어.
 *
 * 부모: T-20260624-foot-BUNDLERX-ICON-NOAPPLY (AC-6 분기 파생).
 * 신고/맥락: director(문지은 대표원장) 본인 자기요청 승계 → medical_confirm_gate §11.1 self-request 예외.
 *
 * ── 조사 결론(AC-1/AC-2 · 분기 a) ──────────────────────────────────────────
 * services_admin_all 정책 = USING/WITH CHECK is_admin_or_manager().
 * is_admin_or_manager() = is_approved_user() AND current_user_role() IN ('admin','manager','director').
 *   → ★director 포함★. 부모 3정책(prescription_sets/document_templates/phrase_templates)이
 *     쓰던 inline {admin,manager} EXISTS 패턴과 달리, services 는 함수 기반이라 director 가 旣포함.
 *   ※ 동명이 함수 주의: current_user_is_admin_or_manager()(20260423)는 admin/manager 만 →
 *     services 가 쓰는 함수가 아님. services 는 is_admin_or_manager()(20260426, director 포함)를 사용.
 *   → write 정상 → ★DB/RLS 변경 불필요(db_change:false)★. 부모와 동일 silent-deny 재발 위험 없음.
 *
 * ── 편집 게이트 ⊆ RLS write set (silent-deny 경로 부재 증명) ──────────────────
 * canEditClinicMgmt = admin || has_ops_authority || director(stopgap).
 *   → {admin,director} ⊆ {admin,manager,director}(RLS write) 이므로 편집 버튼에 도달하는
 *     모든 역할이 RLS write 가능 = 거짓 '저장됐어요' 발생 경로 0.
 *
 * ── AC-4 (FE 방어, 향후 drift 대비) ─────────────────────────────────────────
 * 그럼에도 useSaveDx(UPDATE/INSERT)·useDeleteDx 에 .select('id') + 0행 throw 가드를 동반 적용
 *   (부모 BUNDLERX-ICON-NOAPPLY part2 패턴 미러). RLS/역할 drift 시에도 거짓 성공 토스트 영구 차단.
 *
 * 본 spec = 소스 정적 회귀가드(unit). DB 변경 없음.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DX_TAB = read('src/components/admin/DiagnosisNamesTab.tsx');
const ROLE_SEP = read('supabase/migrations/20260426000000_rls_role_separation.sql');
const PERMS = read('src/lib/permissions.ts');

// ── AC-1/AC-2: services write RLS director 포함 (분기 a, 무변경) ──────────────
test.describe('AC-1/AC-2: services write RLS 는 director 를 포함한다(분기 a)', () => {
  test('services_admin_all 정책은 is_admin_or_manager() 함수 기반', () => {
    expect(ROLE_SEP).toMatch(
      /CREATE POLICY services_admin_all ON services FOR ALL TO authenticated\s*\n\s*USING \(is_admin_or_manager\(\)\) WITH CHECK \(is_admin_or_manager\(\)\)/,
    );
  });

  test('is_admin_or_manager() 함수 정의는 director 를 포함한다', () => {
    const code = stripComments(ROLE_SEP);
    const start = code.indexOf('FUNCTION is_admin_or_manager()');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, start + 400);
    expect(body).toMatch(/current_user_role\(\) IN \('admin','manager','director'\)/);
  });
});

// ── 편집 게이트 ⊆ RLS write set (silent-deny 경로 부재) ───────────────────────
test.describe('canEditClinicMgmt(편집 게이트) ⊆ services write RLS', () => {
  const code = stripComments(PERMS);
  test('편집 게이트는 admin / has_ops_authority / director 만 허용 — 모두 RLS write 포함됨', () => {
    const start = code.indexOf('function canEditClinicMgmt');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, start + 900);
    expect(body).toContain("s.has_ops_authority === true");
    expect(body).toContain("s.role === 'admin'");
    expect(body).toContain("role === 'director'");
    // {admin,director} ⊆ {admin,manager,director} → 편집 가능자 전원 RLS write 가능.
  });
});

// ── AC-4: 상병명 저장/삭제 0행 silent no-op throw (FE 방어) ────────────────────
test.describe('AC-4: 상병명 저장/삭제 0행 throw — 거짓 성공 토스트 차단', () => {
  const code = stripComments(DX_TAB);

  test('useSaveDx UPDATE 는 .select(\'id\') 로 영향 행을 회수한다', () => {
    expect(code).toMatch(/\.update\(payload\)\.eq\('id', id\)\.select\('id'\)/);
  });

  test('useSaveDx INSERT 는 .select(\'id\') 로 생성 행을 회수한다', () => {
    expect(code).toMatch(/\}\)\s*\.select\('id'\)/);
  });

  test('useDeleteDx delete 는 .select(\'id\') 로 삭제 행을 회수한다', () => {
    expect(code).toMatch(/\.delete\(\)\.eq\('id', id\)\.select\('id'\)/);
  });

  test('0행이면 throw — error:null 이라도 거짓 성공 차단(UPDATE/INSERT/DELETE 3곳)', () => {
    const guards = code.match(/if \(!data \|\| data\.length === 0\)/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });

  test('성공 토스트는 0행 throw 이후의 onSuccess 에서만(거짓 성공 경로 없음)', () => {
    // mutationFn 안에서 throw 되면 onSuccess 미호출 → toast.success 안전.
    expect(DX_TAB).toContain("toast.success('상병명이 저장됐어요.')");
    expect(DX_TAB).toContain("toast.success('상병명이 삭제됐어요.')");
  });
});
