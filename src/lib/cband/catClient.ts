/**
 * cband/catClient.ts — 로컬 CAT 데몬(ws://127.0.0.1:8888) WebSocket 클라이언트
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · WS 송수신 계층)
 *
 * 역할: 코밴 CAT 데몬과의 WS 연결·송수신(부수효과) 담당. 전문 조립/파싱/분류는 protocol.ts(순수).
 *   A. probeTerminal() — WS **열고 닫기만**(결제 요청 없음) → 단말 존재/권한 상태 판정(버튼 조건부 노출).
 *   B/C. send() — 요청 전문 송신 + 응답 수신 + 타임아웃. ★요청 동시 1건 한도(실측#4) 강제.
 *
 * ★ 실측#4(동시 1건 한도): 중복 요청은 무응답으로 닫히므로, in-flight 요청이 있으면 새 send 를 거부.
 * ★ 무응답(타임아웃)은 protocol.classify 에서 ATTENTION → 자동 재시도 금지·'확인 필요'(이중결제 방지 D).
 *
 * ── ★ 스펙 갱신 v2 (2026-07-31 최필경 총괄, MSG-20260731-170753-p2f3) ─────────────
 *   U1 (§4-1 정정): 공개 HTTPS 운영주소(https://obliv-foot-crm.pages.dev)에서 로컬 ws://127.0.0.1
 *      최초 접속 시 브라우저 권한창이 뜬다(이전 "권한 불필요"는 로컬파일 기준 오기). 권한은 도메인
 *      단위 저장 → prod_url 고정. [허용]=해당 PC 영구 / [차단]=해당 PC 결제 영구 불가.
 *   U2 (§6-5): WebSocket 동시 1개만. 소켓 2개 동시 오픈 → 권한요청 2건 → 둘 다 거절 → 결제 실패.
 *      → cancelProbe() 로 탐침 소켓을 닫은 뒤에만 결제 소켓을 연다.
 *   U3 (probeTerminal 3분기): boolean → 'ok' | 'awaiting' | 'blocked'.
 *      ok=권한허용+데몬구동 / awaiting=권한창 대기중(버튼 숨기지 않음) / blocked=[차단] 또는 데몬꺼짐.
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
 * ★U3: probeTerminal 결과 3분기(기존 boolean 대체).
 *   'ok'       — WS onopen 도달 = 데몬 구동중 + 브라우저 권한 허용됨 → 결제 버튼 노출.
 *   'awaiting' — 타임아웃까지 open/error 모두 미도달 = 브라우저 권한창이 뜬 채 사용자가
 *                아직 [허용/차단]을 안 누른 상태(소켓 CONNECTING 유지). ★버튼 숨기지 않음
 *                (boolean 시절 버튼이 사라지던 버그 방지) → 버튼 유지 + 권한 허용 안내.
 *   'blocked'  — open 전 error/close = 연결 실패. 브라우저 [차단] 또는 데몬 꺼짐(둘의 증상이
 *                동일해 WS API 로 구분 불가·U1) → 안내문구로 두 원인을 함께 노출.
 */
export type ProbeResult = 'ok' | 'awaiting' | 'blocked';

// ── ★U2/§6-5: WebSocket 동시 1개만 — 탐침(probe) 소켓 단일 참조 ────────────────
let _probeWs: WebSocket | null = null;

/**
 * cancelProbe — 진행 중이던 탐침 소켓을 즉시 닫는다.
 *   ★U2/§6-5: 소켓 2개(탐침+결제)를 동시에 열면 브라우저 권한요청이 2건 뜨고, 둘 다 거절되어
 *   단말이 정상인데도 결제가 실패한다. 결제 소켓을 열기 직전 반드시 호출(send 내부에서 자동 호출).
 *   또한 다음 probe 시작 전에도 호출해 탐침 소켓이 항상 1개만 존재하도록 보장한다.
 */
export function cancelProbe(): void {
  if (_probeWs) {
    try { _probeWs.close(); } catch { /* ignore */ }
    _probeWs = null;
  }
}

export function probeTerminal(
  url: string = CBAND_WS_URL,
  timeoutMs: number = CBAND_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const WS = resolveWS();
  // WS 미지원 환경 = 결제 불가(차단과 동일 취급 — 버튼 대신 안내).
  if (!WS) return Promise.resolve('blocked');
  cancelProbe(); // ★U2: 이전 탐침 잔여 소켓 정리(동시 1개 보장)
  return new Promise<ProbeResult>((resolve) => {
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (r: ProbeResult, closeSocket: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (closeSocket) {
        try { ws?.close(); } catch { /* ignore */ }
        if (_probeWs === ws) _probeWs = null;
      }
      resolve(r);
    };
    // 타임아웃: onopen/onerror 모두 미도달 = CONNECTING 유지 = 브라우저 권한창 대기 → awaiting.
    // ★awaiting 은 소켓을 닫지 않는다(사용자가 [허용] 누르면 이어서 open 가능). cancelProbe 로만 닫음.
    const timer = setTimeout(() => finish('awaiting', false), timeoutMs);
    try {
      ws = new WS(url);
      _probeWs = ws;
      ws.onopen = () => finish('ok', true);        // 열림 = 데몬 구동 + 권한 허용 → 즉시 닫고 ok
      ws.onerror = () => finish('blocked', true);  // [차단] 또는 데몬 꺼짐(구분 불가·U1)
      ws.onclose = () => finish('blocked', true);  // onopen 전 close = 실패
    } catch {
      finish('blocked', true);
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

  // ★U2/§6-5: 탐침 소켓을 먼저 닫고 결제 소켓을 연다(동시 1개 — 권한요청 2건·중복무응답 방지).
  cancelProbe();
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
