import { test, expect } from '@playwright/test';
import {
  normalize,
  classify,
  safeParse,
  responseMessageForUser,
  dllRetMessage,
  bracketRetCode,
  DLL_RET_MESSAGES,
} from '../../src/lib/cband/protocol';

/**
 * T-20260804-foot-CBAND-PAY-CABLE-DISCONNECT-ERRMSG — 케이블 미연결([-2]) 결제 최종 안내 문구
 * ────────────────────────────────────────────────────────────────────────────
 * 형제 PAYBTN-DISABLED-TOOLTIP[deployed] 가 사전 버튼 비활성으로 걸러주나, 그 판정 우회로 실제 결제까지
 * 도달해 데몬이 [-2](POS Serial 포트 연결 실패)를 뱉는 경우의 최종 화면 문구를 사람이 읽을 케이블 확인
 * 안내로 치환한다. 순수 FE 오류문구 매핑(DB/비즈로직 무접촉) — 수신·분류(classify) 로직 불변.
 *
 * AC:
 *   1. 데몬 [-2] 감지 → 화면 문구 = "단말기와 통신할 수 없습니다. … (단말기 후면 POS 단자)"
 *   2. raw '[-2]' / 'POS Serial 포트 연결 실패' 원문 미노출.
 *   3. [-2] 가 dllRet / responseCode / ResultMessage 의 '[-N]' 토큰 어느 경로로 와도 매핑(데몬 실측 방어).
 *   4. [-2] 외 코드·정상흐름 회귀 없음(APPROVED/ATTENTION 불변, 미등록 코드 폴백 유지).
 *
 * unit 전용(page/auth/server 불요) — 순수 함수 단언(데몬 [-2] 모킹). 실환경=field-soak(최필경 대리점).
 */

const CABLE_MSG = '단말기와 통신할 수 없습니다. 단말기와 PC를 연결한 케이블을 확인해 주세요. (단말기 후면 POS 단자)';
const RAW_TEXT = 'POS Serial 포트 연결 실패';

test.describe('AC1/AC2 · [-2] → 케이블 확인 안내 치환(raw 원문 미노출)', () => {
  test('DLL_RET_MESSAGES 에 -2 등록 + 티켓 확정 문구', () => {
    expect(DLL_RET_MESSAGES['-2']).toBe(CABLE_MSG);
    expect(DLL_RET_MESSAGES['-2']).toContain('케이블');
    expect(DLL_RET_MESSAGES['-2']).toContain('POS 단자');
    // raw 데몬 원문 텍스트를 안내 문구에 담지 않음
    expect(DLL_RET_MESSAGES['-2']).not.toContain(RAW_TEXT);
  });

  test('dllRetMessage: -2 조회 + trim 정규화', () => {
    expect(dllRetMessage('-2')).toBe(CABLE_MSG);
    expect(dllRetMessage(' -2 ')).toBe(CABLE_MSG); // trim
  });
});

test.describe('AC3 · [-2] 도달 경로 3종 모두 매핑', () => {
  test('경로A · DLL_RET 필드로 [-2]', () => {
    const n = normalize(safeParse('{"DLL_RET":"-2","ERRCODE":"9999"}'));
    const cls = classify(n);
    // 수신·분류 불변: 0000 아님·ATTENTION 집합 아님 → FAIL(과금 미발생·재시도 안전)
    expect(cls).toBe('FAIL');
    const msg = responseMessageForUser(cls, n);
    expect(msg).toBe(CABLE_MSG);
    expect(msg).not.toContain('[-2]');
    expect(msg).not.toContain(RAW_TEXT);
  });

  test('경로B · ERRCODE(responseCode)=-2 방어', () => {
    const n = normalize(safeParse('{"ERRCODE":"-2"}'));
    const cls = classify(n);
    expect(cls).toBe('FAIL');
    expect(responseMessageForUser(cls, n)).toBe(CABLE_MSG);
  });

  test('경로C · ResultMessage 의 "[-2]" 토큰(ERRCODE=9999 동반) — raw 원문 미노출', () => {
    // 데몬 실측: ERRCODE=9999 실패 시 ResultMessage = "[-2] POS Serial 포트 연결 실패"
    const n = normalize(safeParse(JSON.stringify({ ERRCODE: '9999', MSG1: `[-2] ${RAW_TEXT}` })));
    const cls = classify(n);
    expect(cls).toBe('FAIL');
    const msg = responseMessageForUser(cls, n);
    expect(msg).toBe(CABLE_MSG);
    // ★핵심: raw '[-2]' / 'POS Serial 포트 연결 실패' 노출 금지
    expect(msg).not.toContain('[-2]');
    expect(msg).not.toContain(RAW_TEXT);
  });

  test('bracketRetCode: "[-N]" 토큰 추출 / 대괄호 없으면 null', () => {
    expect(bracketRetCode('[-2] POS Serial 포트 연결 실패')).toBe('-2');
    expect(bracketRetCode('[ -2 ]')).toBe('-2'); // 공백 관대
    expect(bracketRetCode('[-14] 카드 이미 꽂힘')).toBe('-14');
    expect(bracketRetCode('승인되었습니다')).toBeNull();
    expect(bracketRetCode(null)).toBeNull();
  });
});

test.describe('AC4 · 회귀 없음([-2] 외 코드·정상흐름 불변)', () => {
  test('미등록 코드는 폴백 유지(케이블 안내로 오치환 안 함)', () => {
    // 표에 없는 [-N] 은 dllRetMessage null → 기존 폴백(메시지 표시) 유지
    const n = normalize(safeParse(JSON.stringify({ ERRCODE: '9999', MSG1: '[-7] 알 수 없는 거절' })));
    const msg = responseMessageForUser(classify(n), n);
    expect(msg).not.toBe(CABLE_MSG);
    expect(msg).toContain('[-7] 알 수 없는 거절'); // 폴백: 원문 메시지 표시
    expect(dllRetMessage('-7')).toBeNull();
    expect(dllRetMessage(null)).toBeNull();
  });

  test('APPROVED / ATTENTION 정상흐름 불변', () => {
    // 승인
    const ok = normalize(safeParse('{"ERRCODE":"0000","AUTHNO":"12345678","TRANTYPE":"0210"}'));
    expect(classify(ok)).toBe('APPROVED');
    expect(responseMessageForUser('APPROVED', ok)).toContain('승인');
    // 무응답 → ATTENTION(이중결제 방지 정지)
    expect(classify(null)).toBe('ATTENTION');
    expect(responseMessageForUser('ATTENTION', null)).toContain('확인');
  });

  test('기존 -14(IC 카드) 매핑 회귀 없음', () => {
    expect(DLL_RET_MESSAGES['-14']).toBeTruthy();
    const n = normalize(safeParse('{"DLL_RET":"-14"}'));
    expect(responseMessageForUser(classify(n), n)).toBe(DLL_RET_MESSAGES['-14']);
  });
});
