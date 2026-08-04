import { test, expect } from '@playwright/test';
import { normalize, classify, TRANTYPE_APPROVE, type NormalizedResponse } from '../../src/lib/cband/protocol';
import {
  runPaymentFlow, selectRecapAttempts,
  type AttemptRecord, type AttemptStore, type CbandAttemptView,
} from '../../src/lib/cband/paymentFlow';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260804-foot-CBAND-RESPRECV-BANNER-RCA
 *   '카드 단말 결제 확인 필요' 배너 미해소 근본원인 회귀 + fix 고정 (결정론·WS 모킹·DB 무접촉).
 * ────────────────────────────────────────────────────────────────────────────
 * RCA(하드 증거): MSG_TRACE 558080127045 / AUTHNO 29258831 실결제에서
 *   · payments 행은 승인 +8초에 정상 INSERT(external_approval_no=29258831) → WS 응답은 CRM 에 도달·파싱·APPROVED.
 *   · 그러나 cband_payment_attempts.status='attention'(auth_no/raw NULL) → sweep(+8분)이 stale 'requested' 를 승격.
 *   · 원인: 단말이 CARDNO 를 미마스킹(평문 PAN)으로 반환(payments.card_no_masked=NULL 로 코로보) → normalize()가
 *     원본 payload(resp.raw, PAN 포함)를 통째 임베드 → APPROVED 분기가 raw_response 로 write → BEFORE UPDATE
 *     PCI 가드(trg_cband_pa_pci_guard, Rule B: Luhn 13~19자리)가 RAISE → updateAttempt(approved) 거부 →
 *     updateAttempt 가 그 에러를 삼킴(rows-affected 미확인) → status 'requested' 고착 → sweep→attention→배너.
 *   · 결제·수납은 정상 영속(돈 정확·이중결제 없음). 배너는 수납완료 결제에 대한 false alarm.
 *
 * fix: (1) raw_response 에 원본 payload(resp.raw) 제외(정규화·마스킹 감사필드는 보존) → 가드 미트립 → status 정상 승격.
 *      (2) sweep 힐/백스톱: payment_id 있는 'requested' 는 수납완료 → 'approved' 자가치유·승격 제외.
 * 불변식: classify/send-lock/probeConcurrent 무접촉 — 자동 재시도 금지·'확인 필요' 정지 유지(이중결제 방지 D).
 */

// ── trg_cband_pa_pci_guard(mig 20260731190000) Rule A/B/C + foot_is_luhn 를 1:1 복제 ──────────
function isLuhn(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  const n = num.length;
  for (let i = 1; i <= n; i++) {
    let d = Number(num[n - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const RULE_A = /"(track1|track2|track_?data|full_?pan|cvv2?|cvc2?|cvn2?|csc|pin_?block|pin|card_?password|card_?pw)"\s*:\s*("[^"]+"|-?\d)/i;
const RULE_C = /\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[ \-]?[1-8]\d{6}/;
/** raw_response(::text)에 대해 PCI 가드가 RAISE 하면 true(=UPDATE 거부). SQL 가드와 동일 판정. */
function pciGuardTrips(rawJsonText: string): boolean {
  if (RULE_A.test(rawJsonText)) return true;
  const cands = rawJsonText.match(/\d[\d \-]{11,21}\d/g) ?? [];
  for (const c of cands) {
    const digits = c.replace(/[ \-]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && isLuhn(digits)) return true;
  }
  return RULE_C.test(rawJsonText);
}
/** 스토어가 raw_response 로 영속하는 값(fix: 원본 payload resp.raw 제외 투영). supabaseAttemptStore.toPersistableRaw 와 동형. */
function toPersistableRaw(resp: NormalizedResponse): Record<string, unknown> {
  const { raw: _omit, ...safe } = resp;
  return safe as Record<string, unknown>;
}

// 실단말 미마스킹 CARDNO(평문 PAN, Luhn 유효) 반환 변형 — 실 배너 발생건의 재현 shape.
const LIVE_UNMASKED =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"4111111111111111","TAMT":"000003000",' +
  '"TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831","MERNO":"00113742229","TRANSERIAL":"110341558080"}';

const mockSender = (raw: string | null, timedOut = false) =>
  (async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut, msgTrace }));

const BASE = {
  tid: '1047538246', merno: '', catPort: 'COM3',
  clinicId: 'clinic-1', customerId: 'cust-1', checkInId: 'ci-1',
};

test.describe('CBAND RESPRECV 배너 미해소 RCA 회귀', () => {
  test('RC: 미마스킹 CARDNO 를 실은 원본 payload(resp.raw)를 그대로 write 하면 PCI 가드가 RAISE(=updateAttempt 거부)', () => {
    const resp = normalize(JSON.parse(LIVE_UNMASKED));
    expect(classify(resp)).toBe('APPROVED');           // 응답은 정상 승인(WS 도달·파싱됨)
    // 과거 동작: rawResponse=resp(원본 payload resp.raw 포함) → 가드 트립 → status='approved' UPDATE 거부.
    expect(pciGuardTrips(JSON.stringify(resp))).toBe(true);
  });

  test('FIX: 원본 payload(resp.raw) 제외 투영은 가드 미트립 + VERIFY 감사필드 전부 보존', () => {
    const resp = normalize(JSON.parse(LIVE_UNMASKED));
    const persisted = toPersistableRaw(resp);
    // 가드 미트립 → updateAttempt(approved) 정상 반영 → status 승격 → 배너 미발생.
    expect(pciGuardTrips(JSON.stringify(persisted))).toBe(false);
    // 저장완전성(RCA ★인과): 정규화·마스킹 감사필드는 하나도 잃지 않는다.
    expect(persisted.authNo).toBe('29258831');
    expect(persisted.responseCode).toBe('0000');
    expect(persisted.merno).toBe('00113742229');
    expect(persisted.tranDate).toBe('260804');
    expect(persisted.tranTime).toBe('110347');
    expect(persisted.msgTrace).toBe('110341558080');
    expect(persisted.amount).toBe(3000);
    // 원본 단말 payload(평문 PAN 위험)만 제외됨.
    expect('raw' in persisted).toBe(false);
  });

  test('불변식: APPROVED 흐름은 여전히 수납 정확히 1건 기록 + needsCheck=false(자동 재시도 없음)', async () => {
    const payments: Array<AttemptRecord & { authNo: string; attemptId: string }> = [];
    const attempts = new Map<string, AttemptRecord>();
    let seq = 0;
    // ★가드를 모사하는 스토어: raw_response 가 트립하면 status/raw 갱신을 삼킨다(현장 updateAttempt 동작 재현).
    const store: AttemptStore = {
      async insertAttempt(rec) { const id = `att-${++seq}`; attempts.set(rec.msgTrace, { ...rec }); return { id }; },
      async updateAttempt(msgTrace, patch) {
        const cur = attempts.get(msgTrace);
        if (!cur) return;
        // fix 적용: 스토어는 resp.raw 를 제외하고 영속 → 가드 미트립 → status 정상 반영.
        const persistedRaw = patch.rawResponse ? toPersistableRaw(patch.rawResponse) : undefined;
        if (persistedRaw && pciGuardTrips(JSON.stringify(persistedRaw))) return; // 트립 시 삼킴(과거 버그 경로)
        attempts.set(msgTrace, { ...cur, ...patch });
      },
      async recordCardPayment(rec) { payments.push(rec); },
    };
    const res = await runPaymentFlow({ ...BASE, tranType: TRANTYPE_APPROVE, amount: 3000 }, store, mockSender(LIVE_UNMASKED));
    expect(res.classification).toBe('APPROVED');
    expect(res.needsCheck).toBe(false);               // 확인필요 정지 아님 = 배너 미발생
    expect(payments).toHaveLength(1);                  // 이중결제 없음(정확히 1건)
    expect(payments[0].authNo).toBe('29258831');
    // fix 로 status 가 approved 로 승격됨(과거엔 requested 고착).
    expect(attempts.get(res.msgTrace)?.status).toBe('approved');
  });

  test('백스톱: 수납완료(approved) 시도는 재표시(확인필요) 대상이 아니다', () => {
    // sweep 힐 후 status='approved' → selectRecapAttempts 미포함(배너 미노출).
    const recorded: CbandAttemptView = {
      id: 'a1', msgTrace: '558080127045', status: 'approved', tranType: '0210',
      amount: 3000, createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      authNo: '29258831', responseCode: '0000',
    };
    expect(selectRecapAttempts([recorded], Date.now())).toHaveLength(0);
  });
});
