import { test, expect } from '@playwright/test';
import {
  classify,
  normalize,
  safeParse,
  responseMessageForUser,
  errcodeMessage,
  ERRCODE_MESSAGES,
  ATTENTION_CODES,
  UNCLEAR_TXN_CODES,
  RESPONSE_CODE_SUCCESS,
} from '../../src/lib/cband/protocol';

/**
 * T-20260806-foot-PLANA-ERRCODE-8324-CORPCARD-INSTALLMENT — 8324(법인카드 할부 불가) 오류문구 추가
 * ────────────────────────────────────────────────────────────────────────────
 * 배경: 부모 ERRCODE-HANGUL-8326(deployed) 의 ERRCODES 전체표에 8324 미포함 → 원문/코드 폴백으로 노출.
 *   8324 = 할부개월수 오류 = 실무상 법인카드로 할부 시도 시 발생(법인카드는 할부 미지원).
 *   reporter 최필경 확정 문구(MSG-…-tphw): "법인카드는 할부가 지원되지 않아요. 개인카드로 다시 시도해 주세요".
 *
 * ★classify 실측 판정(선확인, 추정 금지): 8324 는 0000/ATTENTION(C011/8003/8555)/UNCLEAR(8326) 어디에도
 *   없어 classify 가 이미 명확 FAIL 로 폴백한다 → 별도 classify 분기 불요. 순수 additive 표시문구만 추가.
 *   물리 CAT 단말 왕복 불가 → 순수 함수(classify/normalize/responseMessageForUser) 단위로 assert.
 */

// ── 시나리오 1: 8324 한글화 + 명확 FAIL ──────────────────────────────────────
test.describe('① 8324 = 법인카드 할부불가 (명확한 FAIL·한글 표시)', () => {
  test('ERRCODE_MESSAGES 에 8324 매핑이 있고 확정 문구를 담는다', () => {
    expect(Object.keys(ERRCODE_MESSAGES)).toContain('8324');
    expect(errcodeMessage('8324')).toContain('법인카드');
    expect(errcodeMessage('8324')).toContain('할부');
    expect(errcodeMessage('8324')).toContain('개인카드');
  });

  test('errcodeMessage: 대소문자·공백 정규화 후 조회', () => {
    expect(errcodeMessage(' 8324 ')).toContain('법인카드');
  });

  test('classify(ERRCODE=8324) → FAIL (성공/확인필요 아님)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8324","TRANTYPE":"0210"}'));
    expect(classify(resp)).toBe('FAIL');
    expect(classify(resp)).not.toBe('APPROVED');
    expect(classify(resp)).not.toBe('ATTENTION');   // unclear 로 새지 않음
  });

  test('8324 는 ATTENTION/UNCLEAR/성공 집합 어디에도 없다(FAIL 폴백 근거)', () => {
    expect(ATTENTION_CODES.has('8324')).toBe(false);
    expect(UNCLEAR_TXN_CODES.has('8324')).toBe(false);
    expect('8324').not.toBe(RESPONSE_CODE_SUCCESS);
  });

  test('8324 사용자 문구: 법인카드 할부불가 + 개인카드 안내 + 코드 병기 (원문 폴백 아님)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8324","MSG1":"INSTALLMENT NOT ALLOWED"}'));
    const cls = classify(resp);
    const msg = responseMessageForUser(cls, resp);
    expect(cls).toBe('FAIL');
    expect(msg).toContain('법인카드');
    expect(msg).toContain('할부');
    expect(msg).toContain('개인카드');
    expect(msg).toContain('8324');            // 실장이 규격서 조회 가능하도록 코드 병기
    expect(msg).not.toContain('INSTALLMENT NOT ALLOWED');   // 영문 원문 폴백이 아니라 한글 치환
    expect(msg).not.toBe('8324');
  });
});

// ── 시나리오 2: 회귀 — 기존 매핑·classify 3분기 불변 ─────────────────────────
test.describe('② 회귀: 기존 classify/문구 불변 (8324 추가로 회귀 0)', () => {
  test('정상 승인(0000+AUTHNO) → APPROVED 유지', () => {
    const resp = normalize(safeParse('{"ERRCODE":"0000","TRANTYPE":"0210","AUTHNO":"12345678"}'));
    expect(classify(resp)).toBe('APPROVED');
    expect(responseMessageForUser('APPROVED', resp)).toContain('승인');
  });

  test('기존 ATTENTION 코드(8326/C011/8003/8555)·무응답 → ATTENTION 유지', () => {
    expect(classify(normalize(safeParse('{"ERRCODE":"8326","AUTHNO":"12345678"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"C011"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"8003"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"8555"}')))).toBe('ATTENTION');
    expect(classify(null)).toBe('ATTENTION');   // 무응답
  });

  test('8326 확인필요 문구 불변(회귀0)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8326","AUTHNO":"12345678"}'));
    const msg = responseMessageForUser(classify(resp), resp);
    expect(msg).toContain('불확실');
    expect(msg).toContain('승인내역조회');
    expect(msg).toContain('8326');
  });

  test('기존 매핑(DLL_RET -14/-2·한도초과) 문구 불변', () => {
    const resp14 = normalize(safeParse('{"ERRCODE":"9999","DLL_RET":"-14"}'));
    expect(responseMessageForUser('FAIL', resp14)).toContain('IC(칩) 카드');
    const resp2 = normalize(safeParse('{"ERRCODE":"9999","MSG1":"[-2] POS Serial 포트 연결 실패"}'));
    expect(responseMessageForUser('FAIL', resp2)).toContain('케이블');
    const respLimit = normalize(safeParse('{"ERRCODE":"9999","MSG1":"거래한도초과"}'));
    expect(responseMessageForUser('FAIL', respLimit)).toContain('한도');
  });

  test('미매핑 FAIL 코드는 여전히 원문+코드 폴백(8324 추가가 폴백 경로 무접촉)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"0051","MSG1":"DO NOT HONOR"}'));
    expect(classify(resp)).toBe('FAIL');
    const msg = responseMessageForUser('FAIL', resp);
    expect(msg).toContain('DO NOT HONOR');
    expect(msg).toContain('0051');
  });
});
