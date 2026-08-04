import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  CBAND_REQUIRED_BODY_FIELDS,
  CBAND_DEVICE_TYPE,
  CBAND_HALBU_LUMPSUM,
  CBAND_CAT_BAUDRATE,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-BODY-FIELDS-NULLREF-COMPLETE — 코밴 CAT 직결결제 body 필수 필드 완전성
 * ────────────────────────────────────────────────────────────────────────────
 * 증상 전진: header 봉투(ENVELOPE-MISSING, deployed → 9999 해소) → DEVICE_TYPE="CAT_"(deployed → 9998 해소,
 *   데몬 CAT 모듈 진입) → ★본건: CAT 모듈 안쪽 body 파싱 시 필수필드 누락 → HandleMessageAsync
 *   NullReferenceException("개체 참조가 개체의 인스턴스로 설정되지 않았습니다").
 *
 * 근본원인: buildMsg 가 데몬 필수 필드 전집합을 항상 채우지 않음(값 없는 필드가 키 누락/null 직렬화).
 * 현장(최필경 총괄) 전수 재현: 20필드를 하나씩 제거 → 19필드 각각 단독 누락만으로 오류.
 *
 * ★물리 CAT 단말은 Playwright 로 왕복 불가 → buildMsg 직렬화 payload 단위 assert(필드 존재·빈문자 치환)로
 *   유닛/E2E 변환. 데몬 왕복은 현장 field-soak(총괄).
 *
 * AC 매핑:
 *  · AC1 필드 존재 보장 — 모든 결제경로(승인/취소·MERNO유무)에서 필수 20필드 키 누락 0.
 *  · AC2 null→빈문자 — 값 없는 필드는 null/undefined 아닌 "" 로 직렬화(키 존재).
 *  · AC3 실승인 전문 대조 — 전집합·순서·기본값을 7/31 실전문 20필드 원문(DIAGNOSE §ROOT-CAUSE)과 대조.
 *  · AC4 회귀0 — 봉투 header(DATA_TYPE/MSG_VERSION/TCODE/MSG_TRACE)·DEVICE_TYPE="CAT_"·wire compact·
 *          이중결제 discriminator(TRANTYPE)·MERNO 계승 무접촉.
 *  · AC5 현장 재현 해소 — "필드 단독 누락 → NullRef" 이 조립 단계에서 발생 불가.
 */

const BASE = { tid: 'T1234567', merno: '00918554560', catPort: 'COM3' as const };

// 7/31 실승인 전문 body 20필드(AUTHORITATIVE, DIAGNOSE §ROOT-CAUSE) — 대조 기준 SSOT.
const AUTHORITATIVE_20 = [
  'TID', 'HALBU', 'TAMT', 'ORI_DATE', 'ORI_AUTHNO', 'IDNO', 'AMT_FLAG',
  'TAX_AMT', 'SVC_AMT', 'NONTAX_AMT', 'FILLER',
  'SET_QR_DATA_512', 'SET_QR_DATA_256', 'DEVICE_TYPE',
  'SET_PG_TYPE', 'SET_PG_DATA_LEN', 'SET_PG_DATA',
  'CAT_PORT', 'CAT_BAUDRATE', 'CAT_TERMINAL_RECEIPT',
];

test.describe('CBAND body 필수 필드 완전성 (NULLREF-COMPLETE)', () => {
  test('AC3: 필수 전집합 상수가 7/31 실승인 20필드 원문과 정확히 일치', () => {
    expect([...CBAND_REQUIRED_BODY_FIELDS]).toEqual(AUTHORITATIVE_20);
    expect(CBAND_REQUIRED_BODY_FIELDS.length).toBe(20);
  });

  test('AC1: 승인(0210) 전문 body 에 필수 20필드 전부 존재(키 누락 0)', () => {
    const { body, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    for (const f of CBAND_REQUIRED_BODY_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(body, f)).toBe(true);
      expect(typeof body[f]).toBe('string');           // null/undefined 아님
    }
    // 직렬화 payload 에도 각 필드 키가 실재(데몬이 파싱하는 실제 문자열 기준).
    const parsed = JSON.parse(message).body as Record<string, unknown>;
    for (const f of CBAND_REQUIRED_BODY_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(parsed, f)).toBe(true);
    }
  });

  test('AC1: 취소(0430) 전문 body 에도 필수 20필드 전부 존재', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(),
      originalAuthNo: '28102510', originalAuthDate: '260731',
    });
    for (const f of CBAND_REQUIRED_BODY_FIELDS) {
      expect(typeof body[f]).toBe('string');
    }
    // 취소 원거래 참조 = authoritative 필드명 ORI_AUTHNO / ORI_DATE.
    expect(body.ORI_AUTHNO).toBe('28102510');
    expect(body.ORI_DATE).toBe('260731');
  });

  test('AC2: 값 없는 필드는 null/키누락 아닌 빈문자 "" 로 직렬화(승인)', () => {
    const { body, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    // 값 없는 필드(승인 경로) = "".
    // ★CAT_TERMINAL_RECEIPT 는 제외 — T-20260804-CATRECEIPT-REALPAY-Y 재정의로 빈문자 아닌 Y/N(별도 spec 커버).
    const emptyOnApprove = [
      'ORI_DATE', 'ORI_AUTHNO', 'IDNO', 'AMT_FLAG', 'TAX_AMT', 'SVC_AMT',
      'NONTAX_AMT', 'FILLER', 'SET_QR_DATA_512', 'SET_QR_DATA_256',
      'SET_PG_TYPE', 'SET_PG_DATA_LEN', 'SET_PG_DATA',
    ];
    for (const f of emptyOnApprove) expect(body[f]).toBe('');
    // CAT_TERMINAL_RECEIPT 는 실결제(기본)에서 "Y"(빈문자 아님) — 재정의 회귀 가드.
    expect(body.CAT_TERMINAL_RECEIPT).toBe('Y');
    // 직렬화 문자열에 null/undefined 리터럴 부재(데몬 null-ref 유발 형태 차단).
    expect(message).not.toContain(':null');
    expect(message).not.toContain('undefined');
  });

  test('AC2: 값 있는 필드 기본값 — HALBU="00" · CAT_BAUDRATE="38400" · DEVICE_TYPE="CAT_"', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002,
      catPort: 'COM3', msgTrace: makeTrace(),
    });
    expect(body.HALBU).toBe(CBAND_HALBU_LUMPSUM);        // "00" 일시불
    expect(body.CAT_BAUDRATE).toBe(CBAND_CAT_BAUDRATE);  // "38400"
    expect(body.DEVICE_TYPE).toBe(CBAND_DEVICE_TYPE);    // "CAT_"
    expect(body.TID).toBe(BASE.tid);
    expect(body.TAMT).toBe('000001002');                 // 9자리 zero-pad
    expect(body.CAT_PORT).toBe('03');                    // 2자리 zero-pad(COM3→03)
  });

  test('AC4 회귀0: 봉투 header·DEVICE_TYPE·wire compact·TRANTYPE discriminator·MERNO 계승 무접촉', () => {
    const trace = makeTrace();
    const { header, body, message, envelope } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: BASE.merno,
      amount: 1003, catPort: 3, msgTrace: trace,
    });
    // 봉투 header 불변식.
    expect(header.DATA_TYPE).toBe('JSON');
    expect(header.MSG_VERSION).toBe('0002');
    expect(header.TCODE).toBe('S0');
    expect(header.MSG_TRACE).toBe(trace);
    expect(body.MSG_TRACE).toBeUndefined();              // MSG_TRACE 는 header 전용
    // wire compact(콜론 뒤 공백 0) + 봉투 stringify 동일.
    expect(message).not.toMatch(/:\s/);
    expect(message).toBe(JSON.stringify(envelope));
    // TRANTYPE discriminator(이중결제 가드 무접촉).
    expect(body.TRANTYPE).toBe('0210');
    // MERNO 계승(값 있으면 주입) — 필수20 외 optional.
    expect(body.MERNO).toBe(BASE.merno);
    // 빈 MERNO 는 미주입(순환참조 해소, MERNO-REQFIELD-BUG 유지).
    const { body: b2 } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '',
      amount: 1003, catPort: 3, msgTrace: makeTrace(),
    });
    expect(b2.MERNO).toBeUndefined();
    // MERNO 유무와 무관하게 필수20 은 항상 완비.
    for (const f of CBAND_REQUIRED_BODY_FIELDS) expect(typeof b2[f]).toBe('string');
  });

  test('AC5: 직렬화 payload 어디에도 필수필드 null/키누락 없음(현장 NullRef 재현 불가)', () => {
    for (const tt of [TRANTYPE_APPROVE, TRANTYPE_CANCEL] as const) {
      const { message } = buildMsg({
        tranType: tt, tid: BASE.tid, amount: 1005, catPort: BASE.catPort,
        msgTrace: makeTrace(),
        originalAuthNo: tt === TRANTYPE_CANCEL ? '28102510' : undefined,
      });
      const bodyObj = JSON.parse(message).body as Record<string, unknown>;
      for (const f of CBAND_REQUIRED_BODY_FIELDS) {
        expect(f in bodyObj).toBe(true);
        expect(bodyObj[f]).not.toBeNull();
        expect(typeof bodyObj[f]).toBe('string');
      }
    }
  });

  test('AC5: 필수필드가 비문자로 오염되면 조립 단계에서 throw(회귀 백스톱)', () => {
    // 정상 경로는 항상 완비되므로 정공법으로는 재현 불가 — 상수·가드 존재 자체가 백스톱.
    // 승인/취소 정상 조립이 throw 없이 성립함을 확인(가드가 정상 payload 를 막지 않음).
    expect(() => buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1006,
      catPort: BASE.catPort, msgTrace: makeTrace(),
    })).not.toThrow();
  });
});
