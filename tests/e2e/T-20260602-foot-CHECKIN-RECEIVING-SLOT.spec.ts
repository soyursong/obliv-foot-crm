/**
 * E2E spec — T-20260602-foot-CHECKIN-RECEIVING-SLOT
 * 셀프접수 [접수중] 슬롯 신규 + 설문 작성→저장 동선
 *
 * 요구 동선:
 *   셀프접수 정보 기입 → 설문 QR 스캔 → 작성 중(미저장)이면 [접수중] 슬롯에 카드 표시
 *   → 설문 "저장" 시 [상담대기] 슬롯으로 자동 이동.
 *
 * AC-1: 셀프접수 후 작성 중(미저장) 카드가 대시보드 [접수중] 슬롯에 표시.
 * AC-2: 설문 저장 시 [상담대기] 슬롯으로 자동 이동(서버 fn_health_q_submit 전이).
 * AC-3: 신규 status 추가 시 CHECK constraint 동시 갱신(DB 마이그 — 본 spec 범위 외, 빌드/마이그로 검증).
 * AC-4: clinic 스코프 보존, 기존 상태전이 회귀 없음, anon 쓰기 신설 없음.
 * AC-5: 대시보드 슬롯 순서 — [접수중]이 맨 앞.
 * AC-6: [접수중] 카드를 직원이 다른 슬롯으로 수동 이동 가능(기존 드래그와 동일).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260602-foot-CHECKIN-RECEIVING-SLOT — 셀프접수 [접수중] 슬롯', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1/AC-5: [접수중] 드롭 컬럼이 칸반에 존재하고 맨 앞에 위치
  test('AC-5: [접수중] 슬롯이 대시보드 칸반 맨 앞에 표시된다', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const receivingCol = page.locator('[data-droppable-id="receiving"]');
    await expect(receivingCol).toBeVisible({ timeout: 15_000 });

    // 맨 앞 검증: receiving 컬럼이 상담대기(consult_waiting) 컬럼보다 DOM 상 앞에 위치
    const consultCol = page.locator('[data-droppable-id="consult_waiting"]');
    const hasConsult = (await consultCol.count()) > 0;
    if (hasConsult) {
      const order = await page.evaluate(() => {
        const recv = document.querySelector('[data-droppable-id="receiving"]');
        const cw = document.querySelector('[data-droppable-id="consult_waiting"]');
        if (!recv || !cw) return null;
        // 2 = DOCUMENT_POSITION_FOLLOWING → recv 가 cw 보다 앞
        return recv.compareDocumentPosition(cw) & Node.DOCUMENT_POSITION_FOLLOWING ? 'recv-first' : 'cw-first';
      });
      expect(order).toBe('recv-first');
    }
  });

  // AC-1: [접수중] 컬럼 헤더 라벨 확인
  test('AC-1: [접수중] 슬롯 헤더 라벨이 노출된다', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const receivingCol = page.locator('[data-droppable-id="receiving"]');
    await expect(receivingCol).toBeVisible({ timeout: 15_000 });
    await expect(receivingCol.getByText('접수중', { exact: true }).first()).toBeVisible();
  });

  // AC-4 회귀: 기존 상담대기/치료대기 슬롯이 그대로 존재 (상태전이 회귀 없음)
  test('AC-4: 기존 상담대기/치료대기 슬롯이 회귀 없이 유지된다', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 상담대기 / 치료대기 드롭 컬럼이 여전히 존재
    await expect(page.locator('[data-droppable-id="consult_waiting"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-droppable-id="treatment_waiting"]')).toHaveCount(1);
  });
});
