import { test, expect } from '@playwright/test';
import {
  buildMsg,
  makeTrace,
  TRANTYPE_APPROVE,
  TRANTYPE_CANCEL,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-CATRECEIPT-REALPAY-Y — CAT_TERMINAL_RECEIPT 빈값 → 결제구분 Y/N 정정
 * ────────────────────────────────────────────────────────────────────────────
 * 증상: NULLREF-COMPLETE(deployed) AC2 가 CAT_TERMINAL_RECEIPT 를 항상 ""(빈문자)로 채움
 *   → 데몬이 단말기 영수증을 출력하지 않음(08:00·09:58·10:55 요청 전건 빈값 확인).
 * 재정의(policy_superseded, reporter 최필경 총괄 명시): 이 필드 한정으로 빈문자 default 를 교체.
 *   · 실결제/실취소(실금전 전문)  → "Y"(단말기 영수증 출력)
 *   · 통신 테스트(돈 안 나가는 점검) → "N"
 *   · 어떤 경우에도 빈값("")/누락 금지.
 * NULLREF-COMPLETE 의 나머지 19필드 null-ref 방지(빈문자 치환)는 불변(회귀 0).
 *
 * ★물리 단말 실출력은 Playwright 불가 → buildMsg 순수함수 payload 의 Y/N/빈값-금지만 결정론 검증.
 *   실 영수증 출력 = field-soak(총괄 최필경).
 *
 * AC 매핑:
 *  · AC1 실결제(승인/취소) 전문 = "Y".
 *  · AC2 통신 테스트 전문 = "N".
 *  · AC3 어떤 결제구분에서도 빈값("")/누락 아님.
 *  · AC4 NULLREF-COMPLETE 나머지 필드 회귀 0(빈문자 유지).
 */

const BASE = { tid: 'T1234567', merno: '00918554560', catPort: 'COM3' as const };

test.describe('CBAND CAT_TERMINAL_RECEIPT 결제구분 Y/N (CATRECEIPT-REALPAY-Y)', () => {
  test('AC1: 실결제 승인(0210) → CAT_TERMINAL_RECEIPT="Y"', () => {
    const { body, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(),
    });
    expect(body.CAT_TERMINAL_RECEIPT).toBe('Y');
    // 직렬화 payload(데몬이 파싱하는 실제 문자열)에도 "Y" 실재.
    const parsed = JSON.parse(message).body as Record<string, string>;
    expect(parsed.CAT_TERMINAL_RECEIPT).toBe('Y');
  });

  test('AC1: 실취소(0430)도 실금전 전문 → CAT_TERMINAL_RECEIPT="Y"', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_CANCEL, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(),
      originalAuthNo: '28102510', originalAuthDate: '260731',
    });
    expect(body.CAT_TERMINAL_RECEIPT).toBe('Y');
  });

  test('AC1: commTest 미지정(기본)은 실결제로 간주 → "Y"', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002,
      catPort: BASE.catPort, msgTrace: makeTrace(),
      // commTest 미지정
    });
    expect(body.CAT_TERMINAL_RECEIPT).toBe('Y');
  });

  test('AC1: commTest:false 명시도 실결제 → "Y"', () => {
    const { body } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1002,
      catPort: BASE.catPort, msgTrace: makeTrace(), commTest: false,
    });
    expect(body.CAT_TERMINAL_RECEIPT).toBe('Y');
  });

  test('AC2: 통신 테스트(commTest:true) → CAT_TERMINAL_RECEIPT="N"', () => {
    const { body, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1001,
      catPort: BASE.catPort, msgTrace: makeTrace(), commTest: true,
    });
    expect(body.CAT_TERMINAL_RECEIPT).toBe('N');
    const parsed = JSON.parse(message).body as Record<string, string>;
    expect(parsed.CAT_TERMINAL_RECEIPT).toBe('N');
  });

  test('AC3: 어떤 결제구분에서도 빈값("")/누락 아님(승인·취소 × 실결제·통신테스트)', () => {
    const cases = [
      { tranType: TRANTYPE_APPROVE, commTest: false, expected: 'Y' },
      { tranType: TRANTYPE_APPROVE, commTest: true, expected: 'N' },
      { tranType: TRANTYPE_CANCEL, commTest: false, expected: 'Y' },
      { tranType: TRANTYPE_CANCEL, commTest: true, expected: 'N' },
    ] as const;
    for (const c of cases) {
      const { body, message } = buildMsg({
        tranType: c.tranType, tid: BASE.tid, amount: 1005,
        catPort: BASE.catPort, msgTrace: makeTrace(),
        commTest: c.commTest,
        originalAuthNo: c.tranType === TRANTYPE_CANCEL ? '28102510' : undefined,
      });
      // 필드 존재 + 빈문자 아님 + 정확한 Y|N.
      expect(Object.prototype.hasOwnProperty.call(body, 'CAT_TERMINAL_RECEIPT')).toBe(true);
      expect(body.CAT_TERMINAL_RECEIPT).not.toBe('');
      expect(['Y', 'N']).toContain(body.CAT_TERMINAL_RECEIPT);
      expect(body.CAT_TERMINAL_RECEIPT).toBe(c.expected);
      // 직렬화 payload 에도 빈 CAT_TERMINAL_RECEIPT 부재.
      expect(message).not.toContain('"CAT_TERMINAL_RECEIPT":""');
    }
  });

  test('AC4 회귀0: 결제구분 분기가 다른 필수필드를 오염시키지 않음(빈문자 치환 불변)', () => {
    const stillEmpty = [
      'ORI_DATE', 'ORI_AUTHNO', 'IDNO', 'AMT_FLAG', 'TAX_AMT', 'SVC_AMT',
      'NONTAX_AMT', 'FILLER', 'SET_QR_DATA_512', 'SET_QR_DATA_256',
      'SET_PG_TYPE', 'SET_PG_DATA_LEN', 'SET_PG_DATA',
    ];
    for (const commTest of [false, true]) {
      const { body } = buildMsg({
        tranType: TRANTYPE_APPROVE, tid: BASE.tid, amount: 1006,
        catPort: BASE.catPort, msgTrace: makeTrace(), commTest,
      });
      // 값 없는 필드는 여전히 ""(null-ref 방지 로직 무접촉).
      for (const f of stillEmpty) expect(body[f]).toBe('');
      // 값 있는 고정필드도 불변.
      expect(body.HALBU).toBe('00');
      expect(body.CAT_BAUDRATE).toBe('38400');
      expect(body.DEVICE_TYPE).toBe('CAT_');
    }
  });
});
