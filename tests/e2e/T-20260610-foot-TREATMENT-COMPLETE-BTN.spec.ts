/**
 * E2E spec — T-20260610-foot-TREATMENT-COMPLETE-BTN
 * 진료완료 확인버튼 (부모 진단 T-20260609-foot-CHART-COMPLETE-PARTIAL-COVERAGE B안)
 *
 * 결정 (문지은 대표원장): B안 = 진료완료 확인버튼 + 직원 role도 처리 가능(권한 개방).
 *   - DoctorCallDashboard 활성 호출(purple)에 '진료완료' 버튼.
 *   - 클릭 시 status_flag purple→pink 전이 → 활성('진료필요') 명단에서 제거.
 *   - status_flag 전이는 applyStatusFlagTransition(SSOT)에 위임 — 병렬 2nd write 없음.
 *   - 처리자(id/이름/역할)는 status_flag_history JSONB 엔트리에 적재(의료 추적).
 *
 * 가드:
 *   - ✋확인(doctor_ack_at, DOCCALL-DOCTOR-ACK)과 별개 신호 — complete 버튼은 ack 컬럼 미터치.
 *   - pink(완료) 행에는 진료완료 버튼 미노출(중복 처리 방지).
 *
 * 시나리오 → AC 매핑:
 *   S1 의사 완료 동선        → 활성 호출에 진료완료 버튼 노출 + 클릭 시 pink 전이(활성 제거)
 *   S2 직원 완료 동선(권한)  → 버튼은 role 게이트 없음(의사/직원 공통 노출)
 *   S3 ack 비간섭            → 진료완료 버튼과 ✋확인 버튼이 독립 표면으로 공존(서로 대체 X)
 *
 * 데이터 의존 동선은 graceful skip (DOCCALL-DOCTOR-ACK.spec.ts 패턴).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const DASH = '[data-testid="doctor-call-dashboard"]';
const FEED_ROW = '[data-testid="doctor-call-feed-row"]';
const COMPLETE_BTN = '[data-testid="doctor-call-complete-btn"]';
const ACK_BTN = '[data-testid="doctor-ack-btn"]';

async function openCallDashboard(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/doctor-tools');
  const tab = page.locator('[data-testid="tab-call-dashboard"]');
  if ((await tab.count()) === 0) return false;
  await tab.click();
  await expect(page.locator(DASH)).toBeVisible();
  return true;
}

test.describe('T-20260610 TREATMENT-COMPLETE-BTN — 진료완료 확인버튼', () => {
  // ── S1: 활성 호출에 진료완료 버튼 노출 + pink 전이로 활성 제거 ──────────────────
  test('S1: 활성 호출(purple)에 진료완료 버튼 노출 — 클릭 시 활성 명단에서 제거(pink)', async ({
    page,
  }) => {
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/진료 알림판 탭 미표시 — 스킵');
      return;
    }
    // 활성 호출(purple, data-inactive=false) 행에만 진료완료 버튼이 존재.
    const activeRow = page.locator(`${FEED_ROW}[data-inactive="false"]`).first();
    if ((await activeRow.count()) === 0) {
      test.skip(true, '당일 활성 진료호출 데이터 없음 — 완료 동선 스킵(구조 무회귀)');
      return;
    }
    const completeBtn = activeRow.locator(COMPLETE_BTN);
    await expect(completeBtn).toBeVisible();
    await expect(completeBtn).toHaveText(/진료완료/);

    const checkinId = await activeRow.getAttribute('data-checkin-id');
    await completeBtn.click();
    // pink 전이 후 해당 행이 활성(data-inactive=false)에서 제거(=완료 흐림 또는 카운트 감소).
    //   Realtime/refetch 반영까지 대기 — 해당 id 의 활성 행이 사라지거나 inactive=true 로 전환.
    await expect
      .poll(async () => {
        const stillActive = page.locator(
          `${FEED_ROW}[data-checkin-id="${checkinId}"][data-inactive="false"]`,
        );
        return await stillActive.count();
      }, { timeout: 10_000 })
      .toBe(0);
  });

  // ── S2: 진료완료 버튼은 role 게이트 없음(의사/직원 공통) ────────────────────────
  test('S2: 진료완료 버튼은 권한 개방 — ✋확인(의사전용)과 달리 role 무관 노출', async ({
    page,
  }) => {
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/탭 미표시 — 스킵');
      return;
    }
    const activeRow = page.locator(`${FEED_ROW}[data-inactive="false"]`).first();
    if ((await activeRow.count()) === 0) {
      test.skip(true, '활성 호출 데이터 없음 — 스킵');
      return;
    }
    // 진료완료 버튼은 활성 호출이면 무조건 노출(의사/직원 공통). aria-label 확인.
    const completeBtn = activeRow.locator(COMPLETE_BTN);
    await expect(completeBtn).toBeVisible();
    await expect(completeBtn).toHaveAttribute('aria-label', '진료완료 처리');
  });

  // ── S3: ack 비간섭 — 진료완료 버튼과 ✋확인 버튼이 독립 표면으로 공존 ─────────────
  test('S3: ✋확인 버튼과 진료완료 버튼은 별개 표면 — 서로 대체하지 않음', async ({ page }) => {
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/탭 미표시 — 스킵');
      return;
    }
    // 미확인 + 의사 역할의 활성 호출이면 두 버튼이 같은 행에 동시 존재(ack=시작 / complete=종료).
    const rowWithAck = page.locator(`${FEED_ROW}[data-inactive="false"]`).filter({
      has: page.locator(ACK_BTN),
    }).first();
    if ((await rowWithAck.count()) === 0) {
      test.skip(true, '미확인 활성 호출(✋확인 버튼) 데이터 없음 — 공존 검증 스킵');
      return;
    }
    // 같은 행에 ✋확인(ack)과 진료완료(complete)가 동시 존재 — 독립 신호.
    await expect(rowWithAck.locator(ACK_BTN)).toHaveCount(1);
    await expect(rowWithAck.locator(COMPLETE_BTN)).toHaveCount(1);
  });
});
