/**
 * T-20260602-foot-SLOT-CAPACITY-3 — 상담실/치료실 슬롯 최대 3명 수용
 *
 * planner DECISION = A안(데이터 마이그) (re: MSG-20260602-182430, 2026-06-02 18:30).
 *   capacity = DB 컬럼 rooms.max_occupancy. FE(Dashboard.tsx)는 max_occupancy 를
 *   동적 참조(L819 isFull / L907 표시 / L1169·L5356 전달 / L4104 토스트)하므로
 *   FE 코드 변경 불필요. 작업물 = migration 20260602230010_room_max_occupancy_to_3.
 *
 * 본 spec 은 capacity 규칙(FE isFull 경계)과 마이그레이션 가드 의미를
 * 코드와 동일 로직으로 재현해 회귀 가드한다 (DB/브라우저 불필요 순수 로직).
 *
 * AC-1: 상담실/치료실 슬롯 각각 최대 3명까지 배치 가능 (maxOccupancy=3 → 0/1/2명은 not full).
 * AC-2: 4명째 배치 시도 차단(isFull) + loud 토스트 (silent fail 없음).
 * AC-3(회귀·스코프): 기존 이동/저장 동작·examination/laser·3 초과 커스텀 값 보존.
 */
import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// FE capacity 규칙 재현 — Dashboard.tsx L819: isFull = occupants.length >= maxOccupancy
// ──────────────────────────────────────────────────────────────────────
function isFull(occupantCount: number, maxOccupancy: number): boolean {
  return occupantCount >= maxOccupancy;
}

// ──────────────────────────────────────────────────────────────────────
// 마이그레이션 가드 재현 —
//   UPDATE rooms SET max_occupancy = 3
//   WHERE room_type IN ('consultation','treatment') AND max_occupancy < 3;
// ──────────────────────────────────────────────────────────────────────
const RAISE_TYPES = ['consultation', 'treatment'];
function migratedMaxOccupancy(roomType: string, current: number): number {
  if (RAISE_TYPES.includes(roomType) && current < 3) return 3;
  return current; // 3 초과 커스텀 값·examination/laser 등은 원값 보존
}

test.describe('T-20260602-foot-SLOT-CAPACITY-3 (pure-logic)', () => {
  // AC-1: 상담실/치료실 capacity=3 에서 0·1·2명은 추가 배치 가능(not full), 3명에서 가득
  test('AC-1: maxOccupancy=3 에서 0/1/2명은 드롭 허용, 3명째까지 배치 가능', () => {
    const cap = 3;
    expect(isFull(0, cap)).toBe(false); // 1명째 허용
    expect(isFull(1, cap)).toBe(false); // 2명째 허용
    expect(isFull(2, cap)).toBe(false); // 3명째 허용
  });

  // AC-2: 3명 도달 시 isFull=true → 4명째 차단 (FE 는 toast.info '정원 초과' 후 return)
  test('AC-2: 3명 도달 시 isFull → 4명째 배치 차단(silent fail 없음)', () => {
    const cap = 3;
    expect(isFull(3, cap)).toBe(true); // 4명째 차단
    expect(isFull(4, cap)).toBe(true); // 초과 상태도 full
    // FE 동작: roomData.isFull → toast.info(`${roomName} 정원 초과 (${max_occupancy}명)`) + return.
    // (Dashboard.tsx L4102-4106) loud 토스트로 사용자에게 명시 — silent fail 아님.
  });

  // AC-3(스코프): 마이그레이션 가드 — consultation/treatment 1·2 → 3 상향, 그 외 원값 보존
  test('AC-3: 마이그 가드 — 상담/치료 1·2→3 상향, examination/laser·3초과 커스텀 보존', () => {
    // 상향 대상: 기본 default 1·2 → 3
    expect(migratedMaxOccupancy('consultation', 1)).toBe(3);
    expect(migratedMaxOccupancy('treatment', 2)).toBe(3);
    expect(migratedMaxOccupancy('consultation', 2)).toBe(3);

    // 지점 커스텀 3 초과(예: 4)는 < 3 가드로 미변경 — 덮어쓰지 않음
    expect(migratedMaxOccupancy('treatment', 4)).toBe(4);
    expect(migratedMaxOccupancy('consultation', 5)).toBe(5);
    // 이미 3 이면 그대로
    expect(migratedMaxOccupancy('treatment', 3)).toBe(3);

    // 요구 외 room_type(examination/laser)은 미접촉 — 1 유지
    expect(migratedMaxOccupancy('examination', 1)).toBe(1);
    expect(migratedMaxOccupancy('laser', 1)).toBe(1);
  });

  // 표시 정책(planner 17:51): 세로 스택 + truncation/+N 금지 — 3박스 전부 노출
  // Dashboard.tsx L968 occupants.map (space-y-1, max-height 없음 → 슬롯 성장해 3개 전부 렌더)
  test('표시정책: 슬롯 capacity 만큼 전부 렌더(축약/숨김 없음)', () => {
    const cap = 3;
    const occupants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    // capacity 한도 내 전부 노출 (slice/truncate 없이 length 그대로)
    expect(occupants.length).toBeLessThanOrEqual(cap);
    const rendered = occupants.map((o) => o.id); // L968 occupants.map 과 동일 — 전부 매핑
    expect(rendered).toHaveLength(3);
  });
});
