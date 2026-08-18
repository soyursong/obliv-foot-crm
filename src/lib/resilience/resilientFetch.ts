/**
 * resilientFetch.ts — data-plane interceptor (canonical 삽입점, spec §2.2)
 *
 * 삽입점: src/lib/supabase.ts → createClient(URL, KEY, { global: { fetch: resilientFetch } })
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT
 *
 * 담당(Step1):
 *   (a) refresh-401 진입/해소를 refresh401Bus 로 브로드캐스트 → 비차단 배너.
 *   (b) refresh-401 판정 시 bounded exponential backoff + full jitter 재시도.
 *       · GET/HEAD(안전) 만 자유 재시도. write(POST/PATCH/PUT/DELETE)는 blind 재전송 금지
 *         (중복쓰기 위험) → 배너 신호만 pulse 하고 응답 그대로 통과. 재전송은 (c) 큐가 담당(Step2).
 *       · bound 필수: maxRetries 소진 시 재시도 중단(게이트웨이 폭주 가중 방지). 응답 그대로 반환.
 *
 * 경계(회귀축, spec §3.2/§4.3):
 *   · interceptor 1겹만 — SDK 자체 재시도와 중첩 금지. supabase-js REST/RPC 는 이 fetch 를
 *     그대로 사용(추가 재시도 없음) → 총 시도횟수는 여기 maxRetries+1 로 bound.
 *   · 네트워크 오류(fetch reject)는 본 표준 대상 아님(오귀속 금지) → 그대로 throw.
 *   · Realtime 소켓 경로는 fetch 를 안 타므로 대상 외(별도 reconnect 로직 보유).
 *   · auth-plane(토큰 갱신)은 anon/만료 판정으로 자연 제외(refresh401.ts).
 */
import { classifyRefresh401, extractBearerToken, isSafeMethod } from './refresh401';
import { beginRetry, endRetry } from './refresh401Bus';

export interface ResilientFetchConfig {
  maxRetries: number;
  baseMs: number;
  capMs: number;
  /** write 경로 refresh-401 감지 시 배너를 잠깐 보여줄 시간(ms). (c) 도입 전 임시 가시성. */
  writePulseMs: number;
}

const DEFAULT_CONFIG: ResilientFetchConfig = {
  maxRetries: 3,
  baseMs: 400,
  capMs: 4000,
  writePulseMs: 1500,
};

/** window override(E2E 결정성). 프로덕션 미설정 시 기본값. */
function readConfig(): ResilientFetchConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  const w = window as unknown as {
    __refresh401MaxRetries?: number;
    __refresh401BaseMs?: number;
    __refresh401CapMs?: number;
    __refresh401WritePulseMs?: number;
  };
  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
  return {
    maxRetries: num(w.__refresh401MaxRetries, DEFAULT_CONFIG.maxRetries, 0, 10),
    baseMs: num(w.__refresh401BaseMs, DEFAULT_CONFIG.baseMs, 1, 10000),
    capMs: num(w.__refresh401CapMs, DEFAULT_CONFIG.capMs, 1, 60000),
    writePulseMs: num(w.__refresh401WritePulseMs, DEFAULT_CONFIG.writePulseMs, 0, 60000),
  };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** exponential backoff + full jitter. delay = random(0, min(cap, base*2^attempt)). */
export function backoffDelayMs(attempt: number, cfg: ResilientFetchConfig): number {
  const exp = Math.min(cfg.capMs, cfg.baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

/**
 * E2E 테스트 훅 — data-plane 401 강제 주입(spec 현장 시나리오 "401 주입/해소").
 * window.__forceRefresh401 === true 인 동안 실제 요청 대신 합성 401 을 반환한다
 * (write 의 실제 부수효과를 막기 위해 baseFetch 를 아예 호출하지 않음).
 * 프로덕션 미설정 시 항상 false → 동작 불변.
 */
function shouldForce401(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __forceRefresh401?: boolean }).__forceRefresh401 === true;
}

function syntheticUnauthorized(): Response {
  return new Response(JSON.stringify({ message: 'injected refresh-401 (test hook)' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

/** fetch 인자에서 method 추출(Request | string + init). */
function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method;
  return 'GET';
}

/** fetch 인자에서 Authorization bearer 추출. */
function resolveBearer(input: RequestInfo | URL, init?: RequestInit): string | null {
  const fromInit = extractBearerToken(
    init?.headers as Headers | Record<string, string> | [string, string][] | undefined,
  );
  if (fromInit) return fromInit;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return extractBearerToken(input.headers);
  }
  return null;
}

/**
 * resilient fetch 팩토리. baseFetch 미지정 시 globalThis.fetch 사용.
 * supabase.ts 에서 `createClient(url, key, { global: { fetch: createResilientFetch() } })`.
 */
export function createResilientFetch(
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  const resilientFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = resolveMethod(input, init);
    const token = resolveBearer(input, init);
    const safe = isSafeMethod(method);
    const cfg = readConfig();

    let attempt = 0;
    let enteredRetry = false;

    const leaveRetry = (): void => {
      if (enteredRetry) {
        enteredRetry = false;
        endRetry();
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const forced = shouldForce401();
      let res: Response;
      if (forced) {
        res = syntheticUnauthorized();
      } else {
        try {
          res = await baseFetch(input, init);
        } catch (networkErr) {
          // 네트워크 오류는 refresh-401 아님 — 오귀속 금지. 재시도 카운터 정리 후 그대로 전파.
          leaveRetry();
          throw networkErr;
        }
      }

      const cls = forced
        ? ({ isRefresh401: true, reason: 'refresh_401' } as const)
        : classifyRefresh401(res.status, token, nowSec());

      if (!cls.isRefresh401) {
        leaveRetry();
        return res;
      }

      // ── refresh-401 감지 ──────────────────────────────────────────────
      if (!safe) {
        // write blind 재전송 금지(중복쓰기 위험). 배너만 잠깐 pulse 하고 응답 통과.
        // 유실0 재전송은 (c) write-buffer(Step2)가 담당 — 여기서는 정직한 신호만.
        beginRetry();
        if (cfg.writePulseMs > 0) {
          window.setTimeout(() => endRetry(), cfg.writePulseMs);
        } else {
          endRetry();
        }
        return res;
      }

      // safe method → bounded backoff 재시도
      if (attempt >= cfg.maxRetries) {
        leaveRetry();
        return res; // 소진 → 응답 그대로((a) 배너는 상위에서 소멸)
      }
      if (!enteredRetry) {
        enteredRetry = true;
        beginRetry();
      }
      const delay = backoffDelayMs(attempt, cfg);
      attempt += 1;
      await sleep(delay);
      // loop → 재시도
    }
  };

  return resilientFetch as typeof fetch;
}
