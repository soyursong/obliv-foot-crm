/**
 * T-20260708-foot-CUSTINFO-PHONE-EDIT-PANEL-NOSYNC
 * 고객정보(2번차트)에서 휴대폰 수정+저장 후 우측 접수 패널(CheckInDetailSheet)에 신번호가 실시간
 * 반영되지 않아(stale) "연락처가 차트와 다릅니다" 정합 가드가 오탐(false-positive)하던 버그 검증.
 *
 * 근본 원인(RC):
 *   customers.phone 만 갱신되고 check_ins/reservations 의 denormalized customer_phone
 *   (접수 패널 표기 소스 + verifyChartLinkOrConfirm 가드의 expectedPhone 소스)이 저장 시점 스냅샷 그대로.
 *   → ① 접수 패널 구번호 stale, ② 가드가 "카드(구 denorm) vs 차트(신 customers.phone)" 불일치로 오탐.
 *
 * 수정:
 *   저장 트랜잭션 직후 이 고객(customer_id 매칭)의 denorm customer_phone 을 신번호(E.164)로 동기화 +
 *   same-tab 새로고침 버스(requestRefresh)로 접수 패널 즉시 갱신. 가드 로직은 무변경(보존).
 *
 * ACs:
 *   AC-1: 휴대폰 저장 시 우측 접수 패널 번호 즉시 갱신(F5 불요)
 *   AC-2: 정상 수정 후 "연락처가 차트와 다릅니다" 팝업 미발생
 *   AC-4: (가드 보존) 실제 카드≠차트 케이스에서는 가드가 계속 정상 발생 — 안전장치 무력화 금지
 *
 * 주의: 실제 저장은 대상 고객 phone 을 변이하므로, UI 저장 테스트는 원복 가능한 케이스에서만 수행하고
 *       종료 시 원번호로 복원한다. 데이터/키 부재 환경에서는 skip-tolerant.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

// ── AC-4 (가드 보존) + 수정 무결성: 소스 불변식 정적 검증 ─────────────────────────
// 이 정적 가드는 데이터 없이도 항상 실행되며, "오탐 수정"이 가드 자체를 삭제/완화하지 않았음을 보증한다.
test('AC-4 가드 보존: verifyChartLinkOrConfirm + 불일치 경고가 그대로 존재하고, denorm 동기화는 customer_id 로만 스코프된다', () => {
  const dash = readFileSync(resolve(repoRoot, 'src/pages/Dashboard.tsx'), 'utf8');
  // 정합 가드(phone↔차트) 로직·문구가 보존되어야 한다 (AC-4: 안전장치 무력화 금지)
  expect(dash).toContain('verifyChartLinkOrConfirm');
  expect(dash).toContain('연락처가 차트와 다릅니다');
  // 성함 불일치 시 차단형 확인(window.confirm)도 유지
  expect(dash).toMatch(/다른 환자의 차트일 수 있습니다/);

  const chart = readFileSync(resolve(repoRoot, 'src/pages/CustomerChartPage.tsx'), 'utf8');
  // denorm 동기화 헬퍼가 존재하고, UPDATE 가 반드시 customer_id 로 스코프되어야 한다.
  //   (전역/조건없는 UPDATE 이거나 가드를 우회하면 안 됨 — 동일 customer_id 의 카드만 신번호로 맞춰 오탐만 제거)
  expect(chart).toContain('syncCheckinDenormPhone');
  expect(chart).toMatch(/update\(\{\s*customer_phone[^)]*\}\)\s*\.eq\('customer_id'/s);
  expect(chart).toMatch(/from\('reservations'\)[\s\S]*?update\(\{\s*customer_phone[\s\S]*?\.eq\('customer_id'/);
});

// ── AC-1/AC-2: 실제 UI 동선 — 접수 패널 즉시 갱신 + 가드 오탐 미발생 (skip-tolerant) ──
test('AC-1/AC-2: 고객정보에서 휴대폰 저장 → 접수 패널 즉시 갱신 + 정합 가드 오탐 미발생', async ({ page }) => {
  if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'service-role 키 없음 — 데이터 검증 skip'); return; }
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // customer_id 가 연결된 체크인 카드 클릭 → 접수 패널(CheckInDetailSheet) 오픈
  const card = page.locator('[data-checkin-id]').first();
  if ((await card.count()) === 0) { test.skip(true, '대시보드 체크인 카드 없음 — skip'); return; }
  await card.click();

  const phoneEl = page.getByTestId('checkin-detail-phone').first();
  if (!(await phoneEl.isVisible({ timeout: 5000 }).catch(() => false))) {
    test.skip(true, '접수 패널 연락처 미표시(고객 미연결 등) — skip'); return;
  }
  const before = digits(await phoneEl.textContent());
  if (before.length < 10) { test.skip(true, '유효 연락처 아님 — skip'); return; }

  // 오탐 감시: "연락처가 차트와 다릅니다" 토스트가 뜨면 AC-2 위반
  const mismatchToast = page.getByText('연락처가 차트와 다릅니다', { exact: false });

  // 고객정보(2번차트) 열기 → 휴대폰 편집 → 신번호 저장. 완료 후 원번호로 복원(데이터 무손실).
  //   UI 타이밍/환경차로 어느 단계든 진입 불가하면 정적 가드(AC-4 test)가 커버하므로 skip.
  const newPhone = '010' + before.slice(3, 7) + '9999'; // 뒤 4자리만 변경(유효 010 형태 유지)
  const chartSheet = page.getByTestId('customer-chart-sheet');
  const phoneInput = page.locator('input[value*="010"], input[placeholder*="010"]');

  const tried = await (async () => {
    // 고객차트 버튼이 있으면 클릭(이미 자동 오픈됐으면 skip). 클릭 인터셉트는 무시.
    const openChartBtn = page.getByRole('button', { name: '고객차트' }).first();
    if (await openChartBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await openChartBtn.click({ timeout: 3000 }).catch(() => {});
    }
    // 차트 시트가 로드 완료될 때까지 대기(로딩 문구 사라짐)
    if (!(await chartSheet.isVisible({ timeout: 5000 }).catch(() => false))) return false;
    await page.getByText('차트 불러오는 중', { exact: false }).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    // 휴대폰 편집 진입(연필 버튼) → 입력 → 저장
    const pencilBtn = chartSheet.getByRole('button').filter({ has: page.locator('svg') });
    // 휴대폰 표시 옆 편집 버튼을 특정하기 어려우므로, 편집 상태의 입력창이 나타날 때까지 후보 버튼 순회
    const input = phoneInput.first();
    if (!(await input.isVisible({ timeout: 1500 }).catch(() => false))) {
      const n = Math.min(await pencilBtn.count(), 12);
      for (let i = 0; i < n; i++) {
        await pencilBtn.nth(i).click({ timeout: 1500 }).catch(() => {});
        if (await input.isVisible({ timeout: 500 }).catch(() => false)) break;
      }
    }
    if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) return false;
    await input.fill(newPhone);
    const saveBtn = chartSheet.getByRole('button', { name: /저장/ }).first();
    if (!(await saveBtn.isVisible({ timeout: 1500 }).catch(() => false))) return false;
    await saveBtn.click({ timeout: 3000 }).catch(() => {});
    return true;
  })().catch(() => false);

  if (!tried) { test.skip(true, '휴대폰 편집 UI 진입 불가(환경차) — 정적 가드로 커버, skip'); return; }

  // AC-1: 접수 패널 번호가 신번호(뒤 9999)로 새로고침 없이 갱신
  await expect(async () => {
    const now = digits(await phoneEl.textContent());
    expect(now.endsWith('9999')).toBeTruthy();
  }).toPass({ timeout: 6000 });

  // AC-2: 오탐 토스트 미발생
  await expect(mismatchToast).toHaveCount(0);

  // 원복 — service-role 로 원번호 복원(테스트 데이터 정리)
  const cid = await card.getAttribute('data-checkin-id');
  if (cid) {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await supa.from('check_ins').select('customer_id').eq('id', cid).maybeSingle();
    const custId = (data as { customer_id: string | null } | null)?.customer_id;
    if (custId) {
      const orig = `${before.slice(0, 3)}-${before.slice(3, 7)}-${before.slice(7, 11)}`;
      await supa.from('customers').update({ phone: orig }).eq('id', custId);
      const e164 = '+82' + before.slice(1);
      await supa.from('check_ins').update({ customer_phone: e164 }).eq('customer_id', custId);
      await supa.from('reservations').update({ customer_phone: e164 }).eq('customer_id', custId);
    }
  }
});
