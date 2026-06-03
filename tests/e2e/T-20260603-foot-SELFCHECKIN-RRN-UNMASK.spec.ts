/**
 * T-20260603-foot-SELFCHECKIN-RRN-UNMASK
 * 셀프접수 주민번호 마스킹 해제 — 본인 오타 더블체크 목적, 전체 자리 표시.
 *
 * 변경: SelfCheckIn.tsx 2곳 maskRrn(rrn) → rrn
 *   - 입력 화면 실시간 표시 (data-testid="rrn-display")
 *   - 최종 확인 요약 (초진 한정, visitType==='new')
 * 저장 정책 불변(DB엔 앞6자리 birth_date만). maskRrn 함수 보존(다른 사용처).
 *
 * AC 커버:
 *   AC-1 입력 화면 실시간 전체 표시 (900101-1234567, 마스킹 '*' 없음)
 *   AC-2 최종 확인 요약 전체 표시
 *   AC-3 회귀: 접수 제출(접수하기) 버튼 활성 — done 동선 불변
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

const FULL_RRN = '9001011234567';        // 13자리 입력
const EXPECTED = '900101-1234567';       // formatRrn 결과(전체 표시 기대값)
const MASKED = '900101-*******';         // 변경 전 마스킹값(부재 검증용)

// 초진 personal_info 단계 진입 헬퍼 (ADDR-CONSENT-LAYOUT spec과 동일 동선)
async function gotoPersonalInfo(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');

  await page.locator('#sc-name').fill(name);
  const phoneDigits = phone.replace(/\D/g, '').slice(0, 11);
  for (const d of phoneDigits) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }

  // 방문유형: 예약 → 초진(new)
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.getByRole('button', { name: '초진' }).click();

  // 접수하기 → personal_info 단계
  await page.locator('[data-testid="btn-checkin"]').click();
  await page.waitForTimeout(1000);
}

// RRN 13자리 NumPad 입력
async function typeRrn(page: import('@playwright/test').Page, rrnDigits: string) {
  for (const d of rrnDigits) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── AC-1: 입력 화면 실시간 전체 표시 ───────────────────────────────────────
test.describe('T-20260603 RRN-UNMASK AC-1 입력 실시간 전체 표시', () => {
  const s = sfx();

  test('주민번호 13자리 입력 시 rrn-display가 전체(900101-1234567) 표시, 마스킹 없음', async ({ page }) => {
    await gotoPersonalInfo(page, `rrn-in-${s}`, `010${s}0001`);

    await typeRrn(page, FULL_RRN);

    const display = page.locator('[data-testid="rrn-display"]');
    await expect(display).toBeVisible({ timeout: 6000 });
    await expect(display).toHaveText(EXPECTED);
    // 마스킹 '*' 가 노출되지 않음
    await expect(display).not.toContainText('*');
    await expect(display).not.toHaveText(MASKED);
  });
});

// ── AC-2: 최종 확인 요약 전체 표시 ─────────────────────────────────────────
test.describe('T-20260603 RRN-UNMASK AC-2 최종 확인 전체 표시', () => {
  const s = sfx();

  test('confirm 단계 요약에서 주민번호 전체 표시(마스킹 없음)', async ({ page }) => {
    await gotoPersonalInfo(page, `rrn-cf-${s}`, `010${s}0002`);

    await typeRrn(page, FULL_RRN);
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 종로구 종로 1');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    // confirm 단계 — 요약에 전체 주민번호 표시
    await expect(page.getByText(EXPECTED)).toBeVisible({ timeout: 6000 });
    // 마스킹값은 어디에도 노출되지 않음
    await expect(page.getByText(MASKED)).toHaveCount(0);
  });
});

// ── AC-3: 회귀 — 제출 동선 불변 ────────────────────────────────────────────
test.describe('T-20260603 RRN-UNMASK AC-3 제출 동선 회귀', () => {
  const s = sfx();

  test('confirm 단계에서 접수하기(제출) 버튼 활성 — done 동선 불변', async ({ page }) => {
    await gotoPersonalInfo(page, `rrn-rg-${s}`, `010${s}0003`);

    await typeRrn(page, FULL_RRN);
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 중구');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    // 제출(접수하기) 버튼 활성 — 저장/제출 로직 불변(표시만 변경)
    await expect(page.getByRole('button', { name: '접수하기' })).toBeEnabled({ timeout: 6000 });
  });
});
