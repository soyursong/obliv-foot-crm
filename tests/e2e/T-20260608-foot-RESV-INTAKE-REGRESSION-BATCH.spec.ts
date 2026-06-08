/**
 * T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH
 * 풋 예약/접수 동선 회귀+신규 일괄 (현장 김주연 총괄 P0)
 *
 * 본 spec 이 직접 검증하는 신규 코드 변경:
 *   AC-4 — confirm 화면 SMS 수신동의 체크박스 기본 체크(true) (4FIX 기본 미체크를 supersede)
 *   AC-5 — SMS 체크박스 하단 미동의 영향 안내문구 노출 + 정확 문안
 *   AC-6 — 예약여부 "예약 없이 방문했어요"(=현장 '아니요') 클릭 시 이름칸 자동입력 없음(빈 상태 유지)
 *
 * E2E 비대상(별 경로로 검증 완료):
 *   AC-7 접수실패 = prod DB check_ins.status CHECK 제약에 'receiving' 누락(마이그레이션 미적용)이 근본원인.
 *        dev-foot 가 receiving 마이그레이션 3종 prod 직접 적용 + anon INSERT 프로브로 해소 검증함.
 *        (DB 레벨 수정 — FE E2E 대상 아님)
 *   AC-1/2/3 = 기존 deployed 코드 회귀(번들 미반영) — 각 원티켓 spec 으로 커버,
 *        본 배포(커밋+push)로 번들 갱신되어 동시 해소.
 *   AC-8/AC-9 = 동의서 본문 항목별 정렬. AC-0 판별 결과 '코드 존재(c)' —
 *        ADDR-CONSENT-LAYOUT AC-2(deployed 6/3)로 이미 main 에 구현됨.
 *        회귀/신규 아님 → 본 spec 에서 렌더를 직접 락(번들 갱신으로 현장 반영).
 *
 * 주의: 전화번호는 NumPad(버튼 클릭)로 입력.
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

async function fillNamePhone(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');
  await page.locator('#sc-name').fill(name);
  for (const d of phone.replace(/\D/g, '').slice(0, 11)) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// 초진(예약) → personal_info 단계 진입 헬퍼 (동의서 본문이 이 화면에 렌더됨)
async function gotoPersonalInfoNew(page: import('@playwright/test').Page, name: string, phone: string) {
  await fillNamePhone(page, name, phone);
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.getByRole('button', { name: '초진' }).click();
  await page.locator('[data-testid="btn-checkin"]').click();
  await page.waitForTimeout(800);
}

// 초진(예약) → confirm 진입 헬퍼
async function gotoConfirmNew(page: import('@playwright/test').Page, name: string, phone: string) {
  await gotoPersonalInfoNew(page, name, phone);
  // personal_info: 주민번호 6자리 + 주소
  for (const d of ['9', '0', '0', '1', '0', '1']) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
  await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 종로구');
  await page.locator('[data-testid="btn-personal-info-next"]').click();
}

// ── AC-4: SMS 동의 기본 체크 ────────────────────────────────────────────────
test.describe('RESV-INTAKE AC-4 SMS 기본 체크', () => {
  const s = sfx();

  test('confirm — SMS 수신동의 체크박스 기본 체크(true)', async ({ page }) => {
    await gotoConfirmNew(page, `ac4-${s}`, `010${s}0041`);
    const smsBox = page.locator('#sms-opt-in');
    await expect(smsBox).toBeVisible({ timeout: 6000 });
    await expect(smsBox).toBeChecked();
  });
});

// ── AC-5: 미동의 안내문구 ───────────────────────────────────────────────────
test.describe('RESV-INTAKE AC-5 미동의 안내문구', () => {
  const s = sfx();

  test('confirm — SMS 체크박스 하단 안내문구 노출 + 정확 문안', async ({ page }) => {
    await gotoConfirmNew(page, `ac5-${s}`, `010${s}0051`);
    const note = page.locator('[data-testid="sms-opt-in-note"]');
    await expect(note).toBeVisible({ timeout: 6000 });
    await expect(note).toHaveText('미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다');
  });
});

// ── AC-6: "아니요"(예약 없이 방문) 클릭 시 이름 자동입력 없음 ────────────────
test.describe('RESV-INTAKE AC-6 아니요 자동입력 방지', () => {
  const s = sfx();

  test('이름 미입력 상태에서 "예약 없이 방문" 클릭 → 이름칸 빈 상태 유지(자동입력 없음)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 이름은 비운 채로 워크인(아니요) 선택 → 워크인 모달 확인
    await page.locator('[data-testid="btn-walkin"]').click();
    // 워크인 안내 모달의 확인 버튼 클릭 (모달이 뜨는 경우)
    const confirmWalkIn = page.getByRole('button', { name: /확인|접수|네/ }).first();
    if (await confirmWalkIn.isVisible().catch(() => false)) {
      await confirmWalkIn.click().catch(() => {});
    }
    // 이름칸은 여전히 빈 상태여야 함 ('김하준' 등 자동입력 없음)
    const nameVal = await page.locator('#sc-name').inputValue();
    expect(nameVal.trim()).toBe('');
    expect(nameVal).not.toContain('김하준');
  });
});

// ── AC-8 / AC-9: 동의서 본문 항목별 정렬(회귀 락) ───────────────────────────
// AC-0 판별 = (c) 코드 존재(ADDR-CONSENT-LAYOUT AC-2, deployed 6/3). 본 배포로 번들 갱신.
test.describe('RESV-INTAKE AC-8/AC-9 동의서 항목별 정렬', () => {
  const s = sfx();

  test('personal_info — 개인정보/건강보험 동의 본문이 항목별 bullet 정렬로 렌더', async ({ page }) => {
    await gotoPersonalInfoNew(page, `ac89-${s}`, `010${s}0891`);

    const detail = page.locator('[data-testid="pi-consent-detail"]');
    await expect(detail).toBeVisible({ timeout: 6000 });

    // AC-8: 개인정보 수집·이용 동의 — 항목별(수집항목/수집목적/보유기간) 줄 분리
    await expect(detail).toContainText('개인정보 수집·이용 동의 (필수)');
    await expect(detail).toContainText('수집항목 : 성함, 주민등록번호, 연락처, 주소 등 기본 정보');
    await expect(detail).toContainText('수집목적 : 진료를 위한 정보 수집');

    // AC-9: 건강보험 조회 동의 — 동일 항목별 정렬
    await expect(detail).toContainText('건강보험 자격정보(가입 여부, 보험종류, 자격상태 등)');
    await expect(detail).toContainText('건강보험 자격 확인, 보험 적용 진료비 산정 및 청구');

    // 항목별 줄바꿈(일렬 X): 각 동의 본문이 별도 <li> 로 분리되어야 함
    const bullets = detail.locator('li');
    expect(await bullets.count()).toBeGreaterThanOrEqual(6); // 개인정보 3 + 건강보험 3
  });
});
