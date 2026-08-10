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
import { runMarker } from '../../fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(__dirname, '../../../src/pages/Dashboard.tsx');

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
// T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN: bare '[QA-FIXTURE]' 대신 run-scoped
//   마커(`[QA-FIXTURE]|<token>|<ts>`)를 쓴다 → 동시 CI run 의 cleanupAll() bare-exact 전수
//   스윕이 이 run 의 G3/G4 in-flight 시드를 지우지 못한다(cross-run cleanup race 원천 차단).
//   scoped row 정리는 globalTeardown/globalSetup 의 sweepScoped(fixtures)가 담당.

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
  const phone = `DUMMY-${ts}`;
  const { data, error } = await svc()
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: visitType, memo: runMarker() })
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
      memo: runMarker(),
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
      customer_phone: `DUMMY-${ts}`,
      visit_type: opts.visit_type,
      status: opts.status,
      queue_number: 970 + (ts % 20),
      checked_in_at: new Date().toISOString(),
      notes: runMarker(),
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

// 과거날짜(어제) 로 "1일 뒤로" 이동 — 수동 네비(pin)라 자동 롤오버 영향 없음.
async function navigatePrevDay(page: import('@playwright/test').Page) {
  await page.getByTestId('dash-date-prev').click();
  // 과거날짜 read-only 진입 확인(전일 fetch 트리거). 배너 미도달은 카드 waitFor 가 흡수.
  await page
    .getByText('과거 날짜 조회 중')
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {});
}

// 카드 미render 시 fresh 재조회: reload → 대시보드 재진입(세션 storageState 유지) → 어제 재이동.
// reload 로 과거날짜 초기 fetch 를 새로 돌려 seed commit/realtime-merge 레이스로 누락된 row 를 편입.
async function renavigateToYesterday(page: import('@playwright/test').Page) {
  await page.reload();
  await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });
  await navigatePrevDay(page);
}

// ── 자동 노쇼 가드 (G3/G4 결정성) ──────────────────────────────────────────────
// 과거 confirmed 예약은 예약관리(Reservations.tsx) auto-noshow + realtime 으로
// noshow 전환될 수 있다(라이브 prod 동시 클라이언트/리얼타임 트리거). noshow 예약은
// 타임라인에서 제외(Dashboard L1875)되어 box1/box2-resv-card 가 렌더되지 않는다.
// → 시드 row 가 noshow 로 뒤집힌 경우는 "환경(시드 무력화)"이며 회귀가 아니다.
//   이 회귀 라인(!isPast 게이트)은 G6 정적 가드가 하드락하므로, 여기선 skip 처리해
//   거짓 RED 를 만들지 않는다. confirmed 유지 상태에서 카드가 안 뜨면 진짜 실패.
async function resvStatus(id: string): Promise<string | null> {
  const { data } = await svc().from('reservations').select('status').eq('id', id).single();
  return (data?.status as string | undefined) ?? null;
}

// waitFor(visible) + click 을 한 try 로 감싼다.
// 과거 confirmed 예약은 auto-noshow 배치(Reservations.tsx L918: status='no_show')로
// 언제든 타임라인에서 사라질 수 있고, 그 소멸은 waitFor 직후·click 직전에도 일어난다
// (라이브 shared-DB 동시 클라이언트/CI 병렬 job). 따라서 click 도 가드 안에 둬야
// "waitFor 통과 → click 소멸 타임아웃" 하드 RED(가드 사각) 를 막을 수 있다.
// 진짜 status enum 은 'no_show'(underscore) — 과거 'noshow' 비교는 skip 이 절대 안 걸려
// auto-noshow 로 무력화된 시드가 거짓 RED 를 냈다(T-20260713-foot-CI-E2E-RED-DIAGNOSE).
async function clickPastCardOrSkipOnAutoNoshow(
  page: import('@playwright/test').Page,
  cardLocator: import('@playwright/test').Locator,
  resvId: string,
  // 카드 부재 시 "fresh 재조회"(page reload → 과거날짜 재이동) 콜백.
  // 왜 필요한가 (T-20260720-meta-RED-CI-DEPLOY-BLOCK-GATE, run 31346287639 trace RCA):
  //   G4 시드 row 는 커밋(status=confirmed)됐고 클라이언트도 realtime payload 로 수신했는데
  //   box2 카드가 40s 예산 내내 미render 했다. 원인 = 과거날짜 초기 "1-shot 전일 fetch"가
  //   seed commit / realtime-merge 와 레이스한 heavy 공유 prod day(초진 52·재진 7) 상황.
  //   기존 재시도 루프는 DOM 을 재해석(relocate)만 하고 재fetch 를 안 해서, 초기 fetch 가
  //   놓친 row 는 아무리 기다려도 타임라인에 편입되지 않았다(realtime insert 미merge).
  //   → reload 후 과거날짜를 다시 조회하면 커밋된 row 가 확정 포함된 fresh full-day fetch 가
  //     돈다. click→open 행위 검증(클릭+차트오픈)은 그대로라 진짜 회귀는 여전히 RED 로 트립.
  renavigate?: () => Promise<void>,
): Promise<void> {
  // ── dnd-kit detach 레이스 흡수: 재로케이트 재시도 루프 ──────────────────────
  // box2-resv-card(재진)는 dnd-kit draggable 이다(aria-roledescription="draggable").
  // 과거날짜 타임라인의 초기 데이터 로드/리얼타임 패치가 카드 리스트를 재렌더하면 그
  // DOM 노드가 waitFor 통과 직후·click 직전에 detach 된다("element was detached from the
  // DOM"). 단발 waitFor+click 은 이 순간과 겹치면 10s tight-timeout 으로 flaky RED 를
  // 냈다(T-20260720-meta-RED-CI-DEPLOY-BLOCK-GATE: G4 만 detach 로 RED, 직전 커밋은 GREEN,
  // 문제 커밋은 read-only diag 로 앱코드 무변경 → 순수 flakiness 확증).
  // → (visible 대기 → click) 한 사이클을 매번 locator 재해석하며 예산 소진까지 재시도한다.
  //   각 시도가 노드를 새로 잡으므로 detach 된 stale 핸들을 물지 않는다. 총 예산은
  //   test-timeout(60s) 안에서 콜드스타트+과거날짜 재조회+재시도를 흡수하도록 40s.
  const budgetDeadline = Date.now() + 40000;
  let lastErr: unknown = null;
  while (Date.now() < budgetDeadline) {
    try {
      // 15s: Vite cold-start(첫 페이지 로드 컴파일) + 과거날짜 재조회 지연 흡수.
      await cardLocator.first().waitFor({ state: 'visible', timeout: 15000 });
      await cardLocator.first().click({ timeout: 8000 });
      return; // 카드 렌더+클릭 성공 → 정상 행위 검증 진행
    } catch (e) {
      lastErr = e;
      const status = await resvStatus(resvId);
      // 카드 소멸의 "환경(시드 무력화)" 원인 2종은 거짓 RED 가 아니다 → skip(조건참이면 즉시 skip throw):
      //   (1) status='no_show' : 과거 confirmed 예약이 auto-noshow 배치(Reservations.tsx L948)로 전환.
      //   (2) status=null      : 시드 row 소멸. (구)dev=prod 단일 Supabase(rxlomoozakkjesdqjtvd)에서 동시 실행
      //        중인 다른 CI run 의 cleanupAll() bare 마커 전수 DELETE 가 이 run 의 시드까지 휩쓴 cross-run
      //        sweep race 였다(T-20260720-meta-RED-CI-DEPLOY-BLOCK-GATE).
      //        → T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN 이 시드를 run-scoped 마커
      //          (`[QA-FIXTURE]|<token>|<ts>`)로 격리해 **이 원인은 구조적으로 제거**됐다(bare-exact 스윕이
      //          scoped row 를 못 잡음). 그럼에도 극히 드문 잔여(예: 수동 정리)까지 거짓 RED 로 두지 않으려
      //          이 skip 은 belt-and-suspenders 로 유지한다. row 부재 = 환경이지 회귀가 아니다.
      //   두 경우 모두 회귀 라인(!isPast)은 G6 정적 가드가 하드락하므로 거짓 RED 를 방지하려 skip 한다.
      test.skip(
        status === 'no_show' || status === null,
        `과거 예약 시드가 환경적으로 무력화됨(status=${status}) — auto-noshow 전환(no_show) 또는 ` +
          `동시 run 의 QA-FIXTURE 전수 스윕으로 시드 소멸(null). ` +
          `!isPast 회귀 라인은 G6 정적 가드가 하드락하므로 거짓 RED 방지 위해 skip.`,
      );
      // 시드 유효(status='confirmed')인데 카드 미render:
      //   (a) 초기 전일 fetch 가 seed commit/realtime-merge 와 레이스 → reload 후 과거날짜 재조회로
      //       커밋된 row 를 확정 편입(fresh full-day fetch).
      //   (b) dnd-kit detach 레이스 → reload 는 이 또한 흡수(재렌더된 안정 DOM 을 새로 잡음).
      //   콜백 미제공(레거시 호출부) 시에는 종전대로 짧게 backoff 후 relocate 재시도.
      if (renavigate) {
        try {
          await renavigate();
        } catch {
          // reload/재이동 순간의 일시적 오류(네비 in-flight 등)는 다음 cycle 에서 재시도.
          await page.waitForTimeout(1000);
        }
      } else {
        await page.waitForTimeout(1000);
      }
    }
  }
  // 예산 소진: 시드 유효(confirmed)인데도 카드 렌더/클릭이 끝내 실패 → 진짜 회귀/렌더 실패 → 원래 오류 전파.
  throw lastErr ?? new Error('past card click 재시도 예산(40s) 소진 — 카드 렌더/클릭 실패');
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
      // 20s: Vite cold-start(첫 실행 카드 렌더 16s 관측) 흡수 — QA#3 flaky RED 방지.
      await card.waitFor({ state: 'visible', timeout: 20000 });
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
    // 콜드스타트 + 카드 미render 시 reload 재조회 1 cycle(≈reload 8s + waitFor)를 60s 안에
    // 흡수하도록 헤드룸 확보. 정상경로(즉시 render)는 조기 종료라 영향 없음.
    test.setTimeout(90_000);
    const name = UNIQ();
    const customerId = await seedCustomer(name, 'new');
    const resvId = await seedReservation({ date: YESTERDAY, time: '14:00', visit_type: 'new', customerId, name });
    try {
      await gotoDashboard(page);
      // 어제로 이동 (수동 네비 = pin → 자동 롤오버 영향 없음)
      await navigatePrevDay(page);
      // 과거 날짜 read-only 배너가 떠도 차트 열람(read)은 가능해야 한다.
      const card = page.locator('[data-testid="box1-resv-card"]', { hasText: name });
      await clickPastCardOrSkipOnAutoNoshow(page, card, resvId, () => renavigateToYesterday(page));
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
    // 콜드스타트 + 카드 미render 시 reload 재조회 1 cycle(≈reload 8s + waitFor)를 60s 안에
    // 흡수하도록 헤드룸 확보. 정상경로(즉시 render)는 조기 종료라 영향 없음.
    test.setTimeout(90_000);
    const name = UNIQ();
    const customerId = await seedCustomer(name, 'returning');
    const resvId = await seedReservation({ date: YESTERDAY, time: '15:00', visit_type: 'returning', customerId, name });
    try {
      await gotoDashboard(page);
      await navigatePrevDay(page);
      const card = page.locator('[data-testid="box2-resv-card"]', { hasText: name });
      await clickPastCardOrSkipOnAutoNoshow(page, card, resvId, () => renavigateToYesterday(page));
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
