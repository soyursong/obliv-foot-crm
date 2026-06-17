/**
 * T-20260617-foot-CLINICINFO-DIRECTOR-TO-STAFFSPACE
 * 병원관리 설정의 '병원·원장 정보'(원장정보 포함)를 [병원] 단독 메뉴 → [직원·공간](Staff) 내부 '원장정보' 탭으로 이동.
 *
 * 요청(김주연 총괄 2026-06-17 #foot): "병원.원장정보 -> 직원.공간 카테고리에 넣어줘"
 *
 * 구현(티켓 §3-IMPL, 케이스(a) 별도 navItem):
 *   1. AdminLayout.tsx: '병원·원장 정보' navItem(route /admin/clinic-settings) 사이드바에서 제거.
 *   2. App.tsx: /admin/clinic-settings → /admin/staff?tab=clinic-info 리다이렉트 보존(북마크/하드링크 404 방지).
 *   3. Staff.tsx: 새 탭 value="clinic-info"(Building2 + "원장정보") — ClinicSettings 페이지 콘텐츠 임베드.
 *      기존 "클리닉 설정"(레이저 시간단위) 탭은 별개 기능으로 유지.
 *
 * AC(티켓 §4):
 *   ① [직원·공간]에 '원장정보' 노출 + [병원] 단독 메뉴에서 제거
 *   ② 기능/필드/저장 동작 보존(회귀0) — 병원 기본정보 + 원장(의사) 정보 섹션 그대로
 *   ③ 노출 권한 규칙 보존 — clinic-settings 진입 role(admin/manager/consultant/coordinator/therapist) 동일 집합
 *   ④ 빈 그룹 안 남게 정리 — '직원·공간'(staff) navItem은 유지, clinic-settings 단독 항목만 제거
 *
 * 시나리오(티켓 §6):
 *   1. 사이드바에 '병원·원장 정보' 단독 메뉴 없음 + '직원·공간' 유지
 *   2. /admin/staff?tab=clinic-info → '원장정보' 탭 활성 + 병원·원장 정보 콘텐츠 노출(기능/필드 보존)
 *   3. /admin/clinic-settings 직접 진입 → /admin/staff 로 리다이렉트(404/blank 방지) + 원장정보 콘텐츠 노출
 *
 * 권한(③)·정적 무결성은 소스 락(아래 'source lock')으로 결정적 검증한다.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 사이드바: '병원·원장 정보' 단독 메뉴 제거 + '직원·공간' 유지 (AC①·④)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 사이드바에 병원·원장 정보 단독 메뉴 없음 + 직원·공간 유지', async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  // 사이드바 nav 렌더 대기
  const sidebarNav = page.locator('[data-sidebar-nav]');
  await sidebarNav.first().waitFor({ timeout: 20000 });

  // AC④: '직원·공간' 메뉴는 유지
  await expect(sidebarNav.getByRole('link', { name: '직원·공간' })).toBeVisible();

  // AC①: '병원·원장 정보' 단독 navItem 제거 — 사이드바 nav 링크에 존재하지 않음
  await expect(sidebarNav.getByRole('link', { name: '병원·원장 정보' })).toHaveCount(0);
  // /admin/clinic-settings 로 가는 사이드바 링크 자체가 없어야 함
  await expect(sidebarNav.locator('a[href="/admin/clinic-settings"]')).toHaveCount(0);

  console.log('✅ 시나리오1: 병원·원장 정보 단독 메뉴 제거 + 직원·공간 유지');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — /admin/staff?tab=clinic-info → '원장정보' 탭 + 콘텐츠 보존 (AC①·②)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: 직원·공간 > 원장정보 탭 노출 + 병원·원장 정보 콘텐츠(필드) 보존', async ({ page }) => {
  await page.goto(`${BASE}/admin/staff?tab=clinic-info`);

  // 직원·공간 탭 트리거 셋 렌더 대기
  await page.getByRole('tab', { name: '근무캘린더' }).first().waitFor({ timeout: 20000 });

  // AC①: '원장정보' 탭 존재 + 활성
  const clinicInfoTab = page.getByRole('tab', { name: '원장정보' });
  await expect(clinicInfoTab).toBeVisible();
  await expect(clinicInfoTab).toHaveAttribute('aria-selected', 'true');

  // AC②: 임베드된 병원·원장 정보 콘텐츠(섹션 헤더/필드) 보존
  await expect(page.getByRole('heading', { name: '병원·원장 정보 설정' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('병원 기본정보', { exact: true })).toBeVisible();
  await expect(page.getByText('원장(의사) 정보', { exact: true })).toBeVisible();
  // 핵심 입력 필드 라벨 보존(저장 동작 소스 = ClinicSettings 그대로 재사용)
  await expect(page.getByText('사업자등록번호', { exact: true })).toBeVisible();
  await expect(page.getByText('요양기관기호', { exact: true })).toBeVisible();

  // AC④: 기존 직원·공간 탭(근무캘린더/직원/공간 배정)도 그대로 유지
  await expect(page.getByRole('tab', { name: '직원' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '공간 배정' })).toBeVisible();

  console.log('✅ 시나리오2: 원장정보 탭 활성 + 병원·원장 정보 콘텐츠/필드 보존');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — /admin/clinic-settings 직접 진입 → 리다이렉트(404/blank 방지)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3: /admin/clinic-settings 직접 진입 → /admin/staff 리다이렉트 + 원장정보 콘텐츠', async ({ page }) => {
  await page.goto(`${BASE}/admin/clinic-settings`);

  // 리다이렉트 완료 대기 — URL이 /admin/staff 로 전환
  await page.waitForURL(/\/admin\/staff/, { timeout: 20000 });
  expect(page.url()).not.toContain('/admin/clinic-settings');

  // 리다이렉트 후 원장정보 탭 활성 + 콘텐츠 노출(빈 화면/404 아님)
  await expect(page.getByRole('tab', { name: '원장정보' })).toHaveAttribute('aria-selected', 'true', {
    timeout: 15000,
  });
  await expect(page.getByRole('heading', { name: '병원·원장 정보 설정' })).toBeVisible();

  console.log('✅ 시나리오3: clinic-settings 직접 진입 리다이렉트 + 콘텐츠 보존(404 방지)');
});

// ─────────────────────────────────────────────────────────────────────────────
// source lock — AC③(권한 보존) + 구조 무결성 결정적 검증 (role 분기 의존 없이)
// ─────────────────────────────────────────────────────────────────────────────
test('source lock: navItem 제거 + 리다이렉트 + 탭 임베드 + role 패리티 보존', () => {
  const adminLayout = readSrc('src/components/AdminLayout.tsx');
  const app = readSrc('src/App.tsx');
  const staff = readSrc('src/pages/Staff.tsx');

  // AC①: AdminLayout NAV_ITEMS 에서 clinic-settings 단독 navItem 제거
  expect(adminLayout).not.toContain("to: '/admin/clinic-settings'");
  // '직원·공간'(staff) navItem 은 유지 (AC④)
  expect(adminLayout).toContain("to: '/admin/staff'");

  // App.tsx: clinic-settings 라우트가 Navigate 리다이렉트로 전환 (404 방지)
  expect(app).toContain('path="clinic-settings"');
  expect(app).toMatch(/path="clinic-settings"[^>]*Navigate[^>]*\/admin\/staff\?tab=clinic-info/s);
  // 독립 ClinicSettings 라우트로서의 RoleGuard 렌더는 더 이상 없음(리다이렉트로 대체)
  expect(app).not.toMatch(/path="clinic-settings"[^>]*RoleGuard[^>]*ClinicSettings/s);

  // Staff.tsx: 원장정보 탭 + ClinicSettings 페이지 임베드
  expect(staff).toContain('value="clinic-info"');
  expect(staff).toContain('원장정보');
  expect(staff).toMatch(/import ClinicSettingsPage from ['"]@\/pages\/ClinicSettings['"]/);
  expect(staff).toContain('<ClinicSettingsPage />');

  // AC③: 가시성 role 패리티 — clinic-info 탭은 isAdmin 게이트 없이 staff 진입 role 전체 노출.
  //   staff 라우트 가드 = admin/manager/consultant/coordinator/therapist 그대로 보존(기존 clinic-settings 동일 집합).
  expect(app).toMatch(
    /path="staff"[^>]*roles=\{\['admin', 'manager', 'consultant', 'coordinator', 'therapist'\]\}/s,
  );
  // clinic-info TabsTrigger/TabsContent 가 {isAdmin && ...} 안에 들어가지 않았는지(전역 노출) 확인:
  //   isAdmin 게이트 탭은 registrars/settings 뿐 — clinic-info 트리거는 그 블록 밖.
  const clinicInfoTriggerIdx = staff.indexOf('value="clinic-info"');
  const registrarsTriggerIdx = staff.indexOf('value="registrars"');
  expect(clinicInfoTriggerIdx).toBeGreaterThan(0);
  expect(registrarsTriggerIdx).toBeGreaterThan(0);
  // clinic-info 트리거가 admin-only(registrars) 트리거보다 먼저 = 비게이트 영역에 위치
  expect(clinicInfoTriggerIdx).toBeLessThan(registrarsTriggerIdx);

  console.log('✅ source lock: navItem 제거 + 리다이렉트 + 탭 임베드 + role 패리티 보존');
});
