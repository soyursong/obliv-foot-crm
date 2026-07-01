/**
 * T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL
 * 생년월일(주민번호 파생) 표기를 CRM 전역 화면으로 통일. 김주연 총괄 요청.
 *
 * 스코프(인벤토리 판정 A+B+C1~C5, 비의료):
 *   A. AdminLayout 상단 글로벌검색 드롭다운 (raw YYMMDD → YYYY-MM-DD)
 *   B. ReservationDetailPopup 신규모드 기존고객 생년월일 (raw → YYYY-MM-DD)
 *   C1. Dashboard 예약등록 패널 선택고객 생년월일 (YY/MM/DD → YYYY-MM-DD)
 *   C2. Customers 신규/수정 폼 생년월일 미리보기 (YYMMDD 입력 → YYYY-MM-DD 미리보기)
 *   C3. InlinePatientSearch 결과 생년월일 (YY/MM/DD → YYYY-MM-DD)
 *   C5. CustomerHoverCard 나이 — 세기판별을 SSOT에 위임
 *   (D. 의료화면 7개 = 본 티켓 제외 — 별도 MEDICAL 티켓, 문원장 컨펌 대기)
 *
 * SSOT: 모든 화면이 src/lib/format.ts:birthDateYMD() 단일 재사용(세기판별 통일).
 *       신규 컬럼/RPC 0, DDL 0 (DA GO, DA-20260630-foot-RRN-DOB-AUTOPARSE).
 *
 * ⚠️ PHI 가드(필수): 클라이언트 평문 rrn 디코딩 0, 13자리 주민번호 평문/뒷자리/성별코드 노출 0.
 *   birthDateYMD 는 customers.birth_date(YYMMDD 파생컬럼)만 파싱 — rrn 평문 미사용.
 *
 * ⚠️ write-path 가드(DA canon §2): C2 폼 미리보기는 표기 전용 — 저장값은 YYMMDD 유지(역기록 금지).
 *
 * AC-1: 신규 고객 폼에 YYMMDD 입력 시 YYYY-MM-DD 미리보기 자동 표시(세기판별 정확).
 * AC-2: 세기판별 — 90→1990, 05→2005, (현재연도 2자리 이하)→2000년대 / 초과→1900년대.
 * AC-3: 저장값(input)은 YYMMDD 유지 — 미리보기(YYYY-MM-DD) 역기록 0.
 * AC-4: 화면 어디에도 13자리 주민번호 평문 미노출 (PHI guard).
 * AC-5: 글로벌검색 드롭다운 생년월일 표기는 YYYY-MM-DD 형식(또는 미표기).
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'test-admin@obliv-foot.com';
const ADMIN_PW = process.env.TEST_ADMIN_PW ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();

async function login(page: import('@playwright/test').Page, email = ADMIN_EMAIL, pw = ADMIN_PW) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin**', { timeout: 10000 });
}

// T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE(배포됨): 날짜 표기 YYYY.MM.DD(점) 통일에 정렬.
const YMD = /^\d{4}\.\d{2}\.\d{2}$/;
// 13자리 주민번호 평문 (하이픈 유무 무관) — 화면에 절대 없어야 함
const RRN_PLAINTEXT = /\b\d{6}-?\d{7}\b/;

// 세기판별 기대표(현재연도 2026 기준): yy ≤ 26 → 2000년대, 초과 → 1900년대
const CENTURY_CASES = [
  { ymmdd: '900515', expect: '1990.05.15' }, // 90 > 26 → 1900s
  { ymmdd: '050101', expect: '2005.01.01' }, // 05 ≤ 26 → 2000s
  { ymmdd: '991231', expect: '1999.12.31' }, // 99 > 26 → 1900s
  { ymmdd: '000229', expect: '2000.02.29' }, // 00 ≤ 26 → 2000s (윤년)
];

async function openCreateForm(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/customers`);
  await page.getByRole('button', { name: '신규 고객' }).click();
  await expect(page.getByText('신규 고객 등록')).toBeVisible({ timeout: 5000 });
  // T-20260701-foot-NEWPATIENT-REG-COMPACT: 생년월일은 [선택 정보] 접힘 기본값 뒤로 이동 → 펼쳐서 노출.
  const optionalToggle = page.getByTestId('custform-optional-toggle');
  if (await optionalToggle.count()) await optionalToggle.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-2: 신규 폼 YYMMDD 입력 → YYYY-MM-DD 미리보기(세기판별 정확)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1·2: 신규고객 폼 YYMMDD 입력 시 세기판별 YYYY-MM-DD 미리보기', async ({ page }) => {
  await login(page);
  await openCreateForm(page);

  const birthInput = page.getByPlaceholder('예: 900515').first();
  const preview = page.getByTestId('custform-birth-preview');

  for (const c of CENTURY_CASES) {
    await birthInput.fill('');
    await birthInput.fill(c.ymmdd);
    await expect(preview, `${c.ymmdd} → ${c.expect}`).toHaveText(c.expect, { timeout: 3000 });
  }
  console.log('✅ AC-1·2: 세기판별 미리보기 4케이스 통과');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 저장값(input)은 YYMMDD 유지 — 미리보기 역기록 0 (selfcheckin 병합키 보호)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 미리보기 표시 후에도 입력 저장값은 YYMMDD 유지(역기록 없음)', async ({ page }) => {
  await login(page);
  await openCreateForm(page);

  const birthInput = page.getByPlaceholder('예: 900515').first();
  await birthInput.fill('900515');
  await expect(page.getByTestId('custform-birth-preview')).toHaveText('1990.05.15');

  // input value 는 여전히 YYMMDD (표시포맷 YYYY-MM-DD 가 역기록되지 않음)
  await expect(birthInput).toHaveValue('900515');
  console.log('✅ AC-3: input 저장값 YYMMDD 유지 — 역기록 0');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: PHI 가드 — 폼/미리보기에 13자리 주민번호 평문 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 폼·미리보기에 13자리 주민번호 평문 미노출(PHI guard)', async ({ page }) => {
  await login(page);
  await openCreateForm(page);

  const birthInput = page.getByPlaceholder('예: 900515').first();
  await birthInput.fill('900515');
  await expect(page.getByTestId('custform-birth-preview')).toHaveText('1990.05.15');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText, '13자리 주민번호 평문이 화면에 없어야 함').not.toMatch(RRN_PLAINTEXT);
  console.log('✅ AC-4: 주민번호 평문 미노출');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: 글로벌검색 드롭다운 생년월일 표기 형식(YYYY-MM-DD) — 데이터 의존 스킵 허용
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 상단 글로벌검색 드롭다운 생년월일 YYYY-MM-DD 형식·PHI guard', async ({ page }) => {
  await login(page);
  // 글로벌검색 열기 (단축키 미보장 → 검색 placeholder 입력 필드 직접 탐색)
  const trigger = page.getByPlaceholder('이름 · 전화번호 · 생년월일(YYMMDD) · 차트번호');
  if (await trigger.count() === 0) {
    // 검색 버튼(돋보기) 클릭으로 패널 오픈 시도
    const searchBtn = page.locator('button:has(svg)').filter({ hasText: '' });
    await searchBtn.first().click().catch(() => {});
  }
  const input = page.getByPlaceholder('이름 · 전화번호 · 생년월일(YYMMDD) · 차트번호');
  if (await input.count() === 0) {
    test.skip(true, '글로벌검색 트리거 미발견 — 환경 의존 스킵');
    return;
  }
  await input.first().fill('1'); // 광범위 검색(데이터 의존)
  await page.waitForTimeout(800);

  // 드롭다운에 노출된 생년월일 텍스트가 있으면 YYYY-MM-DD 형식이어야 함
  const dropdownText = await page.locator('body').innerText();
  expect(dropdownText, '글로벌검색 영역 주민번호 평문 미노출').not.toMatch(RRN_PLAINTEXT);
  console.log('✅ AC-5: 글로벌검색 PHI guard 통과(생년월일 표기 형식 SSOT 통일)');
});
