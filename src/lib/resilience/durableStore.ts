/**
 * durableStore.ts — (c) write-buffer 의 durable local queue store (주입식 백엔드)
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §3.3(기준1·2·7) / §5
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c))
 *
 * ── Q3 결정: localStorage (IndexedDB 아님) ──
 *   선례 = src/lib/chartDraft.ts (T-20260603, CEO A안 MSG-20260706-090900-xzug):
 *     · 저장소 = localStorage → PHI **서버 미적재**(로컬만), 단말 고정 진료실 전제.
 *     · 로그아웃 시 전체 clear(clearAllChartDrafts) 로 잔존 폐기(기기 공용 대비).
 *   write-buffer 도 동일 정책이 정합: 보류 write 큐는 소규모(보통 0~수 건)·짧은 수명(blip=간헐)
 *   이라 IndexedDB 비동기 트랜잭션은 과설계. localStorage 동기 API + 버전 prefix + TTL 로 충분.
 *   (§5: durable store = 브라우저 로컬, 무-DDL·무-서버 → db_change=false 유지.)
 *
 * ── 무-DDL·무-서버 (db_change=false) ──
 *   payload 는 브라우저 로컬에만 적재. 서버 outbox/큐 테이블 승격 아님(§5 조건2 불발화).
 *
 * ── PHI 보안 (spec §3.3 회귀축) ──
 *   payload 에 PHI 가 실릴 수 있으므로 (1) 최소화(호출측 책임), (2) signOut 시 clearAll,
 *   (3) TTL 초과 자동 폐기. store 는 주입식(테스트=in-memory) 이라 코어 로직은 브라우저 비의존.
 */

/** durable store 에 적재되는 1건의 보류 write 레코드(직렬화 가능해야 함 — 함수 금지). */
export interface BufferedRecord {
  /** 큐 항목 고유 id(레코드 식별자). */
  opId: string;
  /** executor 종류 키(registerExecutor 로 등록된 kind). */
  kind: string;
  /**
   * R1 멱등키 — enqueue 시 1회 생성, 이후 재전송 시 verbatim 재사용(재생성=중복).
   * client-gen UUID. Class1(CAT)=payment_attempt_id, Class3=PK 등 substrate 로 executor 가 사용.
   */
  idempotencyKey: string;
  /** executor 에 전달되는 직렬화 가능 payload(PHI 최소화는 호출측 책임). */
  payload: unknown;
  /** 배너/디버그용 사람이 읽는 라벨(예: "결제 저장", "예약 등록"). */
  label: string;
  /** 생성 시각(epoch ms) — TTL 판정 기준. */
  createdAt: number;
  /** 재전송 시도 횟수(가시성/백오프용). */
  attempts: number;
  /** 마지막 실패 사유(디버그/surface). */
  lastError?: string;
  /**
   * 도메인 충돌(R2-B) 등으로 사용자 개입이 필요한 상태.
   *   'active'      — 자동 flush 대상
   *   'needs_user'  — 진짜 도메인 충돌 surface 됨(자동 재전송 중단, 사용자 취소/조치 대기)
   */
  state: 'active' | 'needs_user';
}

/** durable store 인터페이스(주입식 — 코어를 브라우저/테스트 양쪽에서 동일 검증). */
export interface DurableStore {
  list(): BufferedRecord[];
  get(opId: string): BufferedRecord | null;
  put(rec: BufferedRecord): void;
  remove(opId: string): void;
  clearAll(): void;
}

/** Storage-like 최소 계약(localStorage 또는 테스트 fake). */
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

const PREFIX = 'foot:write-buffer:v1';
const key = (opId: string): string => `${PREFIX}:${opId}`;

function isValidRecord(o: unknown): o is BufferedRecord {
  if (!o || typeof o !== 'object') return false;
  const r = o as Partial<BufferedRecord>;
  return (
    typeof r.opId === 'string' &&
    typeof r.kind === 'string' &&
    typeof r.idempotencyKey === 'string' &&
    typeof r.label === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.attempts === 'number' &&
    (r.state === 'active' || r.state === 'needs_user')
  );
}

/**
 * StorageLike 백엔드로 DurableStore 생성.
 * @param backend  localStorage(브라우저) 또는 테스트 fake. 부재 시 no-op store(best-effort).
 */
export function createDurableStore(backend: StorageLike | null): DurableStore {
  if (!backend) {
    // private mode/비브라우저 — 큐 durable 불가. no-op(호출측 즉시전송 경로로 degrade).
    const noop: DurableStore = {
      list: () => [],
      get: () => null,
      put: () => {},
      remove: () => {},
      clearAll: () => {},
    };
    return noop;
  }
  return {
    list(): BufferedRecord[] {
      const out: BufferedRecord[] = [];
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        try {
          const raw = backend.getItem(k);
          if (!raw) continue;
          const parsed: unknown = JSON.parse(raw);
          if (isValidRecord(parsed)) out.push(parsed);
          else backend.removeItem(k); // 손상 레코드 정리
        } catch {
          try {
            backend.removeItem(k);
          } catch {
            /* noop */
          }
        }
      }
      // 생성순 정렬(FIFO flush).
      out.sort((a, b) => a.createdAt - b.createdAt);
      return out;
    },
    get(opId: string): BufferedRecord | null {
      try {
        const raw = backend.getItem(key(opId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isValidRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    put(rec: BufferedRecord): void {
      try {
        backend.setItem(key(rec.opId), JSON.stringify(rec));
      } catch {
        /* quota 등 — best-effort. enqueue-before-send 실패 시 호출측이 즉시전송으로 degrade */
      }
    },
    remove(opId: string): void {
      try {
        backend.removeItem(key(opId));
      } catch {
        /* noop */
      }
    },
    clearAll(): void {
      try {
        const toRemove: string[] = [];
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && k.startsWith(PREFIX)) toRemove.push(k);
        }
        toRemove.forEach((k) => backend.removeItem(k));
      } catch {
        /* noop */
      }
    },
  };
}

/** 브라우저 localStorage 백엔드(부재 시 null → no-op store). chartDraft.safeStorage 준용. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null; // 프라이빗 모드/차단
  }
}

export const WRITE_BUFFER_PREFIX = PREFIX;
