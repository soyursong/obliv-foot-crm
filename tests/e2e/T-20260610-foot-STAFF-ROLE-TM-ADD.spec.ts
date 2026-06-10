/**
 * T-20260610-foot-STAFF-ROLE-TM-ADD
 * 풋 직원등록 직책 'TM' 추가 + 계정관리 역할 'TM' 매핑.
 *
 * 배경: 풋센터 매니저 요청 — "직원 등록시 직책 'TM' 만들어줘 / 해당 직책으로 등록시
 *   계정관리에서 역할이 'TM'". 선결 게이트(DB CHECK)는 이미 'tm' 허용
 *   (20260513000040_contract_align_roles.sql) → 마이그레이션 불요(db_change=none).
 *
 * 박민지 팀장 C안(확정): TM 접근범위 = 대시보드/예약관리/고객관리/통계(route).
 *   통계 내부 탭 가시성(TM집계 탭만)은 자매 티켓 STATS-TM-AGGREGATE-TAB.
 *
 * 본 spec 은 role 매트릭스/드롭다운/라벨이 전부 소스 상수이므로 정적 소스 검증
 *   (fs.readFileSync)으로 AC1~AC6 + 핵심 불변식(ALL_STAFF_ROLES 에 tm 미편입 →
 *   manual_sms_send 임의 권한 부여 금지 + EF role 패리티 보존)을 회귀로 잡는다.
 *   브라우저 auth 불필요 → 빠르고 견고.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** `name: [ ... ]` 또는 `marker = [ ... ]` 형태의 단일 라인/멀티라인 배열에서 role 토큰 추출 */
function extractRoleArray(src: string, marker: RegExp): string[] {
  const m = src.match(marker);
  if (!m) throw new Error(`배열 추출 실패: ${marker}`);
  return [...m[1].matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((x) => x[1] ?? x[2]);
}

// ── AC1/AC5: 자기등록(회원가입) 직책 드롭다운에 'TM' 노출 ──────────────────────
test('AC1/AC5 Register.tsx ROLES 에 { value: "tm", label: "TM" } 포함', () => {
  const src = read('src/pages/Register.tsx');
  // value: 'tm' 항목 존재 + 라벨 'TM'
  expect(src).toMatch(/value:\s*'tm'\s*,\s*label:\s*'TM'/);
});

// ── AC2: 계정관리 역할 'TM' 표시 (admin 초대 ROLES + 라벨) ─────────────────────
test('AC2 Accounts.tsx ROLES 에 tm 포함 + status USER_ROLE_LABEL.tm = "TM"', () => {
  const accounts = read('src/pages/Accounts.tsx');
  const roles = extractRoleArray(accounts, /const ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/);
  expect(roles).toContain('tm');

  const status = read('src/lib/status.ts');
  // USER_ROLE_LABEL 안 tm: 'TM' 매핑
  expect(status).toMatch(/tm:\s*'TM'/);
});

// ── AC3: types UserRole 에 tm 존재 (DB CHECK 이미 허용 — 타입 정합) ────────────
test('AC3 types.ts UserRole 에 tm 포함 (저장 타입 정합)', () => {
  const types = read('src/lib/types.ts');
  expect(types).toMatch(/export type UserRole\s*=[^;]*'tm'/);
});

// ── AC6: TM route 접근 = dashboard/reservations/customers/stats 만 ─────────────
test('AC6 App.tsx stats RoleGuard 에 tm 포함 (dashboard/reservations/customers 는 무가드)', () => {
  const app = read('src/App.tsx');
  // stats route 의 RoleGuard roles 에 tm
  const statsRoles = extractRoleArray(
    app,
    /path="stats"\s+element=\{<RoleGuard roles=\{\[([^\]]+)\]\}/,
  );
  expect(statsRoles).toContain('tm');

  // dashboard(index)/reservations/customers 는 RoleGuard 없음 → 모든 인증 사용자(tm 포함) 접근
  expect(app).toMatch(/path="reservations"\s+element=\{<Reservations \/>\}/);
  expect(app).toMatch(/path="customers"\s+element=\{<Customers \/>\}/);
});

test('AC6 AdminLayout 통계 메뉴 NAV_ITEMS roles 에 tm 포함 (메뉴=라우트 패리티)', () => {
  const layout = read('src/components/AdminLayout.tsx');
  const navStatsRoles = extractRoleArray(
    layout,
    /to:\s*'\/admin\/stats'[^}]*roles:\s*\[([^\]]+)\]/,
  );
  expect(navStatsRoles).toContain('tm');
});

// ── AC6 + 최소권한: TM 은 명시 4키만, 그 외(설정/일마감/매출/메시지) 차단 ────────
test('AC6 permissions.ts PERM_MATRIX — tm 은 dashboard/reservations/customers/stats 에만', () => {
  const perm = read('src/lib/permissions.ts');

  const reservations = extractRoleArray(perm, /reservations:\s*\[([^\]]+)\]/);
  const stats = extractRoleArray(perm, /stats:\s*\[([^\]]+)\]/);
  expect(reservations).toContain('tm');
  expect(stats).toContain('tm');

  // dashboard/customers 는 [...ALL_STAFF_ROLES, 'tm'] 형태 — 명시 추가 확인
  expect(perm).toMatch(/dashboard:\s*\[\.\.\.ALL_STAFF_ROLES,\s*'tm'\]/);
  expect(perm).toMatch(/customers:\s*\[\.\.\.ALL_STAFF_ROLES,\s*'tm'\]/);

  // 미명시 메뉴 차단 — closing/register/messaging 에 tm 없어야(최소권한)
  const closing = extractRoleArray(perm, /closing:\s*\[([^\]]+)\]/);
  const messaging = extractRoleArray(perm, /messaging:\s*\[([^\]]+)\]/);
  expect(closing).not.toContain('tm');
  expect(messaging).not.toContain('tm');
});

// ── 핵심 불변식: ALL_STAFF_ROLES 에 tm 미편입 → manual_sms_send 임의 권한 부여 금지 ──
//   ALL_STAFF_ROLES 는 EF send-notification(manual_send) allowedRoles 와 role 패리티 SSOT.
//   tm 을 여기 넣으면 (1) AC6 미포함 SMS 발송 권한 부여(임의 권한 부여 금지 위반),
//   (2) FE↔EF role 패리티 drift 발생. 둘 다 차단해야 한다.
test('불변식 ALL_STAFF_ROLES 는 tm 미포함 (SMS 임의 권한 부여 + EF drift 차단)', () => {
  const perm = read('src/lib/permissions.ts');
  const allStaff = extractRoleArray(perm, /ALL_STAFF_ROLES:\s*UserRole\[\]\s*=\s*\[([^\]]+)\]/);
  expect(allStaff).not.toContain('tm');

  // manual_sms_send 는 여전히 [...ALL_STAFF_ROLES] (tm 비포함) — 발송 게이트 무회귀
  expect(perm).toMatch(/manual_sms_send:\s*\[\.\.\.ALL_STAFF_ROLES\]/);
});

// ── AC4: 무회귀 — 기존 직책/역할 라벨·드롭다운 보존 ───────────────────────────
test('AC4 무회귀 — 기존 역할 라벨(상담실장/코디/원장 등) 보존', () => {
  const status = read('src/lib/status.ts');
  for (const [role, label] of [
    ['consultant', '상담실장'],
    ['coordinator', '코디네이터'],
    ['director', '원장'],
    ['therapist', '치료사'],
  ] as const) {
    expect(status).toMatch(new RegExp(`${role}:\\s*'${label}'`));
  }
});
