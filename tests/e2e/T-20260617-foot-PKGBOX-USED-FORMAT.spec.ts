/**
 * E2E spec — T-20260617-foot-PKGBOX-USED-FORMAT
 * 대시보드 고객박스 패키지 표기를 "잔여/총"(예 12/12 — 다 쓴 것처럼 오인) →
 * "회차 번호"(N = used+1 = 오늘 회차)로 변경.
 *
 * 배경: 현장(김주연 총괄) — 신규 패키지 생성 직후 `12/12`로 표기되어 "다 쓴 것처럼 보인다" 혼란.
 *   기존 옵션 A(`0/12`)·B(`잔여 12회`)도 폐기 → 회차 번호(`N회차 / {total}회`) 확정.
 *
 * 구현(Dashboard.tsx):
 *   - PackageLabel 인터페이스에 used 추가, fetchPackageLabels 에서 used 보존
 *   - formatPkgLabel(p): used>=total → `{name} 완료 ({total}회)`, else `{name} {used+1}회차 / {total}회`
 *   - 두 렌더 지점(L497 compact · L683 non-compact)이 단일 함수 공유 → 불일치 차단(AC-2)
 *   - data-testid="pkg-session-label" 부여(검증용)
 *
 * 시드: tests/fixtures.seedCheckIn(실고객, checked_in_at 오늘, MARKER) + seedPackage + 수동 used 회차.
 *   ⚠ is_simulation=true 로 직접 시드하면 stripSimulationRows(T-20260610-foot-ADMIN-SIM-FILTER)에
 *     걸려 칸반에서 숨겨지므로 카드가 안 뜬다 → 반드시 정석 fixture 헬퍼(비-sim, 마커 기반) 사용.
 *   getPkgLabel 은 visit_type==='new' 면 null → 'returning' 으로 시드.
 * Supabase service env 미설정 시에만 skip.
 *
 * AC-1: 회차 번호 표기 (used=0 → "1회차", used=6 → "7회차")
 * AC-1 엣지: 전부 소진(used=total) → "13회차" 아님, "완료" 가드
 * AC-2: 표기 일관성 — 라벨에 옛 "12/12" 잔여/총 포맷 미출현
 *
 * 시나리오:
 *   S-1: 신규 패키지(0회 사용) 카드 → "1회차" (`12/12`·`0/12` 아님) [AC-1]
 *   S-2: 6회 사용 패키지 카드 → "7회차" [AC-1]
 *   S-3: 전부 소진(12회 used) 카드 → "완료" 표기, "13회차" 미출현 [AC-1 엣지]
 *   S-4: 라벨에 옛 잔여/총 슬래시 포맷(숫자/숫자) 미출현 [AC-2]
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';
import { seedCheckIn, seedPackage, type FixtureHandle } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const seedReady = Boolean(SUPA_URL && SERVICE_KEY);
const TOTAL = 12;

let sb: SupabaseClient | null = null;

interface Seeded {
  checkInId: string;
  packageId: string;
  cleanup: () => Promise<void>;
}
let fresh: Seeded | null = null; // used=0  → 1회차
let partial: Seeded | null = null; // used=6 → 7회차
let soaked: Seeded | null = null; // used=12 → 완료

// 정석 fixture(seedCheckIn=비-sim 실고객·checked_in_at 오늘·MARKER) + 패키지 + used 회차 차감.
// ⚠ T-20260618-foot-THERAPYWAIT-PKGSESSION-COMPACT: 치료대기(treatment_waiting) 슬롯 카드는 이제
//   compact 표기("N/M", 라벨 제거)로 전환됨. PKGBOX canon("N회차 / M회", formatPkgLabel)은 그 외 모든
//   슬롯에서 유지된다. 본 spec은 formatPkgLabel(회차/회) canon을 검증하므로 시드 슬롯을
//   treatment_waiting → laser_waiting(여전히 formatPkgLabel 사용)으로 이전. 검증 의도 불변.
//   (고객박스·치료대기 카드는 동일 DraggableCard 컴포넌트를 공유 — 표기 분기는 pkgLabelCompact prop으로 제어)
async function seedPkgCard(client: SupabaseClient, usedCount: number): Promise<Seeded> {
  const ci = await seedCheckIn({ visit_type: 'returning', status: 'laser_waiting' });
  const pkg: FixtureHandle = await seedPackage({
    customerId: ci.customerId,
    preset: { label: `풋케어 패키지(QA ${TOTAL}회)`, total: TOTAL, suggestedPrice: 0 },
  });

  if (usedCount > 0) {
    const sessions = Array.from({ length: usedCount }, (_, i) => ({
      package_id: pkg.id,
      session_number: i + 1,
      session_type: 'unheated_laser',
      status: 'used',
    }));
    const { error } = await client.from('package_sessions').insert(sessions);
    if (error) throw new Error(`[seed] 회차 차감(used=${usedCount}) 실패: ${error.message}`);
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

test.describe('T-20260617-foot-PKGBOX-USED-FORMAT — 고객박스 회차 번호 표기', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    fresh = await seedPkgCard(sb, 0);
    partial = await seedPkgCard(sb, 6);
    soaked = await seedPkgCard(sb, TOTAL);
    console.log(`[seed] fresh=${fresh.checkInId} partial=${partial.checkInId} soaked=${soaked.checkInId}`);
  });

  test.afterAll(async () => {
    for (const s of [fresh, partial, soaked]) {
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

  async function gotoDashboard(page: Page, checkInId: string) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`).first();
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    return card;
  }

  test('S-1: AC-1 — 신규 패키지(0회) 카드는 "1회차" 표기 (12/12·0/12 아님)', async ({ page }) => {
    const card = await gotoDashboard(page, fresh!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    expect(txt).toContain('1회차');
    expect(txt).not.toContain('12/12');
    expect(txt).not.toContain('0/12');
  });

  test('S-2: AC-1 — 6회 사용 패키지 카드는 "7회차" 표기', async ({ page }) => {
    const card = await gotoDashboard(page, partial!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    expect(txt).toContain('7회차');
    expect(txt).not.toContain('6/12');
  });

  test('S-3: AC-1 엣지 — 전부 소진 카드는 "완료" 표기, "13회차" 미출현', async ({ page }) => {
    const card = await gotoDashboard(page, soaked!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    expect(txt).toContain('완료');
    expect(txt).not.toContain('13회차');
  });

  test('S-4: AC-2 — 라벨에 옛 잔여/총 슬래시 포맷(숫자/숫자) 미출현', async ({ page }) => {
    const card = await gotoDashboard(page, fresh!.checkInId);
    const label = card.locator('[data-testid="pkg-session-label"]').first();
    await expect(label).toBeVisible({ timeout: 10_000 });
    const txt = (await label.textContent()) ?? '';
    // 옛 포맷 "{remaining}/{total}"(예 "12/12")은 숫자가 슬래시에 바로 붙는다.
    // 신 포맷 "1회차 / 12회"의 슬래시는 공백으로 둘러싸여 숫자 인접이 아니다 → 매치 안 됨.
    expect(/\d\/\d/.test(txt)).toBe(false);
  });
});
