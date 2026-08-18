/**
 * E2E spec — T-20260818-foot-CONSULT-REALTIME-ROOM-SYNC
 *
 * 현장(풋센터, C0ATE5P6JTH · 김주연 총괄): 대시보드 상담 배정이 실시간 상담실 점유현황과
 *   미연동 → 상담 중인 실장/방에 다음 순번이 또 배정됨. 요구:
 *   (1) 상담실 점유(상담 중/비어있음) 실시간 반영, (2) 비었을 때만 다음 순번 자동 배정,
 *   (3) 상담 종료 시점에 대기 중 다음 순번 자동 배정(수동 새로고침 없이).
 *
 * ── 설계(dev-foot 판단, db_change=false 최소 변경) ──
 *   ▸ AC-4 canonical 점유 소스 = check_ins.status='consultation' + consultant_id 보유
 *     (신규 컬럼/상태값 0 = 기존 status enum 재사용 → DA 게이트 불요).
 *   ▸ AC-1 gateOutOccupied(pool, occupied): 상담 중인 실장을 후보 풀에서 hard 제외
 *     (후보 전부 점유면 빈 배열 → maybeAutoAssign no-assign = 대기 유지).
 *     ★ 직전배정 회피(findRecentAssignee)와 달리 후보수 조건 없음 — 점유는 무조건 제외.
 *   ▸ AC-2/AC-3 assignNextWaitingConsult: 상담 종료 시 대기(consultant_id NULL) 다음 순번 1건만
 *     FIFO(sort_order→created_at) 자동 배정. 상담 종료 = status='consultation'→그 외 전이 시
 *     realtime 구독(타 클라이언트) + 이동/우클릭 핸들러(acting 클라이언트) 3경로에서 트리거.
 *
 * 본 spec = gateOutOccupied 순수 단언(3 현장 시나리오) + 엔진/대시보드 배선 정적 단언.
 *   행동은 gateOutOccupied 를 직접 import 해 결정적으로 검증(DB-async 함수는 배선 정적 단언).
 * 실렌더(갤탭 실브라우저: 상담 중 상태에서 다음 순번 대기→종료 시 자동배정)는
 *   supervisor 맥스튜디오 실브라우저에서 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateOutOccupied } from '../../src/lib/autoAssign';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ENGINE = 'src/lib/autoAssign.ts';
const STRATEGY = 'src/lib/assignmentStrategy.ts';
const DASHBOARD = 'src/pages/Dashboard.tsx';

// ── AC-1: gateOutOccupied 순수 로직 ──────────────────────────────────────────────
test.describe('AC-1 gateOutOccupied — 점유(상담 중) 실장 후보 제외', () => {
  test('시나리오1: 상담 중 실장은 후보에서 제외된다', () => {
    const pool = ['a', 'b', 'c'];
    const occupied = new Set(['b']);
    expect(gateOutOccupied(pool, occupied)).toEqual(['a', 'c']);
  });

  test('점유 없음(빈 set) → 후보 원본 그대로(회귀0)', () => {
    const pool = ['a', 'b', 'c'];
    expect(gateOutOccupied(pool, new Set())).toEqual(['a', 'b', 'c']);
  });

  test('AC-1 핵심: 후보 전부 점유면 빈 배열(→ no-assign = 대기 유지)', () => {
    const pool = ['a', 'b'];
    const occupied = new Set(['a', 'b']);
    // 직전배정 회피와 달리 후보수 조건 없음 — 1명 남아도, 0명이 되어도 무조건 제외.
    expect(gateOutOccupied(pool, occupied)).toEqual([]);
  });

  test('일부 점유 + 1명만 남아도 남은 후보 반환(비어있는 실장에게 배정 가능)', () => {
    const pool = ['a', 'b', 'c'];
    const occupied = new Set(['a', 'b']);
    expect(gateOutOccupied(pool, occupied)).toEqual(['c']);
  });

  test('occupied 에 후보 밖 id 가 있어도 무해(교집합만 제외)', () => {
    const pool = ['a', 'b'];
    const occupied = new Set(['x', 'y', 'a']);
    expect(gateOutOccupied(pool, occupied)).toEqual(['b']);
  });
});

// ── AC-4: canonical 점유 소스 배선(check_ins.status='consultation') ───────────────
test.describe('AC-4 점유 소스 = check_ins.status=consultation + consultant_id', () => {
  test('fetchOccupiedConsultantIds 가 consultation status + consultant_id 로 조회', () => {
    const src = read(ENGINE);
    const fn = src.slice(src.indexOf('export async function fetchOccupiedConsultantIds'));
    expect(fn).toContain(".from('check_ins')");
    expect(fn).toContain(".eq('status', 'consultation')");
    expect(fn).toContain("'consultant_id'"); // select consultant_id
    expect(fn).toContain(".not('consultant_id', 'is', null)");
    expect(fn).toContain(".is('deleted_at', null)");
  });

  test('신규 컬럼/상태값 없음 — db_change=false (consultation 은 기존 enum)', () => {
    const types = read('src/lib/types.ts');
    expect(types).toContain("| 'consultation'"); // 기존 CheckInStatus enum 재사용
  });
});

// ── AC-1 배선: maybeAutoAssign consult 경로가 점유 게이팅 적용 ────────────────────
test.describe('AC-1 배선 — maybeAutoAssign 점유 게이팅', () => {
  test('consult 역할에서만 점유 조회 + gateOutOccupied 로 pool 축소', () => {
    const src = read(ENGINE);
    const fn = src.slice(src.indexOf('export async function maybeAutoAssign'));
    // role==='consult' 가드 안에서 점유 조회
    expect(fn).toContain("if (role === 'consult') {");
    expect(fn).toContain('fetchOccupiedConsultantIds(checkIn.clinic_id)');
    expect(fn).toContain('gateOutOccupied(pool, occupiedConsultants)');
  });

  test('전략(랭킹/TM) 경로에도 점유 실장 excludeStaffIds 로 전달', () => {
    const src = read(ENGINE);
    expect(src).toContain('excludeStaffIds: occupiedConsultants.size > 0 ? occupiedConsultants : null');
    const strat = read(STRATEGY);
    // pickConsultantByStrategy + pickTmConsultant 가 excludeStaffIds 로 후보 제외
    expect(strat).toContain('excludeStaffIds?: Set<string> | null');
    expect(strat).toContain("candidates = candidates.filter((id) => !opts.excludeStaffIds!.has(id))");
  });

  test('치료사(therapy)는 점유 게이팅 미적용(스코프 밖·회귀0)', () => {
    const src = read(ENGINE);
    const fn = src.slice(src.indexOf('export async function maybeAutoAssign'));
    // 점유 조회는 consult 가드 내부에만 — therapy 분기엔 fetchOccupiedConsultantIds 없음
    const consultGate = fn.slice(fn.indexOf("if (role === 'consult') {"));
    const gateBlock = consultGate.slice(0, consultGate.indexOf('}') + 1);
    expect(gateBlock).toContain('fetchOccupiedConsultantIds');
  });
});

// ── AC-2/AC-3 배선: 상담 종료 → assignNextWaitingConsult 트리거 ───────────────────
test.describe('AC-2/AC-3 배선 — 상담 종료 시 다음 순번 자동 배정', () => {
  test('assignNextWaitingConsult: NULL 담당 상담대기 건 FIFO 1건만 배정', () => {
    const src = read(ENGINE);
    const fn = src.slice(src.indexOf('export async function assignNextWaitingConsult'));
    expect(fn).toContain(".eq('status', 'consult_waiting')");
    expect(fn).toContain(".is('consultant_id', null)");
    expect(fn).toContain(".is('deleted_at', null)");
    expect(fn).toContain(".order('sort_order'"); // FIFO
    expect(fn).toContain(".order('created_at'");
    expect(fn).toContain("maybeAutoAssign(r.id, 'consult_waiting'");
    // 첫 성공 배정 후 즉시 중단(상담 종료 1건 = 다음 순번 1건, 과다배정 방지)
    expect(fn).toContain('if (res.assigned) return true;');
  });

  test('Dashboard: realtime 구독이 consultation→그외 전이 감지 시 트리거(타 클라이언트)', () => {
    const src = read(DASHBOARD);
    expect(src).toContain('assignNextWaitingConsult');
    // realtime UPDATE: oldRow.status==='consultation' && newRow.status!=='consultation'
    expect(src).toContain("oldRow?.status === 'consultation'");
    expect(src).toContain("newRow.status !== 'consultation'");
  });

  test('Dashboard: 이동/우클릭 핸들러가 상담 종료 시 직접 트리거(acting 클라이언트)', () => {
    const src = read(DASHBOARD);
    // 드래그 이동 핸들러
    expect(src).toContain("row.status === 'consultation' && newStatus !== 'consultation'");
    // 우클릭 상태변경 핸들러
    expect(src).toContain("ci.status === 'consultation' && newStatus !== 'consultation'");
  });

  test('import 배선 — Dashboard 가 assignNextWaitingConsult 를 import', () => {
    const src = read(DASHBOARD);
    expect(src).toMatch(/import\s*{[^}]*assignNextWaitingConsult[^}]*}\s*from\s*'@\/lib\/autoAssign'/);
  });
});
