/**
 * T-20260724-foot-CONSULTANT-TKTREV-SINGLEPAY-ATTR-FIX
 * foot_stats_consultant single_rev(단건결제) WHO 귀속 재설계 — 로직 불변식 가드.
 *
 * 변경: 단건 귀속 = check_in_id 직접조인 단일경로 → 결정적 링크(fact) ∪ 고객기반 폴백(pkg_attr byte-동형).
 *   DA-20260724-FOOTDOSU-STATS-REGCOUNSELOR-WHO-CANON (verdict=GO, Surface2, ADDITIVE·read-path).
 *
 * BINDING(가드 대상):
 *   1. WHO byte-동일: 폴백 = pkg 의 customer→nearest-consultation 귀속과 동일 규칙.
 *   2. 과귀속 금지: 결정적 링크 우선(fact) / 상담이력 無 단건은 미귀속(NULL) 유지.
 *   4. 회귀 0: check_in_id 로 ticketed 상담 정상결선 단건은 옛 귀속과 동일 결과(폴백 미침범).
 *
 * 본 spec = RPC(SQL)의 WHO 파이프라인을 참조구현으로 옮겨 시나리오 1·2 불변식을 고정한다
 *   (repo 관례: 순수 로직 불변식·auth/server 불요). 실 prod 값 회수(₩6.9M/162행) 대사는
 *   evidence.mjs + supervisor field-soak(김주연 총괄 confirm)로 별도 검증.
 */

import { test, expect } from '@playwright/test';

// ─── 참조 도메인 타입 (RPC 파이프라인 축약) ──────────────────────────────────────
type Ticketed = { checkInId: string; consultantId: string; customerId: string; checkedInAt: number };
type Payment  = { paymentId: string; checkInId: string | null; customerId: string | null; createdAt: number; net: number; type: 'payment' | 'refund' };

// RPC single_attr 파이프라인 참조구현 (SQL 과 동형):
//   (a) single_direct: check_in_id → ticketed 상담 consultant (결정적/fact).
//   (b) single_cust  : (a) 미매칭 단건만, 고객 최근접 상담 consultant (pkg_attr byte-동형).
//   미매칭(상담이력無/고객미상) → 귀속 없음(null).
function attributeSingle(payments: Payment[], ticketedAll: Ticketed[]): Map<string, string | null> {
  const byCheckIn = new Map(ticketedAll.map((t) => [t.checkInId, t]));
  const out = new Map<string, string | null>();
  for (const p of payments) {
    // (a) 결정적 링크
    if (p.checkInId && byCheckIn.has(p.checkInId)) {
      out.set(p.paymentId, byCheckIn.get(p.checkInId)!.consultantId);
      continue;
    }
    // (b) 고객기반 폴백 = pkg_attr 동형: 동일 고객 상담 中 createdAt 直前 최근접 1건
    const cands = ticketedAll.filter((t) => p.customerId != null && t.customerId === p.customerId);
    if (cands.length === 0) { out.set(p.paymentId, null); continue; } // 과귀속 금지: 상담이력無 → NULL
    const sorted = [...cands].sort((x, y) => {
      const xBefore = x.checkedInAt <= p.createdAt ? 0 : 1;
      const yBefore = y.checkedInAt <= p.createdAt ? 0 : 1;
      if (xBefore !== yBefore) return xBefore - yBefore;                  // 直前 우선
      const dx = Math.abs(p.createdAt - x.checkedInAt), dy = Math.abs(p.createdAt - y.checkedInAt);
      if (dx !== dy) return dx - dy;                                      // 근접 우선
      return x.checkInId < y.checkInId ? -1 : 1;                         // 결정적 tie-break
    });
    out.set(p.paymentId, sorted[0].consultantId);
  }
  return out;
}

function revByConsultant(payments: Payment[], attr: Map<string, string | null>): Map<string, number> {
  const rev = new Map<string, number>();
  for (const p of payments) {
    const c = attr.get(p.paymentId);
    if (c == null) continue;                       // 미귀속분은 실적에 합산 안 됨
    rev.set(c, (rev.get(c) ?? 0) + p.net);
  }
  return rev;
}

// 고정 픽스처: 고객X = 상담사S1(1월)·S2(3월) 상담이력 / 고객Y = 상담이력 無
const TICKETED: Ticketed[] = [
  { checkInId: 'ci_x_jan', consultantId: 'S1', customerId: 'X', checkedInAt: Date.parse('2026-01-10T00:00:00Z') },
  { checkInId: 'ci_x_mar', consultantId: 'S2', customerId: 'X', checkedInAt: Date.parse('2026-03-10T00:00:00Z') },
];

test.describe('single_rev WHO 귀속 재설계 (T-20260724-SINGLEPAY-ATTR-FIX)', () => {
  // ─ 시나리오 1: 정상 동선 — check_in_id 정상결선 단건 = 결정적 링크 귀속(회귀 0) ─
  test('시나리오1: check_in_id 로 ticketed 상담 정상결선 → 그 상담 consultant 귀속(옛 로직과 동일, 회귀 0)', () => {
    // 단건이 3월 상담 체크인(S2)에 결선. 폴백이 1월(S1)로 침범하면 안 됨.
    const pays: Payment[] = [
      { paymentId: 'pay1', checkInId: 'ci_x_mar', customerId: 'X', createdAt: Date.parse('2026-03-10T01:00:00Z'), net: 500_000, type: 'payment' },
    ];
    const attr = attributeSingle(pays, TICKETED);
    expect(attr.get('pay1')).toBe('S2');                         // 결정적 링크 = 결선된 체크인의 consultant
    const rev = revByConsultant(pays, attr);
    expect(rev.get('S2')).toBe(500_000);
    expect(rev.has('S1')).toBe(false);                           // 폴백 미침범(회귀 0)
  });

  // ─ 시나리오 2-1: 회수 — check_in_id 미결선 + 고객 상담이력 有 → 고객기반 폴백 귀속 ─
  test('시나리오2-1: check_in_id NULL + 고객 상담이력 有 → 고객기반 최근접 상담 consultant 로 회수', () => {
    // 2월 단건(직전 최근접 = 1월 S1). 6.9M 회수 경로의 단위 재현.
    const pays: Payment[] = [
      { paymentId: 'pay2', checkInId: null, customerId: 'X', createdAt: Date.parse('2026-02-15T00:00:00Z'), net: 300_000, type: 'payment' },
    ];
    const attr = attributeSingle(pays, TICKETED);
    expect(attr.get('pay2')).toBe('S1');                         // 2월 直前 최근접 = 1월 상담(S1)
    expect(revByConsultant(pays, attr).get('S1')).toBe(300_000); // 옛 로직이면 통째 누락 → 신 로직이 회수
  });

  // ─ 시나리오 2-1b: 비상담 체크인 결선(치료-only 등) + 고객 상담이력 有 → 폴백 회수 ─
  test('시나리오2-1b: check_in_id 가 ticketed 상담이 아님 + 고객 상담이력 有 → 폴백 회수', () => {
    const pays: Payment[] = [
      { paymentId: 'pay3', checkInId: 'ci_treat_only', customerId: 'X', createdAt: Date.parse('2026-03-20T00:00:00Z'), net: 400_000, type: 'payment' },
    ];
    const attr = attributeSingle(pays, TICKETED); // ci_treat_only ∉ ticketedAll → 결정적 미매칭 → 폴백
    expect(attr.get('pay3')).toBe('S2');                         // 3/20 直前 최근접 = 3/10 상담(S2)
  });

  // ─ 시나리오 2-2: 과귀속 금지 — 고객 상담이력 無 → 미귀속(NULL) 유지 ─
  test('시나리오2-2: check_in_id NULL + 고객 상담이력 無(Y) → 미귀속(NULL), 실적 합산 제외(과귀속 금지)', () => {
    const pays: Payment[] = [
      { paymentId: 'pay4', checkInId: null, customerId: 'Y', createdAt: Date.parse('2026-02-15T00:00:00Z'), net: 999_000, type: 'payment' },
      { paymentId: 'pay5', checkInId: null, customerId: null, createdAt: Date.parse('2026-02-15T00:00:00Z'), net: 111_000, type: 'payment' }, // 고객미상
    ];
    const attr = attributeSingle(pays, TICKETED);
    expect(attr.get('pay4')).toBeNull();                         // 상담이력 無 → 강제귀속 금지
    expect(attr.get('pay5')).toBeNull();                         // 고객미상 → 귀속 불가
    const rev = revByConsultant(pays, attr);
    expect(rev.size).toBe(0);                                    // 어느 실장에도 합산 안 됨
  });

  // ─ 불변식: 결정적 ∩ 폴백 = ∅ (단건당 최대 1회 귀속, 이중카운트 0) ─
  test('불변: 결정적 링크가 있으면 폴백은 그 단건을 재귀속하지 않음(이중카운트 0)', () => {
    const pays: Payment[] = [
      { paymentId: 'pd', checkInId: 'ci_x_jan', customerId: 'X', createdAt: Date.parse('2026-03-15T00:00:00Z'), net: 200_000, type: 'payment' },
    ];
    // 결정적 = 1월 S1. 폴백이라면 3/15 최근접 = 3/10 S2 였을 것 → 그러나 결정적 우선이므로 S1 확정.
    const attr = attributeSingle(pays, TICKETED);
    expect(attr.get('pd')).toBe('S1');                           // 결정적(fact) 우선 — 폴백(S2) 미발화
    const rev = revByConsultant(pays, attr);
    expect(rev.get('S1')).toBe(200_000);
    expect(rev.has('S2')).toBe(false);                           // 동일 단건 이중귀속 없음
  });

  // ─ 불변식: net(refund=음수) 대칭 — 회수된 refund 도 net 으로 실적 차감 ─
  test('불변: 회수된 refund 는 net 음수로 동일 consultant 실적 차감(대칭)', () => {
    const pays: Payment[] = [
      { paymentId: 'p_pay', checkInId: null, customerId: 'X', createdAt: Date.parse('2026-02-15T00:00:00Z'), net: 300_000, type: 'payment' },
      { paymentId: 'p_ref', checkInId: null, customerId: 'X', createdAt: Date.parse('2026-02-16T00:00:00Z'), net: -300_000, type: 'refund' },
    ];
    const attr = attributeSingle(pays, TICKETED);
    expect(attr.get('p_pay')).toBe('S1');
    expect(attr.get('p_ref')).toBe('S1');                        // 동일 고객·동일 최근접 → 대칭 귀속
    expect(revByConsultant(pays, attr).get('S1')).toBe(0);       // net 상쇄 = 0 (허위 매출/차감 없음)
  });
});
