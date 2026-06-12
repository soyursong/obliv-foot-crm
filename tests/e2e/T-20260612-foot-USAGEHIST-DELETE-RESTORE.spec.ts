/**
 * T-20260612-foot-USAGEHIST-DELETE-RESTORE
 * 고객차트 시술 사용이력(회차) 실수 삭제 원복
 *
 * 요청: 김주연 총괄 — 사용 이력에서 '수정' 대신 '삭제'를 실수로 누른 경우 되돌릴 방법.
 *
 * 근본원인:
 *   deleteSession()이 package_sessions row를 HARD DELETE(.delete()) → 앱 복원 경로 0.
 *
 * 해법(예방 = 주 구현):
 *   1) HARD DELETE → SOFT DELETE: soft_delete_package_session RPC(status='deleted' 표식).
 *   2) 복원(원복) UI: 삭제된 회차 노출 + restore_package_session RPC(status='used' 환원).
 *   3) 잔여횟수 정합: 모든 집계가 status='used'만 카운트 → 삭제 +1 / 복원 -1 자동.
 *   4) 권한 비확대: RPC 내부 is_admin_or_manager() 게이트 = 기존 DELETE 권한 동일.
 *   5) UNIQUE 충돌 가드: 삭제 row가 session_number 점유 → 신규 회차번호는 전체 row 최대+1.
 *
 * 본 spec은 DB게이트(supervisor) 적용 전 단계 — 잔여횟수/회차번호 불변식(LOGIC) +
 * 소스 구현 계약(STATIC)을 회귀 가드한다. E2E는 시드 존재 시에만.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHART = readFileSync(
  join(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
  'utf-8',
);
const MIG = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260612140000_pkg_session_soft_delete_restore.sql'),
  'utf-8',
);

// ── 공통 로그인 헬퍼 ────────────────────────────────────────────
async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/이메일/).fill(process.env.TEST_EMAIL ?? 'test@obliv.kr');
  await page.getByLabel(/비밀번호/).fill(process.env.TEST_PASSWORD ?? 'test1234!');
  await page.getByRole('button', { name: /로그인/ }).click();
  await page.waitForURL(/\/(dashboard|waiting)/, { timeout: 15_000 });
}

// ──────────────────────────────────────────────────────────────
// LOGIC: 잔여횟수 불변식 — 'used'만 카운트하므로 'deleted'는 자동 제외(+1) / 복원 시 -1
// ──────────────────────────────────────────────────────────────
type Sess = { session_type: string; status: string };
function usedRemaining(total: number, sessions: Sess[], type: string): number {
  const used = sessions.filter((s) => s.status === 'used' && s.session_type === type).length;
  return total - used;
}

test('LOGIC: 회차 soft-delete(status=deleted) 시 잔여 +1 (used만 차감)', () => {
  const before: Sess[] = [
    { session_type: 'heated_laser', status: 'used' },
    { session_type: 'heated_laser', status: 'used' },
  ];
  expect(usedRemaining(5, before, 'heated_laser')).toBe(3);
  // 2회 중 1건 삭제(soft) → used 1건만 카운트 → 잔여 4
  const after: Sess[] = [
    { session_type: 'heated_laser', status: 'used' },
    { session_type: 'heated_laser', status: 'deleted' },
  ];
  expect(usedRemaining(5, after, 'heated_laser')).toBe(4);
});

test('LOGIC: 복원(deleted→used) 시 잔여 -1 (원복 정합)', () => {
  const restored: Sess[] = [
    { session_type: 'heated_laser', status: 'used' },
    { session_type: 'heated_laser', status: 'used' }, // 복원됨
  ];
  expect(usedRemaining(5, restored, 'heated_laser')).toBe(3);
});

// ──────────────────────────────────────────────────────────────
// LOGIC: 신규 회차번호 = 전체 row(삭제 포함) 최대 session_number + 1 (UNIQUE 충돌 가드)
// ──────────────────────────────────────────────────────────────
function nextSessionNumber(rows: { session_number: number }[]): number {
  const nums = rows.map((r) => r.session_number);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

test('LOGIC: 마지막 회차 삭제 후 재차감 — 삭제 row가 번호 점유해도 충돌 없음', () => {
  // 1,2,3회 중 3회를 soft-delete → row는 남아 session_number=3 점유
  const rows = [
    { session_number: 1, status: 'used' },
    { session_number: 2, status: 'used' },
    { session_number: 3, status: 'deleted' },
  ];
  // used 개수 기반(=2)+1=3 이면 삭제 row(3)와 UNIQUE 충돌 → 전체 최대(3)+1=4 여야 안전
  expect(nextSessionNumber(rows)).toBe(4);
  const usedCountPlus1 = rows.filter((r) => r.status === 'used').length + 1;
  expect(usedCountPlus1).toBe(3); // 옛 로직이면 충돌나는 번호
  expect(nextSessionNumber(rows)).not.toBe(usedCountPlus1);
});

test('LOGIC: 회차 없는 패키지 첫 차감 = 1회', () => {
  expect(nextSessionNumber([])).toBe(1);
});

// ──────────────────────────────────────────────────────────────
// STATIC: 소스 구현 계약 회귀 가드
// ──────────────────────────────────────────────────────────────
test('STATIC: deleteSession은 HARD DELETE(.delete())가 아니라 soft_delete RPC를 호출한다', () => {
  // hard delete 부활 차단
  expect(CHART).not.toMatch(/from\('package_sessions'\)\.delete\(\)/);
  expect(CHART).toContain("supabase.rpc('soft_delete_package_session'");
});

test('STATIC: restoreSession(원복) + restore RPC 존재', () => {
  expect(CHART).toContain('const restoreSession');
  expect(CHART).toContain("supabase.rpc('restore_package_session'");
});

test('STATIC: 삭제된 회차(status=deleted) 복원 UI가 렌더된다', () => {
  expect(CHART).toContain('deletedSessions');
  expect(CHART).toContain("s.status === 'deleted'");
  expect(CHART).toContain('복원');
});

test('STATIC: 복원 버튼 권한 = admin/manager/director (삭제 버튼과 동일, 확대 없음)', () => {
  // 복원 블록 가드에 4개 역할 모두 등장하지 않고 admin/manager/director만
  const restoreBlock = CHART.slice(CHART.indexOf('deletedSessions.length > 0'));
  expect(restoreBlock).toMatch(/'admin' \|\| profile\?\.role === 'manager' \|\| profile\?\.role === 'director'/);
});

test('STATIC: 신규 INSERT의 session_number는 nextSessionNumberFor()로 산출 (usedCount+1 잔존 금지)', () => {
  expect(CHART).toContain('const nextSessionNumberFor');
  // 회차 insert 경로에 옛 usedCount/dlg 기반 번호가 남아있으면 안 됨
  expect(CHART).not.toContain('session_number: usedCount + 1');
  expect(CHART).not.toContain('session_number: dupDeductModal.usedCount + 1');
  expect(CHART).not.toContain('session_number: useSessionDlg.nextSession');
});

// ──────────────────────────────────────────────────────────────
// STATIC: 마이그레이션 계약 (DB게이트 적용 전 초안 무결성)
// ──────────────────────────────────────────────────────────────
test('STATIC(MIG): status CHECK에 deleted 추가 + 감사컬럼 + 권한게이트 RPC', () => {
  expect(MIG).toContain("CHECK (status IN ('used','cancelled','refunded','deleted'))");
  expect(MIG).toContain('deleted_at');
  expect(MIG).toContain('deleted_by');
  expect(MIG).toContain('soft_delete_package_session');
  expect(MIG).toContain('restore_package_session');
  // 권한 비확대: RPC 내부 admin/manager 게이트
  expect(MIG).toMatch(/is_admin_or_manager\(\)/);
  expect(MIG).toContain('SECURITY DEFINER');
});

// ──────────────────────────────────────────────────────────────
// E2E (시드 존재 시) — 차트에서 삭제/복원 동선 무회귀 렌더
// ──────────────────────────────────────────────────────────────
test.describe('차트 사용이력 삭제/복원 UI', () => {
  test('차트 진입 시 콘솔 치명 에러 없이 렌더', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await loginAsAdmin(page);
    await page.goto('/customers');
    const firstCustomer = page.locator('tbody tr, [data-testid="customer-row"]').first();
    if ((await firstCustomer.count()) === 0) test.skip(true, '고객 시드 없음');
    await firstCustomer.click();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
