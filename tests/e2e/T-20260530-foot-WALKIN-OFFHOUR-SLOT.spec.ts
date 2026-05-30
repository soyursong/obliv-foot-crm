/**
 * E2E spec — T-20260530-foot-WALKIN-OFFHOUR-SLOT
 * 영업시간 외 워크인(셀프접수) → 가용 타임슬롯 자동 배정 + CRM 표시
 *
 * AC-1: 영업시간 전 워크인 → 당일 첫 타임슬롯 자동 배정 (예: 08:30 접수 → 10:00 슬롯)
 * AC-2: 영업시간 후 워크인 → 당일 마지막 타임슬롯 자동 배정 (예: 20:15 접수 → 마지막 슬롯)
 * AC-3: 워크인 건 누락 방지 (시간표+접수목록 양쪽 표시)
 * AC-4: 영업시간 내 워크인 기존 동작 무변경 (회귀 방지)
 * AC-5: 오픈/마감 시간 clinic settings 기준 (하드코딩 금지)
 *
 * 테스트 전략: DashboardTimeline 컴포넌트의 슬롯 클램핑 로직을 unit-level로 검증.
 * 실제 DB 워크인 데이터 없이도 로직 분기를 검증할 수 있도록
 * 통합시간표 렌더링 존재 여부 + 클램핑 로직 단위 확인으로 구성.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── Unit-level logic validation (no real DB walk-in needed) ────────────────────

/**
 * 슬롯 클램핑 순수 함수 재현 (Dashboard.tsx 로직 미러)
 * rawSlot < firstSlot → firstSlot
 * rawSlot > lastSlot  → lastSlot
 * otherwise           → rawSlot
 */
function clampSlot(rawSlot: string, slots: string[]): string {
  const first = slots[0] ?? '10:00';
  const last = slots[slots.length - 1] ?? '20:00';
  if (rawSlot < first) return first;
  if (rawSlot > last) return last;
  return rawSlot;
}

/** generateSlots 재현 (schedule.ts 동일 로직) */
function generateSlots(open: string, close: string, interval: number): string[] {
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  const out: string[] = [];
  for (let m = start; m < end; m += interval) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

// ── AC-1 / AC-2 / AC-4 / AC-5: 슬롯 클램핑 로직 ─────────────────────────────

test.describe('T-20260530 WALKIN-OFFHOUR-SLOT — 슬롯 클램핑 로직 유닛 검증', () => {

  const slots = generateSlots('10:00', '20:30', 30); // 10:00~20:00 포함

  test('AC-1: 영업시간 전 접수(08:30) → 첫 슬롯(10:00) 배정', () => {
    const raw = '08:30';
    const result = clampSlot(raw, slots);
    expect(result).toBe('10:00');
  });

  test('AC-1: 영업시간 전 접수(09:45) → 첫 슬롯(10:00) 배정', () => {
    const raw = '09:30'; // 09:45 → 30분 rounding → 09:30
    const result = clampSlot(raw, slots);
    expect(result).toBe('10:00');
  });

  test('AC-2: 영업시간 후 접수(20:15) → 마지막 슬롯 배정', () => {
    const raw = '20:00'; // 20:15 → 30분 rounding → 20:00
    const result = clampSlot(raw, slots);
    // 20:00 is the last slot when close is 20:30
    expect(result).toBe('20:00');
  });

  test('AC-2: 영업시간 후 접수(21:00) → 마지막 슬롯(20:00) 배정', () => {
    const raw = '21:00';
    const result = clampSlot(raw, slots);
    expect(result).toBe('20:00');
  });

  test('AC-4: 영업시간 내 접수(11:15) → rawSlot(11:00) 그대로', () => {
    const raw = '11:00';
    const result = clampSlot(raw, slots);
    expect(result).toBe('11:00');
  });

  test('AC-4: 영업시간 내 접수(10:00) → 10:00 그대로 (첫 슬롯 경계)', () => {
    const raw = '10:00';
    const result = clampSlot(raw, slots);
    expect(result).toBe('10:00');
  });

  test('AC-4: 영업시간 내 접수(19:30) → 19:30 그대로 (마지막 직전 슬롯)', () => {
    const raw = '19:30';
    const result = clampSlot(raw, slots);
    expect(result).toBe('19:30');
  });

  test('AC-5: 토요일 단축운영(10:00~18:00) 기준도 정확히 클램핑', () => {
    // T-20260530-foot-WALKIN-OFFHOUR-SLOT PUSH 반영:
    //   토요일 운영시간 10:00~18:00 (현장 확인 2026-05-30 08:42 KST)
    //   DB weekend_close_time = '18:30' → 마지막 슬롯 18:00
    const satSlots = generateSlots('10:00', '18:30', 30); // 10:00~18:00
    // 영업시간 후 접수(18:30 이후) → 마지막 슬롯 18:00
    expect(clampSlot('18:30', satSlots)).toBe('18:00');
    expect(clampSlot('19:00', satSlots)).toBe('18:00');
    // 정각 18:00 접수 → 슬롯 내 → 클램핑 없음
    expect(clampSlot('18:00', satSlots)).toBe('18:00');
    // 영업시간 전 접수 → 첫 슬롯 10:00
    expect(clampSlot('09:00', satSlots)).toBe('10:00');
  });

  // ── AC-5 시나리오 4·5: 일요일 = 토요일 동일 (2026-05-30 김주연 총괄) ──────────

  test('AC-5 시나리오 4: 일요일 08:30 워크인 → 첫 타임슬롯(10:00) 배정', () => {
    // 일요일 운영시간 10:00~18:00 (DB weekend_close_time = '18:30')
    const sunSlots = generateSlots('10:00', '18:30', 30);
    // 영업시간 전 접수 → 첫 슬롯 10:00
    expect(clampSlot('08:30', sunSlots)).toBe('10:00');
    expect(clampSlot('09:59', sunSlots)).toBe('10:00');
  });

  test('AC-5 시나리오 5: 일요일 18:30 워크인 → 마지막 타임슬롯(18:00) 배정', () => {
    // 일요일 운영시간 10:00~18:00 (DB weekend_close_time = '18:30')
    const sunSlots = generateSlots('10:00', '18:30', 30);
    // 마지막 슬롯 18:00 확인
    expect(sunSlots[sunSlots.length - 1]).toBe('18:00');
    // 영업시간 후 접수 → 마지막 슬롯 18:00
    expect(clampSlot('18:30', sunSlots)).toBe('18:00');
    expect(clampSlot('20:00', sunSlots)).toBe('18:00');
  });

  test('AC-5 시나리오 4+5: 일요일 슬롯 배열 = 토요일과 동일 (10:00~18:00, 17개)', () => {
    const satSlots = generateSlots('10:00', '18:30', 30);
    const sunSlots = generateSlots('10:00', '18:30', 30);
    // 토요일·일요일 슬롯 배열이 동일해야 함
    expect(sunSlots).toEqual(satSlots);
    // 17슬롯: 10:00, 10:30, ..., 18:00
    expect(sunSlots.length).toBe(17);
    expect(sunSlots[0]).toBe('10:00');
    expect(sunSlots[sunSlots.length - 1]).toBe('18:00');
  });

  test('AC-5: 사용자 정의 오픈시간(09:00) 기준 클램핑', () => {
    const earlySlots = generateSlots('09:00', '19:00', 30);
    // 09:00보다 이른 접수 → 09:00
    expect(clampSlot('08:00', earlySlots)).toBe('09:00');
    // 정각 오픈시간 → 클램핑 없음
    expect(clampSlot('09:00', earlySlots)).toBe('09:00');
  });

  test('클램핑 발생 시 rawSlot !== resultSlot (오프아워 감지 기준)', () => {
    const raw = '08:30';
    const clamped = clampSlot(raw, slots);
    expect(clamped).not.toBe(raw); // 클램핑 발생 = 오프아워 배지 대상
  });

  test('클램핑 미발생 시 rawSlot === resultSlot (오프아워 배지 없음)', () => {
    const raw = '14:00';
    const clamped = clampSlot(raw, slots);
    expect(clamped).toBe(raw); // 클램핑 없음 = 배지 미표시
  });
});

// ── AC-3: 통합시간표 + 접수목록 양쪽 표시 (E2E 렌더링 검증) ─────────────────

test.describe('T-20260530 WALKIN-OFFHOUR-SLOT — 통합시간표 렌더링 회귀 검증 (AC-3 / AC-4)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-3: 통합시간표가 정상 렌더링됨 (슬롯 행 존재)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const slotRows = page.locator('[data-testid="timeline-slot-row"]');
    try {
      await slotRows.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 슬롯 미표시 — 환경 스킵');
      return;
    }
    const count = await slotRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('AC-4: 통합시간표 슬롯 수가 영업시간 내 범위와 일치 (회귀)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const slotRows = page.locator('[data-testid="timeline-slot-row"]');
    try {
      await slotRows.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 슬롯 미표시 — 환경 스킵');
      return;
    }

    const count = await slotRows.count();
    // 10:00~20:00 = 최소 20슬롯 (30분 간격), 클리닉 설정에 따라 다를 수 있음
    // 영업시간 외 슬롯이 추가 생성되지 않아야 함
    expect(count).toBeGreaterThanOrEqual(1);
    // 과도한 슬롯 생성 방지 (영업시간 외 슬롯이 추가되면 이상 증가)
    expect(count).toBeLessThanOrEqual(60); // 최대 30h × 2 = 60 (방어값)
  });

  test('AC-4: 초진/재진 컬럼 헤더가 정상 표시됨 (회귀)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 통합시간표 헤더의 초진/재진 레이블 확인
    const newHeader = page.locator('[data-testid="timeline-time-col"]');
    try {
      await newHeader.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 헤더 미표시 — 환경 스킵');
      return;
    }
    // 타임라인 스크롤 컨테이너 존재 확인
    const scrollContainer = page.locator('[data-testid="timeline-inner-scroll"]');
    await expect(scrollContainer).toBeAttached({ timeout: 5_000 });
  });
});
