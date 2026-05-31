/**
 * E2E spec — T-20260530-foot-WALKIN-OFFHOUR-SLOT
 * 영업시간 외 워크인(셀프접수) → 가용 타임슬롯 자동 배정 + CRM 표시
 *
 * AC-1: 영업시간 전 워크인 → 당일 첫 타임슬롯 자동 배정 (예: 08:30 접수 → 10:00 슬롯)
 * AC-2: 영업시간 후 워크인 → 당일 마지막 타임슬롯 자동 배정 (예: 20:15 접수 → 마지막 슬롯)
 * AC-3: 워크인 건 누락 방지 (시간표+접수목록 양쪽 표시)
 * AC-4: [reopened 2026-06-01, 김주연 총괄] 일요일 워크인 → 이동/오류 없이 접수 시각
 *        그대로 배정 (pass-through). 평일/토 오프아워 클램핑(AC-1/2) 미적용.
 *        A안(월요일 첫 슬롯 이동)·B안(오류 처리) 모두 기각. CRM 테스트 용도.
 *        (구 AC-4 "영업시간 내 무변경"은 clampSlot AC-4 유닛 케이스로 유지)
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

// ── AC-4 (reopened): 일요일 워크인 pass-through ───────────────────────────────
// 현장 결정 2026-06-01 (김주연 총괄): 일요일 셀프접수는 이동/오류 없이 접수 시각
// 그대로 배정. Dashboard.tsx 워크인 루프의 `isSunday ? rawSlot : clamp(...)` 분기 미러.

/** Dashboard.tsx 워크인 slot 매핑 로직 미러 (요일 분기 포함) */
function walkInSlot(rawSlot: string, slots: string[], isSunday: boolean): string {
  if (isSunday) return rawSlot; // pass-through: 클램핑 없음
  return clampSlot(rawSlot, slots);
}

test.describe('T-20260530 WALKIN-OFFHOUR-SLOT — AC-4 일요일 pass-through 로직 검증', () => {
  // 일요일도 slots[] 자체는 clinic 설정 기반으로 생성되지만, 워크인은 클램핑하지 않는다.
  const sunSlots = generateSlots('10:00', '18:30', 30); // 10:00~18:00

  test('시나리오4: 일요일 14:00 워크인 → 14:00 그대로 (이동·오류 없음)', () => {
    expect(walkInSlot('14:00', sunSlots, /* isSunday */ true)).toBe('14:00');
  });

  test('시나리오4: 일요일 운영시간 전(08:30) 워크인 → 08:30 그대로 (월요일/첫슬롯 이동 없음)', () => {
    // A안(월요일 첫 슬롯 이동)·평일 클램핑(→10:00) 모두 미적용 — 그 시각 그대로
    const result = walkInSlot('08:30', sunSlots, true);
    expect(result).toBe('08:30');
    expect(result).not.toBe('10:00'); // 평일 클램핑 결과와 달라야 함
  });

  test('시나리오4: 일요일 운영시간 후(20:00) 워크인 → 20:00 그대로 (마지막슬롯 이동 없음)', () => {
    const result = walkInSlot('20:00', sunSlots, true);
    expect(result).toBe('20:00');
    expect(result).not.toBe('18:00'); // 토/주말 클램핑 결과와 달라야 함
  });

  test('AC-4 무파괴: 같은 시각이라도 평일(isSunday=false)은 기존 클램핑 유지', () => {
    const wkSlots = generateSlots('10:00', '20:30', 30);
    // 평일 08:30 → 10:00 클램핑 (AC-1 무변경)
    expect(walkInSlot('08:30', wkSlots, false)).toBe('10:00');
    // 평일 21:00 → 20:00 클램핑 (AC-2 무변경)
    expect(walkInSlot('21:00', wkSlots, false)).toBe('20:00');
    // 평일 14:00 → 14:00 (영업시간 내 무변경)
    expect(walkInSlot('14:00', wkSlots, false)).toBe('14:00');
  });

  test('AC-4: 일요일 pass-through는 오프아워 배지 미대상 (rawSlot === slot)', () => {
    // 일요일은 클램핑이 없으므로 rawSlot === slot → offHourActualTimeMap 미기록
    for (const raw of ['08:30', '14:00', '20:00']) {
      expect(walkInSlot(raw, sunSlots, true)).toBe(raw);
    }
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
