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
  // T-20260630-foot-BADGE-NOTIFY-STALE-MOUNT-ASSERT: 종 진입점 이전/재설계 반영.
  //   06-29 T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE(b72c82bb): 종을 전역 헤더(AdminLayout)→대시보드로 이전.
  //   06-30 T-20260630-foot-DASH-HEADER-DEDUP-COMPACT: 대시보드는 showBell={false} → 종 버튼 숨김, 마키 스트립이 진입점.
  //   ∴ 대시보드 라이브 정본 = (a) 종 버튼(assign-notify-bell) 미노출(DEDUP-COMPACT S2와 정합),
  //      (b) 미읽음 배정이 있을 때만 마키(assign-notify-marquee) 노출 → 클릭 시 패널 토글(showBell 무관, open 상태로 렌더).
  //   클린 QA 픽스처(자동배정 0건)에선 마키도 미노출이라 상호작용 단계는 best-effort.
  //   production 코드는 정본 — 본 수정은 stale 단언만 현재 진입점 설계에 동기화한다.
  test('AC-B3/B4: 대시보드 종 버튼 미노출(정본) + 마키 존재 시 클릭→패널 토글', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.waitForTimeout(2000);

    // (a) 대시보드 showBell={false} → 종 버튼은 노출되지 않는다(DEDUP-COMPACT 정본과 정합).
    expect(
      await page.getByTestId('assign-notify-bell').count(),
      '대시보드에 종 버튼이 남아있음 (showBell={false} 위반)',
    ).toBe(0);

    // (b) 미읽음 배정 알림이 있을 때만 마키 진입점이 노출 → 있으면 클릭→패널 열림→"모두 읽음"(B5)→재클릭 닫힘.
    const marquee = page.getByTestId('assign-notify-marquee');
    if ((await marquee.count()) === 0) {
      // 클린 QA 환경(자동배정 0건) — 진입점 미노출이 정상. 상호작용은 데이터 의존이라 best-effort skip.
      return;
    }
    await expect(marquee).toBeVisible({ timeout: 5_000 });

    // 클릭 → 패널 열림 (고객→담당 내역 또는 빈 안내)
    await marquee.click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible({ timeout: 5_000 });

    // "모두 읽음" 컨트롤 존재 (B5)
    await expect(page.getByTestId('assign-notify-readall')).toBeVisible();

    // 다시 클릭 → 닫힘
    await marquee.click();
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
  // T-20260630-foot-BADGE-NOTIFY-STALE-MOUNT-ASSERT: 종 마운트 위치를 정본(Dashboard)으로 동기화.
  //   06-29 T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE(deployed b72c82bb)가 자동배정 알림 종을
  //   전역 헤더(AdminLayout)→대시보드 날짜선택 옆으로 이전 → 헤더 마운트 단언은 stale(baseline 상시 실패).
  //   production 코드는 정본이며, 본 수정은 테스트 단언만 현재 마운트 위치에 동기화한다.
  test('대시보드(Dashboard)에 종 마운트 + clinic 전달', () => {
    expect(DASH).toContain('AssignmentNotifyBell');
    expect(DASH).toMatch(/<AssignmentNotifyBell clinicId=\{clinic\?\.id \?\? null\}/);
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
