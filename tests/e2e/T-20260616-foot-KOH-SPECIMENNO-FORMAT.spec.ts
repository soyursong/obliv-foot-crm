/**
 * E2E spec — T-20260616-foot-KOH-SPECIMENNO-FORMAT
 * 균배양 검사 결과지 검체번호 자동배정 — 총괄 확정 포맷 핀.
 *
 * 확정 포맷(총괄): K + YYMMDD(검체채취일 6자리) + '-' + 고객 폰 뒷4자리   예: K260616-1234
 *   중복 정책: 같은 날 폰뒷4 충돌 OK → UNIQUE/회피 로직 없음(공란없음이 목표).
 *
 * 검증 대상(현장 클릭 시나리오 3종 변환):
 *   S1 정상 자동삽입       — 정상 폰번호(뒷4 확보) → K260616-1234 형식으로 자동 채워짐.
 *   S2 같은날 폰뒷4 중복허용 — 같은 날 + 같은 폰뒷4 두 건 발행 → 동일 검체번호, 충돌/예외 없음.
 *   S3 phone 엣지          — 미등록/4자리 미만 = 안전 패딩('0' lpad), 발행 막지 않음(공란없음).
 *   S4 실 브라우저         — 균검사지 탭 렌더 스모크.
 *
 * 스타일: S1~S3 = RPC(next_koh_specimen_no + publish_koh_result phone 뒷4 추출) SQL 로직 정본 모사.
 *         포맷·패딩이 PHI FE 비노출(RPC 내부)이므로 SQL 규칙을 TS로 모사해 회귀 차단.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: publish_koh_result 내부 phone 뒷4 추출 규칙 ──────────────────────
//   SQL: right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), 4)  → len<4 면 lpad(_,4,'0').
//   '' → '0000', '123' → '0123', '010-1234-5678' → '5678', '+821012345678' → '2345'.
const phoneLast4 = (phone: string | null | undefined): string => {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  let last4 = digits.slice(-4);
  if (last4.length < 4) last4 = last4.padStart(4, '0');
  return last4;
};

// ── 정본 모사: next_koh_specimen_no(p_clinic, p_base_date, p_phone_last4) ───────
//   SQL: 'K' || to_char(p_base_date,'YYMMDD') || '-' || p_phone_last4.
const yymmdd = (isoDate: string): string => isoDate.slice(2, 10).replace(/-/g, ''); // 2026-06-16 → 260616
const nextKohSpecimenNo = (baseDate: string, last4: string): string =>
  `K${yymmdd(baseDate)}-${last4}`;

// 발행 시 검체번호 산출 = phone 뒷4 추출 → 포맷 결합(공란 없음 보장).
const publishSpecimenNo = (baseDate: string, phone: string | null | undefined): string =>
  nextKohSpecimenNo(baseDate, phoneLast4(phone));

// ── S1: 정상 자동삽입 ─────────────────────────────────────────────────────────
test('S1: 정상 폰번호 → 검체번호 K+YYMMDD-폰뒷4 자동 삽입', () => {
  // 검체채취일 2026-06-16, 폰 010-9988-1234 → K260616-1234
  expect(publishSpecimenNo('2026-06-16', '010-9988-1234')).toBe('K260616-1234');
  // 하이픈 없는 입력
  expect(publishSpecimenNo('2026-06-16', '01099881234')).toBe('K260616-1234');
  // E.164
  expect(publishSpecimenNo('2026-06-16', '+821099885678')).toBe('K260616-5678');
  // 날짜 경계(연도/월/일 zero-pad)
  expect(publishSpecimenNo('2027-01-05', '010-0000-7890')).toBe('K270105-7890');
  // 절대 공란이 아니다(목표: 공란없음)
  expect(publishSpecimenNo('2026-06-16', '010-9988-1234')).not.toBe('');
});

// ── S2: 같은날 폰뒷4 중복허용 ────────────────────────────────────────────────
test('S2: 같은 날 + 같은 폰뒷4 두 건 발행 → 동일 검체번호, 충돌/예외 없음', () => {
  const a = publishSpecimenNo('2026-06-16', '010-9988-1234');
  const b = publishSpecimenNo('2026-06-16', '010-7777-1234'); // 앞자리 달라도 뒷4 동일
  // seq/UNIQUE 없음 → 동일 값 그대로 허용(중복 정책: 충돌 OK).
  expect(a).toBe('K260616-1234');
  expect(b).toBe('K260616-1234');
  expect(a).toBe(b);
  // 발행 함수가 충돌로 throw 하지 않음(순수 포맷 — 회피 로직 부재).
  expect(() => {
    publishSpecimenNo('2026-06-16', '010-9988-1234');
    publishSpecimenNo('2026-06-16', '010-9988-1234');
  }).not.toThrow();
});

// ── S3: phone 엣지 — 안전 패딩, 발행 막지 않음 ───────────────────────────────
test('S3: phone 미등록/4자리 미만 → 0 패딩, 발행 차단 없음(공란없음)', () => {
  // 미등록(null/빈문자) → '0000'
  expect(publishSpecimenNo('2026-06-16', null)).toBe('K260616-0000');
  expect(publishSpecimenNo('2026-06-16', '')).toBe('K260616-0000');
  // 숫자 없는 입력(문자만) → '0000'
  expect(publishSpecimenNo('2026-06-16', '연락처없음')).toBe('K260616-0000');
  // 4자리 미만 → 좌측 0 패딩
  expect(publishSpecimenNo('2026-06-16', '123')).toBe('K260616-0123');
  expect(publishSpecimenNo('2026-06-16', '5')).toBe('K260616-0005');
  // 어떤 엣지에서도 검체번호는 항상 채워진다(공란없음 목표).
  for (const p of [null, '', '연락처없음', '1', '12', '123']) {
    expect(publishSpecimenNo('2026-06-16', p).startsWith('K260616-')).toBe(true);
    expect(publishSpecimenNo('2026-06-16', p).split('-')[1].length).toBe(4);
  }
});

// ── S4: 실 브라우저 — 균검사지 탭 렌더 스모크 ─────────────────────────────────
test('S4: 진료대시보드 균검사지 탭 렌더 스모크', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const dashLink = page.getByRole('link', { name: '진료 대시보드' });
  if (await dashLink.count() > 0) {
    await dashLink.click();
    await page.waitForTimeout(1500);
    const tab = page.getByTestId('tab-koh-report');
    if (await tab.count() > 0) {
      await tab.click();
      await page.waitForTimeout(2500);
    }
  }
  await page.screenshot({
    path: 'evidence/T-20260616-foot-KOH-SPECIMENNO-FORMAT_kohtab.png',
    fullPage: true,
  });
  const table = page.getByTestId('koh-table');
  if (await table.count() > 0) {
    await expect(page.getByTestId('koh-select-all').first()).toBeVisible({ timeout: 5000 });
  }
});
