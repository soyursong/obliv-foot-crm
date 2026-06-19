/**
 * T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR B2① — director OR-widening 파리티 회귀 spec
 *
 * 배경: 문지은 대표원장(user_profiles.role) admin→director 전환(B2②) 시, director 가
 *   admin-정확매칭 운영게이트들에서 권한을 광역 상실하는 GO_WARN 회귀(STAFF-MOONJIEUN
 *   조사 §3)를 차단하기 위해, 9개 운영게이트에 director 를 OR-추가(순수 widening, admin 비제거).
 *
 * 본 spec 은 9게이트 각각의 소스에 'director' 가 존재(OR-추가됨) + 'admin' 이 보존(비제거)
 *   되었는지를 정적 소스 검사로 회귀가드한다. (running app/DB 불요 — 게이트 role-set 상수 잠금)
 *
 * 9 게이트: ①accounts ②staff ③services ④packages ⑤assignments ⑥stats
 *           ⑦treatment-table ⑧sales ⑨register
 *   + 부수(DA PII): customer_export, 고객삭제(canDeleteCustomer)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// playwright 는 repo root 에서 실행 → process.cwd() 가 obliv-foot-crm 루트(ESM 안전, __dirname 불가).
const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

// 한 줄(라우트/nav/상수)에 director 와 admin 이 모두 존재하는지 검사하는 헬퍼.
function lineHas(src: string, anchor: string, needles: string[]): boolean {
  const line = src.split('\n').find(l => l.includes(anchor));
  if (!line) return false;
  return needles.every(n => line.includes(n));
}

test.describe('B2① director OR-widening (admin 비제거)', () => {
  const app = () => read('src/App.tsx');
  const nav = () => read('src/components/AdminLayout.tsx');
  const perm = () => read('src/lib/permissions.ts');

  // ── App.tsx RoleGuard 라우트 ──
  test('①accounts route = admin+director (admin 보존)', () => {
    expect(lineHas(app(), 'path="accounts"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('②staff route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="staff"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('③services route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="services"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('④packages route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="packages"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('⑤assignments route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="assignments"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('⑥stats route = +director (admin 보존) — PERM_MATRIX 정합', () => {
    expect(lineHas(app(), 'path="stats"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('⑦treatment-table route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="treatment-table"', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('⑧sales route = +director (admin 보존)', () => {
    expect(lineHas(app(), 'path="sales"', ["'admin'", "'director'"])).toBeTruthy();
  });

  // ── AdminLayout nav 패리티(메뉴 보이는데 route 튕김=NAV-BOUNCE 차단) ──
  test('nav: accounts/sales/treatment-table/stats/staff/services/packages/assignments director 포함', () => {
    const n = nav();
    for (const anchor of [
      "label: '계정관리'", "label: '매출집계'", "label: '치료 테이블'",
      "label: '통계'", "label: '직원·공간'", "label: '서비스관리'",
      "label: '패키지'", "label: '상담·치료사 배정'",
    ]) {
      expect(lineHas(n, anchor, ["'director'"]), `nav ${anchor} director 누락`).toBeTruthy();
    }
  });

  // ── permissions.ts PERM_MATRIX ──
  test('⑨register = admin+manager+director (admin 보존)', () => {
    expect(lineHas(perm(), 'register:', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('⑥stats(PERM_MATRIX) director 포함 — route 와 정합', () => {
    expect(lineHas(perm(), 'stats:', ["'admin'", "'director'"])).toBeTruthy();
  });
  test('customer_export(PII) = +director (admin 보존, rrn 영구제외 불변)', () => {
    expect(lineHas(perm(), 'customer_export:', ["'admin'", "'director'"])).toBeTruthy();
  });

  // ── 페이지 내부 write-gate isAdmin ──
  test('Staff/Services/Packages isAdmin = director OR-추가 (admin 보존)', () => {
    expect(read('src/pages/Staff.tsx')).toContain("profile?.role === 'director'");
    expect(read('src/pages/Staff.tsx')).toContain("profile?.role === 'admin'");
    expect(read('src/pages/Services.tsx')).toContain("profile?.role === 'director'");
    expect(read('src/pages/Services.tsx')).toContain("profile?.role === 'admin'");
    expect(read('src/pages/Packages.tsx')).toContain("profile?.role === 'director'");
    expect(read('src/pages/Packages.tsx')).toContain("profile?.role === 'admin'");
  });

  test('Customers canDeleteCustomer = admin OR director (PII 삭제, admin 보존)', () => {
    const c = read('src/pages/Customers.tsx');
    expect(lineHas(c, 'canDeleteCustomer', ["'admin'", "'director'"])).toBeTruthy();
  });
});
