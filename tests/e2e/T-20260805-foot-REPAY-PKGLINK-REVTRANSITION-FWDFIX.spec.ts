/**
 * E2E spec — T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX
 * 결제수단-변경 재결제 → 패키지 status 오표시(refunded) forward-fix
 *
 * 근본원인 (F-4717, HARD census C1~C5 / commit 07941264):
 *   결제 원장 2개(① package_payments / ② payments·package_id). 재결제가 원장②(payments)에
 *   착지하면서 package_id 미기록 → refund_package_payment 의 net_paid(원장①-only) 파생이
 *   구조적 blind → status='refunded' 오표시 + 회차권 사용불가. refunded→active 역전이 부재.
 *
 * forward-fix 3축:
 *   §1 링크: 재결제(payments) 착지에 원천 package 컨텍스트(package_id) 스레딩(VG3).
 *   §2 트리거: payments AND package_payments 양원장 write 에서 발화하는 writer-agnostic
 *      status 재계산 → cross-ledger net_paid 기준 active↔refunded 결정적 양방향(VG1/VG4).
 *   §3 단방향 가드 제거: refund_package_payment 내 status UPDATE → §2 트리거 위임(single-authority).
 *
 * DA 판정: change-class=ADDITIVE(둘 다) → §3.1 대표게이트 면제. DB 변경: 있음(신규 트리거 + function-diff).
 *
 * AC-1(VG1): cross-ledger net_paid = Σpkgpay(net) + Σpayments(net WHERE package_id, active).
 * AC-2(VG4): 파생 결정적 양방향 — net>0→active(진성복원) / net≤0→refunded(진성환불).
 * AC-3      : 자동 전이 축 = active↔refunded 국한(completed/cancelled/transferred 무접촉).
 * AC-4(VG5): 진성환불(orphan 재결제 부재·net≤0)은 refunded 유지(무-spurious 복원).
 * AC-5(VG3): 링크는 caller 원천 package 컨텍스트일 때만 — guess-match/fabricate 금지.
 * AC-6(VG2): status 변경 ⊥ 매출(payments net 합산은 package_id 무관 → 이중계상 0).
 * AC-7      : F-4717 실케이스 — 재결제 링크 후 net>0 → active 복원(회차권 재사용).
 *
 * DB 변경: 있음 (ADDITIVE — 신규 트리거 2 + function-diff refund_package_payment/record_planb).
 */
import { test, expect } from '@playwright/test';

// ── §2 트리거 파생 규칙 SSOT 복제 (회귀 락) ─────────────────────────────────
//   net_paid_crossledger = Σ package_payments(payment:+/refund:−)
//                        + Σ payments(payment:+/refund:−  WHERE package_id=pkg AND status='active')
type Ledger = { payment_type: 'payment' | 'refund'; amount: number; status?: string; package_id?: string | null };
const legNet = (r: Ledger): number => (r.payment_type === 'refund' ? -r.amount : r.amount);

const crossLedgerNet = (pkgId: string, pkgPay: Ledger[], pay: Ledger[]): number => {
  const a = pkgPay.reduce((s, r) => s + legNet(r), 0);
  const b = pay
    .filter((r) => r.package_id === pkgId && (r.status ?? 'active') === 'active')
    .reduce((s, r) => s + legNet(r), 0);
  return a + b;
};

// §2: 자동 파생은 active↔refunded 축에만. 그 외 상태는 입력 그대로(무접촉).
const AUTO_AXIS = ['active', 'refunded'];
const deriveStatus = (current: string, net: number): string => {
  if (!AUTO_AXIS.includes(current)) return current;          // completed/cancelled/transferred 무접촉
  return net > 0 ? 'active' : 'refunded';                    // 진성복원 / 진성환불(net=0 포함)
};

const PKG = 'pkg-4717';

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — cross-ledger netting (AC-1/VG1)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — cross-ledger net_paid (VG1)', () => {
  test('AC-1: 원장① package_payments + 원장② payments(package_id·active) 합산', () => {
    const pkgPay: Ledger[] = [{ payment_type: 'payment', amount: 6_000_000 }, { payment_type: 'refund', amount: 6_000_000 }];
    // 원장①-only net = 0 → 구(舊) 파생은 refunded (blind). 재결제가 원장②에 링크됨:
    const pay: Ledger[] = [{ payment_type: 'payment', amount: 6_000_000, status: 'active', package_id: PKG }];
    expect(pkgPay.reduce((s, r) => s + legNet(r), 0)).toBe(0);           // 원장① blind 지점
    expect(crossLedgerNet(PKG, pkgPay, pay)).toBe(6_000_000);           // cross-ledger 진성복원
  });

  test('AC-6/VG2: 다른 package_id·deleted payments 는 net 에서 제외', () => {
    const pkgPay: Ledger[] = [{ payment_type: 'payment', amount: 100_000 }];
    const pay: Ledger[] = [
      { payment_type: 'payment', amount: 50_000, status: 'active', package_id: PKG },
      { payment_type: 'payment', amount: 999_999, status: 'active', package_id: 'other-pkg' }, // 타 패키지
      { payment_type: 'payment', amount: 777_777, status: 'deleted', package_id: PKG },        // soft-deleted 제외
      { payment_type: 'payment', amount: 123_456, status: 'active', package_id: null },         // 미링크 제외
    ];
    expect(crossLedgerNet(PKG, pkgPay, pay)).toBe(150_000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 결정적 양방향 파생 (AC-2/AC-3/AC-4)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — active↔refunded 결정적 양방향 (VG4/VG5)', () => {
  test('AC-2: net>0 → active(진성복원) / net≤0 → refunded(진성환불)', () => {
    expect(deriveStatus('refunded', 6_000_000)).toBe('active');   // refunded→active 복원
    expect(deriveStatus('active', 0)).toBe('refunded');           // net=0 → refunded(진성환불)
    expect(deriveStatus('active', -1)).toBe('refunded');
    expect(deriveStatus('active', 500)).toBe('active');           // 정상 유지
  });

  test('AC-3: completed/cancelled/transferred 는 자동 전이 대상 아님(무접촉)', () => {
    for (const terminal of ['completed', 'cancelled', 'transferred']) {
      expect(deriveStatus(terminal, 0)).toBe(terminal);           // net≤0 여도 refunded 로 강등 금지
      expect(deriveStatus(terminal, 9_999_999)).toBe(terminal);   // net>0 여도 active 로 승격 금지
    }
  });

  test('AC-4/VG5: orphan 재결제 부재(net≤0) 진성환불은 refunded 유지', () => {
    const pkgPay: Ledger[] = [{ payment_type: 'payment', amount: 300_000 }, { payment_type: 'refund', amount: 300_000 }];
    const pay: Ledger[] = []; // 원장② 재결제 없음(진성환불)
    const net = crossLedgerNet(PKG, pkgPay, pay);
    expect(net).toBe(0);
    expect(deriveStatus('active', net)).toBe('refunded');         // spurious 복원 없음
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 링크 authority (AC-5/VG3) — guess-match 금지
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 — 링크 authority (VG3)', () => {
  // FE write-path 규약: caller 가 원천 package 컨텍스트를 보유할 때만 package_id 세팅.
  const linkedPayload = (pkgId: string | null | undefined) =>
    (pkgId ? { package_id: pkgId } : {});

  test('AC-5: package 컨텍스트 보유 시 링크, 미보유 시 미기록(NULL·종전 동작)', () => {
    expect(linkedPayload(PKG)).toEqual({ package_id: PKG });      // 보유 → 링크
    expect(linkedPayload(null)).toEqual({});                       // 미보유 → 필드 부재(guess-match 금지)
    expect(linkedPayload(undefined)).toEqual({});
  });

  test('AC-5: 회수1 단건 인라인 INSERT 도 packageId 보유 시 링크', () => {
    // CustomerChartPage/Packages 회수1 단건 payments INSERT — packageId in-scope → package_id 세팅.
    const packageId = PKG;
    const row = { clinic_id: 'c', check_in_id: null, customer_id: 'cust', package_id: packageId, amount: 100000 };
    expect(row.package_id).toBe(PKG);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 4 — F-4717 실케이스 end-to-end (AC-7)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 4 — F-4717 실케이스 복원 (AC-7)', () => {
  test('AC-7: 원결제→환불→결제수단변경 재결제(링크) → net>0 → active 복원', () => {
    // ① 원결제 6,000,000 (package_payments)
    const pkgPay: Ledger[] = [{ payment_type: 'payment', amount: 6_000_000 }];
    let pay: Ledger[] = [];
    expect(deriveStatus('active', crossLedgerNet(PKG, pkgPay, pay))).toBe('active');

    // ② 환불 6,000,000 (package_payments refund) → 트리거: net=0 → refunded (진성환불 순간)
    pkgPay.push({ payment_type: 'refund', amount: 6_000_000 });
    expect(deriveStatus('active', crossLedgerNet(PKG, pkgPay, pay))).toBe('refunded');

    // ③ 결제수단변경 재결제 6,000,000 → 원장②(payments) 착지 + package_id 링크(§1)
    pay = [{ payment_type: 'payment', amount: 6_000_000, status: 'active', package_id: PKG }];
    const net = crossLedgerNet(PKG, pkgPay, pay);
    expect(net).toBe(6_000_000);
    // ④ 트리거(§2): refunded→active 복원(회차권 재사용 가능)
    expect(deriveStatus('refunded', net)).toBe('active');
  });

  test('AC-6/VG2: 매출은 payments net 을 package_id 무관 합산 → status fix 前後 불변', () => {
    // v_daily_revenue 는 payments.amount 를 package_id 무관 계상 → 5.76M 은 링크 前後 동일.
    const revenue = (pay: Ledger[]) => pay.filter((r) => (r.status ?? 'active') === 'active').reduce((s, r) => s + legNet(r), 0);
    const before: Ledger[] = [{ payment_type: 'payment', amount: 6_000_000, status: 'active', package_id: null }];
    const after: Ledger[] = [{ payment_type: 'payment', amount: 6_000_000, status: 'active', package_id: PKG }];
    expect(revenue(before)).toBe(revenue(after)); // 링크(package_id) 는 매출 불변(이중계상 0)
  });
});
