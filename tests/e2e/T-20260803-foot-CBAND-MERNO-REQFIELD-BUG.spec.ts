import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildMsg,
  makeTrace,
  normalize,
  safeParse,
  TRANTYPE_APPROVE,
} from '../../src/lib/cband/protocol';
import {
  approve,
  type AttemptRecord,
  type AttemptStore,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260803-foot-CBAND-MERNO-REQFIELD-BUG — 코밴 직결결제 MERNO 순환참조 버그 픽스
 * ════════════════════════════════════════════════════════════════════════════
 * 버그: MERNO(가맹점번호)를 결제 '요청 전 필수 입력'으로 잘못 구현 →
 *   "결제해야 MERNO 알고, MERNO 있어야 결제" 순환참조 → 첫 결제 영원히 불가(P0).
 *   현장 evidence: 7/31 실승인 20필드 body에 MERNO 부재·단말기 화면 미표시·승인 응답에서만 도착.
 *   ★DA canonical(3way-canon: '선택 payments.merchant_no', 응답 파생)과 정합 복원.
 *
 * FIX:
 *   FIX-1 결제 개시(config.getTerminalConfig / protocol.buildMsg) MERNO 유무검사 제거.
 *         결제조건 = TID(non-empty) + CAT_PORT(non-empty) 2개뿐. 빈 MERNO 는 요청 전문서 제외.
 *   FIX-2 승인 응답 전문에서 MERNO 파싱 → payments.merchant_no(응답 파생값) 저장. 부재 시 null·성공 처리.
 *   FIX-3 /admin/settings(⑧ 카드 단말기 설정) MERNO 필수 칸 제거(옵션 A).
 *
 * 현장 클릭 시나리오(§현장) 결정론 매핑:
 *   시나리오1 = MERNO 미입력(TID+COM만)으로 결제 개시 성공.
 *   시나리오2 = 승인 응답 MERNO 파싱·저장.
 *   시나리오3 = MERNO 부재 응답도 성공(저장 skip=null).
 */

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ── 실측 정본 응답: MERNO 포함(승인) / MERNO 부재(엣지) ─────────────────────────
const RESP_WITH_MERNO =
  '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104426",' +
  '"AUTHNO":"28102510    ","MERNO":"00918554560    ","TRANSERIAL":"104421000759","MSG1":"거래 승인28102510"}';
// ★AC-3 엣지: 승인 응답에 MERNO 필드 자체가 없음(부재).
const RESP_NO_MERNO =
  '{"ERRCODE":"0000","TRANTYPE":"0210","TAMT":"000001002","TRANDATE":"260731","TRANTIME":"104426",' +
  '"AUTHNO":"28102510    ","TRANSERIAL":"104421000760","MSG1":"거래 승인28102510"}';

const mockSender = (raw: string | null, timedOut = false) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut, msgTrace }));

// ── in-memory store — ★실 supabaseAttemptStore 의 merchant_no write 규칙(rec.rawResponse?.merno ?? null) 모사 ──
function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<{ merchantNo: string | null; authNo: string; amount: number }> = [];
  const updates: Array<Partial<AttemptRecord>> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) {
      const id = `attempt-${++seq}`;
      attempts.set(rec.msgTrace, { ...rec });
      return { id };
    },
    async updateAttempt(msgTrace, patch) {
      const cur = attempts.get(msgTrace);
      if (cur) attempts.set(msgTrace, { ...cur, ...patch });
      updates.push(patch);
    },
    async recordCardPayment(rec) {
      // ★FIX-2: 실 store 와 동일한 규칙 — payments.merchant_no 는 응답 파생값(rawResponse.merno), 부재 시 null.
      payments.push({
        merchantNo: rec.rawResponse?.merno ?? null,
        authNo: rec.authNo,
        amount: rec.amount,
      });
    },
  };
  return { store, attempts, payments, updates };
}

const BASE = { tid: 'TID12345678', catPort: 'COM3', clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1' };

// ══════════════════════════════════════════════════════════════════════════
// A) FIX-1 — 결제 개시 MERNO 유무검사 제거 (순환참조 해소)
// ══════════════════════════════════════════════════════════════════════════
test.describe('FIX-1 결제 개시 조건 = TID + CAT_PORT (MERNO 불참)', () => {
  test('buildMsg: 빈 MERNO 로도 조립 성립 + 요청 전문서 MERNO 제외(throw 아님)', () => {
    const { fields, message } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '',
      amount: 1002, catPort: 'COM3', msgTrace: makeTrace(),
    });
    expect(fields.MERNO).toBeUndefined();        // ★빈 MERNO → 미주입(7/31 실승인 20필드 부재 정합)
    expect(fields.TID).toBe(BASE.tid);
    expect(fields.CAT_PORT).toBe('03');
    expect(fields.TAMT).toBe('000001002');
    expect(message).not.toMatch(/MERNO/);        // 전문 문자열에 MERNO 키 없음
  });

  test('buildMsg: MERNO 파라미터 생략해도 성립', () => {
    const { fields } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid,
      amount: 1002, catPort: 3, msgTrace: makeTrace(),
    });
    expect(fields.MERNO).toBeUndefined();
    expect(fields.TID).toBe(BASE.tid);
  });

  test('buildMsg: MERNO 값이 있으면 계승 주입(하위호환)', () => {
    const { fields } = buildMsg({
      tranType: TRANTYPE_APPROVE, tid: BASE.tid, merno: '00918554560',
      amount: 1002, catPort: 3, msgTrace: makeTrace(),
    });
    expect(fields.MERNO).toBe('00918554560');
  });

  test('시나리오1: MERNO 미입력(빈값)으로 결제 개시 → APPROVED·수납 성공', async () => {
    const { store, payments, attempts } = makeMemStore();
    const r = await approve(
      { ...BASE, merno: '', amount: 1002 }, store, mockSender(RESP_WITH_MERNO),
    );
    expect(r.classification).toBe('APPROVED');   // ★MERNO 없다는 이유로 차단/에러 없음
    expect(r.needsCheck).toBe(false);
    expect(r.authNo).toBe('28102510');
    expect(payments).toHaveLength(1);
    expect(attempts.get(r.msgTrace)?.status).toBe('approved');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B) FIX-2 — 승인 응답에서 MERNO 파싱 → merchant_no 저장 (응답 파생)
// ══════════════════════════════════════════════════════════════════════════
test.describe('FIX-2 승인 응답 MERNO 파싱·저장 (payments.merchant_no)', () => {
  test('normalize: 응답 전문에서 MERNO 추출(trailing space trim)', () => {
    expect(normalize(safeParse(RESP_WITH_MERNO)).merno).toBe('00918554560');
    expect(normalize(safeParse(RESP_NO_MERNO)).merno).toBeNull();  // 부재 시 null
  });

  test('시나리오2: 요청 merno 빈값이어도 merchant_no 는 응답 파싱값으로 저장', async () => {
    const { store, payments, updates } = makeMemStore();
    const r = await approve(
      { ...BASE, merno: '', amount: 1002 }, store, mockSender(RESP_WITH_MERNO),
    );
    expect(r.classification).toBe('APPROVED');
    // ★payments.merchant_no = 응답 파생값(요청 빈값 아님)
    expect(payments[0].merchantNo).toBe('00918554560');
    // ★cband_payment_attempts.merno 도 응답값으로 각인(감사 정합)
    const approvedPatch = updates.find((u) => u.status === 'approved');
    expect(approvedPatch?.merno).toBe('00918554560');
  });

  test('시나리오3: 응답에 MERNO 부재 → 결제 성공·merchant_no=null(저장 skip)', async () => {
    const { store, payments, updates } = makeMemStore();
    const r = await approve(
      { ...BASE, merno: '', amount: 1002 }, store, mockSender(RESP_NO_MERNO),
    );
    expect(r.classification).toBe('APPROVED');   // ★MERNO 부재해도 실패 처리 금지
    expect(r.needsCheck).toBe(false);
    expect(payments).toHaveLength(1);
    expect(payments[0].merchantNo).toBeNull();   // 저장 skip(null)
    const approvedPatch = updates.find((u) => u.status === 'approved');
    expect(approvedPatch?.merno).toBeUndefined(); // 부재 → 시도레코드에도 미주입(skip)
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C) 소스 계약 회귀 — config / protocol / store / AdminSettings
// ══════════════════════════════════════════════════════════════════════════
test.describe('소스 계약 회귀(FIX-1/2/3)', () => {
  test('FIX-1 config.ts: getTerminalConfig 유효조건 = TID+PORT (MERNO 불참)', () => {
    const src = read('src/lib/cband/config.ts');
    expect(src).toMatch(/if \(!tid \|\| !portRaw\) return null;/);
    expect(src).not.toMatch(/if \(!tid \|\| !merno \|\| !portRaw\) return null;/);
  });

  test('FIX-1 protocol.ts: buildMsg 가 빈 MERNO throw 하지 않음 + 값 있을 때만 주입', () => {
    const src = read('src/lib/cband/protocol.ts');
    expect(src).not.toMatch(/MERNO\(가맹점번호\)가 비어 있습니다/);  // 필수 throw 제거
    expect(src).toMatch(/if \(merno && merno\.trim\(\)\) \{/);       // 값 있을 때만 주입
  });

  test('FIX-2 supabaseAttemptStore.ts: merchant_no = 응답 파생값(rawResponse.merno ?? null)', () => {
    const src = read('src/lib/cband/supabaseAttemptStore.ts');
    expect(src).toMatch(/merchant_no:\s*rec\.rawResponse\?\.merno\s*\?\?\s*null/);
    expect(src).not.toMatch(/merchant_no:\s*rec\.merno,/);  // 요청값 write 제거
  });

  test('FIX-3 AdminSettings.tsx: MERNO 입력칸 제거 + 필수 검사 제거 + 기존 merno 계승', () => {
    const src = read('src/pages/AdminSettings.tsx');
    expect(src).not.toMatch(/data-testid="terminal-merno-input"/);       // 칸 제거
    expect(src).not.toMatch(/가맹점 번호\(MERNO\)를 입력하세요/);          // 필수 toast 제거
    expect(src).toMatch(/saveTerminalConfig\(\{ tid: t, merno: existing\?\.merno \?\? '', catPort: p \}\)/); // 계승 저장
  });
});
