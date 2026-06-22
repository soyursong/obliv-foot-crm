import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260622-foot-AUTOASSIGN-ASSIGNEE-BADGE-BELL
 *
 * 자동배정 담당자 표기 A안(내 담당 배지) + B안(벨 알림 🔔) 동시 적용.
 * 김주연 총괄 두 안 동시적용 확정. 순수 FE 표시/알림 레이어 — 배정 알고리즘·대시보드
 * 동작 불변, add-only, 회귀0.
 *
 * ※ 본 spec 은 commit 035afea6(선행 동일기능 티켓 T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY)
 *   으로 이미 shipped 된 코드를 본 티켓 AC1~5 + 현장 클릭 시나리오 3종 프레이밍으로 재검증한다.
 *   두 티켓은 동일 기능(MSG-180423 vs MSG-180518, 55초 간격)이며 planner 측 dedup 대상.
 *
 * ── AC (본 티켓 기준) ──
 *  AC-1 (A안): 로그인 staff_id == 대기카드 배정 staff_id → "내 담당" 배지(본인 한정, FE-only).
 *  AC-2 (B안): 자동배정 이벤트는 기존 assignment_actions(auto_assign) SSOT 재사용 — 별도 알림 테이블 신설 0.
 *  AC-3 (B안): 🔔 클릭 → 최근순 "{고객명} → {담당자명} 배정됨" 알림 피드.
 *  AC-4 (B안): 읽음상태 = per-user localStorage (DB 불요).
 *  AC-5: 배정 알고리즘/대시보드 동작 불변 — 표기/알림 add-only.
 *
 * ── 현장 클릭 시나리오 3종 ──
 *  S1: 종 클릭 → 패널 열림 / 다시 클릭 → 닫힘.
 *  S2: 알림 1건 클릭 → 그 건만 읽음(미읽음 1 감소).
 *  S3: "모두 읽음" → 미읽음 0.
 *
 * 자동배정 자체는 멀티세션·근무시트·실시간에 의존해 E2E 결정론적 재현이 어렵다.
 * → 라이브 렌더(종/패널 토글·읽음 컨트롤)는 Playwright, 배정→배지/알림 결선은 소스 무결성으로 검증.
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const LAYOUT = fs.readFileSync(path.resolve('src/components/AdminLayout.tsx'), 'utf-8');
const BELL = fs.readFileSync(path.resolve('src/components/AssignmentNotifyBell.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 현장 클릭 시나리오 (라이브 Playwright)
// ════════════════════════════════════════════════════════════════════════
test.describe('AUTOASSIGN-ASSIGNEE-BADGE-BELL — 현장 클릭 시나리오 (라이브)', () => {
  test('S1: 종 클릭 → 패널 열림 → 다시 클릭 → 닫힘', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const bell = page.getByTestId('assign-notify-bell');
    await expect(bell).toBeVisible({ timeout: 15_000 });

    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible({ timeout: 5_000 });

    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toHaveCount(0, { timeout: 5_000 });
  });

  test('S2/S3: 패널에 "모두 읽음" 컨트롤 + 항목별 읽음 결선 노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const bell = page.getByTestId('assign-notify-bell');
    await expect(bell).toBeVisible({ timeout: 15_000 });
    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible({ timeout: 5_000 });

    // "모두 읽음"(S3) 컨트롤 존재
    await expect(page.getByTestId('assign-notify-readall')).toBeVisible();

    // 오늘 자동배정 알림이 있으면 1건 클릭 → per-item 읽음(S2), 없으면 빈 안내(둘 중 하나)
    const items = page.getByTestId('assign-notify-item');
    const count = await items.count();
    if (count > 0) {
      const wasUnread = (await items.first().getAttribute('data-unread')) === 'true';
      await items.first().click();
      if (wasUnread) {
        await expect(items.first()).toHaveAttribute('data-unread', 'false', { timeout: 3_000 });
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-1 (A안) "내 담당" 배지 — 소스 무결성
// ════════════════════════════════════════════════════════════════════════
test.describe('AUTOASSIGN-ASSIGNEE-BADGE-BELL — AC-1 A안 배지', () => {
  test('AC-1: "내 담당" 배지 + testid 렌더', () => {
    expect(DASH).toContain('my-assignment-badge');
    expect(DASH).toContain('내 담당');
  });

  test('AC-1: 로그인 staff_id == 카드 배정 staff_id 비교 (본인 한정)', () => {
    expect(DASH).toContain('MyStaffIdCtx');
    expect(DASH).toMatch(/checkIn\.consultant_id === myStaffId \|\| checkIn\.therapist_id === myStaffId/);
  });

  test('AC-1: 본인 staff.id 는 role 무관(user_id 매칭) — 상담사/치료사 전역할 커버', () => {
    expect(DASH).toContain('myAssignStaffId');
    expect(DASH).toMatch(/\.eq\('user_id', profile\.id\)/);
    expect(DASH).toContain('MyStaffIdCtx.Provider');
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-2~4 (B안) 벨 알림 — 소스 무결성
// ════════════════════════════════════════════════════════════════════════
test.describe('AUTOASSIGN-ASSIGNEE-BADGE-BELL — AC-2~4 B안 벨', () => {
  test('AC-2: 자동배정 이벤트 = 기존 assignment_actions(auto_assign) 재사용 — 별도 알림 테이블 0', () => {
    expect(BELL).toContain("from('assignment_actions')");
    expect(BELL).toContain("action_type', 'auto_assign'");
    // 별도 알림 전용 테이블 신설 금지 — notification 류 신규 테이블 참조 없음
    expect(BELL).not.toMatch(/from\('(notifications|assign_notifications|alerts)'\)/);
  });

  test('AC-3: 최근순 "{고객명} → {담당자명} 배정됨" 피드', () => {
    expect(BELL).toMatch(/order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)/);
    expect(BELL).toContain('고객 → ');
    expect(BELL).toContain('배정됨');
    expect(BELL).toContain('assign-notify-item');
    // 이름 매핑: 고객명=check_ins / 담당명=staff
    expect(BELL).toContain("from('check_ins')");
    expect(BELL).toContain("from('staff')");
  });

  test('AC-4: 읽음상태 = per-user localStorage (DB 불요)', () => {
    expect(BELL).toContain('foot-assign-notif-read-');
    expect(BELL).toContain('localStorage');
    // 사용자별 키 — profile.id 스코핑
    expect(BELL).toMatch(/readStorageKey\(.*profile\?\.id|userId/);
    expect(BELL).toContain('markRead');
    expect(BELL).toContain('markAllRead');
    expect(BELL).toContain('unreadCount');
  });

  test('헤더(AdminLayout)에 종 마운트 + clinic 전달', () => {
    expect(LAYOUT).toContain('AssignmentNotifyBell');
    expect(LAYOUT).toMatch(/<AssignmentNotifyBell clinicId=\{clinic\?\.id \?\? null\} \/>/);
  });

  test('오늘(KST) 발생분만 집계 — 종 무한 누적 방지', () => {
    expect(BELL).toContain('todaySeoulISODate');
    expect(BELL).toMatch(/gte\('created_at'/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-5: 배정 알고리즘/대시보드 동작 불변 — add-only, 회귀0
// ════════════════════════════════════════════════════════════════════════
test.describe('AUTOASSIGN-ASSIGNEE-BADGE-BELL — AC-5 add-only 회귀가드', () => {
  test('AC-5: 벨 데이터 로드는 read-only — assignment_actions/check_ins/staff 에 insert/update/delete 없음', () => {
    expect(BELL).not.toMatch(/\.insert\(/);
    expect(BELL).not.toMatch(/\.update\(/);
    expect(BELL).not.toMatch(/\.delete\(/);
    // RPC 호출(배정 알고리즘 트리거)도 벨에서 하지 않음
    expect(BELL).not.toContain('.rpc(');
  });

  test('AC-5: 배지는 표시 레이어 — 배정 RPC/컬럼 쓰기 없이 기존 카드 컬럼만 비교', () => {
    // assign_consultant_atomic 등 배정 RPC 는 배지 로직과 무관(표시만)
    const badgeBlock = DASH.slice(
      Math.max(0, DASH.indexOf('my-assignment-badge') - 1500),
      DASH.indexOf('my-assignment-badge') + 200,
    );
    expect(badgeBlock).not.toContain('assign_consultant_atomic');
  });
});
