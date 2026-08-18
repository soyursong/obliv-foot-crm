/**
 * 로직 spec — T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c) write-buffer)
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §3.3 (유실0 7항)
 * DA:   MSG-20260818-223942-l4ka (R1~R6) + census-gate item4 (23505 constraint 이름)
 *
 * 순수 코어(writeBuffer/durableStore/sqlstate23505) 검증 — 브라우저/로그인 불요, Node 결정성.
 * in-memory StorageLike + mock executor 로 R1~R6 · 유실0 7항 · TTL · signOut 폐기 · 가시성을 실증한다.
 *
 * 왜 로직 spec 인가: (c) 의 무결성 보장은 UI 가 아니라 큐 오케스트레이션의 불변식이다. 이 불변식을
 *   결정적으로 못 박는 것이 supervisor FE code-gate(R1~R4) 의 1급 증적. UI 가시성(배너 "저장 대기 N건")은
 *   Step1 배너 + onPendingChange 배선으로 이미 커버(bus setPendingWrites).
 */
import { test, expect } from '@playwright/test';
import {
  createWriteBuffer,
  classifyWriteOutcome,
  isRetriableError,
  type WriteExecutor,
} from '../../src/lib/resilience/writeBuffer';
import {
  createDurableStore,
  type StorageLike,
  WRITE_BUFFER_PREFIX,
} from '../../src/lib/resilience/durableStore';
import {
  classify23505,
  extractConstraintName,
  isUniqueViolation,
} from '../../src/lib/resilience/sqlstate23505';

/** Map 기반 StorageLike(localStorage 대역). */
function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

function fixedClock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms) => (t += ms) };
}

let idSeq = 0;
const seqId = (): string => `id-${++idSeq}`;

function makeBuffer(overrides?: {
  ttlMs?: number;
  now?: () => number;
  onSurface?: (rec: unknown, outcome: string) => void;
  onDiscardTtl?: (rec: unknown) => void;
  onPendingChange?: (n: number) => void;
}) {
  const backend = fakeStorage();
  const store = createDurableStore(backend);
  const buf = createWriteBuffer({
    store,
    ttlMs: overrides?.ttlMs,
    now: overrides?.now,
    genId: seqId,
    onSurface: overrides?.onSurface as never,
    onDiscardTtl: overrides?.onDiscardTtl as never,
    onPendingChange: overrides?.onPendingChange,
  });
  return { buf, store, backend };
}

const err = (o: Record<string, unknown>): unknown => o;

test.describe('Step2 (c) write-buffer — 유실0 7항 + R1~R6 (순수 로직)', () => {
  test.beforeEach(() => {
    idSeq = 0;
  });

  test('R1 멱등키-once + 기준1 enqueue-before-send: 전송 前 durable 적재, 재전송 verbatim 재사용', async () => {
    const { buf, store } = makeBuffer();
    const seen: string[] = [];
    let calls = 0;
    // 첫 2회 retry, 3회째 committed — 매번 같은 idempotencyKey 를 봐야 한다(R1).
    const exec: WriteExecutor = async (_p, key) => {
      seen.push(key);
      calls += 1;
      return calls < 3 ? 'retry' : 'committed';
    };
    buf.registerExecutor('pay', exec);

    const rec = buf.enqueue({ kind: 'pay', payload: { amount: 1000 }, label: '결제 저장' });
    // 기준1: executor 호출 前에 이미 store 에 있다(intent 기록).
    expect(store.get(rec.opId)).not.toBeNull();
    expect(rec.idempotencyKey).toBeTruthy();

    await buf.flush(); // retry #1
    await buf.flush(); // retry #2
    const s = await buf.flush(); // committed
    expect(calls).toBe(3);
    // R1: 3회 모두 동일 멱등키 verbatim.
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(rec.idempotencyKey);
    expect(s.committed).toBe(1);
    // dequeue 됨.
    expect(store.get(rec.opId)).toBeNull();
    expect(buf.pendingCount()).toBe(0);
  });

  test('기준1: executor throw(전송 도중 크래시)에도 intent 잔존(유실0)', async () => {
    const { buf, store } = makeBuffer();
    buf.registerExecutor('resv', async () => {
      throw err({ status: 401, message: 'refresh-401 blip' }); // 재시도 대상
    });
    const rec = buf.enqueue({ kind: 'resv', payload: { date: '2026-08-19' }, label: '예약 등록' });
    const s = await buf.flush();
    // throw → 재시도 판정, 큐 유지(폐기 금지).
    expect(s.retried).toBe(1);
    expect(store.get(rec.opId)).not.toBeNull();
    expect(buf.pendingCount()).toBe(1);
  });

  test('R2 + 기준4 rowcheck: classifyWriteOutcome 감별표(23505 A/B/C · 0-row · 부분반영)', () => {
    // A own-key(PK/전용멱등키) → committed(R6)
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "payments_pkey"' }) })).toBe('committed');
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "ux_payments_payment_attempt_id"' }) })).toBe('committed');
    // C find-or-create → resolved
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'duplicate key value violates unique constraint "idx_customers_clinic_phone"' }) })).toBe('resolved');
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "uix_mc_customer_clinic_date"' }) })).toBe('resolved');
    // B genuine domain conflict → domain_conflict (성공취급 금지)
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "idx_reservations_customer_daily"' }) })).toBe('domain_conflict');
    // unknown 유니크 → 보수적 domain_conflict(성공취급 금지)
    expect(classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "some_new_unique_xyz"' }) })).toBe('domain_conflict');
    // 401/네트워크 → retry
    expect(classifyWriteOutcome({ error: err({ status: 401 }) })).toBe('retry');
    expect(classifyWriteOutcome({ error: err({ message: 'Failed to fetch' }) })).toBe('retry');
    // 비재시도 비-충돌 → fatal
    expect(classifyWriteOutcome({ error: err({ status: 400, message: 'bad request' }) })).toBe('fatal');
    // rowcheck: 1행=committed / pure-insert 0행=retry(silent 실패 금지) / 부분<expected=retry
    expect(classifyWriteOutcome({ rowsAffected: 1, expectedRows: 1 })).toBe('committed');
    expect(classifyWriteOutcome({ rowsAffected: 0, expectedRows: 1 })).toBe('retry');
    expect(classifyWriteOutcome({ rowsAffected: 1, expectedRows: 2 })).toBe('retry');
    // R4: status-guarded 0-row 는 멱등 성공
    expect(classifyWriteOutcome({ rowsAffected: 0, zeroRowIsIdempotentSuccess: true })).toBe('committed');
  });

  test('R2-B HARD: 진짜 도메인 충돌은 성공취급 금지 → needs_user surface(큐 유지, dequeue 안 함)', async () => {
    const surfaced: string[] = [];
    const { buf, store } = makeBuffer({
      onSurface: (rec, outcome) => surfaced.push(`${(rec as { label: string }).label}:${outcome}`),
    });
    buf.registerExecutor('resv', async () =>
      classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "idx_reservations_customer_daily"' }) }),
    );
    const rec = buf.enqueue({ kind: 'resv', payload: {}, label: '중복예약' });
    const s = await buf.flush();
    expect(s.domainConflict).toBe(1);
    expect(s.committed).toBe(0);
    // 성공취급 금지 = dequeue 안 됨(사일런트 폐기도 아님) → needs_user 로 큐 유지.
    const after = store.get(rec.opId);
    expect(after).not.toBeNull();
    expect(after?.state).toBe('needs_user');
    expect(surfaced).toContain('중복예약:domain_conflict');
    // needs_user 는 다음 flush 에서 자동 재전송 안 함.
    const s2 = await buf.flush();
    expect(s2.domainConflict).toBe(0);
    expect(s2.retried).toBe(0);
    expect(store.get(rec.opId)).not.toBeNull(); // 여전히 보관(사용자 취소 대기)
  });

  test('R6 response-loss: 최초 커밋 후 재전송이 own-key 23505 에 착지 → committed(effectively-once)', async () => {
    const { buf, store } = makeBuffer();
    let n = 0;
    // 1회차: 커밋됐지만 응답이 401 로 유실(retry 로 관측). 2회차 재전송: 서버는 이미 커밋 → own-key 23505.
    buf.registerExecutor('pay', async () => {
      n += 1;
      if (n === 1) return classifyWriteOutcome({ error: err({ status: 401 }) }); // 응답유실 → retry
      return classifyWriteOutcome({ error: err({ code: '23505', message: 'unique constraint "payments_pkey"' }) }); // own-key → committed
    });
    const rec = buf.enqueue({ kind: 'pay', payload: {}, label: '결제' });
    await buf.flush(); // retry
    expect(store.get(rec.opId)).not.toBeNull();
    const s = await buf.flush(); // own-key → committed → dequeue
    expect(s.committed).toBe(1);
    expect(store.get(rec.opId)).toBeNull(); // 중복행 없이 정확히 1회 효과.
  });

  test('R4: status-guarded 0-row 재전송은 멱등 성공(silent 0-row 실패 아님)', async () => {
    const { buf, store } = makeBuffer();
    buf.registerExecutor('changePay', async () =>
      // 재전송 시 이미 target 상태 → 0-row, current==target 검증됨 → 멱등 성공.
      classifyWriteOutcome({ rowsAffected: 0, zeroRowIsIdempotentSuccess: true }),
    );
    const rec = buf.enqueue({ kind: 'changePay', payload: {}, label: '결제수단 변경' });
    const s = await buf.flush();
    expect(s.committed).toBe(1);
    expect(store.get(rec.opId)).toBeNull();
  });

  test('기준7 폐기 정책: TTL 초과만 자동 폐기, 그 외 자동 사일런트 폐기 금지', async () => {
    const clock = fixedClock(1_000_000);
    const discarded: string[] = [];
    const { buf, store } = makeBuffer({
      ttlMs: 1000,
      now: clock.now,
      onDiscardTtl: (rec) => discarded.push((rec as { label: string }).label),
    });
    // 계속 retry 하는 executor(성공 안 됨) → TTL 전에는 절대 폐기되면 안 됨.
    buf.registerExecutor('resv', async () => 'retry');
    const rec = buf.enqueue({ kind: 'resv', payload: {}, label: '예약' });

    await buf.flush();
    expect(store.get(rec.opId)).not.toBeNull(); // retry — 유지
    clock.advance(500);
    await buf.flush();
    expect(store.get(rec.opId)).not.toBeNull(); // 아직 TTL 내 — 유지
    clock.advance(600); // 총 1100 > ttl 1000
    const s = await buf.flush();
    expect(s.discardedTtl).toBe(1);
    expect(discarded).toContain('예약');
    expect(store.get(rec.opId)).toBeNull(); // TTL 초과만 폐기
  });

  test('기준5 가시성: onPendingChange 가 보류 건수 변동을 통지(배너 "저장 대기 N건" 소스)', async () => {
    const counts: number[] = [];
    const { buf } = makeBuffer({ onPendingChange: (n) => counts.push(n) });
    buf.registerExecutor('pay', async () => 'committed');
    buf.enqueue({ kind: 'pay', payload: {}, label: 'a' }); // → 1
    buf.enqueue({ kind: 'pay', payload: {}, label: 'b' }); // → 2
    expect(counts[counts.length - 1]).toBe(2);
    await buf.flush(); // 둘 다 커밋 → 0
    expect(buf.pendingCount()).toBe(0);
    expect(counts[counts.length - 1]).toBe(0);
  });

  test('signOut 큐폐기: discardAll 이 로컬 큐 전체 폐기(PHI 잔류 방지) + prefix 정합', async () => {
    const { buf, backend } = makeBuffer();
    buf.registerExecutor('chart', async () => 'retry');
    buf.enqueue({ kind: 'chart', payload: { phi: '홍길동 진단' }, label: '차트' });
    buf.enqueue({ kind: 'chart', payload: { phi: '김철수 진단' }, label: '차트2' });
    expect(buf.pendingCount()).toBe(2);
    // 저장 키가 버퍼 prefix 로 격리됨.
    expect(Array.from(backend.map.keys()).every((k) => k.startsWith(WRITE_BUFFER_PREFIX))).toBe(true);
    buf.discardAll();
    expect(buf.pendingCount()).toBe(0);
    expect(backend.map.size).toBe(0); // PHI payload 로컬 잔류 0
  });

  test('flush 재진입 가드: 동시/중첩 flush 는 중복전송 금지', async () => {
    const { buf } = makeBuffer();
    let concurrent = 0;
    let maxConcurrent = 0;
    buf.registerExecutor('pay', async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return 'committed';
    });
    buf.enqueue({ kind: 'pay', payload: {}, label: 'a' });
    buf.enqueue({ kind: 'pay', payload: {}, label: 'b' });
    // 두 flush 를 동시에 — 재진입 가드로 executor 동시성은 1을 넘지 않아야(중복전송 방지).
    await Promise.all([buf.flush(), buf.flush()]);
    expect(maxConcurrent).toBeLessThanOrEqual(1);
    expect(buf.pendingCount()).toBe(0);
  });

  test('sqlstate23505 유틸: constraint 이름 추출 + 23505 판정 + census 이름 분류', () => {
    expect(isUniqueViolation(err({ code: '23505' }))).toBe(true);
    expect(isUniqueViolation(err({ message: 'duplicate key value violates unique constraint "x_pkey"' }))).toBe(true);
    expect(isUniqueViolation(err({ code: '23503' }))).toBe(false); // FK 위반(payment_attempt_id manual 오사용 방지 R3)
    expect(extractConstraintName(err({ message: 'duplicate key value violates unique constraint "idx_customers_clinic_phone"' }))).toBe('idx_customers_clinic_phone');
    expect(classify23505(err({ constraint: 'reservations_pkey' }))).toBe('own_key');
    expect(classify23505(err({ constraint: 'uix_mc_customer_clinic_date' }))).toBe('find_or_create');
    expect(classify23505(err({ constraint: 'pending_payment_open_uq' }))).toBe('domain_conflict');
    expect(classify23505(err({ constraint: 'uq_chart_diagnoses_one_primary' }))).toBe('domain_conflict');
    // 이름 미상 → unknown_unique(보수적 surface).
    expect(classify23505(err({ code: '23505' }))).toBe('unknown_unique');
  });

  test('R3 가드: 23503(FK 위반)은 23505 아님 → retry/fatal 분기(payment_attempt_id manual 오사용 감지)', () => {
    // manual 결제에 payment_attempt_id 재사용 시 FK 위반(23503) — own-key 로 오분류하면 안 됨.
    expect(isUniqueViolation(err({ code: '23503' }))).toBe(false);
    expect(classifyWriteOutcome({ error: err({ code: '23503', message: 'insert violates foreign key constraint' }) })).toBe('fatal');
    expect(isRetriableError(err({ code: '23503' }))).toBe(false);
  });
});
