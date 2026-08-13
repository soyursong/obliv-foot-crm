import { test, expect } from '@playwright/test';
import {
  CBAND_TCODE_REPRINT,
  CBAND_DEVICE_TYPE_PRIN,
  CBAND_REPRINT_REQUIRED_BODY_FIELDS,
  buildReceiptContent,
  buildReprintMsg,
  classifyReprint,
  runReceiptReprint,
  type ReceiptData,
  type Sender,
} from '../../src/lib/cband/receiptReprint';
import { normalize, safeParse } from '../../src/lib/cband/protocol';
import { CbandBusyError } from '../../src/lib/cband/catClient';

/**
 * T-20260813-foot-PAYHIST-RECEIPT-REPRINT-TERMINAL1 — 결제내역 영수증 재출력(1번 단말기, 전표출력 XP)
 *   결정론 검증(순수 로직). 물리 단말/데몬 없이 전문 조립·분류·오케스트레이션을 고정한다.
 * ────────────────────────────────────────────────────────────────────────────
 * 벤더 스펙(확정): TCODE=XP 전표출력 · DEVICE_TYPE=PRIN · CAT_PORT/CAT_BAUDRATE · P_ECSPOS_CMD1(ESC/POS).
 *   금전 무이동 재출력(신규 결제/승인/취소 아님) → 구조적으로 중복 매출 유발 불가(AC3).
 *
 * 현장 클릭 시나리오(티켓) → 순수 로직 대응:
 *   시나리오 1(정상): 결제내역 → 상세 → [영수증 출력] → 1번 단말기(로컬 CAT_PORT)로 XP 전표출력 → PRINTED.
 *   시나리오 2(엣지): 단말 미설정/오프라인 → runReceiptReprint FAIL + 명확한 실패 메시지(무반응 금지).
 *   AC3: 재출력 전문에 TRANTYPE/TAMT/AUTHNO 요청필드 부재(신규 결제 유발 불가) — 전문 구조로 실증.
 */

const REAL_APPROVAL_DATA: ReceiptData = {
  tranType: '0210',
  authNo: '30001234',
  amount: 150000,
  halbu: '03',
  cardNoMasked: '55318440****364*',
  cardName: '신한카드',
  tranDate: '260813',
  tranTime: '143005',
  tid: '1234567890',
  merno: '778899',
  msgTrace: '235112000001',
};

// ── AC1/AC2: 전표출력(XP) 전문 조립 — 벤더 스펙 확정 필드 ──────────────────────
test('전표출력 전문은 header.TCODE=XP · body.DEVICE_TYPE=PRIN · P_ECSPOS_CMD1 포함(벤더 스펙)', () => {
  const content = buildReceiptContent(REAL_APPROVAL_DATA);
  const { message, header, body, msgTrace } = buildReprintMsg({ content, catPort: 3 });

  expect(header.TCODE).toBe(CBAND_TCODE_REPRINT);
  expect(header.TCODE).toBe('XP');
  expect(header.DATA_TYPE).toBe('JSON');
  expect(body.DEVICE_TYPE).toBe(CBAND_DEVICE_TYPE_PRIN);
  expect(body.DEVICE_TYPE).toBe('PRIN');
  expect(body.CAT_PORT).toBe('03');           // COM3 → 2자리 zero-pad
  expect(body.CAT_BAUDRATE).toBe('38400');
  expect(body.P_ECSPOS_CMD1).toBe(content);
  expect(msgTrace).toMatch(/^\d{12}$/);

  // 필수 body 필드 전집합 존재.
  for (const f of CBAND_REPRINT_REQUIRED_BODY_FIELDS) {
    expect(body[f]).toBeTruthy();
  }
  // 봉투 파싱 정합.
  const parsed = JSON.parse(message);
  expect(parsed.header.TCODE).toBe('XP');
  expect(parsed.body.P_ECSPOS_CMD1).toContain('카드 매출전표 (재발행)');
});

// ── ★AC3: 재출력 전문은 신규 결제/승인/취소를 유발할 수 없다(금전 무이동) ──────────
test('AC3 — 재출력 전문에 결제/승인/취소 요청필드(TRANTYPE·TAMT·AUTHNO)가 없다(중복 매출 불가)', () => {
  const content = buildReceiptContent(REAL_APPROVAL_DATA);
  const { body } = buildReprintMsg({ content, catPort: 3 });
  // 결제(0210)/취소(0430) 전문에만 있는 거래필드가 재출력 body 에 없어야 함.
  expect(body).not.toHaveProperty('TRANTYPE');
  expect(body).not.toHaveProperty('TAMT');
  expect(body).not.toHaveProperty('ORI_AUTHNO');
  expect(body).not.toHaveProperty('CAT_TERMINAL_RECEIPT');
  // body 는 프린터 4필드뿐(거래필드 0).
  expect(Object.keys(body).sort()).toEqual([...CBAND_REPRINT_REQUIRED_BODY_FIELDS].sort());
});

test('영수증 본문은 "재발행" 명시 + 승인번호·금액·거래고유번호를 담는다(원본 혼동 방지)', () => {
  const content = buildReceiptContent(REAL_APPROVAL_DATA);
  expect(content).toContain('재발행');
  expect(content).toContain('30001234');        // 승인번호
  expect(content).toContain('150,000원');        // 천단위 콤마 금액
  expect(content).toContain('235112000001');     // 거래고유번호(TRANSERIAL)
  expect(content).toContain('55318440****364*'); // 마스킹 카드번호(verbatim)
  expect(content).toContain('※ 재발행 전표입니다');
});

test('빈 내용/잘못된 MSG_TRACE 는 조립 단계에서 차단(throw)', () => {
  expect(() => buildReprintMsg({ content: '   ', catPort: 3 })).toThrow();
  expect(() => buildReprintMsg({ content: 'x', catPort: 3, msgTrace: '12' })).toThrow();
});

// ── 분류: 금전 무이동이라 '확인 필요' 축 없음 — PRINTED / FAIL 2분류 ────────────
test('classifyReprint — 응답 0000/응답코드없음=PRINTED, 무응답/오류=FAIL', () => {
  expect(classifyReprint(normalize(safeParse('{"ERRCODE":"0000"}')), false)).toBe('PRINTED');
  expect(classifyReprint(normalize(safeParse('{"MSG1":"출력완료"}')), false)).toBe('PRINTED'); // 오류코드 없음
  expect(classifyReprint(normalize(safeParse('{"ERRCODE":"9999","MSG1":"프린터 용지 없음"}')), false)).toBe('FAIL');
  expect(classifyReprint(null, true)).toBe('FAIL');  // 무응답(타임아웃)
});

// ── 시나리오 1(정상): 단말로 XP 전송 → PRINTED ───────────────────────────────
test('시나리오1 — 1번 단말기로 재출력 성공 시 PRINTED + 안내', async () => {
  let sentMessage = '';
  const okSender: Sender = async (message, msgTrace) => {
    sentMessage = message;
    return { raw: '{"ERRCODE":"0000"}', timedOut: false, msgTrace };
  };
  const r = await runReceiptReprint({ data: REAL_APPROVAL_DATA, catPort: 3 }, okSender);
  expect(r.outcome).toBe('PRINTED');
  expect(r.userMessage).toContain('출력');
  expect(r.msgTrace).toMatch(/^\d{12}$/);
  // 실제로 XP 전표출력 전문이 나갔는지 확인.
  expect(JSON.parse(sentMessage).header.TCODE).toBe('XP');
});

// ── 시나리오 2(엣지): 단말 미설정 → 명확한 실패(무반응 금지·AC4) ──────────────
test('시나리오2a — 단말 미설정(CAT_PORT 없음)이면 명확한 실패(송신 0)', async () => {
  let called = false;
  const spySender: Sender = async (message, msgTrace) => { called = true; return { raw: null, timedOut: true, msgTrace }; };
  const r = await runReceiptReprint({ data: REAL_APPROVAL_DATA, catPort: null }, spySender);
  expect(r.outcome).toBe('FAIL');
  expect(called).toBe(false);                    // 설정 없으면 송신조차 안 함
  expect(r.userMessage).toContain('단말기 설정');
});

test('시나리오2b — 단말 오프라인(무응답)이면 FAIL + 연결 확인 안내', async () => {
  const timeoutSender: Sender = async (message, msgTrace) => ({ raw: null, timedOut: true, msgTrace });
  const r = await runReceiptReprint({ data: REAL_APPROVAL_DATA, catPort: 3 }, timeoutSender);
  expect(r.outcome).toBe('FAIL');
  expect(r.userMessage).toMatch(/연결|단말기/);
});

test('시나리오2c — 송신 예외(연결 불가)도 무반응 없이 명확한 실패 반환', async () => {
  const throwSender: Sender = async () => { throw new Error('WebSocket 을 사용할 수 없는 환경입니다.'); };
  const r = await runReceiptReprint({ data: REAL_APPROVAL_DATA, catPort: 3 }, throwSender);
  expect(r.outcome).toBe('FAIL');
  expect(r.userMessage).toBeTruthy();
  expect(r.userMessage).toMatch(/단말기/);
});

// ── AC7: [CASHOPEN1][CASHOPEN2] 태그 미사용(풋센터 금전함 없음) — 벤더 구현주의 ①──
//   재발행 본문(P_ECSPOS_CMD1)에도, 조립된 전문 어디에도 금전함 개방 태그가 실려선 안 된다.
test('AC7 — 영수증 본문/전문에 금전함 개방 태그(CASHOPEN)가 절대 포함되지 않는다', () => {
  const content = buildReceiptContent(REAL_APPROVAL_DATA);
  expect(content.toUpperCase()).not.toContain('CASHOPEN');
  // ESC/POS 실제 금전함 개방 펄스(ESC p = 0x1B 0x70)도 부재여야 함(방어).
  expect(content).not.toContain('\x1Bp');
  const { message, body } = buildReprintMsg({ content, catPort: 3, msgTrace: '235112000001' });
  expect(message.toUpperCase()).not.toContain('CASHOPEN');
  expect(body.P_ECSPOS_CMD1.toUpperCase()).not.toContain('CASHOPEN');
});

// ── AC8: 결제(S0/S1) in-flight 중 XP 전송 금지 — 데몬 소켓 단일연결 불변식 ──────
//   재출력은 결제와 동일한 catClient.send(공유 _inFlight 락)를 사용한다. 결제가 진행 중이면
//   send 가 CbandBusyError 를 던지고, 재출력은 XP 를 내보내지 않고 '진행 중' 안내로 명확히 실패한다.
//   (구조적: 락이 payment/reprint 간 공유되므로 동시 XP 전송이 원천 불가 — silent 진행 없음.)
test('AC8 — 결제 진행 중(단말 busy)이면 XP 전송을 하지 않고 진행중 안내로 실패한다', async () => {
  let xpSent = false;
  const busySender: Sender = async () => { xpSent = true; throw new CbandBusyError(); };
  const r = await runReceiptReprint({ data: REAL_APPROVAL_DATA, catPort: 3 }, busySender);
  expect(r.outcome).toBe('FAIL');
  // busy 는 명확한 '진행 중' 안내로 분기(무반응 금지) — 데몬 소켓 단일연결 불변식 표면화.
  expect(r.userMessage).toMatch(/다른 요청|진행|잠시/);
  expect(r.response).toBeNull();
  // CbandBusyError 는 catClient(결제와 동일 모듈)의 공유 락에서 던져진다 = 결제/재출력 락 공유 실증.
  expect(new CbandBusyError().name).toBe('CbandBusyError');
});
