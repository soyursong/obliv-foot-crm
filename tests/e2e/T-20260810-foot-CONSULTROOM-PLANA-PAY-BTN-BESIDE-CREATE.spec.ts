import { test, expect } from '@playwright/test';
import { computeOutstandingPayTargets } from '../../src/lib/footBilling';
import {
  approve,
  type AttemptRecord,
  type AttemptStore,
  type PkgPayTarget,
} from '../../src/lib/cband/paymentFlow';
import { exceedsPerTxnLimit } from '../../src/lib/cband/protocol';
import type { SendResult } from '../../src/lib/cband/catClient';

/**
 * T-20260810-foot-CONSULTROOM-PLANA-PAY-BTN-BESIDE-CREATE — '구입 티켓 추가' 모달 [결제] BETA(환자 기존 미수 총액 일괄)
 * ────────────────────────────────────────────────────────────────────────────
 * 부모 정본(T-20260807, deployed)의 결제 primitive(코밴 CAT·package_payments 착지)를 재사용하고, 본 티켓은
 * '단건 → 다건 미수 합계' aggregation 레이어만 신설한다. 본 스펙 = 그 신규 결정론 로직을 순수 unit 으로 고정:
 *   ① AC-2/AC-4/AC-5 대상 산출: computeOutstandingPayTargets — open 패키지(취소/환불 제외) 中 패키지 잔금>0 만 집계.
 *      deployed AC-2 티켓행 [결제]와 동일 산식(computeOutstanding∘effectiveNetPaid) → confirm 내역 = 실차감 1:1 정합.
 *   ② AC-3 버튼표시: 미수 총액>0 = 활성+금액 / =0 = 비활성+툴팁('결제할 미수가 없습니다') → outstandingTotal 파생.
 *   ③ AC-2/AC-4 aggregate 라우팅: approve()가 paymentTargets 를 AttemptRecord 로 전파(단일 승인→target 별 분개) +
 *      Σ target.amount == 단말 charge 금액(1:1 정합 불변식 — 부분/중복차감 방지).
 *   ④ AC-6 저장모델 census: 신규 스키마 0(기존 package_payments 재사용) → db_change=false. (구조 불변은 코드/DA-ref 로 고정)
 *
 * ⚠ 화면 배치([결제]=[결제 및 티켓 생성] 좌측)·실 단말 승인·태블릿 터치·DB 행 착지·paid_amount 재계산·confirm dialog
 *   실렌더 = field-soak(최필경 총괄, 갤탭 실기기 confirm) + supervisor browser-verify. 본 스펙은 판별/집계 로직만 결정론 고정.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ① AC-2/AC-4/AC-5 — computeOutstandingPayTargets (다건 미수 aggregation 의 심장)
// ─────────────────────────────────────────────────────────────────────────────
type PkgIn = Parameters<typeof computeOutstandingPayTargets>[0];
type PayIn = Parameters<typeof computeOutstandingPayTargets>[1];

const pkg = (o: Partial<NonNullable<PkgIn>[number]> & { id: string }): NonNullable<PkgIn>[number] => ({
  status: 'active', total_amount: 0, total_sessions: 12, paid_amount: 0, transferred_from: null, package_name: '패키지', ...o,
});
const pay = (package_id: string, amount: number, extra: Partial<NonNullable<PayIn>[number]> = {}): NonNullable<PayIn>[number] =>
  ({ package_id, amount, payment_type: 'payment', fee_kind: 'package', ...extra });

test.describe('AC-2/AC-4/AC-5 — computeOutstandingPayTargets(환자 미수 총액 집계)', () => {
  test('미수>0 패키지만 target 집계 + 잔금 = 총액 − 순납부(결제행)', () => {
    const packages: PkgIn = [
      pkg({ id: 'A', total_amount: 2_000_000, package_name: '12회권' }),
      pkg({ id: 'B', total_amount: 960_000, package_name: '24회권' }),
    ];
    const payments: PayIn = [
      pay('A', 500_000), // A 잔금 1,500,000
      // B 무결제 → 잔금 960,000
    ];
    const t = computeOutstandingPayTargets(packages, payments);
    expect(t).toHaveLength(2);
    expect(t.find((x) => x.packageId === 'A')).toEqual({ packageId: 'A', amount: 1_500_000, label: '12회권' });
    expect(t.find((x) => x.packageId === 'B')).toEqual({ packageId: 'B', amount: 960_000, label: '24회권' });
    // ★AC-3 총액 = confirm 합계 = 단말 charge (Σ)
    expect(t.reduce((s, x) => s + x.amount, 0)).toBe(2_460_000);
  });

  test('완납(미수=0)·과수(미수<0) 패키지는 제외 — 오수납 방지', () => {
    const packages: PkgIn = [
      pkg({ id: 'PAID', total_amount: 1_000_000 }),
      pkg({ id: 'OVER', total_amount: 1_000_000 }),
      pkg({ id: 'DUE', total_amount: 1_000_000 }),
    ];
    const payments: PayIn = [
      pay('PAID', 1_000_000),   // 잔금 0
      pay('OVER', 1_200_000),   // 잔금 -200,000(과수)
      pay('DUE', 300_000),      // 잔금 700,000
    ];
    const t = computeOutstandingPayTargets(packages, payments);
    expect(t.map((x) => x.packageId)).toEqual(['DUE']);
    expect(t[0].amount).toBe(700_000);
  });

  test('취소/환불 패키지는 집계 제외(잔금 남아있어도)', () => {
    const packages: PkgIn = [
      pkg({ id: 'CX', status: 'cancelled', total_amount: 1_000_000 }),
      pkg({ id: 'RF', status: 'refunded', total_amount: 1_000_000 }),
      pkg({ id: 'OK', status: 'active', total_amount: 1_000_000 }),
    ];
    const t = computeOutstandingPayTargets(packages, []);
    expect(t.map((x) => x.packageId)).toEqual(['OK']);
  });

  test('결제행 없는 회수1 단건/양도 = paid_amount 폴백(effectiveNetPaid) — phantom 미수 방지', () => {
    const packages: PkgIn = [
      // 회수1 단건: 결제행 없음 + paid_amount 로 완납 → 미수 0(제외)
      pkg({ id: 'S1', total_sessions: 1, total_amount: 300_000, paid_amount: 300_000 }),
      // 양도 승계: 결제행 없음 + paid_amount 승계 완납 → 미수 0(제외)
      pkg({ id: 'TR', transferred_from: 'old-pkg', total_amount: 500_000, paid_amount: 500_000 }),
    ];
    const t = computeOutstandingPayTargets(packages, []);
    expect(t).toHaveLength(0);
  });

  test('label 기본값 = "패키지"(package_name 공란 폴백) — write 미사용(UI 전용)', () => {
    const t = computeOutstandingPayTargets([pkg({ id: 'X', total_amount: 100_000, package_name: '' })], []);
    expect(t[0].label).toBe('패키지');
  });

  test('빈 입력/누락 = 빈 배열(AC-3 비활성 경로) — null-safe', () => {
    expect(computeOutstandingPayTargets([], [])).toEqual([]);
    expect(computeOutstandingPayTargets(null, null)).toEqual([]);
    expect(computeOutstandingPayTargets(undefined, undefined)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② AC-3 — 버튼 표시 상태(미수 총액 파생). >0 활성+금액 / =0 비활성+툴팁.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 버튼 표시 규칙(미수 총액 게이트)', () => {
  const total = (packages: PkgIn, payments: PayIn) =>
    computeOutstandingPayTargets(packages, payments).reduce((s, t) => s + t.amount, 0);

  test('미수>0 → 활성(금액 표기 대상)', () => {
    const sum = total([pkg({ id: 'A', total_amount: 2_960_000 })], []);
    expect(sum).toBe(2_960_000);
    expect(sum > 0).toBe(true); // 활성 조건
  });

  test('미수=0 → 비활성(툴팁 "결제할 미수가 없습니다")', () => {
    const sum = total([pkg({ id: 'A', total_amount: 1_000_000 })], [pay('A', 1_000_000)]);
    expect(sum).toBe(0);
    expect(sum > 0).toBe(false); // 비활성 조건
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ AC-2/AC-4 — aggregate 라우팅: approve()가 paymentTargets 를 전파 + Σ == charge(1:1 정합).
//    (부모 spec makeMemStore 패턴 재사용 — recordCardPayment 이 aggregate 모드로 분기하는 rec 를 관측.)
// ─────────────────────────────────────────────────────────────────────────────
const REAL_APPROVAL =
  '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00",' +
  '"TAMT":"002460000","TRANDATE":"260810","TRANTIME":"131000","AUTHNO":"00328711    ",' +
  '"MERNO":"00918554560    ","TRANSERIAL":"104421000771","MSG1":"거래 승인00328711"}';

function makeMemStore() {
  const attempts = new Map<string, AttemptRecord>();
  const payments: Array<AttemptRecord & { authNo: string; attemptId: string }> = [];
  let seq = 0;
  const store: AttemptStore = {
    async insertAttempt(rec) { attempts.set(rec.msgTrace, { ...rec }); return { id: `attempt-${++seq}` }; },
    async updateAttempt(msgTrace, patch) { const c = attempts.get(msgTrace); if (c) attempts.set(msgTrace, { ...c, ...patch }); },
    async recordCardPayment(rec) { payments.push(rec); },
  };
  return { store, payments };
}

const BASE = { tid: 'TID12345678', merno: '00918554560', catPort: 3, clinicId: 'clinic-foot', customerId: 'cust-1', checkInId: null as string | null };
const sender = (raw: string) => async (_m: string, msgTrace: string): Promise<SendResult> => ({ raw, timedOut: false, msgTrace });

test.describe('AC-2/AC-4 — aggregate 라우팅 + Σ target == charge 정합', () => {
  test('paymentTargets 전파 + 미수 합계 = 단말 승인 금액(1:1)', async () => {
    const targets: PkgPayTarget[] = [
      { packageId: 'A', amount: 1_500_000 },
      { packageId: 'B', amount: 960_000 },
    ];
    const chargeTotal = targets.reduce((s, t) => s + t.amount, 0); // 2,460,000 == REAL_APPROVAL TAMT
    expect(exceedsPerTxnLimit(chargeTotal)).toBe(false);
    const { store, payments } = makeMemStore();
    // ★aggregate 모드: packageId 미전달(상호배타), paymentTargets 전달, amount=Σ.
    const r = await approve({ ...BASE, amount: chargeTotal, paymentTargets: targets }, store, sender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(payments).toHaveLength(1);
    // ★AC-2 라우팅: rec.paymentTargets 전파(recordCardPayment 이 split 분개 모드로 분기하는 근거).
    expect(payments[0].paymentTargets).toEqual(targets);
    // ★단일 packageId 미착지(aggregate 모드는 packageId=null → 단일 착지 경로 회피, 상호배타).
    expect(payments[0].packageId ?? null).toBeNull();
    // ★1:1 정합 불변식: Σ target.amount == 단말 charge 금액(부분/중복차감 방지의 산술 근거).
    expect(payments[0].paymentTargets!.reduce((s, t) => s + t.amount, 0)).toBe(payments[0].amount);
  });

  test('paymentTargets 미전달 = 기존 단일/카드 경로 회귀 0(aggregate 아님)', async () => {
    const { store, payments } = makeMemStore();
    const r = await approve({ ...BASE, packageId: 'pkg-single', amount: 2_460_000 }, store, sender(REAL_APPROVAL));
    expect(r.classification).toBe('APPROVED');
    expect(payments[0].paymentTargets ?? null).toBeNull(); // 기존 경로 무영향
    expect(payments[0].packageId).toBe('pkg-single');
  });
});
