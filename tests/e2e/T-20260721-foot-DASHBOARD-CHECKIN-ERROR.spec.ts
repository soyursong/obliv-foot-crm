/**
 * E2E Spec: T-20260721-foot-DASHBOARD-CHECKIN-ERROR
 *
 * 현장 보고: 대시보드 우측 상단 「체크인」 버튼 → NewCheckInDialog 제출 시 에러.
 *
 * ── RC (재현·규명 완료, prod rxlomoozakkjesdqjtvd) ─────────────────────────────
 *   next_queue_number 와 UNIQUE 인덱스 idx_checkins_clinic_date_queue 는 둘 다
 *   kst_date(checked_in_at) 로 일일 버킷팅한다. 그런데 FE 3개 체크인 발번 경로가
 *   p_date 로 UTC 날짜(new Date().toISOString().slice(0,10)) 또는 client-local/예약날짜를
 *   넘겨서, KST 오전(00:00~09:00 = 전일 15:00~24:00 UTC) 창에서는 전날(UTC) 버킷의
 *   MAX+1 을 발번 → KST-today 버킷에 이미 존재하는 번호와 충돌 → check_ins INSERT 가
 *   23505 duplicate key (idx_checkins_clinic_date_queue) → "체크인 실패" 토스트.
 *
 *   재현 증거: KST 08:46(=UTC 2026-07-20) 창에서
 *     next_queue_number(p_date=UTC '2026-07-20') → 977262 (이미 존재) → INSERT 충돌
 *     next_queue_number(p_date=KST '2026-07-21') → 977264 (정상 MAX+1) → INSERT OK
 *
 * ── FIX ───────────────────────────────────────────────────────────────────────
 *   3개 발번 경로(NewCheckInDialog / Dashboard.doCheckInForReservation /
 *   ReservationDetailPopup)를 todaySeoulISODate()(KST YYYY-MM-DD)로 통일.
 *   스키마 무접촉(FE-only). RPC·인덱스는 이미 KST 정합(T-20260602-TZ-AUDIT-FIX).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8091';

// ── AC-1 (RC 규명): KST 오전 경계에서 UTC 날짜 ≠ KST 날짜 (버그의 근본 조건) ──────
test('AC-1: KST 오전(00:00~09:00) 창에서 UTC 날짜와 KST 날짜가 하루 어긋난다', () => {
  // UTC 2026-07-20T23:46Z == KST 2026-07-21T08:46 (현장 재현 시각대)
  const boundary = new Date('2026-07-20T23:46:00.000Z');
  const utcDate = boundary.toISOString().slice(0, 10);
  const kstDate = boundary.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  expect(utcDate).toBe('2026-07-20');   // 옛 버그 값 (전날 버킷)
  expect(kstDate).toBe('2026-07-21');   // 수정 값 (당일 버킷 = 인덱스 버킷과 일치)
  expect(utcDate).not.toBe(kstDate);    // 이 어긋남이 발번-인덱스 버킷 불일치 → 충돌의 근본
});

// ── AC-2 (회귀 가드): 3개 발번 경로가 KST(todaySeoulISODate) 로 통일되었는지 소스 검증 ──
//   e2e 는 wall-clock 의존이라 이 결정적 소스 가드로 재발을 상시 차단한다.
const CALLSITES = [
  'src/components/NewCheckInDialog.tsx',
  'src/pages/Dashboard.tsx',
  'src/components/ReservationDetailPopup.tsx',
];

for (const rel of CALLSITES) {
  test(`AC-2: ${rel} — next_queue_number p_date 가 todaySeoulISODate(KST) 사용`, () => {
    const src = readFileSync(join(REPO, rel), 'utf8');
    // 발번 RPC 호출 블록 추출
    const idx = src.indexOf("rpc('next_queue_number'");
    expect(idx, 'next_queue_number 호출 존재').toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 220);
    // KST 헬퍼로 발번
    expect(block).toContain('todaySeoulISODate()');
    // 옛 버그 패턴(UTC 슬라이스) 부활 금지
    expect(block).not.toContain('toISOString().slice(0, 10)');
    expect(block).not.toContain("format(new Date(), 'yyyy-MM-dd')");
  });
}

// ── AC-3 (best-effort e2e smoke): 대시보드 우측 「체크인」 → 제출 시 duplicate/실패 토스트 없음 ──
//   local dev 서버 미기동 시 자동 skip (CI 외 환경 안전).
test('AC-3: 대시보드 체크인 제출 시 duplicate-key/체크인 실패 토스트가 뜨지 않는다', async ({ page }) => {
  const reachable = await page.goto(`${BASE_URL}/admin/dashboard`, { timeout: 8000 }).then(() => true).catch(() => false);
  test.skip(!reachable, 'local dev 서버(8091) 미기동 — e2e smoke skip');

  // 로그인 게이트 통과(하니스 auth-disable 이 아니면 로그인)
  const emailInput = page.getByPlaceholder('이메일');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(process.env.TEST_EMAIL ?? 'test@medibuilder.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? '');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/dashboard|admin/, { timeout: 15000 }).catch(() => {});
  }

  const checkinBtn = page.getByRole('button', { name: '체크인' }).first();
  if (!(await checkinBtn.isVisible({ timeout: 8000 }).catch(() => false))) {
    test.skip(true, '체크인 버튼 미표시(권한/렌더 환경) — smoke skip');
  }
  await checkinBtn.click();

  await expect(page.getByText('체크인 추가')).toBeVisible({ timeout: 5000 });
  // 워크인(예약 미연결) 초진 접수
  const uniqueName = `자동검증_${Date.now()}`;
  await page.locator('#ci-name').fill(uniqueName);
  await page.locator('#ci-phone').fill('010-0000-0000');
  await page.getByRole('button', { name: '체크인' }).last().click();

  // duplicate key / 체크인 실패 토스트가 뜨면 회귀
  await expect(page.getByText(/duplicate key|체크인 실패/)).toHaveCount(0, { timeout: 6000 });
});
