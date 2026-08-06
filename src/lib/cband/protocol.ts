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
 *   classify() 가 ATTENTION 을 반환하는 응답(C011/8003/8555/★8326/무응답)은 승인 여부가 **불확실**하다.
 *   → 자동 재시도 절대 금지. 상위 흐름은 '확인 필요'로 정지하고 MSG_TRACE 로 단말기 승인내역조회.
 *   ★8326 = 요청↔응답 전문의 금액·거래고유번호 불일치(받은 응답이 다른 거래일 수 있음) = 동일 불확실 클래스.
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
 * ★★ 8326 — 요청전문 ↔ 응답전문의 거래금액·거래고유번호 불일치(코밴 규격서).
 *   받은 응답이 **다른 거래의 것일 수 있음** → 이 결제가 승인됐는지 **불확실**.
 *   T-20260805-foot-PLANA-ERRCODE-HANGUL-8326-UNCLEAR: 성공(0000)도 실패도 아닌 '확인 필요'로 분기.
 *   ⚠ 성공/실패로 오분류하면 이중결제(자동 재시도)·미확인 결제 발생 → 반드시 ATTENTION(자동 재시도 금지).
 *   응답유실 원칙(C011/8003/8555/무응답)과 동일 클래스(응답 신뢰불가) — 정책 정합 확장(덮어쓰기 아님).
 */
export const RESPONSE_CODE_TXN_MISMATCH = '8326' as const;

/**
 * ★ 거래 무결성 불확실 코드 집합 — classify 가 ATTENTION 으로 분기(자동 재시도 금지·'확인 필요' 정지).
 *   현재 8326(요청/응답 전문 불일치) 1종. ATTENTION_CODES(단말 통신이상)와 개념 축은 다르나 처리는 동일.
 */
export const UNCLEAR_TXN_CODES: ReadonlySet<string> = new Set<string>([RESPONSE_CODE_TXN_MISMATCH]);

/** 건당 결제 한도(원) — 초과 시 밴 거절(⑬). 한도초과 표시 문구 판정 참고값. */
export const PER_TXN_LIMIT_KRW = 5_000_000 as const;

/**
 * ★건당 한도 초과 판정(순수) — T-20260806-foot-PLANA-PKG-PAY-EXPAND(AC-2).
 *   섹타나인(P2) 자리 설정 한도 = 건당 5,000,000원(레드페이 확인). 이 값 **초과**(> 한도)면 단말 전송 시
 *   밴이 거절하므로, CRM 이 전송 **전** 사전 차단한다(실장이 손님 앞에서 승인 실패로 막히지 않게).
 *   · amount ≤ PER_TXN_LIMIT_KRW → false(정상 전송). amount > PER_TXN_LIMIT_KRW → true(사전 차단).
 *   · 비정수·음수·NaN 은 금액 자체가 유효하지 않아 여기서 한도판정 대상이 아님(false, 상위 amount>0 가드가 차단).
 *   패키지 탭·카드 탭 어느 결제 진입에서도 공용 SSOT — 단말 전송 직전 게이트가 이 술어를 소비한다.
 */
export function exceedsPerTxnLimit(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return amount > PER_TXN_LIMIT_KRW;
}

/**
 * ★건당 한도 초과 안내 문구(현장/실장) — AC-2. 전송 전 차단 사유를 자명한 한국어로 안내한다.
 *   개발용어 배제. 카드 단말(섹타나인) 자리 한도 = 건당 500만원 확정 사실만 전달(추정 배제).
 */
export function perTxnLimitBlockMessage(): string {
  return `카드 단말기 결제는 1건당 최대 ${PER_TXN_LIMIT_KRW.toLocaleString('ko-KR')}원까지 가능합니다. 금액을 나누어 결제해 주세요.`;
}

/**
 * ★ ERRCODE(밴/코밴 응답코드) → 현장(실장) 한글 표시 문구 — 표시 전용(additive, classify 무접촉).
 *   T-20260805-foot-PLANA-ERRCODE-HANGUL-8326-UNCLEAR: 종전 DLL_RET(-14/-2) 2개만 매핑 → 나머지 원문 폴백.
 *   여기서 '확인 필요(ATTENTION/UNCLEAR)' 축의 밴 응답코드에 자명한 한글 문구를 부여한다.
 *   ⚠ 이 표는 '표시'만 바꾼다 — 승인/실패/확인필요 판정(classify)은 코드 집합으로만(표에 넣어도 분기 변화 없음).
 *   ★항목은 '확인 필요(ATTENTION)' 코드와 '명확한 실패(FAIL)' 코드가 섞일 수 있다 — 이 표는 표시 전용이라
 *     어느 축이든 responseMessageForUser 가 소비한다(ATTENTION 분기 line~713 + FAIL 분기 line~729 둘 다 errcodeMessage 조회).
 *     예: 8326/C011/8003/8555 = 확인필요(ATTENTION), ★8324 = 법인카드 할부불가 = 명확한 실패(FAIL, classify 폴백).
 *     FAIL 축의 밴 거절 사유는 대개 코드가 아니라 MSG1 텍스트로 오므로 keywordMessage 로 정규화하고, 그래도 못
 *     알아보면 '원문 + 코드번호' 병기로 폴백(실장이 규격서 조회 가능). 코드로 명시된 사유(8324 등)는 이 표로 직접 치환.
 */
export const ERRCODE_MESSAGES: Readonly<Record<string, string>> = {
  '8326': '결제 응답이 요청한 거래와 일치하지 않습니다(금액·거래번호 불일치). 승인 여부가 불확실하니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요.',
  'C011': '단말기 통신에 이상이 있어 결과를 확인할 수 없습니다. 승인 여부가 불확실하니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요.',
  '8003': '단말기 응답에 이상이 있어 결과를 확인할 수 없습니다. 승인 여부가 불확실하니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요.',
  '8555': '단말기 응답에 이상이 있어 결과를 확인할 수 없습니다. 승인 여부가 불확실하니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요.',
  // ★8324 — 할부개월수 오류. 실무상 법인카드로 할부 시도 시 발생(법인카드는 할부 미지원).
  //   T-20260806-foot-PLANA-ERRCODE-8324-CORPCARD-INSTALLMENT(canonical, reporter 최필경 확정 문구 MSG-…-tphw).
  //   ★classify 무접촉: 8324 는 0000/ATTENTION/UNCLEAR 집합 어디에도 없어 classify 가 이미 FAIL 로 폴백(별도 분기 불요).
  //   여기서는 FAIL 화면의 표시 문구만 자명한 한글로 치환한다(순수 additive).
  '8324': '법인카드는 할부가 지원되지 않아요. 개인카드로 다시 시도해 주세요.',
};

/** ERRCODE 로 한글 표시 문구 조회(없으면 null). trim·대문자 정규화 후 비교. */
export function errcodeMessage(code: string | null | undefined): string | null {
  if (code == null) return null;
  const k = String(code).trim().toUpperCase();
  return k in ERRCODE_MESSAGES ? ERRCODE_MESSAGES[k] : null;
}

/**
 * ★ 응답 메시지(MSG1/ResultMessage) 원문 키워드 → 현장 한글 정규화 — 표시 전용(additive).
 *   밴 거절 사유는 코드가 아니라 텍스트(한글/영문 혼재)로 오는 경우가 많다(⑬ 한도초과 포함).
 *   실장이 알아볼 수 있게 알려진 사유는 자명한 한글로 치환하고, 못 알아보는 건 원문+코드로 폴백한다.
 *   순서 = 구체적인 것 우선(먼저 매칭되는 항목 반환). classify 무참여(판정 불변).
 */
const KEYWORD_MESSAGES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    pattern: /한도\s*초과|한도금액|거래한도|EXCEED.*LIMIT|OVER.*LIMIT|LIMIT.*EXCEED/i,
    message: `건당 결제 한도(${PER_TXN_LIMIT_KRW.toLocaleString('ko-KR')}원)를 초과했습니다. 금액을 나누어 결제하시거나 카드사에 한도를 확인해 주세요.`,
  },
  {
    pattern: /잔액\s*부족|INSUFFICIENT|NOT\s*ENOUGH/i,
    message: '카드 잔액(또는 한도)이 부족합니다. 다른 카드로 결제해 주세요.',
  },
  {
    pattern: /유효\s*기간|만료|EXPIRE/i,
    message: '카드 유효기간이 지났습니다. 다른 카드로 결제해 주세요.',
  },
  {
    pattern: /분실|도난|LOST|STOLEN/i,
    message: '사용할 수 없는 카드입니다(분실/도난). 다른 카드로 결제해 주세요.',
  },
  {
    pattern: /비밀번호|PIN|PASSWORD/i,
    message: '카드 비밀번호가 올바르지 않습니다. 다시 확인해 주세요.',
  },
  {
    pattern: /정지|취급\s*거절|거래\s*거절|취소된\s*카드|DECLINE|DENIED/i,
    message: '카드사에서 거래가 거절되었습니다. 카드사에 문의하시거나 다른 카드로 결제해 주세요.',
  },
];

/** 응답 메시지 원문에서 알려진 거절 사유 키워드를 찾아 한글 문구로 정규화(없으면 null). */
export function keywordMessage(message: string | null | undefined): string | null {
  if (message == null) return null;
  const s = String(message).trim();
  if (!s) return null;
  for (const { pattern, message: m } of KEYWORD_MESSAGES) {
    if (pattern.test(s)) return m;
  }
  return null;
}

/** 사용자 문구 뒤에 '(코드 XXXX)' 병기 — 코드가 있고 아직 문구에 없을 때만(실장 규격서 조회용). */
function appendCode(base: string, code: string | null | undefined): string {
  const c = code == null ? '' : String(code).trim();
  if (!c) return base;
  if (base.includes(c)) return base;
  return `${base} (코드 ${c})`;
}

/**
 * ★ DLL_RET(로컬 단말 DLL 반환코드) → 현장(실장) 표시 문구 매핑 — 표시 전용(additive).
 *   T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX ⑤: DLL_RET 참조표에 없던 -14 실 로그 발생 확인
 *   ('단말기에 IC 카드 이미 꽂힘'). 수신·분류(classify) 로직은 불변 — 사용자에게 보일 메시지만 사람이
 *   읽을 문구로 치환한다. 키는 문자열 정규화(trim) 후 비교. 표에 없는 DLL_RET 는 기존 폴백 문구 유지.
 *
 *   ★분류 관점: -14 는 '카드가 이미 꽂혀 있어 진행 불가' = 과금 미발생(재시도 안전) → classify 는
 *   기존대로 FAIL 로 판정된다(코드가 0000 아님·ATTENTION 집합 아님). 여기서는 그 FAIL 화면의 문구만
 *   자명한 안내로 바꾼다(자동 재시도/이중결제 방지 로직 무접촉).
 *
 *   ★-2 추가(T-20260804-foot-CBAND-PAY-CABLE-DISCONNECT-ERRMSG): 데몬이 뱉는 [-2]
 *   ('POS Serial 포트 연결 실패') = 단말↔PC 케이블 미연결(직렬 포트 연결 실패) = 과금 미발생.
 *   형제 PAYBTN-DISABLED-TOOLTIP[deployed] 가 사전 버튼 비활성으로 걸러주나, 그 판정 우회로
 *   실제 결제까지 도달해 데몬이 [-2] 를 뱉는 경우의 최종 화면 문구. raw '[-2]'/'POS Serial 포트 연결
 *   실패' 원문은 노출하지 않고 케이블 확인 안내로 치환한다(수신·분류 로직 무접촉·표시 전용).
 */
export const DLL_RET_MESSAGES: Readonly<Record<string, string>> = {
  '-14': '단말기에 IC(칩) 카드가 이미 꽂혀 있습니다. 카드를 뺀 뒤 다시 결제해 주세요.',
  '-2': '단말기와 통신할 수 없습니다. 단말기와 PC를 연결한 케이블을 확인해 주세요. (단말기 후면 POS 단자)',
};

/** DLL_RET 코드로 표시 문구 조회(없으면 null). trim 정규화 후 비교. */
export function dllRetMessage(code: string | null | undefined): string | null {
  if (code == null) return null;
  const k = String(code).trim();
  return k in DLL_RET_MESSAGES ? DLL_RET_MESSAGES[k] : null;
}

/**
 * ★T-20260804-foot-CBAND-PAY-CABLE-DISCONNECT-ERRMSG: ERRCODE=9999 실패 시 데몬 ResultMessage 는
 *   '[-N] 원문…'([-2] POS Serial 포트 연결 실패 등) 형태로 코드를 대괄호로 실어 보낸다(§실측 정본 주석 참조).
 *   메시지 문자열에서 그 선두 [-N] 토큰의 안쪽 코드('-2' 등)만 추출한다(없으면 null). 표시 매핑 전용·추출만.
 */
export function bracketRetCode(message: string | null | undefined): string | null {
  if (message == null) return null;
  const m = String(message).match(/\[\s*(-?\d+)\s*\]/);
  return m ? m[1] : null;
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
  /**
   * ★통신 테스트(돈 안 나가는 점검) 여부 — T-20260804-foot-CBAND-CATRECEIPT-REALPAY-Y.
   *   false(기본)/미지정 = 실결제·실취소(실금전 전문) → CAT_TERMINAL_RECEIPT="Y"(단말기 영수증 출력).
   *   true = 돈이 오가지 않는 통신 점검 전문 → CAT_TERMINAL_RECEIPT="N".
   *   어느 경우에도 빈값("")/누락 금지(NULLREF-COMPLETE AC2 의 CAT_TERMINAL_RECEIPT 한정 재정의).
   */
  commTest?: boolean;
  /**
   * ★할부 개월수 — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT(HALBU 가변 전송).
   *   undefined/0/1 = 일시불("00"), 2~12 = 개월수("02"~"12"). formatHalbu 로 조립.
   *   ★취소(0430) 시에도 원거래 할부개월을 그대로 전달 → VAN 이 할부거래를 정확히 취소·복원(전체취소만).
   */
  installmentMonths?: number | null;
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
  /**
   * ★응답 HALBU(단말이 되돌려준 실제 적용 개월코드) — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT(spec ③).
   *   실측(MSG-20260806-121820-iyn7): 승인 HALBU "03" → 응답 HALBU "03"(그대로 echo). 취소도 원거래 동일값 echo.
   *   ★spec ③ "응답값(단말기가 돌려준 실제 적용 개월코드) 저장" 착지 = cband_payment_attempts.raw_response(jsonb).
   *     요청값은 payments.installment(int) canonical + formatHalbu 파생 = 요청/응답 둘 다 DB 확보(신규 컬럼 0).
   *   없으면 null. 재-derive 안 함(as-is echo 캡처).
   */
  halbu: string | null;
  /**
   * ★마스킹 카드번호(CARDNO) — 단말이 이미 마스킹해 반환한 값을 **verbatim** 만 캡처(예: '55318440****364*').
   *   DA-20260804-FOOT-CBAND-CARDNO-MASKED-PLACEMENT(§7-3): 재-mask/재-derive/un-mask 금지·평문 PAN 저장 절대 금지.
   *   착지홈 = payments.card_no_masked(§7-1 PRIMARY). 마스킹 마커(별표/X) 없는 값은 캡처하지 않음(null) — 평문 PAN 유입 차단.
   */
  cardNoMasked: string | null;
  /** 파싱 원본(감사/디버그용). */
  raw: Record<string, unknown>;
}

/** 마스킹 카드번호 마커(*, X/x). 단말이 마스킹한 CARDNO 는 연속숫자열이 이 문자로 끊긴다. */
const CARD_MASK_MARKER = /[*Xx]/;

/**
 * ★CARDNO(마스킹) verbatim 추출 — DA §7-3. 마스킹 마커(별표/X)가 있는 값만 as-is(trim) 캡처.
 *   · 마스킹 마커 없는 순수 숫자열 = 평문 PAN 위험 → 캡처하지 않음(null). payments.card_no_masked 평문 유입 구조 차단.
 *   · 재-mask/재-derive/un-mask 안 함(as-is). DB BEFORE 가드(payments-scoped, foot_is_luhn)가 2차 방어.
 */
export function extractMaskedCardNo(raw: Record<string, unknown>): string | null {
  const v = pick(raw, ['CARDNO', 'CARD_NO', 'CARDNUM', 'CARDNUMBER', 'MASKEDCARD', 'MASKED_CARD']);
  if (v == null) return null;
  const s = v.trim();
  if (!s) return null;
  // 마스킹 마커(*/X)가 있어야만 캡처(평문 PAN 저장 방지 — DA §7-3 "마스킹 CARDNO 문자열만 캡처").
  if (!CARD_MASK_MARKER.test(s)) return null;
  return s;
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
 * header.TCODE(취소) — T-20260804-foot-CBAND-TERMINAL-CANCEL-S1-BTN AC-2 확정 스펙.
 *   최필경 총괄 08-04 12:15/12:17 확정 = 7/31 실취소 전문 원문 SSOT: 취소(0430) 전문은
 *   승인 전문과 **동일 구조**이되 `header.TCODE`만 "S1"로 교체 + body.ORI_DATE/ORI_AUTHNO 채움.
 *   ⚠ 승인(0210)은 S0 field-soak 성공값(11:03 실승인) 회귀 금지 → 취소일 때만 S1 로 분기(승인 무접촉).
 */
export const CBAND_TCODE_CANCEL = 'S1' as const;

/**
 * ★body.DEVICE_TYPE — 데몬이 결제기 종류(모듈)를 라우팅하는 값. 정확히 "CAT_"(4자, 끝 밑줄) 고정.
 *   T-20260804-foot-CBAND-DEVICETYPE-CAT-FIXED: header 봉투(370ba999) 해소 후 데몬 오류가
 *   9999(전문형식)→9998(모듈로드)로 전진 = 파싱은 통과, 이제 모듈 라우팅 단계. DEVICE_TYPE 이
 *   정확히 "CAT_"가 아니면(누락/빈값/"CAT"(밑줄없음)/"VPOS") 데몬이 VPOS 분기(VPOS_Client.dll,
 *   현장 미설치·C:\KOVAN 미존재)로 빠져 DLL 로드 실패(9998). CAT 연동 KovanSocketCat.dll=설치됨.
 *   ★근거 = 7/31 실승인 전문 원문 body 20필드(DIAGNOSE §ROOT-CAUSE)의 "DEVICE_TYPE":"CAT_"
 *   + 최필경 총괄 현장 5케이스 직접 재현(CAT_=✅ / 누락·빈값·"CAT"·"VPOS"=❌9998). 추측 아님.
 */
export const CBAND_DEVICE_TYPE = 'CAT_' as const;

/**
 * ★body.HALBU — 할부 개월수. "00" = 일시불(기본).
 *   근거: 7/31 실승인 응답 원문 echo "HALBU":"00"(일시불). 일시불은 언제나 "00" 고정.
 *   (할부 지원 시 이 값을 개월수 2자리("02"~"12")로 치환. 필드 존재는 언제나 보장.)
 */
export const CBAND_HALBU_LUMPSUM = '00' as const;

/**
 * ★할부 최대 개월수 — T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT.
 *   카드 단말 할부 관행상 1개월=일시불, 2~12개월 지원(scalp2 INSTALLMENT-BTN-1TO12 패턴 준용).
 *   초과 값은 실결제 실패 위험 → formatHalbu 에서 throw(조립 단계 차단).
 */
export const CBAND_HALBU_MAX_MONTHS = 12 as const;

/**
 * ★body.HALBU 조립 — 할부 개월수를 CAT 전문 HALBU(2자리) 문자열로 변환.
 *   T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT(HALBU 가변 전송).
 *   · undefined/null/0/1 = 일시불 → "00" (카드 관행: 1개월=일시불, 별도 HALBU 없음).
 *   · 2~12 = 개월수 → 2자리 zero-pad("02"~"12").
 *   · 비정수·음수·12 초과 = 실결제 실패 위험 → throw(조립 단계에서 차단, 과금 위험 0).
 *   ★일시불은 항상 "00"(7/31 실승인 echo 정합 유지) — 승인/취소 어느 경로에서도 필드는 항상 존재.
 */
export function formatHalbu(months?: number | null): string {
  if (months == null) return CBAND_HALBU_LUMPSUM;
  if (!Number.isInteger(months)) {
    throw new Error(`HALBU 할부개월이 정수가 아닙니다: ${months}`);
  }
  if (months < 0) {
    throw new Error(`HALBU 할부개월이 음수입니다(상위 버그 차단): ${months}`);
  }
  if (months <= 1) return CBAND_HALBU_LUMPSUM;   // 0·1개월 = 일시불("00")
  if (months > CBAND_HALBU_MAX_MONTHS) {
    throw new Error(`HALBU 할부개월 범위 초과(2~${CBAND_HALBU_MAX_MONTHS}): ${months}`);
  }
  return String(months).padStart(2, '0');
}

/**
 * ★할부 한글 표기 파생 — spec ②(레드페이 엑셀 형식 "일시불"/"N개월").
 *   T-20260805-foot-PLANA-INSTALLMENT-HALBU-SUPPORT.
 *   저장은 payments.installment(int) canonical 1곳 → 표시 시 이 순수함수로 한글 파생(중복 저장 안 함).
 *   · undefined/null/0/1 = "일시불" / 2~12 = "N개월". 숫자코드 저장 금지(spec ②) — 표시전용 파생.
 */
export function formatInstallmentKo(months?: number | null): string {
  if (months == null || months <= 1) return '일시불';
  return `${months}개월`;
}

/**
 * ★할부 최소 결제금액(카드사 규정) — spec ①.
 *   실데이터 1,217건 최소금액=정확히 50,000원, 5만원 미만 할부 0건.
 *   결제 금액 < 이 값 → 할부 선택 UI 비활성(일시불 강제). FE 게이트 + (백스톱) 상위 판정 공용 SSOT.
 */
export const CBAND_INSTALLMENT_MIN_AMOUNT = 50_000 as const;

/**
 * ★body.CAT_BAUDRATE — CAT 시리얼 통신속도. "38400" 고정(현장 단말 세팅 SSOT,
 *   T-…-TERMINAL-TID-COMPORT-PERSEAT-SETTINGS "baud 38400 고정").
 */
export const CBAND_CAT_BAUDRATE = '38400' as const;

/**
 * ★★ 데몬 필수 body 필드 전집합(T-20260804-foot-CBAND-BODY-FIELDS-NULLREF-COMPLETE, AC1/AC3).
 *   근거 = 7/31 실승인 전문 원문 body 20필드(DIAGNOSE §ROOT-CAUSE, AUTHORITATIVE CAT/VAN 프로토콜 SSOT).
 *   현장(최필경 총괄)이 20필드를 하나씩 제거하며 전수 재현 → 아래 필드 각각 단독 누락만으로
 *   데몬 HandleMessageAsync 가 NullReferenceException 반환(키 누락/null 참조).
 *   ⇒ buildMsg 는 이 전집합을 **항상**(모든 결제경로에서) body 에 포함하고,
 *      값 없는 필드는 null/undefined 가 아닌 **빈 문자열 ""**(AC2)로 직렬화한다.
 *   ★예외 1건: CAT_TERMINAL_RECEIPT 는 빈문자 아님 — T-20260804-CATRECEIPT-REALPAY-Y 재정의로
 *      실결제/실취소="Y"·통신테스트="N"(빈값 금지). 나머지 19필드의 null-ref 방지(빈문자 치환)는 불변.
 *   순서 = 실승인 전문 원문 나열 순서(대조 편의). DEVICE_TYPE 은 여기 포함(선행 CAT_ 고정축과 정합).
 */
export const CBAND_REQUIRED_BODY_FIELDS: readonly string[] = [
  'TID', 'HALBU', 'TAMT', 'ORI_DATE', 'ORI_AUTHNO', 'IDNO', 'AMT_FLAG',
  'TAX_AMT', 'SVC_AMT', 'NONTAX_AMT', 'FILLER',
  'SET_QR_DATA_512', 'SET_QR_DATA_256', 'DEVICE_TYPE',
  'SET_PG_TYPE', 'SET_PG_DATA_LEN', 'SET_PG_DATA',
  'CAT_PORT', 'CAT_BAUDRATE', 'CAT_TERMINAL_RECEIPT',
] as const;

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
  const { tranType, tid, merno, amount, catPort, msgTrace, originalAuthNo, originalAuthDate, commTest, installmentMonths } = params;

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
  //   ★★ BODY-FIELDS-NULLREF-COMPLETE(AC1/AC2): 데몬 필수 body 필드 **전집합을 항상 포함**하고,
  //      값 없는 필드는 null/undefined 가 아닌 **빈 문자열 ""** 로 채운다(데몬 null-ref 차단).
  //      ★단 CAT_TERMINAL_RECEIPT 만 예외(CATRECEIPT-REALPAY-Y): 빈문자 아닌 결제구분 Y/N(아래 #20).
  //      필드명·순서·기본값은 7/31 실승인 전문 원문(DIAGNOSE §ROOT-CAUSE 20필드)과 대조 확정(AC3, 추측 금지).
  //      취소(0430)의 원거래 참조는 authoritative 필드명 ORI_AUTHNO/ORI_DATE 에 착지(구 AUTHNO/AUTHDATE=CRM 발명, 폐기).
  const isCancel = tranType === TRANTYPE_CANCEL;
  const body: Record<string, string> = {
    TRANTYPE: tranType,                                   // ★body 유지: 응답도 flat TRANTYPE echo·승인/취소 discriminator (필수20 외 discriminator)
    TID: tid.trim(),                                      // #1  실측#1: 비우면 거부(위에서 throw 강제)
    HALBU: formatHalbu(installmentMonths),               // #2  할부개월 — 일시불 "00" / 2~12 = "02"~"12"(INSTALLMENT-HALBU-SUPPORT)
    TAMT: pad9(amount),                                   // #3  규칙#3 9자리 zero-pad
    ORI_DATE: isCancel ? (originalAuthDate?.trim() ?? '') : '',   // #4  원거래일자(취소 시) / 승인 시 ""
    ORI_AUTHNO: isCancel ? (originalAuthNo as string).trim() : '', // #5  실측#2: 원거래 승인번호(취소 시) / 승인 시 ""
    IDNO: '',                                             // #6  무기명(값 없음 → "")
    AMT_FLAG: '',                                         // #7  값 없음 → "" (AC2)
    TAX_AMT: '',                                          // #8  부가세액 — 값 없음 → ""
    SVC_AMT: '',                                          // #9  봉사료 — 값 없음 → ""
    NONTAX_AMT: '',                                       // #10 비과세금액 — 값 없음 → ""
    FILLER: '',                                           // #11 예비영역 — ""
    SET_QR_DATA_512: '',                                  // #12 QR(512) — 미사용 → ""
    SET_QR_DATA_256: '',                                  // #13 QR(256) — 미사용 → ""
    DEVICE_TYPE: CBAND_DEVICE_TYPE,                       // #14 ★FIX-A(DEVICETYPE-CAT-FIXED): 정확히 "CAT_" 고정
    SET_PG_TYPE: '',                                      // #15 PG유형 — 미사용 → ""
    SET_PG_DATA_LEN: '',                                  // #16 PG데이터길이 — 미사용 → ""
    SET_PG_DATA: '',                                      // #17 PG데이터 — 미사용 → ""
    CAT_PORT: pad2Port(catPort),                          // #18 규칙#4 2자리 zero-pad
    CAT_BAUDRATE: CBAND_CAT_BAUDRATE,                     // #19 통신속도 "38400" 고정
    // #20 단말영수증 — ★T-20260804-CATRECEIPT-REALPAY-Y: NULLREF-COMPLETE 의 빈문자("") default 를
    //   이 필드 한정 재정의(policy_superseded, reporter 최필경 총괄 명시). 실결제/실취소(실금전)=출력 위해 "Y",
    //   돈 안 나가는 통신 테스트=미출력 "N". 빈값("")/누락 절대 금지(어느 경로에서도 Y|N 확정 세팅).
    CAT_TERMINAL_RECEIPT: commTest ? 'N' : 'Y',
  };
  // ★FIX-1(MERNO-REQFIELD-BUG): MERNO 는 요청 필수 전집합에 없다(7/31 실승인 20필드 부재).
  //   값이 명시적으로 있을 때만 계승해 실어 보내고, 빈값(정상)은 전문에서 제외한다(필수20 무영향).
  if (merno && merno.trim()) {
    body.MERNO = merno.trim();
  }

  // ── header(머리말) — 데몬이 먼저 읽는 전문형태(DATA_TYPE). 필드값은 현장 정상 전문 예시로 확정(§상수). ──
  //   순서는 현장 예시(LENGTH·MSG_VERSION·TCODE·MSG_TRACE·DATA_TYPE)에 맞춤(literal 매칭 데몬 대비).
  const bodyStr = JSON.stringify(body);           // 규칙#1: space 인자 미지정(콜론 뒤 공백 0)
  const header: Record<string, string> = {
    LENGTH: bodyLength(bodyStr),                   // FIX-B: body 바이트수 4자리 zero-pad
    MSG_VERSION: CBAND_MSG_VERSION,
    // ★T-20260804-foot-CBAND-TERMINAL-CANCEL-S1-BTN AC-2: 취소(0430)=S1, 승인(0210)=S0(회귀금지).
    //   7/31 실취소 원문 SSOT: 취소 전문은 header.TCODE 만 S1 로 교체(body 구조 동일).
    TCODE: isCancel ? CBAND_TCODE_CANCEL : CBAND_TCODE,
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
  // ★FIX-A 방어(DEVICETYPE-CAT-FIXED): body.DEVICE_TYPE 정확히 "CAT_"(4자, 끝 밑줄) 불변식.
  //   현장 케이스 ②(누락)③(빈값)④("CAT")⑤("VPOS") 전부 발생 불가 — 어긋나면 데몬 VPOS 분기(9998) 차단.
  if (body.DEVICE_TYPE !== CBAND_DEVICE_TYPE) {
    throw new Error('body.DEVICE_TYPE 는 정확히 "CAT_" 여야 합니다 — 데몬이 VPOS 모듈로 오라우팅되어 결제 실패(9998).');
  }
  // ★★ BODY-FIELDS-NULLREF-COMPLETE 방어(AC1/AC2): 필수 전집합 20필드가 모두 존재하고
  //    값이 string(null/undefined 아님)인지 조립 단계에서 강제 → 데몬 HandleMessageAsync NullReferenceException 재발 차단.
  //    (현장 "필드 단독 누락 → NullRef" 전수 재현 케이스가 조립 단계에서 발생 불가.)
  for (const f of CBAND_REQUIRED_BODY_FIELDS) {
    if (typeof body[f] !== 'string') {
      throw new Error(`body 필수 필드 누락/비문자: ${f} — 데몬 null-ref 위험(전집합 20필드 항상 채울 것).`);
    }
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
    // ★응답 HALBU(실제 적용 개월코드) echo — spec ③ 응답값 저장 근거. 없으면 null.
    halbu: pick(raw, ['HALBU', 'INSTALLMENT', 'INSTALLMENTMONTH']),
    // ★CARDNO(마스킹) verbatim 캡처 — payments.card_no_masked 착지(DA §7). 평문 PAN 은 null(캡처 안 함).
    cardNoMasked: extractMaskedCardNo(raw),
    raw,
  };
}

// ── classify — ★ 이중결제 방지 핵심(티켓 §D) ──────────────────────────────────

/**
 * 응답을 3분류한다. 이중결제 방지의 심장 — ATTENTION 은 절대 자동 재시도하지 않는다.
 *
 * @param resp    normalize() 결과. **무응답(타임아웃)은 반드시 null 을 넘길 것** → ATTENTION.
 * @returns
 *   'ATTENTION' : ★불확실(무응답 or C011/8003/8555 or ★8326 전문불일치). 자동 재시도 금지·'확인 필요' 정지.
 *   'APPROVED'  : 성공(RESPCODE=0000 + AUTHNO 수신).
 *   'FAIL'      : 명확한 실패(그 외 응답코드). 과금 미발생 확정 → 재시도 안전.
 *
 * ★ 무응답을 FAIL 로 오분류하면 자동 재시도 → 이중결제 사고. 반드시 null → ATTENTION 경로 유지.
 */
export function classify(resp: NormalizedResponse | null): PaymentClassification {
  // 무응답(타임아웃/연결끊김): 승인이 단말에서 성립했을 수 있음 → ATTENTION.
  if (resp == null) return 'ATTENTION';

  const code = resp.responseCode;

  // 응답코드가 ATTENTION 집합(단말 통신이상 C011/8003/8555)이면 불확실 → 정지.
  if (code != null && ATTENTION_CODES.has(code.toUpperCase())) return 'ATTENTION';

  // ★8326(요청↔응답 전문 금액·거래고유번호 불일치) = 받은 응답이 다른 거래일 수 있음 → 승인 여부 불명.
  //   반드시 성공/실패보다 먼저 판정해 ATTENTION 으로 정지(FAIL 로 새면 자동 재시도 → 이중결제).
  if (code != null && UNCLEAR_TXN_CODES.has(code.toUpperCase())) return 'ATTENTION';

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
    // ★확인필요 코드(8326/C011/8003/8555)면 코드별 자명한 한글 문구 + 코드번호 병기. 없으면 일반 안내.
    //   (무응답=null 은 responseCode 없음 → 일반 안내로 폴백. 어느 경우든 '자동 재시도 금지' 정지 취지.)
    const attMsg = errcodeMessage(resp?.responseCode);
    if (attMsg) return appendCode(attMsg, resp?.responseCode);
    return '결제 결과를 확인할 수 없습니다. 카드가 승인되었을 수 있으니 다시 결제하지 마시고, 단말기 [승인내역조회]로 확인해 주세요. (확인 필요)';
  }
  // FAIL
  // ⑤ DLL_RET 표시 매핑(additive) — dllRet 또는 responseCode 가 DLL_RET 표에 있으면 자명한 안내로 치환.
  //    (예: -14 = 단말기에 IC 카드 이미 꽂힘). 표에 없으면 아래 폴백 순서로.
  //    ★[-2] 케이블 미연결(T-20260804-...-CABLE-DISCONNECT-ERRMSG): 데몬이 코드를 dllRet/responseCode
  //    필드가 아니라 ResultMessage 의 '[-N]' 토큰으로 실어 보내는 경로도 커버 → bracketRetCode 로 추출해
  //    같은 표로 조회. 표에 없는 [-N] 은 null → 아래 폴백 유지(회귀 없음, raw 원문 미노출).
  const dllMsg =
    dllRetMessage(resp?.dllRet) ??
    dllRetMessage(resp?.responseCode) ??
    dllRetMessage(bracketRetCode(resp?.responseMessage));
  if (dllMsg) return dllMsg;
  // ★ERRCODE 전체표 한글 매핑(신규) — 밴 응답코드가 표에 있으면 자명한 한글 문구 + 코드 병기.
  const errMsg = errcodeMessage(resp?.responseCode);
  if (errMsg) return appendCode(errMsg, resp?.responseCode);
  // ★키워드 정규화(신규) — 거절 사유가 MSG1 텍스트로 오는 경우(⑬ 한도초과·잔액부족 등)를 한글로.
  const kwMsg = keywordMessage(resp?.responseMessage);
  if (kwMsg) return appendCode(kwMsg, resp?.responseCode);
  // ★미매핑 잔여: 원문 + 코드번호 병기(실장이 규격서 조회 가능) — reporter 요구.
  const msg = resp?.responseMessage;
  const code = resp?.responseCode;
  if (msg) return appendCode(`결제가 처리되지 않았습니다: ${msg}`, code);
  return code ? `결제가 처리되지 않았습니다 (코드 ${code}). 다시 시도해 주세요.` : '결제가 처리되지 않았습니다. 다시 시도해 주세요.';
}
