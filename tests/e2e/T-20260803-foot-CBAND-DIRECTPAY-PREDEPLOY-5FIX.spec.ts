import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  normalize,
  classify,
  safeParse,
  responseMessageForUser,
  dllRetMessage,
  DLL_RET_MESSAGES,
  RESPONSE_CODE_SUCCESS,
  TRANTYPE_APPROVE,
} from '../../src/lib/cband/protocol';
import { CBAND_SEND_TIMEOUT_MS } from '../../src/lib/cband/catClient';

/**
 * T-20260803-foot-CBAND-DIRECTPAY-PREDEPLOY-5FIX — 코밴 CAT 직결결제(플랜A) flag-ON 전 확정 수정 5건
 * ────────────────────────────────────────────────────────────────────────────
 * 현장(최필경 총괄) 오늘 오후 배포 목표. flag-ON(VITE_CBAND_PAY) 은 별도 게이트 — 본 티켓은 flag-ON 전 코드수정.
 *
 * 본 spec 의 시나리오 1~3 (E2E 변환):
 *   · 시나리오 1 — ④ 응답 대기 타임아웃 45초(CRM 상수) + 무응답 3분기(ATTENTION) 회귀 없음.
 *   · 시나리오 2 — ⑤ 응답코드 -14('단말기에 IC 카드 이미 꽂힘') 표시 매핑(additive) + classify 불변.
 *   · 시나리오 3 — ①③ 랜드마크/SSOT 소스 가드(버튼 이관·안내문구 플랜A) + classify 3분기 회귀.
 *
 * ★GO_WARN(결제 경로): ①버튼 게이팅·④타임아웃 변경이 성공/실패 판정·이중결제방지·전문 파싱을 훼손하지
 *   않음을 회귀로 고정한다. (①③ 실 렌더/활성 카드결제는 물리 단말·flag-ON 의존 → supervisor QA·field-soak.)
 *
 * unit 전용(page/auth/server 불요) — 순수 함수 단언 + 정적 소스 가드.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

// ── 시나리오 1 — ④ 응답 대기 타임아웃 45초 ────────────────────────────────────
test.describe('시나리오1 · ④ 응답 대기 타임아웃 35→45초(CRM 상수)', () => {
  test('CBAND_SEND_TIMEOUT_MS = 45,000ms (send() 응답 대기의 유일 CRM 출처)', () => {
    // ★출처 확정: send()가 opts.timeoutMs 미지정 시 사용하는 기본 상수 = 이 값. 데몬/외부 고정값 아님.
    expect(CBAND_SEND_TIMEOUT_MS).toBe(45_000);
  });

  test('소스: catClient 타임아웃 상수 45_000 (구 25_000 잔존 없음)', () => {
    const s = read('lib/cband/catClient.ts');
    expect(s).toContain('CBAND_SEND_TIMEOUT_MS = 45_000');
    expect(s).not.toContain('CBAND_SEND_TIMEOUT_MS = 25_000');
  });

  test('무응답(타임아웃) 3분기 회귀 없음 — raw===null → ATTENTION(자동 재시도 금지)', () => {
    // 타임아웃은 sr.timedOut=true → resp=null → classify(null)=ATTENTION. 타임아웃 값 변경과 무관하게 불변.
    expect(classify(null)).toBe('ATTENTION');
  });
});

// ── 시나리오 2 — ⑤ 응답코드 -14 표시 매핑(additive) ────────────────────────────
test.describe('시나리오2 · ⑤ 응답코드 -14(단말기 IC 카드 이미 꽂힘) 표시 매핑', () => {
  test('DLL_RET_MESSAGES 에 -14 등록 + 사람이 읽을 문구', () => {
    expect(DLL_RET_MESSAGES['-14']).toBeTruthy();
    expect(DLL_RET_MESSAGES['-14']).toContain('이미 꽂혀');
    // 개발용어 배제(현장 실장 가독) — 코드 숫자 노출 없이 조치 안내.
    expect(DLL_RET_MESSAGES['-14']).toContain('카드를 뺀 뒤');
  });

  test('dllRetMessage: -14 매핑 조회 / 미등록 코드는 null(폴백 유지)', () => {
    expect(dllRetMessage('-14')).toBe(DLL_RET_MESSAGES['-14']);
    expect(dllRetMessage(' -14 ')).toBe(DLL_RET_MESSAGES['-14']); // trim 정규화
    expect(dllRetMessage('-99')).toBeNull();
    expect(dllRetMessage(null)).toBeNull();
  });

  test('normalize: DLL_RET 필드 추출(ERRCODE 축과 별개)', () => {
    const parsed = safeParse('{"DLL_RET":"-14","TRANTYPE":"0210"}');
    const n = normalize(parsed);
    expect(n.dllRet).toBe('-14');
    // ERRCODE 미수신 → responseCode(밴 응답코드) 는 별개 축으로 null.
    expect(n.responseCode).toBeNull();
  });

  test('responseMessageForUser(FAIL): -14 → 읽을 수 있는 안내로 치환(코드 -14 노출 아님)', () => {
    const n = normalize(safeParse('{"DLL_RET":"-14"}'));
    const cls = classify(n);
    // ★수신·분류 불변: -14 는 과금 미발생(재시도 안전) = FAIL (ATTENTION 오분류 아님).
    expect(cls).toBe('FAIL');
    const msg = responseMessageForUser(cls, n);
    expect(msg).toBe(DLL_RET_MESSAGES['-14']);
    expect(msg).not.toContain('코드 -14');
  });

  test('responseMessageForUser: -14 가 ERRCODE(responseCode) 로 와도 매핑(방어)', () => {
    const n = normalize(safeParse('{"ERRCODE":"-14"}'));
    const cls = classify(n); // 0000 아님·ATTENTION 아님 → FAIL
    expect(cls).toBe('FAIL');
    expect(responseMessageForUser(cls, n)).toBe(DLL_RET_MESSAGES['-14']);
  });

  test('소스: 수신 로직 불변 — 표시 매핑만 additive(classify 미참여)', () => {
    const s = read('lib/cband/protocol.ts');
    expect(s).toContain('DLL_RET_MESSAGES');
    expect(s).toContain('dllRet');
    // classify 는 DLL_RET 를 참조하지 않는다(표시 전용). classify 함수 본문에 dllRet 미등장.
    const classifyBody = s.slice(s.indexOf('export function classify'), s.indexOf('export function responseMessageForUser'));
    expect(classifyBody).not.toContain('dllRet');
  });
});

// ── 시나리오 3 — ①③ 랜드마크/SSOT 소스 가드 + classify 3분기 회귀 ──────────────
test.describe('시나리오3 · ①버튼 이관 · ③안내문구 플랜A · classify 3분기 회귀', () => {
  test('③ 안내문구: 플랜B 자동매칭 문구 제거 + 플랜A 직접수신 문구/testid 반영', () => {
    const s = read('components/PaymentMiniWindow.tsx');
    expect(s).not.toContain('시간·금액 기반으로 자동 매칭');
    expect(s).not.toContain('card-auto-match-info');
    expect(s).toContain('카드 결제 승인 정보는 단말기에서 직접 받아 기록됩니다.');
    expect(s).toContain('card-payment-info');
  });

  test('① 버튼 이관: CheckInDetailSheet 에서 코밴 버튼 제거', () => {
    const s = read('components/CheckInDetailSheet.tsx');
    expect(s).not.toContain('<CbandPayEntryButton');
    expect(s).not.toContain("import CbandPayEntryButton");
  });

  test('① 버튼 이관: PaymentMiniWindow 수납 옆에 렌더 + 분할 시 disabled 게이팅', () => {
    const s = read('components/PaymentMiniWindow.tsx');
    expect(s).toContain("import CbandPayEntryButton from '@/components/CbandPayEntryButton'");
    expect(s).toContain('<CbandPayEntryButton');
    expect(s).toContain('disabled={splitMode}');
    // 카드 단일결제 또는 분할일 때만 노출(비카드 단일=무노출), 렌더 조건 게이트 존재.
    expect(s).toContain("payMethod === 'card' || splitMode");
  });

  test('① disabled prop: 코밴 컴포넌트가 외부 게이팅 수용(결제 로직 무접촉)', () => {
    const s = read('components/CbandPayEntryButton.tsx');
    expect(s).toContain('disabled = false');
    expect(s).toContain('disabledReason');
    // 플래그 OFF 는 여전히 최우선 null(무노출) — flag-ON 전 회귀0.
    expect(s).toContain('if (!enabled) return null;');
  });

  test('회귀: classify 3분기(APPROVED/FAIL/ATTENTION) 불변', () => {
    // APPROVED — 0000 + AUTHNO
    const approved = normalize(safeParse(`{"ERRCODE":"${RESPONSE_CODE_SUCCESS}","AUTHNO":"28102510","TRANTYPE":"${TRANTYPE_APPROVE}"}`));
    expect(classify(approved)).toBe('APPROVED');
    // ATTENTION — 통신 이상 코드
    expect(classify(normalize(safeParse('{"ERRCODE":"C011"}')))).toBe('ATTENTION');
    expect(classify(normalize(safeParse('{"ERRCODE":"8003"}')))).toBe('ATTENTION');
    // FAIL — 명확한 실패코드(0000 아님·ATTENTION 아님)
    expect(classify(normalize(safeParse('{"ERRCODE":"0051","MSG1":"한도초과"}')))).toBe('FAIL');
    // 무응답 → ATTENTION
    expect(classify(null)).toBe('ATTENTION');
  });
});
