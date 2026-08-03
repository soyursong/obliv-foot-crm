import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  safeParse,
  normalize,
  classify,
  CBAND_DEVICE_TYPE,
  CBAND_DATA_TYPE,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-DEVICETYPE-CAT-FIXED — 코밴 CAT 직결결제 body DEVICE_TYPE "CAT_" 고정 P0
 * ────────────────────────────────────────────────────────────────────────────
 * 실 원인(전진): header 봉투(370ba999, ENVELOPE-MISSING) 해소 후 데몬 오류가
 *   9999(전문형식) → 9998(모듈로드) 로 전진 = 전문 파싱은 통과, 이제 모듈 라우팅 단계.
 *   body.DEVICE_TYPE 이 정확히 "CAT_"(4자, 끝 밑줄)가 아니면 데몬이 VPOS 분기(VPOS_Client.dll,
 *   현장 미설치·C:\KOVAN 미존재)로 라우팅 → DLL 로드 실패(9998). CAT 연동 KovanSocketCat.dll=설치됨.
 *
 * ★근거(추측 아님):
 *   (a) 7/31 실승인 전문 원문 body 20필드(DIAGNOSE §ROOT-CAUSE)에 DEVICE_TYPE 존재, 값 "CAT_".
 *   (b) 최필경 총괄 현장 5케이스 직접 재현:
 *       ① "CAT_"(4자,끝밑줄)=✅ / ② 누락=❌9998 / ③ ""(빈값)=❌ / ④ "CAT"(밑줄없음)=❌ / ⑤ "VPOS"=❌
 *
 * 커버(AC):
 *   AC-1 buildMsg body.DEVICE_TYPE === "CAT_" (정확히 4자, 끝 밑줄). 케이스 ②③④⑤ 발생 불가.
 *   AC-2 7/31 실승인 전문 값(CAT_)과 정합.
 *   AC-3 DEVICE_TYPE="CAT_" 불변식 가드(승인·취소·MERNO유무 전조합).
 *   AC-4 header 봉투(370ba999)·이중결제·classify·safeParse 회귀 0.
 */

const BASE = { tid: 'TID12345678', catPort: 'COM3' as const };

// ══════════════════════════════════════════════════════════════════════════
// AC-1 / AC-2 — body.DEVICE_TYPE === "CAT_" (정확히 4자·끝 밑줄, 실승인 전문 정합)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-1/AC-2 DEVICE_TYPE = "CAT_" 값 고정', () => {
  test('승인 전문 body.DEVICE_TYPE = 정확히 "CAT_"(4자, 끝 밑줄)', () => {
    const { body, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    // 정확히 "CAT_" — 케이스 ①.
    expect(body.DEVICE_TYPE).toBe('CAT_');
    expect(body.DEVICE_TYPE).toBe(CBAND_DEVICE_TYPE);
    // 케이스 ④(밑줄없음) 불가: 정확히 4자 + 끝이 밑줄.
    expect(body.DEVICE_TYPE.length).toBe(4);
    expect(body.DEVICE_TYPE.endsWith('_')).toBe(true);
    expect(body.DEVICE_TYPE).not.toBe('CAT');
    // 케이스 ⑤ 불가: VPOS 아님.
    expect(body.DEVICE_TYPE).not.toBe('VPOS');
    // 전문 문자열에도 리터럴 존재(literal-match 데몬 대비).
    expect(message).toContain('"DEVICE_TYPE":"CAT_"');
  });

  test('상수 CBAND_DEVICE_TYPE 자체가 정확히 "CAT_"', () => {
    // 7/31 실승인 전문 원문 값과 정합 — 상수 SSOT.
    expect(CBAND_DEVICE_TYPE).toBe('CAT_');
    expect(String(CBAND_DEVICE_TYPE)).toHaveLength(4);
  });

  test('케이스 ②(누락) 불가 — DEVICE_TYPE 항상 body 에 존재', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 500, catPort: 3, msgTrace: makeTrace(),
    });
    expect(body.DEVICE_TYPE).toBeDefined();
    expect(body.DEVICE_TYPE).not.toBe('');
    expect('DEVICE_TYPE' in body).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-3 — DEVICE_TYPE="CAT_" 불변식(승인·취소·MERNO유무 전조합)
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 불변식 (전조합 케이스 ②③④⑤ 불가)', () => {
  test('승인/취소/MERNO유무 모든 조합에서 body.DEVICE_TYPE = "CAT_"', () => {
    const perms = [
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace() },
      { tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560', amount: 500, catPort: 3, msgTrace: makeTrace() },
      { tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(), originalAuthNo: '28102510' },
      { tranType: TRANTYPE_CANCEL, tid: BASE.tid, merno: '00918554560', amount: 300, catPort: 'COM5' as const, msgTrace: makeTrace(), originalAuthNo: '28102510', originalAuthDate: '260731' },
    ];
    for (const p of perms) {
      const { body, message } = buildMsg(p);
      expect(body.DEVICE_TYPE).toBe('CAT_');           // ② 누락 · ③ 빈값 불가
      expect(body.DEVICE_TYPE.length).toBe(4);         // ④ 밑줄없음("CAT",3자) 불가
      expect(body.DEVICE_TYPE.endsWith('_')).toBe(true);
      expect(body.DEVICE_TYPE).not.toBe('VPOS');       // ⑤ VPOS 불가
      expect(message).toContain('"DEVICE_TYPE":"CAT_"');
    }
  });

  test('취소(0430) 전문에도 DEVICE_TYPE="CAT_" 유지(시나리오2)', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1002, catPort: 3,
      msgTrace: makeTrace(), originalAuthNo: '28102510',
    });
    expect(body.TRANTYPE).toBe('0430');
    expect(body.DEVICE_TYPE).toBe('CAT_');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-4 — 회귀 0: header 봉투(370ba999) 무접촉 + 응답 flat classify 불변
// ══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 회귀 (header 봉투·응답 파싱 무접촉)', () => {
  test('header 봉투(DATA_TYPE:"JSON") 무변조 — 370ba999 회귀 없음', () => {
    const { header, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    // DEVICE_TYPE 은 body 필드 — header 에는 없음(봉투 무접촉).
    expect(header.DATA_TYPE).toBe('JSON');
    expect(header.DATA_TYPE).toBe(CBAND_DATA_TYPE);
    expect(header.DEVICE_TYPE).toBeUndefined();
    // 콜론 뒤 공백 0(규칙#1) 유지.
    expect(message).not.toMatch(/:\s/);
  });

  test('LENGTH = DEVICE_TYPE 포함 body 바이트수와 정합(동적 산출 유지)', () => {
    const { header, body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002, catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    const bodyStr = JSON.stringify(body);
    // LENGTH 는 body(DEVICE_TYPE 포함) 실 바이트수 — 하드코딩 아님.
    expect(header.LENGTH).toMatch(/^\d{4}$/);
    expect(parseInt(header.LENGTH, 10)).toBe(Buffer.byteLength(bodyStr, 'utf8'));
  });

  test('응답은 flat(봉투 아님) — normalize/classify 불변', () => {
    const REAL_APPROVAL =
      '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000001002","AUTHNO":"28102510    ",' +
      '"TRANSERIAL":"104421000759","MSG1":"거래 승인28102510"}';
    const n = normalize(safeParse(REAL_APPROVAL));
    expect(n.responseCode).toBe('0000');
    expect(n.authNo).toBe('28102510');
    expect(classify(n)).toBe('APPROVED');
  });
});
