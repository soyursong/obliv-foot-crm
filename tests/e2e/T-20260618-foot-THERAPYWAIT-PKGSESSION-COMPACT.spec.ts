/**
 * E2E spec — T-20260618-foot-THERAPYWAIT-PKGSESSION-COMPACT
 * 치료대기(치료실) 환자 카드의 패키지 세션 카운터 표기 간소화.
 *   "{N}회차 / {M}회" → "{N}/{M}" (라벨 "회차"·"회" 제거, 숫자/총만). N·M 값 동일.
 *
 * 배경: 현장(김주연 총괄) — 치료대기 패널 카드 "PD 10회권 6회차 / 10회"가 장황 → "6/10" 요청.
 *
 * 구현(Dashboard.tsx):
 *   - formatPkgLabelCompact(p): used>=total → "{name} 완료 ({total})", else "{name} {used+1}/{total}"
 *   - DraggableCard 에 pkgLabelCompact prop 추가 — true면 compact 포맷터 사용
 *   - case 'treatment_waiting_col' DraggableCard 에만 pkgLabelCompact 전달 (그 외 슬롯은 formatPkgLabel 유지)
 *   - 고객박스·치료대기 카드는 동일 DraggableCard 공유 → 분기는 pkgLabelCompact prop으로 제어
 *
 * 시드: PKGBOX spec과 동일 정석 fixture(seedCheckIn 비-sim·returning·MARKER) + seedPackage + used 회차.
 *   ⚠ getPkgLabel 은 visit_type==='new' 면 null → 'returning' 으로 시드.
 *   ⚠ 패키지명에 "회"/"회차" 미포함 → 라벨 제거 검증(toContain 회차) 오염 방지.
 * Supabase service env 미설정 시에만 skip.
 *
 * AC-1: 치료대기 카드 카운터 "N/M" 표기 (used=5,total=10 → "6/10")
 * AC-2: "패키지" 뱃지 유지
 * AC-3: 일관성(소량 패키지도 동일 포맷) + 고객박스/그 외 슬롯 회귀 없음(회차/회 유지)
 *
 * 시나리오:
 *   S-1: 단건 패키지 치료대기 카드 → "6/10" ("6회차 / 10회" 미출현) [AC-1]
 *   S-2: 소량 잔여 치료대기 카드 → "2/2" ("2회차" 미출현) + "회차" 라벨 잔존 0건 [AC-1/AC-3]
 *   S-3 (회귀): 그 외 슬롯(레이저대기) 고객박스 카드는 "N회차 / M회" 유지 (PKGBOX canon 미영향) [AC-3]
 *   S-4: 치료대기 카드에 "패키지" 뱃지 그대로 표시 [AC-2]
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn, seedPackage, type FixtureHandle } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;

interface Seeded {
  checkInId: string;
  packageId: string;
  cleanup: () => Promise<void>;
}
let twCard: Seeded | null = null;     // 치료대기 단건: total=10 used=5 → "6/10"
let twSmall: Seeded | null = null;    // 치료대기 소량: total=2 used=1 → "2/2"
let otherSlot: Seeded | null = null;  // 레이저대기(회귀): total=10 used=5 → "6회차 / 10회" 유지

// 정석 fixture + 패키지 + used 회차 차감. status·label·total 파라미터화.
// ⚠ 패키지명은 "회"/"회차" 미포함 — 라벨 제거 검증 오염 방지.
async function seedPkgCard(
  client: SupabaseClient,
  opts: { status: 'treatment_waiting' | 'laser_waiting'; label: string; total: number; usedCount: number },
): Promise<Seeded> {
  const ci = await seedCheckIn({ visit_type: 'returning', status: opts.status });
  const pkg: FixtureHandle = await seedPackage({
    customerId: ci.customerId,
    preset: { label: opts.label, total: opts.total, suggestedPrice: 0 },
  });

  if (opts.usedCount > 0) {
    const sessions = Array.from({ length: opts.usedCount }, (_, i) => ({
      package_id: pkg.id,
      session_number: i + 1,
      session_type: 'unheated_laser',
      status: 'used',
    }));
    const { error } = await client.from('package_sessions').insert(sessions);
    if (error) throw new Error(`[seed] 회차 차감(used=${opts.usedCount}) 실패: ${error.message}`);
  }

  return {
    checkInId: ci.id,
    packageId: pkg.id,
    cleanup: async () => {
      await client.from('package_sessions').delete().eq('package_id', pkg.id);
      await pkg.cleanup();
      await ci.cleanup();
    },
  };
}

test.describe('T-20260618-foot-THERAPYWAIT-PKGSESSION-COMPACT — 치료대기 카드 패키지 표기 간소화', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    twCard = await seedPkgCard(sb, { status: 'treatment_waiting', label: '풋케어팩QA-A', total: 10, usedCount: 5 });
    twSmall = await seedPkgCard(sb, { status: 'treatment_waiting', label: '필러팩QA-B', total: 2, usedCount: 1 });
    otherSlot = await seedPkgCard(sb, { status: 'laser_waiting', label: '풋케어팩QA-C', total: 10, usedCount: 5 });
    console.log(`[seed] twCard=${twCard.checkInId} twSmall=${twSmall.checkInId} otherSlot=${otherSlot.checkInId}`);
  });

  test.afterAll(async () => {
    for (const s of [twCard, twSmall, otherSlot]) {
      if (s) await s.cleanup();
    }
    console.log('[seed] 정리 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  async function gotoCard(page: Page, checkInId: string) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`).first();
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    return card;
  }

  test('S-1: AC-1 — 단건 패키지 치료대기 카드는 "6/10" 표기 ("6회차 / 10회" 미출현)', async ({ page }) => {
    const card = await gotoCard(page, twCard!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    expect(txt).toContain('6/10');
    expect(txt).not.toContain('회차');
    expect(txt).not.toContain('6회차');
    // 옛 포맷 "{N}회차 / {M}회" 패턴 부재
    expect(/\d+회차\s*\/\s*\d+회/.test(txt)).toBe(false);
  });

  test('S-2: AC-1/AC-3 — 소량 잔여 치료대기 카드는 "2/2" 표기, "회차" 라벨 잔존 0건', async ({ page }) => {
    const card = await gotoCard(page, twSmall!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    expect(txt).toContain('2/2');
    expect(txt).not.toContain('회차');
  });

  test('S-3: AC-3 회귀 — 그 외 슬롯(레이저대기) 고객박스는 "N회차 / M회" 유지 (PKGBOX canon)', async ({ page }) => {
    const card = await gotoCard(page, otherSlot!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    // formatPkgLabel canon: "{name} 6회차 / 10회" — compact("6/10")로 변하지 않음
    expect(txt).toContain('6회차');
    expect(txt).toContain('10회');
    expect(txt).not.toContain('6/10');
  });

  test('S-4: AC-2 — 치료대기 카드에 "패키지" 뱃지 그대로 표시', async ({ page }) => {
    const card = await gotoCard(page, twCard!.checkInId);
    const badge = card.locator('[data-testid="pkg-holder-badge"]').first();
    await expect(badge).toBeVisible({ timeout: 10_000 });
    expect((await badge.textContent()) ?? '').toContain('패키지');
  });
});
