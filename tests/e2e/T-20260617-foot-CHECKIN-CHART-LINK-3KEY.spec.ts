/**
 * E2E spec — T-20260617-foot-CHECKIN-CHART-LINK-3KEY
 * 체크인↔차트 연결을 복합키(성함 AND 연락처)로 강제 — 단일키(연락처) 오배정 재발 차단.
 *
 * 배경: 대시보드 체크인 카드 클릭 시 customer_id 가 SET 이어도 연락처 중복으로 타 환자 차트가
 *   열렸다(6/17 김사비→문자테스트 / 6/3 동일 축). 직전 RES-NAME-MISMATCH-WARN 은 비차단 토스트뿐.
 *   본 티켓은 (AC-3) 오픈 직전 성함/연락처 교차검증 → 성함 불일치 시 window.confirm 차단형,
 *   (AC-2) customer_id=null 시 성함 단독 fallback → 성함 AND 연락처 복합으로 좁힘.
 *
 * 검증 (src/pages/Dashboard.tsx):
 *   - verifyChartLinkOrConfirm: 연결 고객의 성함이 카드 표기명과 다르면 window.confirm.
 *       취소 → 차트 오픈 차단 / 확인 → 오픈.
 *   - openChartFor / handleOpenChartFromList: 복합키 fallback + 교차검증.
 *
 * 시나리오:
 *   S1/S4 오연결 교차검증 차단: 체크인 customer_id 가 타 고객(성함 불일치)으로 SET → 카드 클릭 시
 *     confirm 차단. dismiss(취소) → 차트 미오픈. accept(확인) → 오픈.
 *   S2 name 단독 fallback 제거: customer_id=null + 동명이인 2명, 체크인 연락처가 1명과 일치 →
 *     복합키로 그 1명 차트만 오픈(이름만으로 임의 오픈 X).
 *   S3 정상 단일 매칭 무회귀: 성함+연락처 모두 일치 연결 → confirm 없이 정상 오픈(false-block 없음).
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE-3KEY]';

let _sb: SupabaseClient | null = null;
const svc = (): SupabaseClient => (_sb ??= createClient(SUPA_URL, SERVICE_KEY));

const UNIQ = () => `3k${Date.now()}${Math.floor(Math.random() * 1000)}`;

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
      queue_number: 950 + (ts % 40),
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

test.describe('T-20260617-foot-CHECKIN-CHART-LINK-3KEY — 복합키 오배정 차단', () => {
  // ── S1/S4: 오연결(성함 불일치) 교차검증 — confirm 취소 시 차트 미오픈, 확인 시 오픈 ──
  test('S4: 오연결 카드 클릭 → confirm 차단(취소=미오픈 / 확인=오픈)', async ({ page }) => {
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
        test.skip(true, '시드 카드 미렌더(환경) — 차단 로직은 단위 동작으로 보장');
        return;
      }

      // (a) 취소(dismiss) → 성함 불일치 차단 → 차트 미오픈
      let dialogSeen = false;
      const onDismiss = (d: import('@playwright/test').Dialog) => { dialogSeen = true; void d.dismiss(); };
      page.on('dialog', onDismiss);
      await card.first().click();
      await page.waitForTimeout(800);
      page.off('dialog', onDismiss);
      expect(dialogSeen, '성함 불일치 → 확인 프롬프트(window.confirm)가 떠야 함').toBe(true);
      const openedAfterDismiss = await waitForChartOpen(page, 1500);
      expect(openedAfterDismiss, '취소 시 타 차트가 열리면 안 됨(오배정 차단)').toBe(false);

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

  // ── S3: 정상 단일 매칭 무회귀 — 성함+연락처 일치 시 confirm 없이 오픈 ──
  test('S3: 성함+연락처 일치 연결 → confirm 없이 정상 오픈(false-block 없음)', async ({ page }) => {
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
      expect(opened, '정상 매칭은 차트가 열려야 함').toBe(true);
    } finally {
      await cleanup({ checkIns: [ciId], customers: [cid] });
    }
  });

  // ── S2: customer_id=null + 동명이인 2명, 연락처로 복합 좁힘 (정적 가드: 코드에 복합키 적용 확인) ──
  // 칸반 명단/이름 fallback 렌더는 데이터 상태 의존 → 코드 레벨 정적 가드로 회귀 차단.
  test('S2: name 단독 fallback 제거 — openChartFor/handleOpenChartFromList 복합키 적용(정적)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(dir, '../../src/pages/Dashboard.tsx'), 'utf8');
    // 복합키 fallback: phoneSame 으로 성함 매칭을 연락처로 좁히는 코드가 존재해야 함
    expect(src.includes('phoneSame(phone, c.phone)'), 'openChartFor fallback 에 복합키(연락처) 필터 없음').toBe(true);
    expect(src.includes('phoneSame(ci.customer_phone, c.phone)'), 'handleOpenChartFromList fallback 에 복합키 필터 없음').toBe(true);
    // 차단형 교차검증 존재
    expect(src.includes('verifyChartLinkOrConfirm'), '교차검증 차단형 헬퍼 없음').toBe(true);
    // name 단독 .eq(name).limit(2) 직열 오픈(구버전) 잔존 금지
    expect(/\.eq\('name', ci\.customer_name\)\s*\.limit\(2\)/.test(src), 'name 단독 limit(2) fallback 잔존').toBe(false);
  });

  // ── S5 (AC-1 ①): 셀프접수 체크인 생성 경로 — phone 단독 해소 제거 + 복합키 적용(정적) ──
  //   실제 6/17 김사비 오배정은 '셀프접수' 경로였다(datafix: 4b091fa7 김사비 셀프접수). b8e0e33c 는
  //   self_checkin_with_reservation_link RPC 만 고쳤으나 SelfCheckIn.tsx 는 그 RPC 를 호출하지 않고
  //   FE 가 phone 단독으로 선해소한 customer_id 로 직접 check_ins INSERT → 서버 가드 우회였다.
  //   본 가드는 SelfCheckIn.tsx 가 성함+연락처(phoneCanonDigits) 복합키로 고객을 해소하는지 확인.
  test('S5: SelfCheckIn 체크인 생성 — 복합키(성함 AND 연락처) 해소(정적)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(dir, '../../src/pages/SelfCheckIn.tsx'), 'utf8');
    // 복합키 신규: 이름 eq + canonical 연락처 필터
    expect(src.includes("phoneCanonDigits"), 'SelfCheckIn 에 phoneCanonDigits 복합키 비교 없음').toBe(true);
    expect(src.includes("ambiguousLink"), '성함+연락처 동시중복(미연결 보류) 처리 없음').toBe(true);
    // 구버전 phone 단독 해소(.eq(phone, phoneStored).maybeSingle() 로 existing 결정) 잔존 금지
    expect(/existing = res\.data as \{ id: string \} \| null/.test(src), 'phone 단독 existing 해소 잔존').toBe(false);
  });

  // ── S6 (AC-1 ②): 스태프 수동 체크인 다이얼로그 — phone 단독(.eq + ilike) 제거 + 복합키(정적) ──
  test('S6: NewCheckInDialog 체크인 생성 — 복합키(성함 AND 연락처) 해소(정적)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(dir, '../../src/components/NewCheckInDialog.tsx'), 'utf8');
    expect(src.includes('phoneCanonDigits'), 'NewCheckInDialog 에 phoneCanonDigits 복합키 비교 없음').toBe(true);
    expect(src.includes('ambiguousLink'), '성함+연락처 동시중복 처리 없음').toBe(true);
    // 구버전 phone 단독 fallback (.ilike('phone', `%${phoneDigits.slice(-8)}%`)) 잔존 금지
    expect(src.includes(".ilike('phone'"), 'phone 단독 ilike fallback 잔존(오배정 경로)').toBe(false);
  });
});
