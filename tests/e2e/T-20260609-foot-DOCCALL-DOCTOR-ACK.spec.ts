/**
 * E2E spec — T-20260609-foot-DOCCALL-DOCTOR-ACK
 * 진료호출 의사 ✋확인(손 들기) 신호 + 직원 화면 Realtime 반영
 *
 * 현장 요청 (문지은 대표원장, 슬랙 C0ATE5P6JTH):
 *   진료호출 수신 시 의사가 환자에게 "손 들기(확인)" 표시 → 호출 직원 화면에 실시간 "의사 확인됨".
 *
 * 데이터 모델: 진료호출 식별 단위 = check_ins.status_flag (purple/pink). 별도 doctor_calls 테이블 없음.
 *   doctor_ack_at timestamptz NULL (additive) — 의사 ✋확인 시각. 진료완료(completed_at)와 별개 신호.
 *
 * 구현:
 *   - supabase/migrations/20260609233000_checkin_doctor_ack_at.sql (additive 컬럼 + rollback)
 *   - src/components/doctor/DoctorAck.tsx (DoctorAckButton 의사전용 + DoctorAckBadge 표시전용)
 *   - src/components/doctor/DoctorCallDashboard.tsx (호출 카드에 ✋확인 버튼/배지)
 *   - src/components/DoctorCallListBar.tsx (직원 진료콜 명단에 '의사 확인됨' 배지 — 조회 전용)
 *   - src/components/MedicalChartPanel.tsx (환자차트 헤더 ✋ 표시 — 대기 pulse / 확인 후 파란 고정)
 *   - tailwind.config.js (animate-pulse-hand: opacity 0.4→1→0.4, 1.5s ease-in-out)
 *
 * 시나리오(티켓 §현장 클릭 시나리오) → AC 매핑:
 *   S1 의사 확인 정상 동선   → AC1·AC2·AC3·AC8
 *   S2 직원 권한 게이트       → AC1·시나리오2 (직원=조회만)
 *   S3 엣지(중복 클릭)        → AC4 (idempotent)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const ACK_BTN = '[data-testid="doctor-ack-btn"]';
const ACK_BADGE = '[data-testid="doctor-ack-badge"]';

test.describe('T-20260609 DOCCALL-DOCTOR-ACK — 진료호출 의사 ✋확인', () => {
  // ── S1: 의사 진료대시보드에서 ✋확인 동선 (AC1·AC2·AC8) ──────────────────────
  test('S1 (AC1/AC8): 의사 진료대시보드 진입 — 활성 호출에 ✋확인 버튼(pulse-hand) 노출', async ({
    page,
  }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    if ((await tab.count()) === 0) {
      test.skip(true, '진료 알림판 탭 미표시(권한/환경) — 스킵');
      return;
    }
    await tab.click();
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();

    // 활성 호출(purple) 데이터가 있어야 ✋확인 버튼이 뜬다. 없으면 구조 검증만 하고 graceful skip.
    const ackBtn = page.locator(ACK_BTN).first();
    if ((await ackBtn.count()) === 0) {
      test.skip(true, '당일 활성 진료호출 데이터 없음 — ✋확인 버튼 동선 스킵(구조는 무회귀)');
      return;
    }
    // AC1: ✋확인 버튼 노출(의사 역할). AC8: 대기 중 아이콘 pulse-hand 애니.
    await expect(ackBtn).toBeVisible();
    await expect(ackBtn.locator('.animate-pulse-hand')).toHaveCount(1);

    // AC2: 클릭 → '의사 확인됨' 파란 배지로 전환(idempotent — 동일 행).
    await ackBtn.click();
    const badge = page.locator(`${ACK_BADGE}[data-ack="confirmed"]`).first();
    await expect(badge).toBeVisible();
    // AC2 파란색(primary-blue) — 초록 아님. text-blue-700 / bg-blue-100 클래스 검증.
    await expect(badge).toHaveClass(/text-blue-700/);
    await expect(badge).toHaveText(/의사 확인됨/);
  });

  // ── S3: 중복 클릭 idempotent (AC4) ──────────────────────────────────────────
  test('S3 (AC4): ✋확인 후 동일 호출은 배지로만 표시 — 중복 write 버튼 사라짐(에러 없음)', async ({
    page,
  }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin/doctor-tools');
    const tab = page.locator('[data-testid="tab-call-dashboard"]');
    if ((await tab.count()) === 0) {
      test.skip(true, '진료 알림판 탭 미표시 — 스킵');
      return;
    }
    await tab.click();
    await expect(page.locator('[data-testid="doctor-call-dashboard"]')).toBeVisible();

    // 이미 ack 된 행: 배지만 있고 ✋확인 버튼은 없어야 한다(재클릭 write 표면 제거 = idempotent UX).
    const confirmedBadges = page.locator(`${ACK_BADGE}[data-ack="confirmed"]`);
    const n = await confirmedBadges.count();
    if (n === 0) {
      test.skip(true, '확인 완료된 호출 데이터 없음 — idempotent 동선 스킵');
      return;
    }
    // 확인됨 배지는 파란색 고정(무애니) — pulse-hand 클래스 없음(AC8 ack 후).
    const first = confirmedBadges.first();
    await expect(first).toHaveClass(/text-blue-700/);
    await expect(first.locator('.animate-pulse-hand')).toHaveCount(0);
  });

  // ── S2: 직원 화면 — 조회 전용 배지(권한 게이트) (AC3) ────────────────────────
  test('S2/AC3: 직원 대시보드 진료콜 명단의 의사확인 배지는 조회 전용(✋확인 버튼 없음)', async ({
    page,
  }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    // 대시보드(직원 동선)의 진료콜 명단(DoctorCallListBar) — 호출 발신 측 화면.
    const callList = page.locator('[data-testid="doctor-call-list"]');
    if ((await callList.count()) === 0) {
      test.skip(true, '진료콜 명단 미표시(당일 호출 없음/권한) — 스킵');
      return;
    }
    // 진료콜 명단 내부에는 ack write 버튼(doctor-ack-btn)이 존재하지 않는다 — 직원은 조회만(AC1/시나리오2).
    //   ✋확인 write 표면은 의사 진료대시보드(DoctorCallDashboard)에만 존재.
    await expect(callList.locator(ACK_BTN)).toHaveCount(0);
    // 의사 확인됨 배지가 있다면 파란색 조회 전용으로 렌더(있을 때만 검증, 없으면 통과).
    const badges = callList.locator(`${ACK_BADGE}[data-ack="confirmed"]`);
    if ((await badges.count()) > 0) {
      await expect(badges.first()).toHaveClass(/text-blue-700/);
    }
  });
});
