import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * T-20260702-foot-CODY-ALL-PKG-PERM
 *
 * 현장 재확인(김주연 총괄, MSG-20260702) exact repro:
 *   승인된 coordinator 4명(김민경·김지혜·박민석·장예지) → 2번차트 패키지 섹션 → [구입티켓추가] 미노출.
 *
 * repro-first PIN 결과: first-failing-link = FE 버튼 role-visibility 게이트(체크인 게이트 아님).
 *   - packages RLS write set = STAFF_UNLOCK_ROLES(coordinator 포함) + packages_staff_unlock_6menu 마이그 → DB write 정상.
 *   - chart-page [구입 티켓 추가]/[항목 추가]/[수정·삭제] 버튼만 admin/manager/consultant 하드코딩 → coordinator 미노출 = FE/RLS 불일치.
 *
 * fix: 세 버튼 게이트를 isStaffUnlockRole(=STAFF_UNLOCK_ROLES 6역할)로 정합. (FE=RLS)
 * 소스단언 방식(로그인 세션 불요) — 게이트가 하드코딩 3역할로 회귀하면 실패.
 */

const SRC = resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');
const PERM = resolve(__dirname, '../../src/lib/permissions.ts');

test('AC-1: [구입 티켓 추가]/[항목 추가] 버튼 게이트가 isStaffUnlockRole 로 정합(coordinator 포함)', () => {
  const src = readFileSync(SRC, 'utf-8');
  // 패키지 섹션 wrapper 가 isStaffUnlockRole 게이트를 사용한다.
  expect(src).toContain('isStaffUnlockRole(profile?.role)');
  // 패키지 버튼 영역이 하드코딩 3역할(admin||manager||consultant)로 회귀하지 않았다.
  // 앵커 = 구입 티켓 추가 버튼 고유 핸들러(setOpenPackagePurchase) — 주석 오탐 회피.
  const pkgBtnIdx = src.indexOf('setOpenPackagePurchase(true)');
  expect(pkgBtnIdx).toBeGreaterThan(0);
  const gateWindow = src.slice(pkgBtnIdx - 1500, pkgBtnIdx);
  expect(gateWindow).toContain('isStaffUnlockRole(profile?.role)');
  // 이 버튼 직전 게이트가 하드코딩 3역할 conjunction 이 아니다.
  expect(gateWindow).not.toContain("profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'consultant'");
});

test('AC-2: 패키지 수정/삭제 버튼도 동일 role-set(생성=수정 정합, 반쪽권한 방지)', () => {
  const src = readFileSync(SRC, 'utf-8');
  // 앵커 = 수정 버튼 고유 핸들러(setEditPkgDlg) — 주석 오탐 회피.
  const editIdx = src.indexOf('setEditPkgDlg(p)');
  expect(editIdx).toBeGreaterThan(0);
  const editWindow = src.slice(editIdx - 800, editIdx);
  expect(editWindow).toContain('isStaffUnlockRole(profile?.role)');
});

test('AC-3: STAFF_UNLOCK_ROLES 에 coordinator 포함(= packages RLS write set 과 FE 정합)', () => {
  const perm = readFileSync(PERM, 'utf-8');
  const defIdx = perm.indexOf('STAFF_UNLOCK_ROLES: UserRole[] = [');
  expect(defIdx).toBeGreaterThan(0);
  const defBlock = perm.slice(defIdx, defIdx + 160);
  expect(defBlock).toContain("'coordinator'");
});

test('AC-4: import 에 isStaffUnlockRole 추가됨', () => {
  const src = readFileSync(SRC, 'utf-8');
  expect(src).toMatch(/import\s*\{[^}]*isStaffUnlockRole[^}]*\}\s*from\s*'@\/lib\/permissions'/);
});
