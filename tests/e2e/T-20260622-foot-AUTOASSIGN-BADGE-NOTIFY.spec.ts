import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260622-foot-AUTOASSIGN-BADGE-NOTIFY
 *
 * 자동 배정 담당자 표기 — A안(본인 "내 담당" 배지) + B안(상단 🔔 배정 알림) 동시 적용.
 * 순수 FE 표시/알림 레이어. 신규 스키마 0 — 기존 assignment_actions(자동배정 SSOT) +
 * check_ins.consultant_id/therapist_id 재사용. 읽음 상태=사용자별 localStorage.
 *
 * ── A안 (대시보드 "내 담당" 배지) ──
 *  AC-A1: 자동배정된 담당자(로그인 본인) 대기 카드에 "내 담당" 파랑 배지.
 *  AC-A2: 본인 담당 카드에만 표시(consultant_id/therapist_id === 본인 staff.id).
 *
 * ── B안 (상단 🔔 알림, 팀 전체) ──
 *  AC-B3: 자동배정 발생 시 상단 🔔 미읽음 숫자 증가(전 사용자).
 *  AC-B4: 🔔 클릭 → "고객명 → 담당자명 배정됨" 내역 목록.
 *  AC-B5: 읽음 처리 시 숫자 차감 (per-item: 1건 읽음 → 1 감소 / 모두 읽음 → 0).
 *
 * 자동배정 자체는 멀티세션·근무시트·실시간 상호작용에 의존해 E2E로 결정론적 재현이 어렵다.
 * → 라이브 렌더(종 존재·패널 토글)는 Playwright로, 배정→배지/알림 결선은 소스 무결성으로 검증.
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const LAYOUT = fs.readFileSync(path.resolve('src/components/AdminLayout.tsx'), 'utf-8');
const BELL = fs.readFileSync(path.resolve('src/components/AssignmentNotifyBell.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 상단 종(B안) 존재 + 패널 토글
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260622 AUTOASSIGN-BADGE-NOTIFY — 상단 알림 종 (라이브)', () => {
  test('AC-B3/B4: 헤더에 알림 종 노출 + 클릭 시 패널 열림', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const bell = page.getByTestId('assign-notify-bell');
    await expect(bell).toBeVisible({ timeout: 15_000 });

    // 클릭 → 패널 열림 (고객→담당 내역 또는 빈 안내)
    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible({ timeout: 5_000 });

    // "모두 읽음" 컨트롤 존재 (B5)
    await expect(page.getByTestId('assign-notify-readall')).toBeVisible();

    // 다시 클릭 → 닫힘
    await bell.click();
    await expect(page.getByTestId('assign-notify-panel')).toHaveCount(0, { timeout: 5_000 });
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — A안 "내 담당" 배지 결선
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260622 AUTOASSIGN-BADGE-NOTIFY — A안 배지 (소스 무결성)', () => {
  test('AC-A1: "내 담당" 배지 + testid 렌더', () => {
    expect(DASH).toContain('my-assignment-badge');
    expect(DASH).toContain('내 담당');
  });

  test('AC-A2: 본인 담당 판정 = consultant_id/therapist_id === 본인 staff.id', () => {
    expect(DASH).toContain('MyStaffIdCtx');
    // 본인 staff id 와 카드 담당자 컬럼 매칭
    expect(DASH).toMatch(/checkIn\.consultant_id === myStaffId \|\| checkIn\.therapist_id === myStaffId/);
  });

  test('AC-A2: 본인 staff.id 는 role 무관(user_id 매칭) 별도 조회 — 상담사/치료사 커버', () => {
    expect(DASH).toContain('myAssignStaffId');
    // role 게이트 없는 user_id 매칭 조회 존재
    expect(DASH).toMatch(/\.eq\('user_id', profile\.id\)/);
    // Provider 로 카드에 주입
    expect(DASH).toContain('MyStaffIdCtx.Provider');
  });

  test('배지는 compact/non-compact 카드 양쪽에 렌더', () => {
    const occurrences = DASH.split('my-assignment-badge').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — B안 알림 종 결선 (데이터·읽음·실시간)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260622 AUTOASSIGN-BADGE-NOTIFY — B안 알림 (소스 무결성)', () => {
  test('헤더(AdminLayout)에 종 마운트 + clinic 전달', () => {
    expect(LAYOUT).toContain('AssignmentNotifyBell');
    expect(LAYOUT).toMatch(/<AssignmentNotifyBell clinicId=\{clinic\?\.id \?\? null\} \/>/);
  });

  test('데이터 소스 = 기존 assignment_actions auto_assign (신규 스키마 0)', () => {
    expect(BELL).toContain("from('assignment_actions')");
    expect(BELL).toContain("action_type', 'auto_assign'");
    // 고객명=check_ins.customer_name / 담당명=staff.display_name??name
    expect(BELL).toContain("from('check_ins')");
    expect(BELL).toContain("from('staff')");
  });

  test('AC-B4: "고객명 → 담당자명 배정됨" 포맷', () => {
    expect(BELL).toContain('고객 → ');
    expect(BELL).toContain('배정됨');
    expect(BELL).toContain('assign-notify-item');
  });

  test('AC-B5: per-item 읽음 + 모두 읽음 + 미읽음 카운트', () => {
    expect(BELL).toContain('unreadCount');
    expect(BELL).toContain('markRead');
    expect(BELL).toContain('markAllRead');
    expect(BELL).toContain('assign-notify-count');
    // 읽음 상태 = 사용자별 localStorage (DB 컬럼 없음)
    expect(BELL).toContain('foot-assign-notif-read-');
  });

  test('실시간 = 기존 realtime 채널 재사용 + 폴링 fallback (티켓 허용)', () => {
    expect(BELL).toContain("table: 'assignment_actions'");
    expect(BELL).toContain('postgres_changes');
    expect(BELL).toContain('setInterval');
  });

  test('오늘(KST) 발생분만 집계 — 종 무한 누적 방지', () => {
    expect(BELL).toContain('todaySeoulISODate');
    expect(BELL).toMatch(/gte\('created_at'/);
  });
});
