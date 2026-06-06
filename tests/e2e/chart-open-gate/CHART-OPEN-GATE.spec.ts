/**
 * T-20260606-foot-CHART-OPEN-E2E-GATE
 * 차트오픈 "행위 기반" 머지차단 게이트 (CHART-OPEN-GATE)
 *
 * 왜 이 spec이 있나 (부모 RCA: T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA):
 *   대시보드 초진 차트 안열림이 6번 재발했다. 직전 6/6 회귀의 진짜 코드는
 *   Dashboard.tsx L6160 `onCardClick={!isPast ? handleCardClick : undefined}` (+ onReservationSelect 동형).
 *   자정 넘긴 24/7 태블릿의 stale date(=과거날짜) → isPast=true → onClick이 undefined → 클릭 사망(silent fail).
 *
 *   기존 안전망의 사각:
 *     - CHART-ACCESS-LOCK 스캐너: `openChart` 심볼 "존재"만 grep → caller 배선이 죽어도 GREEN.
 *     - CHART-OPEN-GUARD.spec: 칸반 카드만 클릭(box1/box2), 타임라인은 "렌더만" 검증 → click→open 미검증.
 *     - 행위 spec이 머지차단(test:critical=CF1~5) 밖 → 깨진 채로 머지됨.
 *
 *   ⇒ 이 게이트는 "차트오픈 행위"를 직접 클릭해 검증한다. 특히 **과거 날짜에서의 click→open**을
 *      강제해 `!isPast` 게이트가 살아나면(=6/6 회귀 재발) RED로 트립한다.
 *      (과거날짜 click→open = stale-date 자정 시나리오와 동일 코드경로의 결정적 프록시.)
 *
 * 역회귀 증명(이 게이트의 존재 이유):
 *   L6160 을 `onCardClick={!isPast ? handleCardClick : undefined}` +
 *   L6162 `onReservationSelect={!isPast ? handleReservationSelect : undefined}` 로 되돌리면
 *   G3/G4(과거날짜 click→open)가 즉시 RED. 현행(게이트 제거) 코드에선 GREEN.
 *
 * 편입(머지차단 활성화)은 supervisor GO 후:
 *   `npm run test:chart-gate` 를 ci:push / ci-push.yml job 으로 추가.
 *   (활성화 전까지 이 폴더는 critical-flow 밖이라 자동 머지차단되지 않는다.)
 *
 * 시드: service_role + [QA-FIXTURE] 마커. 각 테스트는 자기 row만 생성/삭제(try/finally).
 * db_change=false (스키마 변경 없음 — 테스트 데이터 임시 INSERT/DELETE 뿐).
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../../helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(__dirname, '../../../src/pages/Dashboard.tsx');

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE]';

let _sb: SupabaseClient | null = null;
const svc = (): SupabaseClient => (_sb ??= createClient(SUPA_URL, SERVICE_KEY));

// ── 날짜 헬퍼 (브라우저=노드 동일 TZ 가정 — CI 단일 머신) ─────────────────────
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const TODAY = localDateStr();
const YESTERDAY = localDateStr(new Date(Date.now() - 86_400_000));

// ── 시드 ─────────────────────────────────────────────────────────────────────
async function seedCustomer(name: string, visitType: 'new' | 'returning' = 'new'): Promise<string> {
  const ts = Date.now();
  const phone = `010${String(ts).slice(-8)}`;
  const { data, error } = await svc()
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: visitType, memo: MARKER })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedCustomer failed: ${error?.message}`);
  return data.id as string;
}

async function seedReservation(opts: {
  date: string;
  time: string; // 'HH:MM'
  visit_type: 'new' | 'returning';
  customerId: string | null;
  name: string;
}): Promise<string> {
  const { data, error } = await svc()
    .from('reservations')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: opts.customerId,
      customer_name: opts.name,
      reservation_date: opts.date,
      reservation_time: `${opts.time}:00`,
      visit_type: opts.visit_type,
      status: 'confirmed',
      memo: MARKER,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedReservation failed: ${error?.message}`);
  return data.id as string;
}

async function seedActiveCheckIn(opts: {
  name: string;
  visit_type: 'new' | 'returning';
  status: string;
}): Promise<{ checkInId: string; customerId: string }> {
  const customerId = await seedCustomer(opts.name, opts.visit_type);
  const ts = Date.now();
  const { data, error } = await svc()
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customerId,
      customer_name: opts.name,
      customer_phone: `010${String(ts).slice(-8)}`,
      visit_type: opts.visit_type,
      status: opts.status,
      queue_number: 970 + (ts % 20),
      checked_in_at: new Date().toISOString(),
      notes: MARKER,
    })
    .select('id')
    .single();
  if (error || !data) {
    await svc().from('customers').delete().eq('id', customerId);
    throw new Error(`seedActiveCheckIn failed: ${error?.message}`);
  }
  return { checkInId: data.id as string, customerId };
}

async function deleteReservation(id: string) {
  await svc().from('reservation_logs').delete().eq('reservation_id', id);
  await svc().from('reservations').delete().eq('id', id);
}
async function deleteCustomer(id: string) {
  await svc().from('check_ins').delete().eq('customer_id', id);
  await svc().from('customers').delete().eq('id', id);
}

// ── 차트 오픈 대기 (chart-info-panel | SMART DOCTOR | 로딩) ────────────────────
async function waitForChartOpen(page: import('@playwright/test').Page, timeout = 9000): Promise<boolean> {
  return Promise.race([
    page.locator('[data-testid="chart-info-panel"]').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('SMART DOCTOR — 고객정보').waitFor({ state: 'visible', timeout }).then(() => true),
    page.getByText('불러오는 중').first().waitFor({ state: 'visible', timeout }).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeout + 100)),
  ]);
}

async function gotoDashboard(page: import('@playwright/test').Page) {
  const ok = await loginAndWaitForDashboard(page);
  expect(ok, '대시보드 진입(로그인) 실패 — 게이트 실행 전제 미충족').toBe(true);
  await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });
}

const UNIQ = () => `gate-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// ════════════════════════════════════════════════════════════════════════════
// G1 — 칸반 활성 카드 click → 차트 오픈 (today)  [기준선: 항상 GREEN]
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G1 칸반 click→open', () => {
  test('G1: 초진대기(exam_waiting) 칸반 카드 클릭 → 차트 오픈', async ({ page }) => {
    const name = UNIQ();
    const { checkInId, customerId } = await seedActiveCheckIn({ name, visit_type: 'new', status: 'exam_waiting' });
    try {
      await gotoDashboard(page);
      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`);
      await card.waitFor({ state: 'visible', timeout: 12000 });
      await card.click();
      const opened = await waitForChartOpen(page);
      expect(opened, '칸반 카드 클릭 후 차트가 열려야 함(차트오픈 1급 경로)').toBe(true);
    } finally {
      await deleteCustomer(customerId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — 타임라인 초진(box1) click → 차트 오픈 (today)
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G2 타임라인 초진(box1) click→open (today)', () => {
  test('G2: 오늘 초진 예약 카드 클릭 → 차트 오픈', async ({ page }) => {
    const name = UNIQ();
    const customerId = await seedCustomer(name, 'new');
    const resvId = await seedReservation({ date: TODAY, time: '14:00', visit_type: 'new', customerId, name });
    try {
      await gotoDashboard(page);
      const card = page.locator('[data-testid="box1-resv-card"]', { hasText: name });
      await card.first().waitFor({ state: 'visible', timeout: 12000 });
      await card.first().click();
      const opened = await waitForChartOpen(page);
      expect(opened, '오늘 타임라인 초진 카드 클릭 후 차트가 열려야 함').toBe(true);
    } finally {
      await deleteReservation(resvId);
      await deleteCustomer(customerId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — 타임라인 초진(box1) "과거 날짜" click → 차트 오픈  ★역회귀 RED 트립 게이트★
//   stale-date(자정 롤오버) 시나리오와 동일 코드경로(!isPast).
//   회귀(onReservationSelect={!isPast ? ... : undefined})면 과거날짜 onSelect=undefined → 클릭 사망 → RED.
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G3 타임라인 초진 과거날짜 click→open [역회귀 게이트]', () => {
  test('G3: 어제 초진 예약 카드 클릭 → 차트 오픈 (read-only 무관)', async ({ page }) => {
    const name = UNIQ();
    const customerId = await seedCustomer(name, 'new');
    const resvId = await seedReservation({ date: YESTERDAY, time: '14:00', visit_type: 'new', customerId, name });
    try {
      await gotoDashboard(page);
      // 어제로 이동 (수동 네비 = pin → 자동 롤오버 영향 없음)
      await page.getByTestId('dash-date-prev').click();
      // 과거 날짜 read-only 배너가 떠도 차트 열람(read)은 가능해야 한다.
      const card = page.locator('[data-testid="box1-resv-card"]', { hasText: name });
      await card.first().waitFor({ state: 'visible', timeout: 12000 });
      await card.first().click();
      const opened = await waitForChartOpen(page);
      expect(
        opened,
        '과거 날짜에서도 차트(read-only)는 열려야 함. RED면 onReservationSelect에 !isPast 게이트 재발(6/6 회귀).',
      ).toBe(true);
    } finally {
      await deleteReservation(resvId);
      await deleteCustomer(customerId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — 타임라인 재진(box2) "과거 날짜" click → 차트 오픈  ★역회귀 RED 트립 게이트★
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G4 타임라인 재진 과거날짜 click→open [역회귀 게이트]', () => {
  test('G4: 어제 재진 예약 카드 클릭 → 차트 오픈', async ({ page }) => {
    const name = UNIQ();
    const customerId = await seedCustomer(name, 'returning');
    const resvId = await seedReservation({ date: YESTERDAY, time: '15:00', visit_type: 'returning', customerId, name });
    try {
      await gotoDashboard(page);
      await page.getByTestId('dash-date-prev').click();
      const card = page.locator('[data-testid="box2-resv-card"]', { hasText: name });
      await card.first().waitFor({ state: 'visible', timeout: 12000 });
      await card.first().click();
      const opened = await waitForChartOpen(page);
      expect(opened, '과거 날짜 재진 카드 클릭 후 차트가 열려야 함(RED면 !isPast 게이트 재발)').toBe(true);
    } finally {
      await deleteReservation(resvId);
      await deleteCustomer(customerId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — 아코디언 명단 이름 fallback (customer_id=null) click → 차트 오픈 (today)
//   field-soak 하드닝 경로: 고객 미연결 초진 명단도 이름 fallback 으로 열려야 한다.
//   1차 핫픽스 회귀(canOpen=customerId only)면 이름-only 항목 비활성 → 클릭 사망 → RED.
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G5 아코디언 명단 이름 fallback click→open', () => {
  test('G5: customer_id=null 초진 명단 이름 클릭 → 이름 fallback 차트 오픈', async ({ page }) => {
    const name = UNIQ();
    // 차트가 실제로 열리려면 동일 클리닉·동명 고객 1건이 존재해야 한다(handleNameChartOpen fallback).
    const customerId = await seedCustomer(name, 'new');
    // 예약은 customer_id=null (고객 미연결 초진) — 명단엔 이름만 노출.
    const resvId = await seedReservation({ date: TODAY, time: '16:00', visit_type: 'new', customerId: null, name });
    try {
      await gotoDashboard(page);
      // 16:00 슬롯 아코디언 펼치기
      const slotBtn = page.getByTestId('timeline-slot-time-16:00');
      await slotBtn.waitFor({ state: 'visible', timeout: 12000 });
      await slotBtn.click();
      const nameRow = page.locator('[data-testid="timeline-accordion-name"]', { hasText: name });
      await nameRow.first().waitFor({ state: 'visible', timeout: 8000 });
      // 이름-only 항목도 클릭 활성(data-can-open=true)이어야 한다.
      await expect(nameRow.first()).toHaveAttribute('data-can-open', 'true');
      await nameRow.first().click();
      const opened = await waitForChartOpen(page);
      expect(
        opened,
        '고객 미연결(customer_id=null) 초진 명단 이름 클릭 → 이름 fallback 으로 차트가 열려야 함',
      ).toBe(true);
    } finally {
      await deleteReservation(resvId);
      await deleteCustomer(customerId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G6 — 정적 가드: 자정 롤오버 + 타임라인 무조건 배선 (행위 게이트 보강)
//   행위 테스트(G3/G4)가 빈 DB·시드실패로 비활성화돼도, 회귀 라인 자체를 정적으로도 잠근다.
// ════════════════════════════════════════════════════════════════════════════
test.describe('CHART-OPEN-GATE · G6 정적 회귀 라인 락', () => {
  function readDash(): string { return fs.readFileSync(DASH, 'utf-8'); }

  test('G6-1: 타임라인 onCardClick/onReservationSelect 무조건 배선(!isPast 게이트 부재)', () => {
    const src = readDash();
    expect(src).not.toContain('onCardClick={!isPast ? handleCardClick : undefined}');
    expect(src).not.toContain('onReservationSelect={!isPast ? handleReservationSelect : undefined}');
    expect(src).toContain('onCardClick={handleCardClick}');
    expect(src).toContain('onReservationSelect={handleReservationSelect}');
  });

  test('G6-2: stale date 자정 롤오버(dateUserPinnedRef + isSameDay) 존재', () => {
    const src = readDash();
    expect(src).toContain('dateUserPinnedRef');
    expect(src).toMatch(/if \(dateUserPinnedRef\.current\) return;/);
    expect(src).toMatch(/setDate\(\(d\) => \(isSameDay\(d, today\) \? d : today\)\)/);
  });

  test('G6-3: 아코디언 명단 canOpen 이 이름 fallback 포함(customer_id-only 회귀 부재)', () => {
    const src = readDash();
    expect(src).toMatch(/const canOpen = Boolean\(\(item\.customerId \|\| item\.name\) && onNameOpen\)/);
    expect(src).not.toContain('const canOpen = Boolean(item.customerId && onNameOpen)');
  });
});
