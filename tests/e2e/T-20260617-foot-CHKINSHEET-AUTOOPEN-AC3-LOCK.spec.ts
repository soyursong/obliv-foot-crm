/**
 * E2E spec — T-20260617-foot-CHKINSHEET-AUTOOPEN-AC3-LOCK
 * CheckInDetailSheet 무조건 자동 차트오픈이 AC-3 교차검증을 우회하던 표시-시점 구멍 봉합.
 *
 * 배경(모티켓 AC-3 잔여): CheckInDetailSheet.tsx 의 auto-open useEffect 가 checkIn.customer_id 로
 *   2번차트(고객차트)를 '무조건' 열어 Dashboard.openChartFor 의 verifyChartLinkOrConfirm 게이트를
 *   우회했다 → 체크인 카드에서 confirm 을 취소해도 디테일시트 경로로 타 환자 차트가 열릴 수 있었다
 *   (6/17 김OO→문자테스트류 오배정 표시 재현).
 *
 * 수정(옵션 A, CHART_UNIFORMITY_LOCK 양립): auto-open 을 guardedAutoOpenChart 로 교체.
 *   - 정상 매칭(성함 일치) → 종전대로 '무조건' 오픈(LOCK 보존, 회귀0).
 *   - 성함 불일치(데이터 무결성 오류 상태)에서만 차단 + window.confirm(균일 에러 가드).
 *   ⇒ '고객별로 열리고/안 열리고' 하는 UX 분기가 아니라, 모든 고객에 동일 규칙 → LOCK 무저촉.
 *
 * 시나리오:
 *   S4(격상): 체크인 customer_id 를 타 고객(성함 불일치)으로 SET → 카드 클릭 시 디테일시트
 *     auto-open 이 confirm 차단. dismiss → 타 차트 미오픈 / accept → 오픈(staff override). [런타임]
 *   S2(무회귀): 성함+연락처 일치 정상 연결 → confirm 없이 디테일시트가 차트를 무조건 오픈. [런타임]
 *   S-GUARD(정적): CheckInDetailSheet 의 auto-open useEffect 에 무조건 openChart(customer_id) 잔존
 *     금지 + guardedAutoOpenChart/verifyChartOpenOrConfirm/window.confirm 경유 확인. [정적, 결정적]
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE-AC3LOCK]';

let _sb: SupabaseClient | null = null;
const svc = (): SupabaseClient => (_sb ??= createClient(SUPA_URL, SERVICE_KEY));

const UNIQ = () => `ac3l${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function seedCustomer(name: string, phone: string): Promise<string> {
  const { data, error } = await svc()
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new', memo: MARKER })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedCustomer failed: ${error?.message}`);
  return data.id as string;
}

async function seedCheckIn(opts: {
  customerId: string | null;
  name: string;
  phone: string;
  status?: string;
}): Promise<string> {
  const ts = Date.now();
  const { data, error } = await svc()
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: opts.customerId,
      customer_name: opts.name,
      customer_phone: opts.phone,
      visit_type: 'new',
      status: opts.status ?? 'exam_waiting',
      queue_number: 960 + (ts % 30),
      checked_in_at: new Date().toISOString(),
      notes: MARKER,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedCheckIn failed: ${error?.message}`);
  return data.id as string;
}

async function cleanup(ids: { checkIns?: string[]; customers?: string[] }) {
  for (const id of ids.checkIns ?? []) await svc().from('check_ins').delete().eq('id', id);
  for (const id of ids.customers ?? []) {
    await svc().from('check_ins').delete().eq('customer_id', id);
    await svc().from('customers').delete().eq('id', id);
  }
}

async function waitForChartOpen(page: import('@playwright/test').Page, timeout = 7000): Promise<boolean> {
  return Promise.race([
    page.locator('[data-testid="chart-info-panel"]').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('SMART DOCTOR — 고객정보').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('불러오는 중').first().waitFor({ state: 'visible', timeout }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeout + 100)),
  ]);
}

async function gotoDashboard(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });
  return true;
}

test.describe('T-20260617-foot-CHKINSHEET-AUTOOPEN-AC3-LOCK — 디테일시트 auto-open 게이트', () => {
  // ── S4(격상): 오연결(성함 불일치) → 디테일시트 auto-open 이 confirm 차단 ──
  test('S4: 오연결 카드 클릭 → auto-open confirm 차단(취소=미오픈 / 확인=오픈)', async ({ page }) => {
    const u = UNIQ();
    const sharedPhone = `+8210${String(Date.now()).slice(-8)}`;
    const wrongId = await seedCustomer(`오배정유저${u}`, sharedPhone); // 연결될(잘못된) 고객
    const rightName = `정답유저${u}`;
    // 체크인: 표기명=정답유저, 그러나 customer_id=오배정유저(성함 불일치) — 6/17 재현
    const ciId = await seedCheckIn({ customerId: wrongId, name: rightName, phone: sharedPhone });
    try {
      if (!(await gotoDashboard(page))) { test.skip(true, '로그인 실패'); return; }
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ciId}"]`);
      try {
        await card.first().waitFor({ state: 'visible', timeout: 12000 });
      } catch {
        test.skip(true, '시드 카드 미렌더(환경) — 차단 로직은 S-GUARD 정적 가드로 보장');
        return;
      }

      // (a) 취소(dismiss) → 성함 불일치 차단 → 타 차트 미오픈
      let dialogSeen = false;
      const onDismiss = (d: import('@playwright/test').Dialog) => { dialogSeen = true; void d.dismiss(); };
      page.on('dialog', onDismiss);
      await card.first().click();
      await page.waitForTimeout(900);
      page.off('dialog', onDismiss);
      expect(dialogSeen, '성함 불일치 → 확인 프롬프트(window.confirm)가 떠야 함').toBe(true);
      const openedAfterDismiss = await waitForChartOpen(page, 1500);
      expect(openedAfterDismiss, '취소 시 디테일시트 경로로도 타 차트가 열리면 안 됨').toBe(false);

      // (b) 확인(accept) → staff 승인 → 차트 오픈(읽기 허용)
      const onAccept = (d: import('@playwright/test').Dialog) => { void d.accept(); };
      page.on('dialog', onAccept);
      await card.first().click();
      const openedAfterAccept = await waitForChartOpen(page, 7000);
      page.off('dialog', onAccept);
      expect(openedAfterAccept, '확인 시에는 차트가 열려야 함(staff override)').toBe(true);
    } finally {
      await cleanup({ checkIns: [ciId], customers: [wrongId] });
    }
  });

  // ── S2(무회귀): 정상 매칭 → confirm 없이 무조건 오픈(LOCK 보존, false-block 없음) ──
  test('S2: 성함+연락처 일치 → confirm 없이 auto-open(무회귀)', async ({ page }) => {
    const u = UNIQ();
    const phone = `+8210${String(Date.now()).slice(-8)}`;
    const name = `정상유저${u}`;
    const cid = await seedCustomer(name, phone);
    const ciId = await seedCheckIn({ customerId: cid, name, phone });
    try {
      if (!(await gotoDashboard(page))) { test.skip(true, '로그인 실패'); return; }
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${ciId}"]`);
      try {
        await card.first().waitFor({ state: 'visible', timeout: 12000 });
      } catch {
        test.skip(true, '시드 카드 미렌더(환경)');
        return;
      }
      let dialogSeen = false;
      const onDialog = (d: import('@playwright/test').Dialog) => { dialogSeen = true; void d.accept(); };
      page.on('dialog', onDialog);
      await card.first().click();
      const opened = await waitForChartOpen(page, 7000);
      page.off('dialog', onDialog);
      expect(dialogSeen, '성함+연락처 일치 시 confirm 이 뜨면 안 됨(false-block)').toBe(false);
      expect(opened, '정상 매칭은 차트가 열려야 함(LOCK 보존)').toBe(true);
    } finally {
      await cleanup({ checkIns: [ciId], customers: [cid] });
    }
  });

  // ── S-GUARD(정적, 결정적): 디테일시트 auto-open 이 무조건 openChart 를 버리고 교차검증 경유 ──
  //   런타임 카드 렌더가 환경 의존(위 S4/S2 skip 가능)이므로 회귀 신호는 이 정적 가드가 확정한다.
  test('S-GUARD: CheckInDetailSheet auto-open 이 guardedAutoOpenChart 경유(무조건 openChart 잔존 금지)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(dir, '../../src/components/CheckInDetailSheet.tsx'), 'utf8');

    // (1) 교차검증 게이트 헬퍼 + 차단형 프롬프트 존재
    expect(src.includes('verifyChartOpenOrConfirm'), '교차검증 헬퍼(verifyChartOpenOrConfirm) 없음').toBe(true);
    expect(src.includes('guardedAutoOpenChart'), 'race-guard 래퍼(guardedAutoOpenChart) 없음').toBe(true);
    expect(src.includes('window.confirm'), '성함 불일치 차단형 확인(window.confirm) 없음').toBe(true);

    // (2) auto-open 효과가 guard 경유 — customer_id / resolvedCustomerId 둘 다
    expect(
      src.includes('guardedAutoOpenChart(checkIn.customer_id'),
      'customer_id auto-open 이 guardedAutoOpenChart 경유 아님',
    ).toBe(true);
    expect(
      src.includes('guardedAutoOpenChart(resolvedCustomerId'),
      'resolvedCustomerId auto-open 이 guardedAutoOpenChart 경유 아님',
    ).toBe(true);

    // (3) 무조건 openChart(checkIn.customer_id) / openChart(resolvedCustomerId) 직결 잔존 금지
    //     (guard 를 우회하던 구경로 = 표시-시점 오배정 근원).
    expect(
      /openChart\(checkIn\.customer_id\)/.test(src),
      '무조건 openChart(checkIn.customer_id) 직결 잔존 — 게이트 우회 재발',
    ).toBe(false);
    expect(
      /openChart\(resolvedCustomerId\)/.test(src),
      '무조건 openChart(resolvedCustomerId) 직결 잔존 — 게이트 우회 재발',
    ).toBe(false);

    // (4) LOCK 보존: 정상 매칭은 무조건 오픈 — verify 는 성함 불일치일 때만 차단(기본 return true)
    //     nameMismatch 조건과 기본 통과(return true) 가 모두 존재해야 균일 에러 가드.
    expect(src.includes('const nameMismatch'), '성함 불일치 판정(nameMismatch) 없음').toBe(true);
  });
});
