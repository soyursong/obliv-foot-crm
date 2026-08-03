/**
 * cband/protocol.ts — 코밴(Kovan) CAT 단말기 직결 결제 전문 조립·파싱·분류 순수 라이브러리
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 전문/파싱/classify 코어)
 *
 * 역할: 로컬 CAT 데몬(ws://127.0.0.1:8888)과 주고받는 결제 전문을 조립/파싱/분류하는
 *   **순수 함수** 계층. 프론트엔드(react·supabase·import.meta) 의존 0 → Deno unit 으로 결정론 커버.
 *   WS 송수신(부수효과)·수납 write(DB)는 상위 계층(catClient.ts / cbandPaymentFlow.ts)이 소비.
 *
 * ── 전문 조립 5대 규칙 (위반 시 실결제 실패, 티켓 §전문조립) ──────────────────
 *   0. ★봉투(T-20260804-CBAND-DATATYPE-HEADER-ENVELOPE): {"header":{…DATA_TYPE:"JSON"…},"body":{…}} 로 emit.
 *      데몬은 header 의 DATA_TYPE(전문형태)를 먼저 읽어 전문 종류를 판정 → header 누락 시 "DATA_TYPE 값이 없습니다" 거부.
 *      (응답은 flat — 봉투 아님. 요청측만 봉투. safeParse/normalize 는 flat 파싱 유지.)
 *   1. 콜론 뒤 공백 금지 — JSON.stringify 기본값 그대로(indent 미지정). 기본출력은 이미 공백無.
 *   2. MSG_TRACE 12자리 숫자, 중복 금지 — makeTrace() 가 12자리 보장 + 세션내 dedup. (★header 에 실림)
 *   3. TAMT 9자리 zero-pad — pad9(amount). (body)
 *   4. CAT_PORT 2자리 zero-pad — COM3 → "03". (body)
 *
 * ── 실측 vs 공식문서 차이 (티켓 §6, 반드시 실측 우선) ─────────────────────────
 *   1. TID 비우면 실제 거부 → buildMsg 가 TID 공백을 throw 로 강제(채울 것).
 *   2. 취소 응답 AUTHNO = 원거래 동일, TRANTYPE(0210/0430)으로만 구분 → classify/normalize 반영.
 *   3. FILLER offset 최대 9바이트 어긋남·기종구분 미수신 → safeParse 는 미지 필드에 관대(throw 안함).
 *   4. 요청 동시 1건 한도 → catClient 동시성 잠금(본 파일은 순수, 상위에서 강제).
 *
 * ── ★ 이중결제 방지(D, 티켓 §D — 후순위 금지 최우선 안전장치) ────────────────
 *   classify() 가 ATTENTION 을 반환하는 응답(C011/8003/8555/무응답)은 승인 여부가 **불확실**하다.
 *   → 자동 재시도 절대 금지. 상위 흐름은 '확인 필요'로 정지하고 MSG_TRACE 로 단말기 승인내역조회.
 */

// ── 전문 종류(TRANTYPE) — 실측: 취소 AUTHNO 는 원거래와 동일, TRANTYPE 으로만 승인/취소 구분 ──
export const TRANTYPE_APPROVE = '0210' as const; // 승인(신용승인)
export const TRANTYPE_CANCEL = '0430' as const;  // 취소(승인취소)
export type TranType = typeof TRANTYPE_APPROVE | typeof TRANTYPE_CANCEL;

// ── 응답 분류 ────────────────────────────────────────────────────────────────
//   APPROVED  : 승인/취소 성공(응답코드 성공 + AUTHNO 수신)
//   FAIL      : 명확한 실패(카드거절·사용자취소 등) — 과금 미발생 확정 → 재시도 안전
//   ATTENTION : ★불확실(과금 여부 불명) — 자동 재시도 금지·'확인 필요' 정지 (D 핵심)
export type PaymentClassification = 'APPROVED' | 'FAIL' | 'ATTENTION';

/** 승인 성공 응답코드(코밴 표준). "0000" = 정상승인. */
export const RESPONSE_CODE_SUCCESS = '0000' as const;

/**
 * ★ ATTENTION 응답코드 — 이중결제 방지 트리거 (티켓 §D).
 *   이 코드들 또는 '무응답(타임아웃)'은 승인 여부가 불확실 → 자동 재시도 금지, '확인 필요' 정지.
 *   C011 : 통신/응답 이상   8003 / 8555 : 단말 응답 이상.
 *   (무응답=timeout 은 코드가 없으므로 classify 가 별도 신호 raw===null 로 판단)
 */
export const ATTENTION_CODES: ReadonlySet<string> = new Set(['C011', '8003', '8555']);

/**
 * ★ DLL_RET(로컬 단말 DLL 반환코드) → 현장(실장) 표시 문구 매핑 — 표시 전용(additive).
 *   T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX ⑤: DLL_RET 참조표에 없던 -14 실 로그 발생 확인
 *   ('단말기에 IC 카드 이미 꽂힘'). 수신·분류(classify) 로직은 불변 — 사용자에게 보일 메시지만 사람이
 *   읽을 문구로 치환한다. 키는 문자열 정규화(trim) 후 비교. 표에 없는 DLL_RET 는 기존 폴백 문구 유지.
 *
 *   ★분류 관점: -14 는 '카드가 이미 꽂혀 있어 진행 불가' = 과금 미발생(재시도 안전) → classify 는
 *   기존대로 FAIL 로 판정된다(코드가 0000 아님·ATTENTION 집합 아님). 여기서는 그 FAIL 화면의 문구만
 *   자명한 안내로 바꾼다(자동 재시도/이중결제 방지 로직 무접촉).
 */
export const DLL_RET_MESSAGES: Readonly<Record<string, string>> = {
  '-14': '단말기에 IC(칩) 카드가 이미 꽂혀 있습니다. 카드를 뺀 뒤 다시 결제해 주세요.',
};

/** DLL_RET 코드로 표시 문구 조회(없으면 null). trim 정규화 후 비교. */
export function dllRetMessage(code: string | null | undefined): string | null {
  if (code == null) return null;
  const k = String(code).trim();
  return k in DLL_RET_MESSAGES ? DLL_RET_MESSAGES[k] : null;
}

// ── 요청 전문 파라미터 ───────────────────────────────────────────────────────
export interface BuildMsgParams {
  /** 전문 종류: 승인('0210') / 취소('0430'). */
  tranType: TranType;
  /** 단말기 ID(TID). ★실측: 비우면 거부됨 → 반드시 채울 것(공백/미지정 시 throw). */
  tid: string;
  /**
   * 가맹점번호(MERNO) — ★선택(optional). T-20260803-foot-CBAND-MERNO-REQFIELD-BUG(FIX-1):
   * MERNO 는 결제 '요청' 전문에 들어가는 값이 아니라(7/31 실승인 20필드 부재) 승인 '응답'에서만 온다.
   * 비었으면 요청 전문에서 아예 제외(MERNO 없이도 결제 성립). 값이 있으면 계승해 그대로 실어 보낸다.
   */
  merno?: string;
  /** 결제/취소 금액(원, 정수). TAMT 9자리 zero-pad 로 조립. */
  amount: number;
  /** CAT 포트. 숫자(3) 또는 "COM3"/"03" 문자열 허용 → 2자리 zero-pad. */
  catPort: number | string;
  /** 거래 추적번호(MSG_TRACE) 12자리 숫자. makeTrace() 로 생성. 중복 금지. */
  msgTrace: string;
  /** 취소(0430) 시 원거래 승인번호(AUTHNO). 승인(0210) 시 생략. */
  originalAuthNo?: string;
  /** 취소(0430) 시 원거래 승인일자(YYMMDD, 선택 — 단말/밴 요구 시). */
  originalAuthDate?: string;
}

// ── 정규화된 응답 ────────────────────────────────────────────────────────────
export interface NormalizedResponse {
  /** 전문 종류(0210 승인 / 0430 취소). 미수신 시 null. */
  tranType: string | null;
  /** 승인번호(AUTHNO). ★취소 응답도 원거래와 동일 값 — 구분은 tranType 으로. */
  authNo: string | null;
  /** 응답코드. ★실측 정본 = ERRCODE("0000"=성공, "9999"=메시지동반 실패). RESPCODE 등은 별칭 관용. */
  responseCode: string | null;
  /** ★DLL_RET(로컬 단말 DLL 반환코드, 예: '-14'). ERRCODE(밴 응답코드)와 별개 축 — 표시 매핑 전용(⑤). 없으면 null. */
  dllRet: string | null;
  /** 응답 메시지. ★실측 정본 = MSG1(+ ERRCODE=9999 시 ResultMessage 의 [-N] 패턴). */
  responseMessage: string | null;
  /** 가맹점번호(MERNO) — 수납기록 필수(정산 귀속 §11). */
  merno: string | null;
  /** 승인금액(TAMT, 파싱된 정수). 없으면 null. */
  amount: number | null;
  /** 거래 추적번호. ★실측 정본 = TRANSERIAL(요청 MSG_TRACE 가 그대로 되돌아옴, §5-3/§9). 유실 시 단말 승인내역조회 유일 키. */
  msgTrace: string | null;
  /** ★승인 거래일자(TRANDATE, YYMMDD). 취소 시 원거래 ORI_DATE 근거 + BINDING#3(paid_at=승인시각, 일경계 drift 방지). */
  tranDate: string | null;
  /** ★승인 거래시각(TRANTIME, HHMMSS). BINDING#3(paid_at=승인시각) 근거. */
  tranTime: string | null;
  /** 카드 관련 부가정보(카드사·할부 등, 있으면 원문 유지). */
  cardName: string | null;
  /** 파싱 원본(감사/디버그용). */
  raw: Record<string, unknown>;
}

// ── zero-pad 헬퍼 ────────────────────────────────────────────────────────────

/** TAMT 9자리 zero-pad (규칙 #3). 음수·비정수·9자리 초과는 실결제 실패 위험 → throw. */
export function pad9(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`TAMT 금액이 올바르지 않습니다(정수·0 이상): ${amount}`);
  }
  const s = String(amount);
  if (s.length > 9) throw new Error(`TAMT 9자리 초과: ${amount}`);
  return s.padStart(9, '0');
}

/**
 * CAT_PORT 2자리 zero-pad (규칙 #4). COM3 → "03".
 *   허용 입력: 숫자(3), "3", "03", "COM3"(대소문자 무관). → "03".
 */
export function pad2Port(catPort: number | string): string {
  let n: number;
  if (typeof catPort === 'number') {
    n = catPort;
  } else {
    const m = String(catPort).trim().toUpperCase().match(/(\d+)/);
    if (!m) throw new Error(`CAT_PORT 형식 오류: ${catPort}`);
    n = parseInt(m[1], 10);
  }
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`CAT_PORT 범위 오류(0~99): ${catPort}`);
  }
  return String(n).padStart(2, '0');
}

// ── MSG_TRACE 생성 (규칙 #2, 12자리 숫자, 중복 금지) ──────────────────────────
const _usedTraces = new Set<string>();

/**
 * 12자리 숫자 MSG_TRACE 생성. 세션 내 중복을 dedup 으로 회피(교차세션 유일성은 DB unique 로 강제).
 * @param isUsed 이미 사용된 trace 인지 판정(테스트/DB 대조 주입용). 기본은 세션 내 Set.
 * @param rng    0~1 난수 공급자(테스트 결정론 주입용). 기본 Math.random.
 */
export function makeTrace(
  isUsed: (t: string) => boolean = (t) => _usedTraces.has(t),
  rng: () => number = Math.random,
): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    // 12자리: 앞 6자리 = 시분초/밀리초 파생 불가(순수성 위해 난수), 12자리 전부 난수 dedup.
    let t = '';
    for (let i = 0; i < 12; i++) t += Math.floor(rng() * 10) % 10;
    if (t.length === 12 && /^\d{12}$/.test(t) && !isUsed(t)) {
      _usedTraces.add(t);
      return t;
    }
  }
  throw new Error('MSG_TRACE 생성 실패(중복 회피 재시도 초과)');
}

/** 12자리 숫자 MSG_TRACE 형식 검증. */
export function isValidTrace(t: string | null | undefined): t is string {
  return typeof t === 'string' && /^\d{12}$/.test(t);
}

// ── ★ 전문 봉투(header/body) 상수 — T-20260804-foot-CBAND-DATATYPE-HEADER-ENVELOPE-MISSING ─
//
//   데몬 오류 "DATA_TYPE 전문형태 값이 없습니다" = CRM 이 header 봉투를 통째로 안 보냄(현장 케이스 ②).
//   실 원인: 종전 buildMsg 는 flat 필드만 emit → 데몬이 전문 종류(DATA_TYPE)를 header 에서 못 찾아 즉시 거부.
//   → 데몬이 기대하는 {"header":{…DATA_TYPE:"JSON"…},"body":{…거래필드…}} 봉투로 조립한다.
//
//   ★header 필드값 = 추측 아님, 두 authoritative 예시로 확정:
//     (a) 현장 "정상 전문 예시"(T-20260804 티켓 §배경):
//         {"LENGTH":"0590","MSG_VERSION":"0002","TCODE":"S0","MSG_TRACE":"235112000001","DATA_TYPE":"JSON"}
//     (b) DAEMON-PARSE-ROBUST 티켓 §1 재확인: {"header":{"LENGTH":"0591","MSG_VERSION":"0002","TC…}}
//   ★body = 거래필드(TRANTYPE 로 승인/취소 구분). 7/31 실승인 20필드 body 에 TRANTYPE·MSG_TRACE 부재 →
//     MSG_TRACE 는 header 로 이동(canonical), TRANTYPE 은 body 유지(응답도 flat TRANTYPE echo·discriminator).
//   ★응답은 flat(예: {"ERRCODE":"0000","TRANTYPE":"0210",…}) — 봉투 아님 → safeParse/normalize 불변(요청측만 봉투).

/** header.DATA_TYPE — 전문형태(데몬이 header 에서 먼저 읽는 값). 항상 "JSON"(FIX-C). */
export const CBAND_DATA_TYPE = 'JSON' as const;
/** header.MSG_VERSION — 현장 정상 전문 예시 + PARSE-ROBUST 예시 공통 확정값. */
export const CBAND_MSG_VERSION = '0002' as const;
/** header.TCODE — 현장 정상 전문 예시 확정값("S0"). CAT 결제요청 전문형태 코드(승인/취소 구분은 body.TRANTYPE). */
export const CBAND_TCODE = 'S0' as const;

/**
 * UTF-8 바이트 길이 — header.LENGTH 산출용. TextEncoder 우선(브라우저·Node), 미지원 시 수동 폴백.
 * ASCII(코드·숫자) 위주라 대개 문자수와 동일하나, 정확성을 위해 UTF-8 바이트로 계산.
 */
export function utf8ByteLength(s: string): number {
  const g = globalThis as unknown as { TextEncoder?: new () => { encode(x: string): { length: number } } };
  if (typeof g.TextEncoder === 'function') return new g.TextEncoder().encode(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // surrogate pair(4바이트)
    else n += 3;
  }
  return n;
}

/**
 * header.LENGTH — ★body(데이터부) JSON 문자열의 UTF-8 바이트수 4자리 zero-pad(FIX-B, 현장 예시 "0590").
 *   LENGTH 는 header 안에 들어가므로 '전체 전문' 길이일 수 없다(순환) → 데이터부(body) 길이(비순환).
 *   현장 예시 590~591 크기도 20필드 body 규모와 정합(header 포함 아님).
 */
export function bodyLength(bodyStr: string): string {
  return String(utf8ByteLength(bodyStr)).padStart(4, '0');
}

// ── buildMsg — 요청 전문 조립 (규칙 1~4 + 봉투 강제) ─────────────────────────

/**
 * 코밴 CAT 요청 전문(JSON 문자열)을 조립한다.
 *   · ★봉투(T-20260804): {"header":{…DATA_TYPE:"JSON"…},"body":{…거래필드…}} 로 emit(데몬 header 요구 충족).
 *   · 규칙#1 콜론 뒤 공백 금지 → JSON.stringify 기본출력(indent 미지정)으로 보장.
 *   · 규칙#2 MSG_TRACE 12자리 숫자 → isValidTrace 강제(★header 로 이동).
 *   · 규칙#3 TAMT 9자리 zero-pad → pad9.
 *   · 규칙#4 CAT_PORT 2자리 zero-pad → pad2Port.
 *   · 실측#1 TID 비우면 거부 → 공백 TID throw.
 *   · 실측#2 취소는 TRANTYPE=0430 + 원거래 AUTHNO 동봉(body).
 * @returns { message: 봉투 JSON 문자열, fields: body 거래필드(하위호환 alias), header, body, envelope }
 * @throws  규칙/실측/봉투 위반 시(실결제 실패 방지 — 조립 단계에서 차단).
 */
export function buildMsg(params: BuildMsgParams): {
  message: string;
  fields: Record<string, string>;
  header: Record<string, string>;
  body: Record<string, string>;
  envelope: { header: Record<string, string>; body: Record<string, string> };
} {
  const { tranType, tid, merno, amount, catPort, msgTrace, originalAuthNo, originalAuthDate } = params;

  // 실측#1: TID 비우면 실제 거부 → 강제 채움.
  if (!tid || !tid.trim()) {
    throw new Error('TID 가 비어 있습니다(실측: 비우면 단말이 거부). TID 를 채워야 합니다.');
  }
  // ★FIX-1(MERNO-REQFIELD-BUG): MERNO 는 요청 전문에 없고 승인 응답에서만 온다 → 유무검사 제거.
  //   결제 개시 조건은 TID + CAT_PORT 만. MERNO 빈값이어도 결제 성립(순환참조 해소).
  // 규칙#2: MSG_TRACE 12자리 숫자.
  if (!isValidTrace(msgTrace)) {
    throw new Error(`MSG_TRACE 는 12자리 숫자여야 합니다: ${msgTrace}`);
  }
  if (tranType !== TRANTYPE_APPROVE && tranType !== TRANTYPE_CANCEL) {
    throw new Error(`TRANTYPE 오류(0210/0430만 허용): ${tranType}`);
  }
  // 실측#2: 취소는 원거래 AUTHNO 필수(원거래와 동일 값을 그대로 전송).
  if (tranType === TRANTYPE_CANCEL && (!originalAuthNo || !originalAuthNo.trim())) {
    throw new Error('취소(0430) 전문에는 원거래 승인번호(AUTHNO)가 필요합니다.');
  }

  // ── body(데이터부) = 실 거래필드. MSG_TRACE 는 header 로 이동(7/31 실승인 20필드 body 부재 정합). ──
  const body: Record<string, string> = {
    TRANTYPE: tranType,            // ★body 유지: 응답도 flat TRANTYPE echo·승인/취소 discriminator
    TID: tid.trim(),
    CAT_PORT: pad2Port(catPort),   // 규칙#4
    TAMT: pad9(amount),            // 규칙#3
  };
  // ★FIX-1(MERNO-REQFIELD-BUG): MERNO 는 요청에 주입하지 않는다(7/31 실승인 20필드 부재).
  //   값이 명시적으로 있을 때만 계승해 실어 보내고, 빈값(정상)은 전문에서 제외한다.
  if (merno && merno.trim()) {
    body.MERNO = merno.trim();
  }
  if (tranType === TRANTYPE_CANCEL) {
    body.AUTHNO = (originalAuthNo as string).trim();     // 실측#2: 원거래 동일 AUTHNO
    if (originalAuthDate && originalAuthDate.trim()) body.AUTHDATE = originalAuthDate.trim();
  }

  // ── header(머리말) — 데몬이 먼저 읽는 전문형태(DATA_TYPE). 필드값은 현장 정상 전문 예시로 확정(§상수). ──
  //   순서는 현장 예시(LENGTH·MSG_VERSION·TCODE·MSG_TRACE·DATA_TYPE)에 맞춤(literal 매칭 데몬 대비).
  const bodyStr = JSON.stringify(body);           // 규칙#1: space 인자 미지정(콜론 뒤 공백 0)
  const header: Record<string, string> = {
    LENGTH: bodyLength(bodyStr),                   // FIX-B: body 바이트수 4자리 zero-pad
    MSG_VERSION: CBAND_MSG_VERSION,
    TCODE: CBAND_TCODE,
    MSG_TRACE: msgTrace,                           // 규칙#2(★header 로 이동)
    DATA_TYPE: CBAND_DATA_TYPE,                     // FIX-C: 항상 "JSON"
  };

  // ── 봉투 조립 ──
  const envelope = { header, body };
  // 규칙#1: 콜론 뒤 공백 금지 = JSON.stringify 기본출력(space 인자 미지정).
  const message = JSON.stringify(envelope);
  // 방어(회귀 가드): 콜론 뒤 공백 시 조립 차단(현장 케이스 ④⑤ 불가).
  if (/:\s/.test(message)) {
    throw new Error('전문에 콜론 뒤 공백이 포함됨(규칙#1 위반).');
  }
  // ★FIX-C 방어: DATA_TYPE 항상 존재·비어있지 않음(현장 케이스 ②③ 불가 — 데몬 "DATA_TYPE 값이 없습니다" 재발 차단).
  if (!header.DATA_TYPE || !header.DATA_TYPE.trim()) {
    throw new Error('header.DATA_TYPE(전문형태) 가 비어 있습니다 — 데몬이 전문을 거부합니다.');
  }
  // fields = body alias(하위호환: 기존 테스트/소비자가 fields.TID/TAMT/MERNO 참조).
  return { message, fields: body, header, body, envelope };
}

// ── safeParse — 응답 전문 안전 파싱 (실측#3: FILLER offset·미지필드 관대) ─────

/**
 * 단말 응답(문자열/객체)을 안전하게 파싱한다. 실측#3(FILLER offset 어긋남·기종구분 미수신)에 관대 —
 * 알 수 없는 필드나 여분 바이트가 있어도 throw 하지 않고 파싱 가능한 부분만 취한다.
 * @returns 파싱된 raw 객체. 파싱 완전 실패(빈응답/깨진 JSON) 시 null.
 */
export function safeParse(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  const s = String(raw).trim();
  if (!s) return null;
  // 1차: 그대로 JSON 시도.
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') return o as Record<string, unknown>;
  } catch { /* 아래 관대 파싱으로 폴백 */ }
  // 2차(실측#3): 앞뒤 여분 바이트/FILLER 로 어긋난 경우 첫 '{' ~ 마지막 '}' 만 취해 재시도.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(s.slice(start, end + 1));
      if (o && typeof o === 'object') return o as Record<string, unknown>;
    } catch { /* 파싱 불가 */ }
  }
  return null;
}

/** raw 객체에서 대소문자·별칭을 관대하게 조회. */
function pick(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    for (const actual of Object.keys(raw)) {
      if (actual.toUpperCase() === k.toUpperCase()) {
        const v = raw[actual];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) return s;
      }
    }
  }
  return null;
}

/**
 * safeParse 결과를 CRM 표준 필드로 정규화한다(별칭·대소문자 관대).
 * 미지 필드는 무시(실측#3), 필수축만 안정 추출.
 *
 * ★ 실측 정본 필드명(35KB SSOT §5-3/부록 실측 원문, 공개 HTTPS 재실증 2회) 우선:
 *   응답코드=ERRCODE / 추적번호=TRANSERIAL / 메시지=MSG1(+9999 시 ResultMessage) /
 *   승인번호=AUTHNO(trailing space → pick 이 trim) / 거래일시=TRANDATE·TRANTIME /
 *   카드사=ISSUECARD·PURCHASECARD. RESPCODE/MSG_TRACE 등 종전 추정 별칭은 관용 폴백으로 보존.
 */
export function normalize(parsed: Record<string, unknown> | null): NormalizedResponse {
  const raw = parsed ?? {};
  const amountStr = pick(raw, ['TAMT', 'AMOUNT', 'APPRAMT']);
  const amount = amountStr != null && /^\d+$/.test(amountStr) ? parseInt(amountStr, 10) : null;
  return {
    tranType: pick(raw, ['TRANTYPE', 'TRAN_TYPE', 'TRAN']),
    authNo: pick(raw, ['AUTHNO', 'APPRNO', 'APPROVALNO', 'AUTH_NO']),
    // ★ERRCODE 가 실측 정본 판정 필드(0000=성공). RESPCODE 계열은 종전 추정 별칭(관용 폴백).
    responseCode: pick(raw, ['ERRCODE', 'RESPCODE', 'RESPONSECODE', 'RESCODE', 'RESULTCODE', 'CODE']),
    // ★DLL_RET(로컬 단말 DLL 반환코드) — ERRCODE 와 별개. ⑤ 표시 매핑용(추출만, classify 미참여).
    dllRet: pick(raw, ['DLL_RET', 'DLLRET', 'DLL_RETURN', 'DLLRETURN', 'RETURNCODE', 'RETCODE']),
    // ★MSG1 이 실측 정본 서버 메시지. ERRCODE=9999 실패 시 ResultMessage 의 [-N] 패턴도 함께.
    responseMessage: pick(raw, ['MSG1', 'RESULTMESSAGE', 'RESULT_MESSAGE', 'RESPMSG', 'RESPONSEMESSAGE', 'RESMSG', 'MESSAGE', 'MSG']),
    merno: pick(raw, ['MERNO', 'MERCHANTNO', 'MID']),
    amount,
    // ★TRANSERIAL 이 실측 정본(요청 MSG_TRACE 가 그대로 echo). MSG_TRACE 계열은 관용 폴백.
    msgTrace: pick(raw, ['TRANSERIAL', 'MSG_TRACE', 'MSGTRACE', 'TRACE', 'TRACENO']),
    tranDate: pick(raw, ['TRANDATE', 'TRAN_DATE', 'ORI_DATE']),
    tranTime: pick(raw, ['TRANTIME', 'TRAN_TIME']),
    // ★ISSUECARD(발급사)/PURCHASECARD(매입사)가 실측 정본. 종전 추정 별칭도 폴백.
    cardName: pick(raw, ['ISSUECARD', 'PURCHASECARD', 'CARDNAME', 'ISSUER', 'CARD_NM', 'CARDCO']),
    raw,
  };
}

// ── classify — ★ 이중결제 방지 핵심(티켓 §D) ──────────────────────────────────

/**
 * 응답을 3분류한다. 이중결제 방지의 심장 — ATTENTION 은 절대 자동 재시도하지 않는다.
 *
 * @param resp    normalize() 결과. **무응답(타임아웃)은 반드시 null 을 넘길 것** → ATTENTION.
 * @returns
 *   'ATTENTION' : ★불확실(무응답 or C011/8003/8555). 자동 재시도 금지·'확인 필요' 정지.
 *   'APPROVED'  : 성공(RESPCODE=0000 + AUTHNO 수신).
 *   'FAIL'      : 명확한 실패(그 외 응답코드). 과금 미발생 확정 → 재시도 안전.
 *
 * ★ 무응답을 FAIL 로 오분류하면 자동 재시도 → 이중결제 사고. 반드시 null → ATTENTION 경로 유지.
 */
export function classify(resp: NormalizedResponse | null): PaymentClassification {
  // 무응답(타임아웃/연결끊김): 승인이 단말에서 성립했을 수 있음 → ATTENTION.
  if (resp == null) return 'ATTENTION';

  const code = resp.responseCode;

  // 응답코드가 ATTENTION 집합이면 불확실 → 정지.
  if (code != null && ATTENTION_CODES.has(code.toUpperCase())) return 'ATTENTION';

  // 성공: 코드 0000 + 승인번호 수신.
  if (code === RESPONSE_CODE_SUCCESS && resp.authNo) return 'APPROVED';

  // 응답코드 자체가 없는데 raw 도 비어있다시피 하면(파싱 실패에 준함) 불확실 → ATTENTION.
  if (code == null && !resp.authNo && Object.keys(resp.raw).length === 0) return 'ATTENTION';

  // 그 외 명확한 응답코드 = 실패(거절/취소불가 등). 과금 미발생 → 재시도 안전.
  return 'FAIL';
}

// ── 응답코드별 사용자 메시지 (티켓 §E) ───────────────────────────────────────

/**
 * 분류·응답코드에 대응하는 현장(태블릿) 사용자 메시지. 개발용어 배제, 한국어.
 * '확인 필요'(ATTENTION)는 자동 재시도 금지 안내를 명시한다.
 */
export function responseMessageForUser(cls: PaymentClassification, resp: NormalizedResponse | null): string {
  if (cls === 'APPROVED') {
    return resp?.tranType === TRANTYPE_CANCEL ? '취소가 완료되었습니다.' : '결제가 승인되었습니다.';
  }
  if (cls === 'ATTENTION') {
    return '결제 결과를 확인할 수 없습니다. 카드가 승인되었을 수 있으니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요. (확인 필요)';
  }
  // FAIL
  // ⑤ DLL_RET 표시 매핑(additive) — dllRet 또는 responseCode 가 DLL_RET 표에 있으면 자명한 안내로 치환.
  //    (예: -14 = 단말기에 IC 카드 이미 꽂힘). 표에 없으면 기존 폴백(메시지 → 코드 → 일반문구) 유지.
  const dllMsg = dllRetMessage(resp?.dllRet) ?? dllRetMessage(resp?.responseCode);
  if (dllMsg) return dllMsg;
  const msg = resp?.responseMessage;
  if (msg) return `결제가 처리되지 않았습니다: ${msg}`;
  const code = resp?.responseCode;
  return code ? `결제가 처리되지 않았습니다 (코드 ${code}). 다시 시도해 주세요.` : '결제가 처리되지 않았습니다. 다시 시도해 주세요.';
}
