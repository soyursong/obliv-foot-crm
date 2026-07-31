/**
 * cband/catClient.ts — 로컬 CAT 데몬(ws://127.0.0.1:8888) WebSocket 클라이언트
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · WS 송수신 계층)
 *
 * 역할: 코밴 CAT 데몬과의 WS 연결·송수신(부수효과) 담당. 전문 조립/파싱/분류는 protocol.ts(순수).
 *   A. probeTerminal() — WS **열고 닫기만**(결제 요청 없음) → 단말 존재 여부 판정(버튼 조건부 노출).
 *   B/C. send() — 요청 전문 송신 + 응답 수신 + 타임아웃. ★요청 동시 1건 한도(실측#4) 강제.
 *
 * ★ 실측#4(동시 1건 한도): 중복 요청은 무응답으로 닫히므로, in-flight 요청이 있으면 새 send 를 거부.
 * ★ 무응답(타임아웃)은 protocol.classify 에서 ATTENTION → 자동 재시도 금지·'확인 필요'(이중결제 방지 D).
 */

export const CBAND_WS_URL = 'ws://127.0.0.1:8888';

/** 승인/취소 응답 대기 타임아웃(ms). 실측: 승인 8초·취소 7초 → 여유 포함 25초. (티켓 §7-5) */
export const CBAND_SEND_TIMEOUT_MS = 25_000;
/** probe 연결 타임아웃(ms) — 단말 없으면 빠르게 숨김. */
export const CBAND_PROBE_TIMEOUT_MS = 1_500;

type WSCtor = new (url: string) => WebSocket;

function resolveWS(): WSCtor | null {
  const g = globalThis as unknown as { WebSocket?: WSCtor };
  return g.WebSocket ?? null;
}

/**
 * probeTerminal — WS 를 열고 즉시 닫기만 한다(결제 요청 절대 없음).
 *   성공(onopen 도달) → true(단말 데몬 구동중 → 결제 버튼 노출).
 *   실패/타임아웃 → false(단말 없는 PC → 결제 버튼 숨김, 티켓 §3-2/시나리오2).
 */
export function probeTerminal(
  url: string = CBAND_WS_URL,
  timeoutMs: number = CBAND_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const WS = resolveWS();
  if (!WS) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WS(url);
      ws.onopen = () => finish(true);   // 열림 = 데몬 구동 → 즉시 닫고 true
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false); // onopen 전 close = 실패
    } catch {
      finish(false);
    }
  });
}

export interface SendResult {
  /** 원 응답 문자열(수신). 무응답/타임아웃이면 null. */
  raw: string | null;
  /** 무응답(타임아웃/연결끊김)으로 응답을 못 받았는지 — classify 에 ATTENTION 신호로 전달. */
  timedOut: boolean;
  /** 요청에 사용한 MSG_TRACE(응답 유실 시 단말 승인내역조회 키). */
  msgTrace: string;
}

// ── ★ 요청 동시 1건 한도(실측#4) — 모듈 단일 락 ──────────────────────────────
let _inFlight = false;
/** 테스트/복구용: 강제 언락(정상 흐름은 send 가 finally 로 자동 해제). */
export function _resetInFlight(): void { _inFlight = false; }
export function isSendInFlight(): boolean { return _inFlight; }

/** 동시 요청 시 던지는 에러(상위에서 '이미 진행 중' 안내). */
export class CbandBusyError extends Error {
  constructor() { super('결제 요청이 이미 진행 중입니다(동시 1건 한도).'); this.name = 'CbandBusyError'; }
}

/**
 * send — 요청 전문을 WS 로 보내고 응답 1건을 기다린다. 타임아웃 시 timedOut=true, raw=null.
 *   ★ 동시성 잠금: in-flight 요청이 있으면 CbandBusyError throw(실측#4 — 중복요청 무응답 방지).
 *   ★ 무응답을 '실패'가 아닌 timedOut=true 로 리턴 → 상위 classify 가 ATTENTION 처리(이중결제 방지).
 *
 * @param message  buildMsg() 로 조립된 요청 전문(JSON 문자열).
 * @param msgTrace 요청의 MSG_TRACE(응답 유실 대비 반환).
 */
export function send(
  message: string,
  msgTrace: string,
  opts: { url?: string; timeoutMs?: number } = {},
): Promise<SendResult> {
  const url = opts.url ?? CBAND_WS_URL;
  const timeoutMs = opts.timeoutMs ?? CBAND_SEND_TIMEOUT_MS;

  if (_inFlight) return Promise.reject(new CbandBusyError());
  const WS = resolveWS();
  if (!WS) return Promise.reject(new Error('WebSocket 을 사용할 수 없는 환경입니다.'));

  _inFlight = true;
  return new Promise<SendResult>((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (raw: string | null, timedOut: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      _inFlight = false;
      try { ws?.close(); } catch { /* ignore */ }
      resolve({ raw, timedOut, msgTrace });
    };
    // 타임아웃 = 무응답 → timedOut=true, raw=null → classify ATTENTION(자동 재시도 금지).
    const timer = setTimeout(() => finish(null, true), timeoutMs);
    try {
      ws = new WS(url);
      ws.onopen = () => { try { ws?.send(message); } catch { finish(null, true); } };
      ws.onmessage = (ev: MessageEvent) => finish(typeof ev.data === 'string' ? ev.data : String(ev.data), false);
      // 응답 전 error/close = 무응답 처리(ATTENTION). '실패(FAIL)'로 내리지 않는다 — 승인 성립 가능성.
      ws.onerror = () => finish(null, true);
      ws.onclose = () => { if (!done) finish(null, true); };
    } catch {
      finish(null, true);
    }
  });
}
