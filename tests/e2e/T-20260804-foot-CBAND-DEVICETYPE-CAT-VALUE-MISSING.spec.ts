import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  safeParse,
  normalize,
  classify,
  CBAND_DATA_TYPE,
  CBAND_DEVICE_TYPE,
  CBAND_MSG_VERSION,
  CBAND_TCODE,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-DEVICETYPE-CAT-VALUE-MISSING — 코밴 CAT 직결결제 DEVICE_TYPE 값 누락 P0
 * ────────────────────────────────────────────────────────────────────────────
 * 실 원인: DATA_TYPE(header 봉투)는 ENVELOPE-MISSING(370ba999)으로 해소됐으나, 한 단계 안쪽에서
 *   VPOS_Client.dll 이 DEVICE_TYPE 를 요구 → 값 누락 시 오류로 카드결제 전면 차단.
 * 현장 5케이스 재현(최필경 총괄) — 정확히 "CAT_"(언더스코어 포함) 하나만 정상:
 *   ① "CAT_" → 정상   ② 누락 → 오류   ③ "" → 오류   ④ "CAT"(밑줄X) → 오류   ⑤ "VPOS" → 오류
 * FIX: body 에 DEVICE_TYPE:"CAT_"(하드코딩 상수) 주입. header 봉투(DATA_TYPE) 무접촉 → ENVELOPE 회귀0.
 *
 * ★배치 근거: 오류가 VPOS_Client.dll(= 거래처리 body 층, DATA_TYPE header 파싱 이후 "한 단계 안쪽")에서 발생 +
 *   기존 device-config 필드 CAT_PORT 가 이미 body → DEVICE_TYPE(단말 기종)은 body 의 CAT_PORT 형제.
 *   header 봉투는 현장 정상 전문 예시와 byte-identical 로 보존(무접촉).
 *
 * 커버(AC): AC-1 전문에 DEVICE_TYPE="CAT_" 포함(케이스① pass) /
 *   AC-2 재현매트릭스 ②~⑤ = CRM 경로 물리적 발생불가(하드코딩 상수·조립 방어) /
 *   AC-3 ENVELOPE(header) 회귀0(DATATYPE 봉투 불변) / 이중결제·응답 flat 파싱 불변.
 */

const BASE = { tid: 'TID12345678', catPort: 'COM3' as const };

// ══════════════════════════════════════════════════════════════════════════
// AC-1 — 전문(body)에 DEVICE_TYPE="CAT_" 포함 (케이스 ① 정상)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 DEVICE_TYPE="CAT_" 주입 (케이스 ① 정상)', () => {
  test('승인 전문 body 에 DEVICE_TYPE="CAT_" (언더스코어 포함) 존재', () => {
    const { message, body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    const parsed = JSON.parse(message) as { header: Record<string, string>; body: Record<string, string> };
    // body.DEVICE_TYPE = 정확히 "CAT_" (케이스 ① 유일 정상값).
    expect(body.DEVICE_TYPE).toBe('CAT_');
    expect(body.DEVICE_TYPE).toBe(CBAND_DEVICE_TYPE);
    expect(parsed.body.DEVICE_TYPE).toBe('CAT_');
    // 전문 문자열에도 리터럴 존재(literal-match VPOS_Client.dll 대비).
    expect(message).toContain('"DEVICE_TYPE":"CAT_"');
    // ★배치 = body(header 아님). header 봉투는 DEVICE_TYPE 미포함(무접촉).
    expect(parsed.header.DEVICE_TYPE).toBeUndefined();
  });

  test('상수 무결성 — CBAND_DEVICE_TYPE 는 "CAT_"(언더스코어 포함, 트림해도 4자)', () => {
    expect(CBAND_DEVICE_TYPE).toBe('CAT_');
    expect(CBAND_DEVICE_TYPE.endsWith('_')).toBe(true);       // ④"CAT"(밑줄X) 배제
    expect(CBAND_DEVICE_TYPE.trim()).toBe('CAT_');            // ③"" 배제
    expect(CBAND_DEVICE_TYPE).not.toBe('VPOS');               // ⑤"VPOS" 배제
  });

  test('승인·취소·MERNO 유무 전조합 모두 body.DEVICE_TYPE="CAT_"', () => {
    const perms = [
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace() },
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560', amount: 500, catPort: 3, msgTrace: makeTrace() },
      { tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(), originalAuthNo: '28102510' },
    ];
    for (const p of perms) {
      const { body, message } = buildMsg(p);
      expect(body.DEVICE_TYPE).toBe('CAT_');
      expect(message).toContain('"DEVICE_TYPE":"CAT_"');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-2 — 재현매트릭스 ②~⑤ = CRM 경로 물리적 발생불가 (하드코딩 상수 · 조립 방어)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 케이스 ②~⑤ CRM 발생불가 (하드코딩 상수)', () => {
  test('DEVICE_TYPE 는 BuildMsgParams 로 주입 불가 — 사용자입력/per-seat 유래 물리 차단', () => {
    // buildMsg 는 DEVICE_TYPE 를 파라미터로 받지 않는다 → 호출부가 "CAT_" 외 값을 실을 경로가 없음.
    // (오염된 값을 억지로 넣어도) 조립 결과는 항상 상수 "CAT_" 로 고정된다.
    const poison = { tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
      // @ts-expect-error — DEVICE_TYPE 은 BuildMsgParams 에 없음(주입 경로 부재를 타입으로 증명).
      DEVICE_TYPE: 'VPOS' } as Parameters<typeof buildMsg>[0];
    const { body } = buildMsg(poison);
    expect(body.DEVICE_TYPE).toBe('CAT_');    // ⑤"VPOS" 오염 무시 → 상수 유지
  });

  test('케이스 ②누락·③""·④"CAT"·⑤"VPOS" 전문에 리터럴로 실릴 수 없음', () => {
    const { message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    // ② 누락: DEVICE_TYPE 키 자체가 항상 존재.
    expect(message).toContain('"DEVICE_TYPE":');
    // ③ 빈값 / ④ "CAT"(밑줄X) / ⑤ "VPOS" 리터럴 부재.
    expect(message).not.toContain('"DEVICE_TYPE":""');
    expect(message).not.toContain('"DEVICE_TYPE":"CAT"'); // "CAT" 뒤에 반드시 _ (아래 정규식으로 재확인)
    expect(message).not.toMatch(/"DEVICE_TYPE":"CAT"[,}]/); // "CAT"(밑줄X) 종결 배제
    expect(message).not.toContain('"DEVICE_TYPE":"VPOS"');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-3 — ENVELOPE(header) 회귀0 : DATATYPE 봉투 불변(header byte-identical)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 ENVELOPE 회귀0 (header 봉투 무접촉)', () => {
  test('header 키셋·값 = ENVELOPE-MISSING 확정 그대로(DEVICE_TYPE 는 header 에 없음)', () => {
    const trace = makeTrace();
    const { header } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: trace,
    });
    // header 키셋 = {DATA_TYPE, LENGTH, MSG_TRACE, MSG_VERSION, TCODE} — DEVICE_TYPE 미포함.
    expect(Object.keys(header).sort()).toEqual(
      ['DATA_TYPE', 'LENGTH', 'MSG_TRACE', 'MSG_VERSION', 'TCODE']);
    expect(header.DATA_TYPE).toBe(CBAND_DATA_TYPE);
    expect(header.MSG_VERSION).toBe(CBAND_MSG_VERSION);
    expect(header.TCODE).toBe(CBAND_TCODE);
    expect(header.MSG_TRACE).toBe(trace);
    expect((header as Record<string, string>).DEVICE_TYPE).toBeUndefined();
  });

  test('DATA_TYPE header 불변 + 콜론 뒤 공백 0 (DEVICE_TYPE 추가로도 회귀 없음)', () => {
    const { message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560',
      amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    expect(message).toContain('"DATA_TYPE":"JSON"');  // ENVELOPE-MISSING 불변
    expect(message).not.toMatch(/:\s/);               // 콜론 뒤 공백/개행 0
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 회귀 — 이중결제 분류 + 응답(flat) 파싱 불변 (요청측만 봉투)
// ══════════════════════════════════════════════════════════════════════════
test.describe('회귀 (이중결제·응답 flat 불변)', () => {
  test('취소(0430)도 body.DEVICE_TYPE="CAT_" + AUTHNO 유지', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: 3,
      msgTrace: makeTrace(), originalAuthNo: '28102510',
    });
    expect(body.DEVICE_TYPE).toBe('CAT_');
    expect(body.TRANTYPE).toBe('0430');
    expect(body.AUTHNO).toBe('28102510');
  });

  test('응답은 flat(봉투 아님) — normalize/classify 불변(무응답 → ATTENTION)', () => {
    const REAL_APPROVAL =
      '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000001002","AUTHNO":"28102510    ",' +
      '"TRANSERIAL":"104421000759","MSG1":"거래 승인28102510"}';
    const n = normalize(safeParse(REAL_APPROVAL));
    expect(n.responseCode).toBe('0000');
    expect(classify(n)).toBe('APPROVED');
    // 무응답(타임아웃) → ATTENTION(자동 재시도 금지·이중결제 방지 불변).
    expect(classify(null)).toBe('ATTENTION');
  });
});
