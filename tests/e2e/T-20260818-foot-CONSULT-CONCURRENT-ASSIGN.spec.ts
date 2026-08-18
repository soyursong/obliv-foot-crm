/**
 * E2E spec — T-20260818-foot-CONSULT-CONCURRENT-ASSIGN
 *
 * 현장(풋센터, C0ATE5P6JTH): 동일/인접 시간대에 나란히 접수된 환자 2명 이상이 같은 상담
 *   담당자에게 연속 배정됨 → "나란히 온 환자는 서로 다른 담당자로 분산" 요구.
 *
 * ── 설계(dev-foot 판단, db_change=false 최소 변경) ──
 *   직전 배정 담당자를 회피하는 레이어를 least-loaded fallback 위에 추가.
 *   - findRecentAssignee(actions, role): fetchMonthActions 결과(추가 쿼리 0)에서
 *     window(기본 20분) 이내 마지막 auto_assign|manual 의 to_staff_id = '직전 배정 담당자'.
 *   - maybeAutoAssign 5-b: 후보 2명+ 이고 직전 배정자가 후보에 있으면 pool 에서 사전 제외
 *     → pickLeastLoaded(pool, load, order) 호출부 시그니처는 불변(회귀 lock 보존).
 *   - 후보 1명뿐이면 회피 미적용(정상 배정, AC-3). 부하분산(월균등)은 primary 유지(AC-5).
 *
 * 본 spec = 3 현장 시나리오 + 창(window)·action-type 경계 + 엔진 배선 정적 단언.
 *   행동은 findRecentAssignee / pickLeastLoaded 를 직접 import 해 결정적으로 검증.
 * 실렌더(갤탭 실브라우저 동시 접수→분산 배정)는 supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickLeastLoaded,
  findRecentAssignee,
  CONCURRENT_ASSIGN_WINDOW_MS,
  type LoadCounts,
} from '../../src/lib/autoAssign';
import type { AssignmentAction, AssignmentActionType, AssignmentRole } from '../../src/lib/types';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ENGINE = 'src/lib/autoAssign.ts';

const emptyLoad = (): LoadCounts => ({
  monthlyByAxis: new Map(),
  todayNet: new Map(),
  tossGiven: new Map(),
  pullCount: new Map(),
});

const NOW = Date.parse('2026-08-18T05:00:00.000Z'); // 고정 기준시각(결정성)
let seq = 0;
const mkAction = (
  to: string | null,
  agoMs: number,
  opts: { role?: AssignmentRole; type?: AssignmentActionType } = {},
): AssignmentAction => ({
  id: `act-${seq++}`,
  clinic_id: 'clinic-1',
  check_in_id: `ci-${seq}`,
  action_type: opts.type ?? 'auto_assign',
  role: opts.role ?? 'consult',
  axis: '워크인',
  from_staff_id: null,
  to_staff_id: to,
  reason: null,
  created_by: null,
  created_at: new Date(NOW - agoMs).toISOString(),
});

/** 엔진 5-b 로직 재현: 직전 배정자 사전 제외 후 least-loaded 선택. */
function assignOnce(
  pool: string[],
  actions: AssignmentAction[],
  load: LoadCounts,
  order: Map<string, number>,
  nowMs: number,
): string | null {
  const recent = findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, nowMs);
  let p = pool;
  if (recent && pool.length >= 2 && pool.includes(recent)) {
    p = pool.filter((id) => id !== recent);
  }
  return pickLeastLoaded(p, load, order);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 동시 접수 2명 분산 (직전 배정자 회피)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 동시 접수 2명 분산', () => {
  test('환자1이 A 배정 직후, 환자2는 B(A 아님)로 분산 — A가 월부하 더 낮아도 회피', () => {
    const pool = ['a', 'b'];
    const order = new Map([['a', 1], ['b', 2]]);
    const load = emptyLoad();
    // A 가 오히려 부하 적음(원래 least-loaded 라면 A 재선택될 상황) — 회피가 이를 뒤집는지 검증
    load.monthlyByAxis.set('a', 0);
    load.monthlyByAxis.set('b', 1);
    // 직전(1분 전) 배정 = A
    const actions = [mkAction('a', 60_000)];
    expect(assignOnce(pool, actions, load, order, NOW)).toBe('b');
  });

  test('직전 배정자가 후보 풀에 있으면 findRecentAssignee 가 그를 지목', () => {
    const actions = [mkAction('a', 30_000), mkAction('b', 120_000)]; // 최근 = a(30s 전)
    expect(findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, NOW)).toBe('a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 단일 담당자 예외 (분산 불가 시 정상 배정)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 단일 담당자 예외', () => {
  test('배정 가능 담당자 A 1명뿐이면 연속 접수라도 둘 다 A (회피 미적용)', () => {
    const pool = ['a'];
    const order = new Map([['a', 1]]);
    const actions: AssignmentAction[] = [];
    // 환자1 → A
    const p1 = assignOnce(pool, actions, emptyLoad(), order, NOW);
    expect(p1).toBe('a');
    actions.push(mkAction('a', 1_000)); // 방금 배정 기록
    // 환자2 → 여전히 A (후보 1명 → 회피 skip, AC-3)
    const p2 = assignOnce(pool, actions, emptyLoad(), order, NOW);
    expect(p2).toBe('a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 3명 이상 라운드로빈 (A→B→C→A)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 — 3명 이상 라운드로빈', () => {
  test('환자 4명 연속 접수 → A→B→C→A 순환 배정', () => {
    const pool = ['a', 'b', 'c'];
    const order = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const load = emptyLoad();
    const actions: AssignmentAction[] = [];
    const picks: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const chosen = assignOnce(pool, actions, load, order, NOW);
      picks.push(chosen);
      if (chosen) {
        // 배정 반영: 월부하 +1, 직전 배정 기록(i초 전 순서 보존 위해 감소하는 agoMs)
        load.monthlyByAxis.set(chosen, (load.monthlyByAxis.get(chosen) ?? 0) + 1);
        actions.push(mkAction(chosen, 1_000 - i)); // 뒤 접수일수록 더 최근
      }
    }
    expect(picks).toEqual(['a', 'b', 'c', 'a']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 경계 — 창(window) / action-type 필터
// ─────────────────────────────────────────────────────────────────────────────
test.describe('경계 — findRecentAssignee 필터', () => {
  test('창(20분) 밖의 오래된 배정은 직전 배정자 아님 → null (동시간대 아님)', () => {
    const actions = [mkAction('a', CONCURRENT_ASSIGN_WINDOW_MS + 60_000)]; // 21분 전
    expect(findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, NOW)).toBeNull();
  });

  test('창 밖이면 회피 미적용 → 정상 least-loaded (A 재선택 허용)', () => {
    const pool = ['a', 'b'];
    const order = new Map([['a', 1], ['b', 2]]);
    const load = emptyLoad(); // 전원 0건 → 순번상 A
    const actions = [mkAction('a', CONCURRENT_ASSIGN_WINDOW_MS + 1)]; // 창 밖
    expect(assignOnce(pool, actions, load, order, NOW)).toBe('a');
  });

  test('toss/pull_in(운영자 재배분)은 직전 배정자 산출 대상 아님', () => {
    const actions = [
      mkAction('a', 10_000, { type: 'toss' }),
      mkAction('a', 20_000, { type: 'pull_in' }),
    ];
    expect(findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, NOW)).toBeNull();
  });

  test('role 불일치(therapy)는 consult 직전 배정자 산출에서 제외', () => {
    const actions = [mkAction('a', 5_000, { role: 'therapy' })];
    expect(findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, NOW)).toBeNull();
  });

  test('manual 배정도 직전 배정자로 인정(접수→수동 담당 배정)', () => {
    const actions = [mkAction('a', 5_000, { type: 'manual' })];
    expect(findRecentAssignee(actions, 'consult', CONCURRENT_ASSIGN_WINDOW_MS, NOW)).toBe('a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 엔진 배선 정적 단언 (회귀 lock 보존 확인)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('엔진 배선', () => {
  test('5-b: 직전 배정자 사전 제외 후 pickLeastLoaded(pool, load, order) 호출부 불변', () => {
    const src = read(ENGINE);
    expect(src).toMatch(/const recentAssignee = findRecentAssignee\(actions, role\)/);
    expect(src).toMatch(/pool = pool\.filter\(\(id\) => id !== recentAssignee\)/);
    // 회귀 lock: 기존 호출부 시그니처 유지(5개 선행 spec 이 이 문자열을 lock)
    expect(src).toMatch(/chosen = pickLeastLoaded\(pool, load, order\)/);
  });

  test('회피는 후보 2명+ 조건(pool.length >= 2)에서만 발동 — 단일 담당자 예외 보장', () => {
    const src = read(ENGINE);
    expect(src).toMatch(/pool\.length >= 2 && pool\.includes\(recentAssignee\)/);
  });

  test('창 상수(20분) export + Date.now 기본 주입(테스트 결정성)', () => {
    expect(CONCURRENT_ASSIGN_WINDOW_MS).toBe(20 * 60 * 1000);
    const src = read(ENGINE);
    expect(src).toMatch(/nowMs: number = Date\.now\(\)/);
  });
});
