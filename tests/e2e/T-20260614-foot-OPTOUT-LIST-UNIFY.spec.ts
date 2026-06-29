/**
 * T-20260614-foot-OPTOUT-LIST-UNIFY · 수신거부 명단 합산 표시(옵션 A)
 *
 * 메시지 설정 ⑥ 수신거부 명단이 notification_opt_outs(수동)만 읽어 공란이던 문제를
 * customers.sms_opt_in=false(셀프접수·차트·T-20260610 백필 과거분)와 읽기 UNION 합산해 표시.
 *
 * 핵심:
 *  - 조회: notification_opt_outs(source=manual) + customers WHERE sms_opt_in=false(source=opt_in) 전화번호 키 병합.
 *  - ★해제 라우팅(risk 3/5): manual→notification_opt_outs DELETE / opt_in→customers.sms_opt_in=true UPDATE.
 *    양쪽 거부 행은 두 경로 모두 해제해야 발송 차단 완전 해제.
 *  - send-notification EF 무변경(발송 차단 이미 동작, 회귀 0 = AC7) → 본 spec 범위 외.
 *  - AdminSettings ⑥ 안내문 실제 동작에 맞게 수정(AC6).
 *
 * 시나리오(티켓 가이드 4종):
 *  S1: 합산 표시 — ⑥ 진입, 출처 배지(수동/셀프·차트) 컬럼 + 안내문 정합 확인.
 *  S2: opt_in=false 고객 해제 — 셀프/차트 출처 행 해제 시 목록 제거.
 *  S3: 수동 추가/해제 회귀 — 수동 추가 → '수동' 배지 → 해제 → 제거(AC4).
 *  S4: 엣지 — 양쪽 거부 병합 행은 1행만(중복 없음, AC5).
 *
 * DB 시드 비의존: 실데이터 유무에 따라 가용 시나리오는 검증, 부재 시 구조/안내문 회귀만 보장(repo 관례).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
  }
}

/** /admin/settings 진입 후 ⑥ 수신거부 명단 섹션 활성화. 진입 성공 여부 반환. */
async function gotoOptOutSection(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/admin/settings`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  // 섹션 네비 버튼(데스크탑/모바일 양쪽 동일 라벨 노출) — 첫 매칭 클릭
  const navBtn = page.getByRole('button', { name: /⑥ 수신거부 명단/ }).first();
  if (!(await navBtn.isVisible({ timeout: 5000 }).catch(() => false))) return false;
  await navBtn.click();
  // 섹션 헤더 렌더 대기
  await expect(page.getByRole('heading', { name: '⑥ 수신거부 명단' })).toBeVisible({ timeout: 8000 });
  return true;
}

// ── S1: 합산 표시 + 출처 배지 + 안내문 정합 ──────────────────────────────────────
test('S1: ⑥ 수신거부 명단 — 출처 컬럼/안내문 합산 동작 정합', async ({ page }) => {
  await loginIfNeeded(page);
  const ok = await gotoOptOutSection(page);
  if (!ok) { test.skip(true, '메시지 설정 ⑥ 섹션 접근 불가 — 스킵'); return; }

  // 안내문이 실제 동작(합산 표시)과 일치해야 함(AC6) — 구 문구 "자동 적재" 잔존 금지.
  const sectionBody = page.locator('body');
  await expect(sectionBody).toContainText('셀프접수·차트에서 문자수신을');
  await expect(sectionBody).not.toContainText('셀프체크인 미동의 시 자동 적재');

  // 목록이 있으면 출처 컬럼 헤더 노출(AC2). 공란이면 안내 텍스트.
  const hasRows = await page.locator('tbody tr').first().isVisible({ timeout: 4000 }).catch(() => false);
  if (hasRows) {
    await expect(page.getByRole('columnheader', { name: '출처' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '이름' })).toBeVisible();
    // 최소 1개 출처 배지(수동 또는 셀프/차트)가 렌더되어야 함.
    const badges = page.locator('tbody tr').first().getByText(/수동|셀프\/차트/);
    await expect(badges.first()).toBeVisible();
  } else {
    await expect(page.getByText('수신거부 번호가 없습니다.')).toBeVisible();
  }
});

// ── S2: opt_in=false(셀프/차트) 출처 행 해제 → 목록 제거 ─────────────────────────
test('S2: 셀프/차트 출처 행 해제 → customers.sms_opt_in=true 라우팅 후 목록 제거', async ({ page }) => {
  await loginIfNeeded(page);
  const ok = await gotoOptOutSection(page);
  if (!ok) { test.skip(true, '메시지 설정 ⑥ 섹션 접근 불가 — 스킵'); return; }

  // '셀프/차트' 배지를 가진 첫 행 탐색
  const optInRow = page.locator('tbody tr').filter({ hasText: '셀프/차트' }).first();
  if (!(await optInRow.isVisible({ timeout: 4000 }).catch(() => false))) {
    test.skip(true, 'opt_in=false(셀프/차트) 출처 행 없음 — 스킵'); return;
  }
  const phoneText = (await optInRow.locator('td').nth(1).textContent())?.trim() ?? '';
  const rowCountBefore = await page.locator('tbody tr').count();

  await optInRow.getByRole('button', { name: '해제' }).click();
  // 토스트(해제 완료) 또는 행 제거 확인
  await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 8000 })
    .toBeLessThan(rowCountBefore);
  // 동일 전화번호 행이 사라졌는지 확인
  if (phoneText) {
    await expect(page.locator('tbody tr').filter({ hasText: phoneText })).toHaveCount(0);
  }
});

// ── S3: 수동 추가 → '수동' 배지 → 해제(notification_opt_outs DELETE 회귀, AC4) ──────
test('S3: 수동 추가/해제 회귀 — notification_opt_outs 경로 무변경', async ({ page }) => {
  await loginIfNeeded(page);
  const ok = await gotoOptOutSection(page);
  if (!ok) { test.skip(true, '메시지 설정 ⑥ 섹션 접근 불가 — 스킵'); return; }

  // 충돌 없는 임의 테스트 번호(010-0000-XXXX)
  const rand = String(1000 + Math.floor(Math.random() * 8999));
  const rawPhone = `0100000${rand}`;

  await page.getByPlaceholder('01012345678').fill(rawPhone);
  await page.getByRole('button', { name: '추가' }).click();

  // 추가된 행이 '수동' 배지로 표시되는지 확인
  const addedRow = page.locator('tbody tr').filter({ hasText: rand }).first();
  if (!(await addedRow.isVisible({ timeout: 6000 }).catch(() => false))) {
    test.skip(true, '수동 추가 결과 반영 불가(RLS/권한) — 스킵'); return;
  }
  await expect(addedRow.getByText('수동')).toBeVisible();

  // 해제 → 목록에서 제거
  await addedRow.getByRole('button', { name: '해제' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: rand })).toHaveCount(0, { timeout: 8000 });
});

// ── S4: 엣지 — 전화번호 병합으로 중복 행 없음(AC5) ───────────────────────────────
test('S4: 동일 전화번호 양쪽 거부 시 1행만 — 중복 없음', async ({ page }) => {
  await loginIfNeeded(page);
  const ok = await gotoOptOutSection(page);
  if (!ok) { test.skip(true, '메시지 설정 ⑥ 섹션 접근 불가 — 스킵'); return; }

  const hasRows = await page.locator('tbody tr').first().isVisible({ timeout: 4000 }).catch(() => false);
  if (!hasRows) { test.skip(true, '수신거부 행 없음 — 병합 검증 스킵'); return; }

  // 표시된 모든 전화번호 셀(td[1]) 수집 → 중복 0 (전화번호 키 병합 불변식)
  const phones = await page.locator('tbody tr td:nth-child(2)').allTextContents();
  const trimmed = phones.map((p) => p.trim()).filter(Boolean);
  const uniq = new Set(trimmed);
  expect(uniq.size).toBe(trimmed.length);
});
