/**
 * T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT
 * 셀프접수 personal_info 단계: 주소 자동기입 + 상세주소칸 + 동의서 항목별 정렬 + 문자수신 부가문구
 *
 * AC 커버:
 *   AC-1 우편번호 검색 버튼 + 상세주소 입력칸 존재 + 기본주소 직접입력으로 다음 활성(회귀)
 *        (Kakao Postcode 팝업 자동기입은 외부 위젯이라 E2E 비결정적 → 버튼 존재 + 수동입력 경로로 검증)
 *   AC-2 동의서 본문이 항목별(수집항목/수집목적/보유기간) 줄바꿈 정렬 + 지정 문구 그대로 표시
 *   AC-3 confirm 단계: 문자수신 동의 라벨 정리 + 하단 부가 안내 문구 표시, sms 미체크 제출 가능(선택 유지)
 *   AC-4 회귀: 동의 체크박스 동작/필수성 불변
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

// 초진 personal_info 단계 진입 헬퍼
// 현재 셀프접수(FLOW-REVAMP/2STEP) 실제 동선:
//   성함(#sc-name input) → 전화(NumPad 클릭, 입력칸 아님) →
//   방문유형 1단계 '예약하고 왔어요'(btn-reserved) → 2단계 '초진' →
//   접수하기(btn-checkin) → 초진은 personal_info 단계 진입.
async function gotoPersonalInfo(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');

  // 성함은 input, 전화번호는 NumPad(최대 11자리)로 입력
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

// ── AC-1: 우편번호 검색 + 상세주소칸 ────────────────────────────────────────
test.describe('T-20260603 AC-1 주소 자동기입 + 상세주소', () => {
  const s = sfx();

  test('우편번호 검색 버튼 + 상세주소 입력칸이 존재한다', async ({ page }) => {
    await gotoPersonalInfo(page, `addr-ui-${s}`, `010${s}0001`);

    await expect(page.locator('[data-testid="pi-postcode-search"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="pi-postal-code"]')).toBeVisible();
    await expect(page.locator('[data-testid="pi-address-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="pi-address-detail-input"]')).toBeVisible();
  });

  test('상세주소 입력 가능 + 기본주소 직접입력으로 다음 버튼 활성(회귀)', async ({ page }) => {
    await gotoPersonalInfo(page, `addr-fill-${s}`, `010${s}0002`);

    // 주민번호 6자리
    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    // 기본주소 직접 입력 (우편번호 위젯 없이도 입력 가능 — 회귀 보장)
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 종로구 종로 1');
    // 상세주소 입력
    await page.locator('[data-testid="pi-address-detail-input"]').fill('101동 1001호');
    await expect(page.locator('[data-testid="pi-address-detail-input"]')).toHaveValue('101동 1001호');

    // 다음 버튼 활성화 (기본주소만으로 충족)
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-2: 동의서 본문 항목별 정렬 ───────────────────────────────────────────
test.describe('T-20260603 AC-2 동의서 항목별 정렬', () => {
  const s = sfx();

  test('개인정보/건강보험 동의 본문이 항목별 + 지정 문구 그대로 표시', async ({ page }) => {
    await gotoPersonalInfo(page, `consent-${s}`, `010${s}0003`);

    const detail = page.locator('[data-testid="pi-consent-detail"]');
    await expect(detail).toBeVisible({ timeout: 6000 });

    // 개인정보 섹션 — 제목 + 3개 항목 그대로 (성함 통일)
    await expect(detail.getByText('개인정보 수집·이용 동의 (필수)')).toBeVisible();
    await expect(detail.getByText('수집항목 : 성함, 주민등록번호, 연락처, 주소 등 기본 정보')).toBeVisible();
    await expect(detail.getByText('수집목적 : 진료를 위한 정보 수집')).toBeVisible();

    // 건강보험 섹션 — 제목 + 항목 (성함 통일)
    await expect(detail.getByText('건강보험 조회에 동의합니다 (필수)')).toBeVisible();
    await expect(
      detail.getByText('수집항목 : 성함, 주민등록번호(또는 생년월일), 건강보험 자격정보(가입 여부, 보험종류, 자격상태 등)')
    ).toBeVisible();
    await expect(
      detail.getByText('수집목적 : 건강보험 자격 확인, 보험 적용 진료비 산정 및 청구, 보험 급여 적정성 확인')
    ).toBeVisible();

    // 성함 통일 — 동의서 본문에 '이름'·'성명' 라벨 부재
    await expect(detail.getByText(/수집항목 : 이름/)).toHaveCount(0);
    await expect(detail.getByText(/수집항목 : 성명/)).toHaveCount(0);

    // 항목별 줄바꿈 정렬 — li 요소가 6개(개인정보 3 + 건보 3)
    await expect(detail.locator('li')).toHaveCount(6);
  });
});

// ── AC-3 / AC-4: 문자수신 부가문구 + 동의 회귀 ──────────────────────────────
test.describe('T-20260603 AC-3 문자수신 부가문구', () => {
  const s = sfx();

  test('confirm 단계 문자수신 라벨 + 하단 부가 안내 표시, sms 미체크 제출 가능', async ({ page }) => {
    await gotoPersonalInfo(page, `sms-${s}`, `010${s}0004`);

    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 중구');
    await page.locator('[data-testid="btn-personal-info-next"]').click();

    // confirm 단계 — 문자수신 라벨 표시
    await expect(page.getByText('예약 안내 등 문자 수신에 동의합니다 (선택)')).toBeVisible({ timeout: 6000 });
    // T-20260603-RETURN-CONSENT-QR-4FIX AC3: 예약 안내 문자 중복 부가 안내(sms-opt-in-note) 제거됨
    await expect(page.locator('[data-testid="sms-opt-in-note"]')).toHaveCount(0);

    // sms 미체크해도 접수하기(제출) 버튼 활성 — (선택) 유지
    const smsBox = page.locator('#sms-opt-in');
    await smsBox.uncheck();
    await expect(smsBox).not.toBeChecked();
    await expect(page.getByRole('button', { name: '접수하기' })).toBeEnabled();
  });
});

// ── AC-4: 동의 체크박스 동작/필수성 불변 (회귀) ─────────────────────────────
test.describe('T-20260603 AC-4 동의 체크박스 회귀', () => {
  const s = sfx();

  test('건강보험 동의 체크박스 토글 동작 + 미체크여도 다음 활성(선택 유지)', async ({ page }) => {
    await gotoPersonalInfo(page, `reg-${s}`, `010${s}0005`);

    for (const d of ['9', '0', '0', '1', '0', '1']) {
      await page.getByRole('button', { name: d, exact: true }).first().click();
    }
    await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 강남구');

    // T-20260603-RETURN-CONSENT-QR-4FIX AC2: 건강보험 동의 기본 체크(true)
    const ins = page.locator('[data-testid="pi-insurance-consent-checkbox"]');
    await expect(ins).toBeChecked();
    await ins.uncheck();
    await expect(ins).not.toBeChecked();

    // 미체크/체크 무관 다음 버튼 활성 (선택 필드 불변)
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeEnabled();
  });
});
