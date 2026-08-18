/**
 * writeBuffer.ts — (c) optimistic write buffer / local durable queue (순수 코어 + 오케스트레이션)
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §3.3 [우선축·데이터안전]
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c))
 * DA:   MSG-20260818-223942-l4ka(CONDITIONAL-GO) + census-gate(READ-ONLY prod introspection)
 * gate: planner MSG-20260818-234541-yon8 — (c) Step2 GO, db_change=false 확정, MIG-GATE 불요.
 *
 * ── 목표 (spec §0): blip 중 in-flight 저장 유실 0. UX 가 아니라 데이터 무결성. ──
 *
 * ── 유실0 보장 7항 (spec §3.3) ──
 *   1. enqueue-before-send : 전송 前 durable store 에 payload 적재(intent). 성공+rowcheck 통과 후에만 dequeue.
 *   2. durable store        : 브라우저 로컬(localStorage, Q3=durableStore.ts). 무-DDL·무-서버.
 *   3. idempotency key       : client-gen UUID, at-least-once + 멱등 = effectively-once (R1).
 *   4. rowcheck 연동         : HTTP 200 만으로 dequeue 금지 — rows-affected==의도(또는 R4 멱등 0-row)까지 확인.
 *   5. 가시성                : 보류 건수를 refresh401Bus.setPendingWrites → 배너 "저장 대기 N건".
 *   6. flush 트리거          : online 복귀/성공 관측/타이머 (writeBufferFlush.ts).
 *   7. 폐기 정책             : 사용자 취소 또는 TTL 초과 시에만 — **자동 사일런트 폐기 금지**.
 *
 * ── DA load-bearing 요건 R1~R6 ──
 *   R1 멱등키-once      : enqueue 시 1회 생성·persist·재전송 verbatim(재생성=중복) → 본 코어가 보장.
 *   R2 23505 disambig    : own-key=committed / domain=surface / find-or-create=resolved (sqlstate23505.ts).
 *                          ★全 23505 성공취급 HARD 금지 — executor 가 classifyWriteOutcome 로 감별.
 *   R3 partial-unique WHERE: payment_attempt_id 는 CAT 경로 전용(NULL=inert). manual=client-gen PK(Class3).
 *                          → executor 책임(payload 구성). 본 코어는 substrate 를 강제하지 않음.
 *   R4 0-row 멱등성공    : status-guarded UPDATE 재전송 0-row 는 current==target 이면 성공(silent 실패 아님).
 *   R5 multi-statement   : Class4(chart_diagnoses) txn 원자성 — **본 pilot 버퍼 제외**(아래 ★참조).
 *   R6 response-loss     : 최초 커밋 후 401 이 응답경로 타격 → 동일 substrate 재전송 → 23505 own-key → committed.
 *
 * ── ★chart_diagnoses 버퍼 제외 (DA + planner ACCEPT, MSG-20260818-234541-yon8 ②) ──
 *   chart_diagnoses = Class4 **loss-tolerated 파생 미러**. medical_charts 텍스트가 원장이며 다음 저장 시
 *   재싱크(deploy-tolerant 42P01 무시). 원장성 load-bearing write = medical_charts(Class2·
 *   uix_mc_customer_clinic_date·23505-handled). ∴ chart_diagnoses 는 (c) 버퍼에 넣지 않는다(유실0 위반 아님).
 *   ⚠ REVISIT 트리거: chart_diagnoses 가 향후 load-bearing(원장성)으로 승격되면 Class4 db_change=true
 *     escalation(단일 멱등-keyed 원자 RPC + supervisor DDL-diff + MIG-GATE + 물리 GO-token) 재발화.
 *     현 pilot 범위 밖. 이 가정이 깨지면 이 주석과 함께 재판정할 것.
 *
 * ── db_change=false ──
 *   순수 클라(로컬 store) + client-gen 멱등키 + 기존 서버 제약/유니크 재사용 = 무-DDL·무-서버·무-EF.
 */
import type { BufferedRecord, DurableStore } from './durableStore';
import { classify23505, isUniqueViolation } from './sqlstate23505';

/** executor 실행 결과(rowcheck·23505 감별 후 최종 판정). */
export type WriteOutcome =
  | 'committed' // 성공(신규 커밋 또는 R6 own-key 재전송 또는 R4 멱등 0-row) → dequeue
  | 'resolved' // R2-C find-or-create: 기존 행 재-resolve(성공) → dequeue
  | 'domain_conflict' // R2-B 진짜 도메인 충돌 → 사용자 surface(성공취급 금지, needs_user)
  | 'retry' // 일시 실패(401/네트워크/5xx) → 큐 유지, 다음 flush 재전송
  | 'fatal'; // 비재시도 비-충돌 실패 → 사용자 surface(needs_user, 사일런트 폐기 금지)

/**
 * write executor — 실제 DB write + rowcheck 수행. **동일 payload+idempotencyKey 로 몇 번 불려도
 * effectively-once** 여야 한다(R1/R6). 성공/충돌/재시도/치명을 WriteOutcome 로 반환.
 * @param payload         enqueue 시 적재된 직렬화 payload
 * @param idempotencyKey  R1 멱등키(verbatim). Class1=payment_attempt_id, Class3=PK substrate 등에 사용.
 */
export type WriteExecutor = (payload: unknown, idempotencyKey: string) => Promise<WriteOutcome>;

/** rowcheck/에러를 WriteOutcome 으로 감별하는 executor 보조(R2·R4). executor 구현이 재사용. */
export function classifyWriteOutcome(input: {
  error?: unknown;
  /** write 가 실제 영향을 준 행 수(.select() count 등). 미측정 시 undefined. */
  rowsAffected?: number;
  /** 의도한 영향 행수(보통 1). */
  expectedRows?: number;
  /**
   * R4: 0-row 를 "이미 목표상태 도달(멱등 성공)"로 간주해도 되는가.
   *   status-guarded UPDATE(.eq('status', ...)) 재전송처럼 current==target 검증이 선행된 경우만 true.
   *   pure-INSERT 는 false(0-row insert 는 정상 아님).
   */
  zeroRowIsIdempotentSuccess?: boolean;
}): WriteOutcome {
  const { error, rowsAffected, expectedRows = 1, zeroRowIsIdempotentSuccess = false } = input;

  if (error) {
    if (isUniqueViolation(error)) {
      const v = classify23505(error);
      if (v === 'own_key') return 'committed'; // R6 response-loss / 이미 커밋
      if (v === 'find_or_create') return 'resolved'; // R2-C 기존 재-resolve
      return 'domain_conflict'; // R2-B / unknown_unique → surface(성공취급 금지)
    }
    if (isRetriableError(error)) return 'retry';
    return 'fatal';
  }

  // 에러 없음 → rowcheck(spec 기준4).
  if (typeof rowsAffected === 'number') {
    if (rowsAffected === 0) {
      // R4: 0-row 는 status-guard 재전송(이미 목표도달)일 때만 멱등성공. 아니면 silent 실패 → retry.
      return zeroRowIsIdempotentSuccess ? 'committed' : 'retry';
    }
    if (rowsAffected >= expectedRows) return 'committed';
    // 부분 반영(<expected) — silent 0-row 계열 위험 → 재시도(성공취급 금지).
    return 'retry';
  }
  // rowcheck 미측정이면 성공으로 취급(executor 가 rowcheck 를 안 넘긴 경우 = 계약상 성공 전제).
  return 'committed';
}

/** 401/네트워크/5xx = 일시(refresh-401 blip 포함) → retry 대상. */
export function isRetriableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status === 401 || status === 408 || status === 425 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return /network|fetch failed|timeout|failed to fetch|load failed/.test(msg);
}

export interface EnqueueInput {
  kind: string;
  payload: unknown;
  label: string;
  /** 미지정 시 생성(R1). 호출측이 payload 안에 이미 substrate id 를 심었다면 그 값과 일치시켜 전달 가능. */
  idempotencyKey?: string;
}

export interface FlushSummary {
  committed: number;
  resolved: number;
  domainConflict: number;
  retried: number;
  fatal: number;
  discardedTtl: number;
  remaining: number;
}

export interface WriteBufferOptions {
  store: DurableStore;
  /** 보류 건수 변동 통지(가시성, spec 기준5). 기본=refresh401Bus.setPendingWrites 배선(default singleton). */
  onPendingChange?: (count: number) => void;
  /** 진짜 도메인 충돌(R2-B)/치명(fatal) 발생 시 사용자 surface 콜백. */
  onSurface?: (rec: BufferedRecord, outcome: 'domain_conflict' | 'fatal') => void;
  /** TTL 초과 폐기 통지(감사/로그). */
  onDiscardTtl?: (rec: BufferedRecord) => void;
  /** TTL(ms). 기본 24h(spec §3.3 권고). */
  ttlMs?: number;
  /** 시각 소스(테스트 주입). 기본 Date.now. */
  now?: () => number;
  /** id 생성기(테스트 주입). 기본 crypto.randomUUID. */
  genId?: () => string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultGenId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // 폴백(비암호 — id 유일성만 필요). 충돌 확률 무시가능.
  return `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface WriteBuffer {
  registerExecutor(kind: string, exec: WriteExecutor): void;
  enqueue(input: EnqueueInput): BufferedRecord;
  flush(): Promise<FlushSummary>;
  /** 사용자 취소(폐기 정책 — 명시 취소만 허용). */
  cancel(opId: string): void;
  list(): BufferedRecord[];
  pendingCount(): number;
  /** signOut 등 — 큐 전체 폐기(PHI 잔류 방지). */
  discardAll(): void;
}

/** write-buffer 인스턴스 생성(테스트=격리 store 주입, 앱=default singleton). */
export function createWriteBuffer(opts: WriteBufferOptions): WriteBuffer {
  const {
    store,
    onPendingChange,
    onSurface,
    onDiscardTtl,
    ttlMs = DAY_MS,
    now = () => Date.now(),
    genId = defaultGenId,
  } = opts;

  const executors = new Map<string, WriteExecutor>();
  let flushing = false;

  const notifyPending = (): void => {
    if (onPendingChange) onPendingChange(store.list().length);
  };

  const registerExecutor = (kind: string, exec: WriteExecutor): void => {
    executors.set(kind, exec);
  };

  const enqueue = (input: EnqueueInput): BufferedRecord => {
    // R1: 멱등키를 여기서 1회 생성·persist. 이후 재전송은 이 값을 verbatim 재사용.
    const rec: BufferedRecord = {
      opId: genId(),
      kind: input.kind,
      idempotencyKey: input.idempotencyKey ?? genId(),
      payload: input.payload,
      label: input.label,
      createdAt: now(),
      attempts: 0,
      state: 'active',
    };
    // 기준1: enqueue-before-send — 전송 前 durable 적재.
    store.put(rec);
    notifyPending();
    return rec;
  };

  const cancel = (opId: string): void => {
    store.remove(opId);
    notifyPending();
  };

  const discardAll = (): void => {
    store.clearAll();
    notifyPending();
  };

  const flush = async (): Promise<FlushSummary> => {
    const summary: FlushSummary = {
      committed: 0,
      resolved: 0,
      domainConflict: 0,
      retried: 0,
      fatal: 0,
      discardedTtl: 0,
      remaining: 0,
    };
    if (flushing) {
      summary.remaining = store.list().length;
      return summary; // 재진입 방지(동시 flush 중첩 금지 — 중복전송 위험).
    }
    flushing = true;
    try {
      const records = store.list(); // FIFO
      const t = now();
      for (const rec of records) {
        // 기준7 폐기 정책: TTL 초과만 자동 폐기(사일런트 성공 폐기 금지 — 명시 폐기).
        if (t - rec.createdAt > ttlMs) {
          store.remove(rec.opId);
          summary.discardedTtl += 1;
          if (onDiscardTtl) onDiscardTtl(rec);
          continue;
        }
        // needs_user = 진짜 충돌 surface 됨 → 자동 재전송 대상 아님(사용자 조치/취소 대기).
        if (rec.state === 'needs_user') continue;

        const exec = executors.get(rec.kind);
        if (!exec) {
          // executor 미등록(앱 부팅 순서/kind 오타) — 재시도 유지(폐기 금지). 다음 flush 에서 재판정.
          summary.retried += 1;
          continue;
        }

        let outcome: WriteOutcome;
        try {
          // R1/R6: 동일 payload + 동일 idempotencyKey verbatim.
          outcome = await exec(rec.payload, rec.idempotencyKey);
        } catch (err) {
          // executor 가 throw = 분류 실패 → 보수적으로 재시도 판정(폐기 금지).
          outcome = isRetriableError(err) ? 'retry' : 'fatal';
          rec.lastError = errMsg(err);
        }

        if (outcome === 'committed' || outcome === 'resolved') {
          store.remove(rec.opId); // dequeue (rowcheck 통과 후에만 — executor 계약)
          if (outcome === 'committed') summary.committed += 1;
          else summary.resolved += 1;
        } else if (outcome === 'domain_conflict' || outcome === 'fatal') {
          // 성공취급 금지 + 사일런트 폐기 금지 → needs_user 로 surface(큐 유지, 사용자 조치 대기).
          const updated: BufferedRecord = {
            ...rec,
            state: 'needs_user',
            attempts: rec.attempts + 1,
            lastError: rec.lastError ?? outcome,
          };
          store.put(updated);
          if (outcome === 'domain_conflict') summary.domainConflict += 1;
          else summary.fatal += 1;
          if (onSurface) onSurface(updated, outcome);
        } else {
          // retry — 큐 유지, 시도횟수 증가.
          store.put({ ...rec, attempts: rec.attempts + 1, lastError: rec.lastError });
          summary.retried += 1;
        }
      }
    } finally {
      flushing = false;
      notifyPending();
    }
    summary.remaining = store.list().length;
    return summary;
  };

  return {
    registerExecutor,
    enqueue,
    flush,
    cancel,
    list: () => store.list(),
    pendingCount: () => store.list().length,
    discardAll,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}
