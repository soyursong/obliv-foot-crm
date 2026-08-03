import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  utf8ByteLength,
  bodyLength,
  safeParse,
  normalize,
  classify,
  CBAND_DATA_TYPE,
  CBAND_MSG_VERSION,
  CBAND_TCODE,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-DATATYPE-HEADER-ENVELOPE-MISSING — 코밴 직결결제 전문 header 봉투 누락 P0
 * ────────────────────────────────────────────────────────────────────────────
 * 실 원인: 종전 buildMsg 가 flat 필드만 emit → 데몬이 header 의 DATA_TYPE(전문형태)를 못 찾아
 *   "DATA_TYPE 전문형태 값이 없습니다"로 전문 거부(현장 케이스 ② 필드누락 일치).
 * FIX: buildMsg 가 데몬 기대 봉투 {"header":{…DATA_TYPE:"JSON"…LENGTH…},"body":{…}} 를 emit.
 *
 * ★header 필드값은 추측 아님 — authoritative 2예시 확정:
 *   (a) 현장 "정상 전문 예시"(티켓 §배경):
 *       {"LENGTH":"0590","MSG_VERSION":"0002","TCODE":"S0","MSG_TRACE":"235112000001","DATA_TYPE":"JSON"}
 *   (b) DAEMON-PARSE-ROBUST 티켓 §1: {"header":{"LENGTH":"0591","MSG_VERSION":"0002","TC…}}
 *
 * 커버(AC): AC-1 봉투 shape·필드정합 / AC-2 DATA_TYPE 항상존재+콜론공백0(케이스②③④⑤ 불가) /
 *   AC-3 LENGTH=no-space body 바이트수 4자리 zero-pad / 승인·취소 회귀·응답 flat 파싱 불변.
 */

const BASE = { tid: 'TID12345678', catPort: 'COM3' as const };

// 현장 "정상 전문 예시"(데몬이 받는 형태) — 구조 대조용.
const FIELD_NORMAL_EXAMPLE =
  '{"header":{"LENGTH":"0590","MSG_VERSION":"0002","TCODE":"S0","MSG_TRACE":"235112000001","DATA_TYPE":"JSON"},"body":{}}';

// ══════════════════════════════════════════════════════════════════════════
// AC-1 — buildMsg 출력이 데몬 기대 봉투({header{…DATA_TYPE…LENGTH…}, body{…}})
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 봉투 구조 + 필드 정합', () => {
  test('승인 전문 = {header, body} 봉투 · header 필드값 현장 예시 정합', () => {
    const trace = makeTrace();
    const { message, header, body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: trace,
    });
    const parsed = JSON.parse(message) as { header: Record<string, string>; body: Record<string, string> };
    // 봉투 최상위 = header + body 두 키만.
    expect(Object.keys(parsed).sort()).toEqual(['body', 'header']);
    // header — 현장 정상 전문 예시와 동일 필드셋·값(LENGTH 제외 상수 정합).
    expect(parsed.header.DATA_TYPE).toBe('JSON');
    expect(parsed.header.DATA_TYPE).toBe(CBAND_DATA_TYPE);
    expect(parsed.header.MSG_VERSION).toBe('0002');
    expect(parsed.header.MSG_VERSION).toBe(CBAND_MSG_VERSION);
    expect(parsed.header.TCODE).toBe('S0');
    expect(parsed.header.TCODE).toBe(CBAND_TCODE);
    expect(parsed.header.MSG_TRACE).toBe(trace);      // ★MSG_TRACE 는 header 에
    expect(Object.keys(parsed.header).sort()).toEqual(
      ['DATA_TYPE', 'LENGTH', 'MSG_TRACE', 'MSG_VERSION', 'TCODE']);
    // body — 거래필드(MSG_TRACE 는 body 아님).
    expect(parsed.body.TRANTYPE).toBe('0210');
    expect(parsed.body.TID).toBe(BASE.tid);
    expect(parsed.body.CAT_PORT).toBe('03');
    expect(parsed.body.TAMT).toBe('000001002');
    expect(parsed.body.MSG_TRACE).toBeUndefined();
    // 반환 header/body 는 message 와 일치.
    expect(header).toEqual(parsed.header);
    expect(body).toEqual(parsed.body);
  });

  test('현장 정상 전문 예시와 봉투 구조 동형(header 키셋 일치)', () => {
    const ex = JSON.parse(FIELD_NORMAL_EXAMPLE) as { header: Record<string, string> };
    const { header } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1000, catPort: 3, msgTrace: makeTrace(),
    });
    expect(Object.keys(header).sort()).toEqual(Object.keys(ex.header).sort());
    expect(header.DATA_TYPE).toBe(ex.header.DATA_TYPE);
    expect(header.MSG_VERSION).toBe(ex.header.MSG_VERSION);
    expect(header.TCODE).toBe(ex.header.TCODE);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-2 — DATA_TYPE 항상 존재·비어있지 않음(케이스 ②③) + 콜론 뒤 공백 0(케이스 ④⑤)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 불변식 3종 (케이스 ②③④⑤ 불가)', () => {
  test('케이스②③ 불가 — DATA_TYPE 항상 "JSON"·비어있지 않음(승인·취소·MERNO유무 전조합)', () => {
    const perms = [
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace() },
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560', amount: 500, catPort: 3, msgTrace: makeTrace() },
      { tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(), originalAuthNo: '28102510' },
    ];
    for (const p of perms) {
      const { header, message } = buildMsg(p);
      expect(header.DATA_TYPE).toBe('JSON');
      expect(header.DATA_TYPE.trim().length).toBeGreaterThan(0);
      // 전문 문자열에도 DATA_TYPE:"JSON" 리터럴 존재(literal-match 데몬 대비).
      expect(message).toContain('"DATA_TYPE":"JSON"');
    }
  });

  test('케이스④⑤ 불가 — 콜론 뒤 공백/개행 0 (봉투 stringify 기본출력)', () => {
    const { message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560',
      amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    expect(message).not.toMatch(/:\s/);   // 콜론 뒤 공백/개행/탭 0
    expect(message).not.toMatch(/\n|\t/);  // 들여쓰기/개행 0
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-3 — LENGTH = no-space body 바이트수 4자리 zero-pad, 실제 body 길이와 일치
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 LENGTH 산출', () => {
  test('LENGTH = body(데이터부) UTF-8 바이트수 4자리 zero-pad', () => {
    const { header, body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    const bodyStr = JSON.stringify(body);
    expect(header.LENGTH).toMatch(/^\d{4}$/);
    expect(header.LENGTH).toBe(String(utf8ByteLength(bodyStr)).padStart(4, '0'));
    expect(parseInt(header.LENGTH, 10)).toBe(utf8ByteLength(bodyStr));
  });

  test('utf8ByteLength / bodyLength 헬퍼 정확성', () => {
    expect(utf8ByteLength('abc')).toBe(3);        // ASCII
    expect(utf8ByteLength('가')).toBe(3);          // 한글 = 3바이트
    expect(bodyLength('abc')).toBe('0003');        // 4자리 zero-pad
    expect(bodyLength('')).toBe('0000');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 회귀 — 취소 봉투 + TID throw + 응답(flat) 파싱 불변
// ══════════════════════════════════════════════════════════════════════════
test.describe('회귀 (취소·throw·응답 flat 불변)', () => {
  test('취소(0430)도 header.DATA_TYPE 포함 + body.AUTHNO(원거래) 유지', () => {
    const { header, body, message } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: 3,
      msgTrace: makeTrace(), originalAuthNo: '28102510',
    });
    expect(header.DATA_TYPE).toBe('JSON');
    expect(body.TRANTYPE).toBe('0430');
    expect(body.AUTHNO).toBe('28102510');
    expect(message).not.toMatch(/:\s/);
  });

  test('실측#1 TID 빈값 → 조립 throw(봉투 이전 차단) 유지', () => {
    expect(() => buildMsg({
      tranType: TRANTYPE_APPROVE, tid: '  ', amount: 1002, catPort: 3, msgTrace: makeTrace(),
    })).toThrow(/TID/);
  });

  test('응답은 flat(봉투 아님) — normalize/classify 불변', () => {
    // 요청측만 봉투. 응답은 종전대로 flat(ERRCODE/TRANTYPE/AUTHNO…) → normalize 정상 추출.
    const REAL_APPROVAL =
      '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000001002","AUTHNO":"28102510    ",' +
      '"TRANSERIAL":"104421000759","MSG1":"거래 승인28102510"}';
    const n = normalize(safeParse(REAL_APPROVAL));
    expect(n.responseCode).toBe('0000');
    expect(n.authNo).toBe('28102510');
    expect(classify(n)).toBe('APPROVED');
  });
});
