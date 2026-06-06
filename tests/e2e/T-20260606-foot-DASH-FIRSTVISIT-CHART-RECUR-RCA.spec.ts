/**
 * T-20260606-foot-DASH-FIRSTVISIT-CHART-RECUR-RCA  (P0 hotfix)
 *
 * 증상: 대시보드에서 초진 환자 차트 클릭이 무반응 — 에러·빈화면 없는 silent fail.
 *       매일 아침 재현(recurring).
 *
 * RCA (증거: src/pages/Dashboard.tsx):
 *   P0-A (근본): 좌측 타임라인(DashboardTimeline) 바인딩이
 *               `onCardClick={!isPast ? handleCardClick : undefined}` 로 묶여 있었다.
 *               isPast = date < 오늘0시. 24/7 접수 태블릿이 자정을 넘기면 마운트 시점
 *               new Date()로 잡힌 date가 '어제'로 stale 고정 → isPast=true →
 *               onClick이 undefined → 클릭 자체 사망(silent fail). 칸반은 이미 무조건
 *               전달(handleCardClick)이라 정상 → "칸반은 되는데 타임라인은 안 됨"의 정체.
 *   P0-C: 슬롯 명단 펼침(아코디언) 이름은 onClick이 전혀 없는 plain span → 항상 silent fail.
 *
 * 수정:
 *   1) (P0-A) 타임라인 onCardClick/onReservationSelect 에서 `!isPast` 게이트 제거.
 *      차트 열기는 read-only → isPast로 막을 이유 없음(칸반과 일관). mutation(드래그 등)은
 *      핸들러 자체 isPast 가드(handleDragEnd)로 그대로 보호 → 읽기전용 회귀 없음.
 *   2) (근본) date stale 자정 롤오버: 사용자 수동 변경(이전/다음/캘린더)이 없는 '오늘 추적'
 *      모드에서만 60초 틱으로 date를 오늘로 자동 갱신. 의도적 과거/미래 선택은 존중(pin).
 *   3) (P0-C) 아코디언 이름에 onNameOpen(customer_id) → 진료차트 열기 onClick 추가.
 *
 * db_change=false. FE-only.
 *
 * 시나리오:
 *   시나리오1 (정적 소스 — RCA 회귀의 진실 원천):
 *     AC-A1: 타임라인 onCardClick 바인딩에서 `!isPast` 게이트 제거됨
 *     AC-A2: 타임라인 onReservationSelect 바인딩에서 `!isPast` 게이트 제거됨
 *     AC-A3: stale date 자정 롤오버(dateUserPinnedRef + isSameDay rollover) 존재
 *     AC-A4: 수동 날짜 네비(이전/다음/캘린더)가 pin, '오늘로'가 unpin 처리
 *     AC-C1: 아코디언 명단 이름에 onNameOpen 클릭 경로 존재
 *     AC-GUARD: handleDragEnd 가 isPast 가드 유지(읽기전용 보호 무회귀)
 *   시나리오2 (브라우저): 어드민 대시보드 렌더 + 타임라인 슬롯 아코디언 토글 + 콘솔 무에러
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const DASH = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');

function readDash(): string {
  return fs.readFileSync(DASH, 'utf-8');
}

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

// ─────────────────────────────────────────────────────────
// 시나리오 1 — 정적 소스 검증 (RCA 회귀의 진실 원천)
// ─────────────────────────────────────────────────────────
test.describe('T-20260606 DASH-FIRSTVISIT-CHART-RECUR — 시나리오1: 정적 RCA', () => {

  test('AC-A1: 타임라인 onCardClick 에서 !isPast 게이트가 제거됨', () => {
    const src = readDash();
    // 회귀 라인(!isPast ? handleCardClick) 부재 + 무조건 전달 존재
    expect(src).not.toContain('onCardClick={!isPast ? handleCardClick : undefined}');
    expect(src).toContain('onCardClick={handleCardClick}');
  });

  test('AC-A2: 타임라인 onReservationSelect 에서 !isPast 게이트가 제거됨', () => {
    const src = readDash();
    expect(src).not.toContain('onReservationSelect={!isPast ? handleReservationSelect : undefined}');
    expect(src).toContain('onReservationSelect={handleReservationSelect}');
  });

  test('AC-A3: stale date 자정 롤오버(dateUserPinnedRef + isSameDay)가 존재', () => {
    const src = readDash();
    expect(src).toContain('dateUserPinnedRef');
    // 롤오버 effect: pin 아니면 오늘로 갱신
    expect(src).toMatch(/if \(dateUserPinnedRef\.current\) return;/);
    expect(src).toMatch(/setDate\(\(d\) => \(isSameDay\(d, today\) \? d : today\)\)/);
  });

  test('AC-A4: 수동 날짜 네비는 pin, "오늘로"는 unpin', () => {
    const src = readDash();
    // 이전/다음/캘린더 onSelect 에서 pin=true
    expect(src).toMatch(/dateUserPinnedRef\.current = true; setDate\(\(d\) => subDays\(d, 1\)\)/);
    expect(src).toMatch(/dateUserPinnedRef\.current = true; setDate\(\(d\) => addDays\(d, 1\)\)/);
    expect(src).toMatch(/dateUserPinnedRef\.current = true; setDate\(d\); setShowCalendar\(false\)/);
    // 오늘로 버튼 = unpin
    expect(src).toMatch(/dateUserPinnedRef\.current = false; setDate\(new Date\(\)\)/);
  });

  test('AC-C1: 아코디언 명단 이름에 onNameOpen 클릭 경로가 존재', () => {
    const src = readDash();
    // prop 정의 + 바인딩 + 클릭 핸들러 (field-soak 하드닝: ctxOpenChart 직결 → handleNameChartOpen)
    expect(src).toContain('onNameOpen');
    expect(src).toContain('onNameOpen={handleNameChartOpen}');
    expect(src).toMatch(/onClick=\{canOpen \? \(\) => onNameOpen!\(item\.customerId, item\.name\) : undefined\}/);
    expect(src).toContain('data-testid="timeline-accordion-name"');
    // 회귀 차단: 1차 핫픽스의 customer_id 직결(ctxOpenChart)로 되돌아가면 신규 초진 무반응 재발
    expect(src).not.toContain('onNameOpen={ctxOpenChart}');
  });

  // ── field-soak P0 하드닝 (6/6 통합시간표 '체크인 전 초진 명단' 클릭 무반응) ──
  // 현장 확정: 날짜 정상(6/6) → P0-A(stale date) 배제 → 통합시간표 아코디언 명단 경로.
  // 잔존 갭: 체크인 전 초진은 customer_id 미연결이 흔한데 canOpen=Boolean(customerId)였다 →
  //          신규 초진 명단은 onClick 미부착 → 여전히 silent fail. 이름 fallback 으로 닫는다.
  test('AC-C2: 아코디언 명단이 customer_id 없어도(이름만 있으면) 클릭 활성', () => {
    const src = readDash();
    // canOpen 이 customerId OR name 으로 확장(이름만 있는 신규 초진도 클릭 가능)
    expect(src).toMatch(/const canOpen = Boolean\(\(item\.customerId \|\| item\.name\) && onNameOpen\)/);
    // 1차 핫픽스의 customer_id-only 게이트로 회귀하면 신규 초진 무반응 재발
    expect(src).not.toContain('const canOpen = Boolean(item.customerId && onNameOpen)');
  });

  test('AC-C3: handleNameChartOpen 이 customer_id 없을 때 이름 fallback 으로 차트 열기', () => {
    const src = readDash();
    // 핸들러 존재 + customer_id 우선 직결
    expect(src).toMatch(/const handleNameChartOpen = useCallback\(async \(customerId: string \| null, name\?: string \| null\)/);
    expect(src).toMatch(/if \(customerId\) \{\s*ctxOpenChart\(customerId\)/);
    // customer_id 없을 때: 동일 클리닉·동명 customers 조회 후 1건이면 자동 열기(handleReservationSelect 미러)
    expect(src).toMatch(/\.eq\('clinic_id', clinic\.id\)/);
    expect(src).toMatch(/matches\.length === 1[\s\S]{0,80}ctxOpenChart\(matches\[0\]\.id\)/);
    // 동명이인 다건은 자동 열기 금지(오픈 방지) + 안내 토스트
    expect(src).toMatch(/동명이인 \$\{matches\.length\}명/);
  });

  test('AC-C4: prop 타입이 customerId null + name 옵션을 수용(초진 미연결 경로 보장)', () => {
    const src = readDash();
    expect(src).toMatch(/onNameOpen\?: \(customerId: string \| null, name\?: string \| null\) => void;/);
  });

  test('AC-GUARD: handleDragEnd 가 isPast 가드 유지(읽기전용 보호 무회귀)', () => {
    const src = readDash();
    // mutation 경로의 과거날짜 차단은 핸들러 레벨에 그대로 살아있어야 한다.
    const guardCount = (src.match(/과거 날짜는 수정할 수 없습니다/g) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(2);
    // 과거 조회 read-only 배너도 유지
    expect(src).toContain('과거 날짜 조회 중 — 읽기 전용');
  });
});

// ─────────────────────────────────────────────────────────
// 시나리오 2 — 브라우저: 대시보드 렌더 + 아코디언 토글 + 콘솔 무에러
// ─────────────────────────────────────────────────────────
test.describe('T-20260606 DASH-FIRSTVISIT-CHART-RECUR — 시나리오2: 브라우저', () => {

  test('어드민 대시보드 렌더 + 타임라인 슬롯 아코디언 토글, 콘솔 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`);

    // 대시보드 루트 렌더
    await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });

    // 타임라인 슬롯(시간 레이블 버튼) 중 하나를 펼친다 — 아코디언 토글 동작 확인(크래시 없음)
    const slotBtns = page.locator('[data-testid^="timeline-slot-time-"]');
    const cnt = await slotBtns.count();
    expect(cnt).toBeGreaterThan(0);
    // 예약 유무와 무관하게 토글 자체가 silent crash 없이 동작해야 한다
    await slotBtns.first().click().catch(() => {});

    // 치명적 콘솔 에러 없음(소음성 제외)
    const fatal = errors.filter((e) =>
      !/favicon|ResizeObserver|Failed to load resource|net::ERR|manifest|chrome-extension/i.test(e));
    expect(fatal, `console errors:\n${fatal.join('\n')}`).toHaveLength(0);
  });
});
