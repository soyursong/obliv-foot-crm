import { test, expect } from '@playwright/test';
import {
  classify,
  normalize,
  safeParse,
  responseMessageForUser,
  errcodeMessage,
  keywordMessage,
  ERRCODE_MESSAGES,
  ATTENTION_CODES,
  UNCLEAR_TXN_CODES,
  RESPONSE_CODE_TXN_MISMATCH,
  RESPONSE_CODE_SUCCESS,
  PER_TXN_LIMIT_KRW,
} from '../../src/lib/cband/protocol';

/**
 * T-20260805-foot-PLANA-ERRCODE-HANGUL-8326-UNCLEAR — 오류문구 한글화 + ERRCODES 전체표 + ★8326 unclear
 * ────────────────────────────────────────────────────────────────────────────
 * 현상: 오류코드 매핑이 DLL_RET -14/-2 2개만 → 나머지는 단말 원문(영문/코드) 그대로 노출(실장 판독 불가).
 *
 * 스코프:
 *  ① ERRCODE 전체표 한글 매핑 + 미매핑 잔여는 '원문 + 코드번호' 병기.
 *  ② ★8326 unclear 편입(안전 최우선): 요청↔응답 전문 금액·거래고유번호 불일치 = 받은 응답이 다른 거래일 수
 *     있음 → 성공(0000)도 실패도 아닌 '확인 필요(ATTENTION)'. 자동 재시도 금지(이중결제·미확인 결제 방지).
 *  ③ ⑬ 한도초과: 거래한도 초과 거절 문구를 자명한 한글로(코드가 아닌 MSG1 텍스트로 오는 경로 keyword 정규화).
 *
 * ★classify 안전경로(GO_WARN) → 8326 이 성공/실패로 새지 않는지 케이스 테스트 필수.
 *   물리 CAT 단말 왕복 불가 → 순수 함수(classify/normalize/responseMessageForUser) 단위로 assert.
 */

// ── 시나리오 2: ★8326 unclear (안전 핵심) ────────────────────────────────────
test.describe('② 8326 = 확인필요(ATTENTION) — 성공/실패로 새면 안 됨', () => {
  test('상수·집합 정합: 8326 은 UNCLEAR_TXN_CODES 이며 ATTENTION/성공 집합과 분리', () => {
    expect(RESPONSE_CODE_TXN_MISMATCH).toBe('8326');
    expect(UNCLEAR_TXN_CODES.has('8326')).toBe(true);
    // 8326 은 성공코드(0000)도 아니고, 단말통신이상 집합(C011/8003/8555)과도 별개 축.
    expect(RESPONSE_CODE_TXN_MISMATCH).not.toBe(RESPONSE_CODE_SUCCESS);
    expect(ATTENTION_CODES.has('8326')).toBe(false);
  });

  test('classify(ERRCODE=8326) → ATTENTION (성공/실패 아님)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8326","TRANTYPE":"0210","AUTHNO":"12345678"}'));
    // ★AUTHNO 가 실려 있어도(원문이 다른 거래 것일 수 있음) 절대 APPROVED 로 판정하지 않는다.
    expect(classify(resp)).toBe('ATTENTION');
    expect(classify(resp)).not.toBe('APPROVED');
    expect(classify(resp)).not.toBe('FAIL');
  });

  test('classify(ERRCODE=8326, AUTHNO 없음) → ATTENTION (FAIL 로 새지 않음 = 자동재시도 차단)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8326"}'));
    expect(classify(resp)).toBe('ATTENTION');
  });

  test('8326 사용자 문구: 승인여부 불명 + 재결제 금지 + 승인내역조회 안내 + 코드 병기', () => {
    const resp = normalize(safeParse('{"ERRCODE":"8326","AUTHNO":"12345678"}'));
    const cls = classify(resp);
    const msg = responseMessageForUser(cls, resp);
    expect(cls).toBe('ATTENTION');
    expect(msg).toContain('불확실');
    expect(msg).toContain('다시 결제하지 마시고');
    expect(msg).toContain('승인내역조회');
    expect(msg).toContain('8326');   // 실장이 규격서 조회 가능하도록 코드 병기
    // 원문 코드('8326')만 덩그러니 뜨는 게 아니라 한글 사유가 포함되어야 함.
    expect(msg).not.toBe('8326');
  });
});

// ── 시나리오 1: 오류 한글화 + 미매핑 잔여 원문+코드 병기 ──────────────────────
test.describe('① ERRCODE 전체표 한글 매핑 + 폴백', () => {
  test('errcodeMessage: 표에 있는 확인필요 코드는 한글 문구 반환', () => {
    expect(errcodeMessage('8326')).toContain('일치하지 않');
    expect(errcodeMessage('C011')).toContain('통신');
    expect(errcodeMessage('8003')).toContain('응답');
    expect(errcodeMessage('8555')).toContain('응답');
    // ERRCODE_MESSAGES 는 실제로 확인필요 코드를 담고 있다.
    expect(Object.keys(ERRCODE_MESSAGES)).toContain('8326');
  });

  test('errcodeMessage: 미매핑 코드/공백은 null (원문+코드 폴백으로 넘김)', () => {
    expect(errcodeMessage('0051')).toBeNull();
    expect(errcodeMessage(null)).toBeNull();
    expect(errcodeMessage('')).toBeNull();
  });

  test('미매핑 FAIL 코드: 원문 + 코드번호 병기 (실장 규격서 조회)', () => {
    // 단말이 알 수 없는 코드 0051 + 영문 원문을 보냄 → 원문 유지 + 코드 병기.
    const resp = normalize(safeParse('{"ERRCODE":"0051","MSG1":"DO NOT HONOR"}'));
    expect(classify(resp)).toBe('FAIL');
    const msg = responseMessageForUser('FAIL', resp);
    expect(msg).toContain('DO NOT HONOR');   // 원문 병기
    expect(msg).toContain('0051');            // 코드번호 병기
  });

  test('코드만 있고 메시지 없음: 코드번호 안내로 폴백', () => {
    const resp = normalize(safeParse('{"ERRCODE":"0051"}'));
    const msg = responseMessageForUser('FAIL', resp);
    expect(msg).toContain('0051');
    expect(msg).toContain('다시 시도');
  });
});

// ── 시나리오 1 연장: ⑬ 한도초과 등 MSG1 텍스트 → 한글 정규화 ─────────────────
test.describe('③ 한도초과·거절사유 keyword 한글 정규화', () => {
  test('한도초과(한글 원문): 자명한 한글 문구 + 한도금액 안내', () => {
    expect(keywordMessage('거래한도초과')).toContain('한도');
    const resp = normalize(safeParse('{"ERRCODE":"9999","MSG1":"거래한도초과"}'));
    expect(classify(resp)).toBe('FAIL');
    const msg = responseMessageForUser('FAIL', resp);
    expect(msg).toContain('한도');
    // 한도금액(5,000,000)이 천단위 콤마로 안내됨.
    expect(msg).toContain(PER_TXN_LIMIT_KRW.toLocaleString('ko-KR'));
  });

  test('한도초과(영문 원문 OVER LIMIT): 한글로 치환', () => {
    const resp = normalize(safeParse('{"ERRCODE":"9999","MSG1":"OVER LIMIT"}'));
    const msg = responseMessageForUser('FAIL', resp);
    expect(msg).toContain('한도');
    expect(msg).not.toContain('OVER LIMIT');
  });

  test('잔액부족/유효기간/거절 등 대표 사유도 한글 정규화', () => {
    expect(keywordMessage('INSUFFICIENT FUNDS')).toContain('부족');
    expect(keywordMessage('카드 유효기간 만료')).toContain('유효기간');
    expect(keywordMessage('취급거절')).toContain('거절');
    expect(keywordMessage('정상적인 메시지')).toBeNull();  // 알 수 없는 텍스트는 null(원문 폴백)
  });
});

// ── 회귀: 기존 판정·문구 불변 ────────────────────────────────────────────────
test.describe('AC-회귀: 기존 classify/문구 불변', () => {
  test('정상 승인(0000+AUTHNO) → APPROVED (8326 추가로 회귀 없음)', () => {
    const resp = normalize(safeParse('{"ERRCODE":"0000","TRANTYPE":"0210","AUTHNO":"12345678"}'));
    expect(classify(resp)).toBe('APPROVED');
    expect(responseMessageForUser('APPROVED', resp)).toContain('승인');
  });

  test('기존 ATTENTION 코드(C011/8003/8555)·무응답 → ATTENTION 유지', () => {
    expect(classify(normalize(safeParse('{"ERRCODE":"C011"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"8003"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"8555"}')))).toBe('ATTENTION');
    expect(classify(null)).toBe('ATTENTION');   // 무응답
  });

  test('DLL_RET -14/-2 표시 매핑 회귀 유지', () => {
    const resp14 = normalize(safeParse('{"ERRCODE":"9999","DLL_RET":"-14"}'));
    expect(responseMessageForUser('FAIL', resp14)).toContain('IC(칩) 카드');
    const resp2 = normalize(safeParse('{"ERRCODE":"9999","MSG1":"[-2] POS Serial 포트 연결 실패"}'));
    expect(responseMessageForUser('FAIL', resp2)).toContain('케이블');
  });
});
