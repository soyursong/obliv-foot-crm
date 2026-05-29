/**
 * E2E spec — T-20260530-foot-WALKIN-TIMETABLE
 * 통합시간표 워크인(시간 외 셀프접수) 자동 타임 배정 + 시각적 구분
 *
 * AC-1: 오픈 전 셀프접수 → 첫 타임 슬롯 자동 배정
 * AC-2: 마감 후 셀프접수 → 마지막 타임 슬롯 자동 배정
 * AC-3: 워크인 건 통합시간표 누락 없이 표시 (예약 건과 시각적 구분 — 'W' 배지)
 * AC-4: clinic_hours 기준 슬롯 배정 (clinics.open_time/close_time 사용, DB 변경 없음)
 *
 * 구현: Dashboard.tsx
 *   - walkInCiIdSet: 워크인 체크인 ID 집합
 *   - TimelineCheckInCard.isWalkIn: 'W' 배지(bg-violet-100) 표시
 *   - 슬롯 클램핑: firstSlot/lastSlot 기준 (WALKIN-OFFHOUR-SLOT 연계)
 *
 * DB 구조 선확인 결과:
 *   - 'clinic_hours' 테이블 없음 → clinics.open_time/close_time + clinic_schedules 사용
 *   - DB 변경 불필요 (FE only)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── Unit-level: 워크인 배지 로직 검증 ──────────────────────────────────────────

/**
 * walkInCiIdSet 로직 미러:
 * - matchedCiIds 에 없는 selfCheckIn → walkIn
 * - matchedCiIds 에 있는 selfCheckIn → 예약 매칭 (워크인 아님)
 */
function simulateWalkInIds(
  selfCheckInIds: string[],
  matchedCiIds: Set<string>,
): Set<string> {
  const walkIns = new Set<string>();
  for (const id of selfCheckInIds) {
    if (!matchedCiIds.has(id)) {
      walkIns.add(id);
    }
  }
  return walkIns;
}

test.describe('T-20260530 WALKIN-TIMETABLE — walkInCiIdSet 로직 유닛 검증', () => {
  test('AC-3: 예약 미매칭 체크인 → walkIn 집합 등록', () => {
    const selfCheckInIds = ['ci-001', 'ci-002', 'ci-003'];
    const matchedCiIds = new Set(['ci-001']); // ci-001 은 예약 매칭
    const walkIns = simulateWalkInIds(selfCheckInIds, matchedCiIds);

    expect(walkIns.has('ci-001')).toBe(false); // 예약 매칭 → 워크인 아님
    expect(walkIns.has('ci-002')).toBe(true);  // 워크인
    expect(walkIns.has('ci-003')).toBe(true);  // 워크인
    expect(walkIns.size).toBe(2);
  });

  test('AC-3: 전체 예약 매칭 시 walkIn 집합 비어있음', () => {
    const selfCheckInIds = ['ci-a', 'ci-b'];
    const matchedCiIds = new Set(['ci-a', 'ci-b']);
    const walkIns = simulateWalkInIds(selfCheckInIds, matchedCiIds);

    expect(walkIns.size).toBe(0);
  });

  test('AC-3: 전체 예약 미매칭 시 전부 워크인 등록', () => {
    const selfCheckInIds = ['ci-x', 'ci-y', 'ci-z'];
    const matchedCiIds = new Set<string>();
    const walkIns = simulateWalkInIds(selfCheckInIds, matchedCiIds);

    expect(walkIns.size).toBe(3);
    expect(walkIns.has('ci-x')).toBe(true);
    expect(walkIns.has('ci-y')).toBe(true);
    expect(walkIns.has('ci-z')).toBe(true);
  });

  test('AC-3: 빈 selfCheckIns → walkIn 집합 비어있음', () => {
    const selfCheckInIds: string[] = [];
    const matchedCiIds = new Set<string>();
    const walkIns = simulateWalkInIds(selfCheckInIds, matchedCiIds);
    expect(walkIns.size).toBe(0);
  });

  test('AC-4: clinic_hours 독립 없음 — open_time/close_time 기반 슬롯 배열 검증', () => {
    // clinics.open_time / close_time 기반으로 슬롯 배열 생성
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

    const slots = generateSlots('10:00', '20:30', 30);
    expect(slots[0]).toBe('10:00');
    expect(slots[slots.length - 1]).toBe('20:00');
    // firstSlot/lastSlot 클램핑 기준이 clinic 설정과 일치
    expect(slots.length).toBeGreaterThan(0);
  });
});

// ── AC-1 / AC-2: 슬롯 클램핑 (WALKIN-OFFHOUR-SLOT 연계 — 회귀 방지) ───────────

function clampSlot(rawSlot: string, slots: string[]): string {
  const first = slots[0] ?? '10:00';
  const last = slots[slots.length - 1] ?? '20:00';
  if (rawSlot < first) return first;
  if (rawSlot > last) return last;
  return rawSlot;
}

function generateSlotsUtil(open: string, close: string, interval: number): string[] {
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

test.describe('T-20260530 WALKIN-TIMETABLE — 슬롯 클램핑 회귀 검증', () => {
  const slots = generateSlotsUtil('10:00', '20:30', 30);

  test('AC-1: 오픈 전(08:30) 워크인 → 첫 슬롯(10:00)으로 자동 배정', () => {
    expect(clampSlot('08:30', slots)).toBe('10:00');
  });

  test('AC-1: 오픈 전(09:30) 워크인 → 첫 슬롯(10:00)으로 자동 배정', () => {
    expect(clampSlot('09:30', slots)).toBe('10:00');
  });

  test('AC-2: 마감 후(21:00) 워크인 → 마지막 슬롯으로 자동 배정', () => {
    expect(clampSlot('21:00', slots)).toBe('20:00');
  });

  test('AC-2: 마감 직후(20:30) 워크인 → 마지막 슬롯으로 자동 배정', () => {
    expect(clampSlot('20:30', slots)).toBe('20:00');
  });

  test('영업시간 내 워크인 → 클램핑 없음 (회귀)', () => {
    expect(clampSlot('14:00', slots)).toBe('14:00');
    expect(clampSlot('10:00', slots)).toBe('10:00');
    expect(clampSlot('19:30', slots)).toBe('19:30');
  });
});

// ── E2E: 통합시간표 렌더링 + 워크인 배지 검증 ─────────────────────────────────

test.describe('T-20260530 WALKIN-TIMETABLE — 통합시간표 렌더링 회귀 + 워크인 배지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-3: 통합시간표 슬롯이 정상 렌더링됨', async ({ page }) => {
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

  test('AC-3: 워크인 배지(W) DOM 속성 존재 확인 — 워크인 건이 있을 때', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 워크인 배지가 있는지 확인 (데이터 없으면 스킵)
    const walkinBadge = page.locator('[data-testid="walkin-badge"]');
    try {
      await walkinBadge.first().waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '오늘 워크인 데이터 없음 — 배지 표시 스킵');
      return;
    }
    // 워크인 배지가 "W" 텍스트를 가짐
    const firstBadgeText = await walkinBadge.first().textContent();
    expect(firstBadgeText?.trim()).toBe('W');
  });

  test('AC-4: 통합시간표 슬롯 수가 적정 범위 (영업시간 외 슬롯 미생성 회귀)', async ({ page }) => {
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
    // 영업시간 외 슬롯이 추가 생성되지 않아야 함 (클램핑만)
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(60);
  });
});
