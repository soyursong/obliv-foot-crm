/**
 * cband/receiptReprint.ts — 코밴 CAT 단말기 영수증 재출력(전표출력) 순수 라이브러리 + 오케스트레이션
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260813-foot-PAYHIST-RECEIPT-REPRINT-TERMINAL1 (결제내역에서 지난 결제 영수증 재출력)
 *
 * 역할: 결제내역(일마감 결제내역) 페이지에서 이미 승인된 플랜A 결제의 영수증을
 *   **1번 단말기(카운터/퍼시트, 이 PC에 연결된 단말)로 재출력(reprint)** 하는 전문 조립·오케스트레이션.
 *
 * ── ★ 벤더 스펙 (SSOT, 확정 MSG-20260813-122045-d41r · 통합_WEB POS 연동 인터페이스-v2.1_260108 §2.2-2) ─
 *   전표출력 = **금전 무이동 재출력** 전용 명령(신규 결제/승인/취소 아님).
 *     · header.TCODE = "XP"       (전표출력 — CAT단말기 및 POS프린터)
 *     · body.DEVICE_TYPE = "PRIN" (프린터 라우팅 — 결제(CAT_)와 별개)
 *     · body.CAT_PORT = "01"~"99" (프린터가 물린 시리얼 포트 = 이 PC 로컬 단말)
 *     · body.CAT_BAUDRATE = "38400"
 *     · body.P_ECSPOS_CMD1 = 인쇄할 내용(ESC/POS 표준 문자열)
 *
 * ── ★★ 재출력-only 불변식 (티켓 AC3 · risk_verdict GO_WARN #3) ──────────────────
 *   이 경로는 **결제/승인/취소 전문을 절대 만들지 않는다**. TRANTYPE(0210/0430)·TAMT·AUTHNO 요청필드 부재.
 *   → 구조적으로 신규 결제/재승인/중복 매출을 유발할 수 없다(금전 무이동).
 *   또한 payments/package_payments/cband_payment_attempts **어떤 테이블에도 write 하지 않는다**
 *   (재출력은 이미 저장된 승인데이터를 종이로 다시 뽑을 뿐 — 감사/매출 레코드 생성 0).
 *
 * ── ★ 라우팅: "1번 단말기" = 이 PC에 연결된 로컬 단말(카운터/퍼시트) ─────────────────
 *   전표출력은 시리얼 CAT_PORT 로 물린 **로컬 프린터**에 인쇄한다(원격 TID 라우팅 불가·시리얼 물리연결).
 *   → CAT_PORT/CAT_BAUDRATE = 이 PC의 단말 설정(getTerminalConfig). 원거래 TID/승인번호는 **인쇄 내용**에
 *     실려 어느 결제였는지 식별하게 한다(라우팅 키가 아니라 표시 데이터). 다른 좌석으로 오출력될 여지 없음
 *     (물리 시리얼 = 이 PC 카운터 단말 1대). 총괄 문언 "1번 단말기 = 카운터/퍼시트"와 정합.
 *
 * 순수성: 프론트(react·supabase·import.meta) 의존 0. WS 송수신(부수효과)만 catClient.send 주입으로 분리.
 */

import {
  bodyLength, isValidTrace, makeTrace, normalize, pad2Port, safeParse,
  CBAND_CAT_BAUDRATE, CBAND_DATA_TYPE, CBAND_MSG_VERSION, RESPONSE_CODE_SUCCESS,
  type NormalizedResponse,
} from './protocol';
import { fmtHalbu, fmtTranDate, fmtTranTime, fmtTranType } from './payInfoView';
import { send as wsSend, type SendResult } from './catClient';

/** header.TCODE — 전표출력(재출력). 결제(S0)/취소(S1)와 별개 축. 벤더 스펙 확정값. */
export const CBAND_TCODE_REPRINT = 'XP' as const;
/** body.DEVICE_TYPE — 프린터 라우팅. 결제("CAT_")와 별개. 벤더 스펙 확정값. */
export const CBAND_DEVICE_TYPE_PRIN = 'PRIN' as const;

// ── ESC/POS 제어코드(표준) ────────────────────────────────────────────────────
//   JSON.stringify 는 제어문자를  등으로 이스케이프(유효 JSON) → 데몬이 P_ECSPOS_CMD1 을 디코드해 인쇄.
const ESC = '\x1B';
const GS = '\x1D';
/** 프린터 초기화(ESC @). */
const ESCPOS_INIT = `${ESC}@`;
/** 가운데 정렬 / 왼쪽 정렬. */
const ESCPOS_ALIGN_CENTER = `${ESC}a\x01`;
const ESCPOS_ALIGN_LEFT = `${ESC}a\x00`;
/** 굵게 on/off. */
const ESCPOS_BOLD_ON = `${ESC}E\x01`;
const ESCPOS_BOLD_OFF = `${ESC}E\x00`;
/** 용지 피드(4줄) 후 부분 절단(GS V 1). */
const ESCPOS_FEED_CUT = `\n\n\n\n${GS}V\x01`;

/** 재출력 대상 결제의 저장된 승인데이터(cband_payment_attempts 조회 결과에서 파생·표시용 subset). */
export interface ReceiptData {
  /** 거래구분(0210 승인 / 0430 취소). */
  tranType?: string | null;
  /** 승인번호(AUTHNO). */
  authNo?: string | null;
  /** 승인금액(원). */
  amount?: number | null;
  /** 할부 코드('00'/'03' 등). */
  halbu?: string | null;
  /** 마스킹 카드번호(단말 verbatim). 평문 PAN 은 상위에서 이미 마스킹(payInfoView.maskCardNo). */
  cardNoMasked?: string | null;
  /** 발급사·매입사. */
  cardName?: string | null;
  /** 승인일자(YYMMDD). */
  tranDate?: string | null;
  /** 승인시각(HHMMSS). */
  tranTime?: string | null;
  /** 단말기번호(TID) — 원거래 식별 표시(라우팅 키 아님). */
  tid?: string | null;
  /** 가맹점번호(MERNO). */
  merno?: string | null;
  /** 거래고유번호(TRANSERIAL, msg_trace 12자리). */
  msgTrace?: string | null;
}

/** 천단위 콤마(순수·로케일 무관 — Intl 미사용, 결정론). */
function comma(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(Math.trunc(n)));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${out}` : out;
}

/** 라벨/값 한 줄(라벨 좌측 고정폭, 값 우측). ESC/POS 는 모노폭 → 공백 패딩으로 정렬. */
function line(label: string, value: string): string {
  return `${label}  ${value}`;
}

/**
 * ★ 영수증(카드매출전표) 재발행 본문(P_ECSPOS_CMD1) 조립 — 순수·결정론.
 *   저장된 승인데이터를 사람이 읽을 수 있는 매출전표로 렌더한다. **금전 무이동**(인쇄 내용일 뿐).
 *   상단에 "재발행"을 명시해 원본 전표와 혼동/이중 회계 처리되지 않게 한다(현장 명확성).
 *   ESC/POS 제어코드는 표준 init/정렬/굵게/절단만 사용(폰트·바코드 등 확장 미사용 — 호환성 보수).
 */
export function buildReceiptContent(data: ReceiptData): string {
  const rule = '--------------------------------';
  const parts: string[] = [];
  parts.push(ESCPOS_INIT);
  parts.push(ESCPOS_ALIGN_CENTER);
  parts.push(ESCPOS_BOLD_ON);
  parts.push('카드 매출전표 (재발행)');
  parts.push(ESCPOS_BOLD_OFF);
  parts.push(ESCPOS_ALIGN_LEFT);
  parts.push(rule);
  parts.push(line('거래구분', fmtTranType(data.tranType)));
  if (data.cardName && data.cardName.trim()) parts.push(line('카드사  ', data.cardName.trim()));
  if (data.cardNoMasked && data.cardNoMasked.trim()) parts.push(line('카드번호', data.cardNoMasked.trim()));
  parts.push(line('할부    ', fmtHalbu(data.halbu)));
  parts.push(line('금액    ', data.amount != null ? `${comma(data.amount)}원` : '—'));
  parts.push(line('승인번호', data.authNo && data.authNo.trim() ? data.authNo.trim() : '—'));
  parts.push(line('승인일자', fmtTranDate(data.tranDate)));
  parts.push(line('승인시각', fmtTranTime(data.tranTime)));
  parts.push(line('단말기  ', data.tid && data.tid.trim() ? data.tid.trim() : '—'));
  if (data.merno && data.merno.trim()) parts.push(line('가맹점  ', data.merno.trim()));
  parts.push(line('거래고유', data.msgTrace && data.msgTrace.trim() ? data.msgTrace.trim() : '—'));
  parts.push(rule);
  parts.push(ESCPOS_ALIGN_CENTER);
  parts.push('※ 재발행 전표입니다');
  parts.push(ESCPOS_ALIGN_LEFT);
  parts.push(ESCPOS_FEED_CUT);
  return parts.join('\n');
}

/** buildReprintMsg 파라미터. */
export interface BuildReprintMsgParams {
  /** 인쇄할 내용(ESC/POS). buildReceiptContent 산출물. */
  content: string;
  /** 프린터가 물린 시리얼 포트(이 PC 로컬 단말). 숫자/"COM3"/"03" 허용 → 2자리 zero-pad. */
  catPort: number | string;
  /** 통신속도 — 기본 38400 고정(현장 세팅 SSOT). */
  catBaudrate?: string;
  /** 거래 추적번호(12자리). 미지정 시 makeTrace() 생성. */
  msgTrace?: string;
}

/** 전표출력에 필요한 body 필드 전집합(벤더 스펙 §2.2-2). */
export const CBAND_REPRINT_REQUIRED_BODY_FIELDS: readonly string[] = [
  'DEVICE_TYPE', 'CAT_PORT', 'CAT_BAUDRATE', 'P_ECSPOS_CMD1',
] as const;

/**
 * ★ 전표출력(재출력) 요청 전문 조립 — {"header":{…TCODE:"XP"…},"body":{DEVICE_TYPE:"PRIN"…}}.
 *   결제 전문(buildMsg)과 봉투 형태는 같으나 header.TCODE=XP · body=프린터 필드뿐(거래필드 0).
 *   ★TRANTYPE/TAMT/AUTHNO 요청필드 부재 = 금전 무이동(신규 결제/승인/취소 절대 불가 — AC3 구조적 보장).
 *   콜론 뒤 공백 금지(규칙#1)·CAT_PORT 2자리 zero-pad·MSG_TRACE 12자리 강제(결제 전문과 동일 규율).
 */
export function buildReprintMsg(params: BuildReprintMsgParams): {
  message: string;
  header: Record<string, string>;
  body: Record<string, string>;
  msgTrace: string;
} {
  const content = params.content ?? '';
  if (!content.trim()) {
    throw new Error('전표출력 내용(P_ECSPOS_CMD1)이 비어 있습니다.');
  }
  const msgTrace = params.msgTrace ?? makeTrace();
  if (!isValidTrace(msgTrace)) {
    throw new Error(`MSG_TRACE 는 12자리 숫자여야 합니다: ${msgTrace}`);
  }
  const body: Record<string, string> = {
    DEVICE_TYPE: CBAND_DEVICE_TYPE_PRIN,       // ★프린터 라우팅(결제 CAT_ 와 별개)
    CAT_PORT: pad2Port(params.catPort),         // ★이 PC 로컬 단말 시리얼 포트(2자리)
    CAT_BAUDRATE: params.catBaudrate ?? CBAND_CAT_BAUDRATE,
    P_ECSPOS_CMD1: content,                     // ★인쇄 내용(ESC/POS)
  };
  const bodyStr = JSON.stringify(body);         // 규칙#1: space 인자 미지정(콜론 뒤 공백 0)
  const header: Record<string, string> = {
    LENGTH: bodyLength(bodyStr),
    MSG_VERSION: CBAND_MSG_VERSION,
    TCODE: CBAND_TCODE_REPRINT,                 // ★XP 전표출력(승인 S0/취소 S1 과 별개)
    MSG_TRACE: msgTrace,
    DATA_TYPE: CBAND_DATA_TYPE,                 // 항상 "JSON"
  };
  const message = JSON.stringify({ header, body });
  // 방어(회귀 가드): 필수 body 필드 전집합 존재 + 문자열 + XP 봉투 형태 강제.
  for (const f of CBAND_REPRINT_REQUIRED_BODY_FIELDS) {
    if (typeof body[f] !== 'string' || body[f] === '') {
      throw new Error(`전표출력 body 필수 필드 누락/비문자: ${f}`);
    }
  }
  if (header.TCODE !== CBAND_TCODE_REPRINT) {
    throw new Error('전표출력 전문 header.TCODE 는 반드시 "XP" 여야 합니다.');
  }
  return { message, header, body, msgTrace };
}

// ── 재출력 결과 분류 ──────────────────────────────────────────────────────────
//   결제와 달리 재출력은 **금전 무이동** → '확인 필요(이중결제 방지)' 축이 없다.
//   PRINTED(성공) / FAIL(무응답·오류·단말 미연결) 2분류. FAIL 은 돈이 오가지 않아 재시도 안전.
export type ReprintOutcome = 'PRINTED' | 'FAIL';

/**
 * 전표출력 응답 분류(순수).
 *   · timedOut(무응답/연결끊김) → FAIL(단말 미연결/오프라인 — 금전 무이동이라 재시도 안전).
 *   · 응답코드 없음 또는 0000 → PRINTED(성공). 명시적 비-0000 응답코드 → FAIL(프린터 오류 등).
 */
export function classifyReprint(resp: NormalizedResponse | null, timedOut: boolean): ReprintOutcome {
  if (timedOut || resp == null) return 'FAIL';
  const code = resp.responseCode;
  if (code == null || code === '') return 'PRINTED';       // 응답은 왔으나 오류코드 없음 = 성공
  if (code.trim().toUpperCase() === RESPONSE_CODE_SUCCESS) return 'PRINTED';
  return 'FAIL';
}

/** 재출력 오케스트레이션 입력. */
export interface ReprintFlowInput {
  /** 재출력할 결제의 저장된 승인데이터. */
  data: ReceiptData;
  /** 이 PC 로컬 단말의 시리얼 포트. 없으면(null) 재출력 불가(명확한 실패 반환). */
  catPort: number | string | null | undefined;
  catBaudrate?: string;
}

export interface ReprintFlowResult {
  outcome: ReprintOutcome;
  /** 현장(태블릿) 안내 메시지 — 개발용어 배제, 한국어. */
  userMessage: string;
  msgTrace: string | null;
  response: NormalizedResponse | null;
}

/** WS 송신부 주입 타입(테스트 시 mock). */
export type Sender = (message: string, msgTrace: string, opts?: { url?: string; timeoutMs?: number }) => Promise<SendResult>;

/**
 * ★ 영수증 재출력 흐름 — 조립 → 송신 → 분류. **DB write 0**(금전 무이동·감사/매출 레코드 생성 없음).
 *   단말 미연결/설정없음/오프라인/오류는 모두 **명확한 실패 메시지**로 반환한다(무반응·silent 금지 — AC4).
 *
 * @param store  (없음) — 재출력은 저장소를 쓰지 않는다(결제 흐름과의 결정적 차이).
 * @param sender WS 송신부(주입). 기본 catClient.send. 테스트는 mock.
 */
export async function runReceiptReprint(
  input: ReprintFlowInput,
  sender: Sender = wsSend,
  opts: { url?: string; timeoutMs?: number; trace?: string } = {},
): Promise<ReprintFlowResult> {
  // ① 단말 설정 없음 = 이 PC에 연결된 단말이 없음 → 재출력 불가(명확한 실패).
  if (input.catPort == null || String(input.catPort).trim() === '') {
    return {
      outcome: 'FAIL',
      userMessage: '이 PC에 카드 단말기 설정이 없어 영수증을 재출력할 수 없습니다. 단말기 설정(COM 포트)을 확인해 주세요.',
      msgTrace: null,
      response: null,
    };
  }

  // ② 전문 조립(금전 무이동 — 결제/승인/취소 전문 아님). 조립 실패는 송신 전 차단.
  let message: string;
  let msgTrace: string;
  try {
    const content = buildReceiptContent(input.data);
    const built = buildReprintMsg({
      content, catPort: input.catPort, catBaudrate: input.catBaudrate, msgTrace: opts.trace,
    });
    message = built.message;
    msgTrace = built.msgTrace;
  } catch (e) {
    return {
      outcome: 'FAIL',
      userMessage: `영수증 재출력 준비 중 문제가 발생했습니다: ${(e as Error)?.message ?? '오류'}`,
      msgTrace: null,
      response: null,
    };
  }

  // ③ 송신(+타임아웃). 무응답/연결끊김 = FAIL(금전 무이동이라 재시도 안전).
  let sr: SendResult;
  try {
    sr = await sender(message, msgTrace, { url: opts.url, timeoutMs: opts.timeoutMs });
  } catch (e) {
    // 송신 예외(동시요청 CbandBusyError·WS 미지원 등) → 명확한 실패(무반응 금지).
    const busy = (e as Error)?.name === 'CbandBusyError';
    return {
      outcome: 'FAIL',
      userMessage: busy
        ? '단말기가 다른 요청을 처리하고 있습니다. 잠시 후 다시 [영수증 출력]을 눌러 주세요.'
        : '단말기와 연결할 수 없어 영수증을 재출력하지 못했습니다. 단말기 전원·케이블·연결 상태를 확인해 주세요.',
      msgTrace,
      response: null,
    };
  }

  // ④ 파싱 → 분류.
  const resp: NormalizedResponse | null = sr.timedOut ? null : normalize(safeParse(sr.raw));
  const outcome = classifyReprint(resp, sr.timedOut);
  return {
    outcome,
    userMessage: outcome === 'PRINTED'
      ? '영수증을 단말기로 다시 출력했습니다.'
      : '영수증을 재출력하지 못했습니다. 단말기 연결 상태를 확인한 뒤 다시 시도해 주세요.',
    msgTrace,
    response: resp,
  };
}
