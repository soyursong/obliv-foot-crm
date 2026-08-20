/**
 * E2E spec — T-20260820-foot-CLOSING-CASHTOTAL-CROSSMETHOD-REBUCKET-REVBASIS
 * 김주연 총괄 / 풋센터 (C0ATE5P6JTH, thread 1787097152.422279) / 2026-08-20
 *
 * 일마감 > 합계(결제수단별) 박스 '현금 총합' 표기 정정: 635,400 → 735,400.
 *   RC(자식 티켓 18:14 POST-VERIFY): 이금득 08-18 카드결제 100k → 현금환불(교차수단: 환불행 method=cash,
 *   원결제 method=card, linked_payment_id join). net(저장 method) 기준 차감 시 현금 총합 −100k(635,400) 오표기.
 *
 * ★설계(path B = revenue-basis 재귀속, 김주연 총괄 field-decision ts 1787189112 "735,400이 맞음"):
 *   - '합계(결제수단별)' 표시 카드 전용 revenue-basis 소계(totalCardRev/CashRev/TransferRev) 도입.
 *     교차수단 환불(환불행 method ≠ 원결제행 method)을 원결제 method 버킷으로 재귀속(bucketOfPayment/bucketOfPkg).
 *     → 현금 총합 = 현금 결제행 합산(원결제 수단 매출) = 735,400. 카드 총합에 환불 net(원결제=card 매출 반전).
 *   - ★적용 경계(핵심 불변식): 재귀속은 표시 카드에만. 정산 대사(cashDiff=actualCash−totalCash)·마감 DB 저장
 *     (single_cash_total)·print '환불차감후' 행은 net(drawer) 그대로 — 물리 금고에서 빠져나간 현금 100k 반영.
 *     안 그러면 정산에 허위 부족(-100k). → net totalCard/Cash/Transfer 불변(회귀 0).
 *   - ★grossTotal(총계) 불변: totalCardRev+CashRev+TransferRev ≡ net 3소계 합(버킷 간 이동일 뿐) → total prop 정합.
 *   - db_change=false: historical row·DB 미접촉. 순수 view-layer 재귀속(원결제 method = 당일 로드행 map 조회).
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 가드 + 앱 로드(HTTP 200) + 재귀속 로직 자립 시뮬레이션.
 *   실브라우저 수치 정합(현금 총합 735,400)은 하단 갤탭 실기기 현장 confirm 체크리스트(done 판정 근거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260820-foot-CLOSING-CASHTOTAL-CROSSMETHOD-REBUCKET-REVBASIS', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 합계(결제수단별) 박스 현금 총합 = revenue-basis 재귀속 소계 ──────────
  test('AC-1: 합계 박스가 net → revenue-basis(…Rev) 소계로 전환', () => {
    const c = closing();
    // 합계 카드 행이 재귀속 소계(…Rev)를 표시.
    expect(c).toContain("['카드 총합', totals.totalCardRev, totals.totalCardCount]");
    expect(c).toContain("['현금 총합', totals.totalCashRev, totals.totalCashCount]");
    expect(c).toContain("['이체 총합', totals.totalTransferRev, totals.totalTransferCount]");
    // 이전(net) 표시행은 합계 박스에서 대체됨.
    expect(c).not.toContain("['현금 총합', totals.totalCash, totals.totalCashCount]");
  });

  test('AC-1: revenue-basis 소계 산출(sumRev) + 원결제 method 재귀속 헬퍼 존재', () => {
    const c = closing();
    expect(c).toContain('const sumRev');
    expect(c).toContain('const totalCashRev');
    expect(c).toContain('const totalCardRev');
    expect(c).toContain('const totalTransferRev');
    // 교차수단 환불 → 원결제 method 버킷 조회(단건=linked_payment_id, 패키지=parent_payment_id).
    expect(c).toContain('bucketOfPayment');
    expect(c).toContain('bucketOfPkg');
    expect(c).toContain('payMethodById');
    expect(c).toContain('pkgMethodById');
    // 동일 method / 고아 환불은 재귀속 안 함(저장 method 유지).
    expect(c).toMatch(/origM && origM !== r\.method/);
  });

  // ── AC-2: net(정산/DB/print) 축 불변 — 회귀 0 ────────────────────────────────
  test('AC-2: 정산 대사·DB 저장·grossTotal 은 net(drawer) 불변', () => {
    const c = closing();
    // net 소계 정의 보존.
    expect(c).toContain('const totalCard     = pkgCard + singleCard + manualCard;');
    expect(c).toContain('const totalCash     = pkgCash + singleCash + manualCash;');
    expect(c).toContain('const totalTransfer = pkgTransfer + singleTransfer + manualTransfer;');
    // grossTotal(총계) = net 합 — 표시축 변경이 총액 산식을 건드리지 않음.
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    // 합계 박스 total prop = grossTotal(불변).
    expect(c).toContain('total={totals.grossTotal}');
    // 정산(ReconRow) 시스템값 = net 그대로(drawer 기준).
    expect(c).toContain('system={totals.totalCash}');
    // DB 저장(single_cash_total) = net singleCash 그대로.
    expect(c).toContain('single_cash_total: totals.singleCash');
  });

  // ── AC-3: db_change=false — 표시 전용, 신규 DDL/쿼리 없음 ────────────────────
  test('AC-3(db_change=false): 재귀속이 신규 supabase from/rpc 를 도입하지 않음', () => {
    const c = closing();
    const idx = c.indexOf('CROSSMETHOD-REBUCKET-REVBASIS');
    expect(idx).toBeGreaterThan(-1);
    // 재귀속 블록은 로드된 payments/pkgPayments/manualEntries 를 재사용 — 신규 supabase 호출 없음.
    const block = c.slice(idx, idx + 2000);
    expect(block).not.toContain('supabase.from');
    expect(block).not.toContain('.rpc(');
    // 원결제 method 조회 = 당일 로드행 map(payMethodById/pkgMethodById).
    expect(block).toContain('payMethodById');
  });

  // ── AC-5: 재귀속 로직 자립 시뮬레이션 — 교차수단 환불 → 현금 735,400 ──────────
  //   Closing.tsx sumRev 의 핵심 reduce/bucketOf 규칙을 동일 재현해 수치 정합 assert.
  //   시나리오: 현금 결제 735,400(합) + 카드 결제 100k(원결제) + 현금 환불 -100k(원결제=card 교차수단).
  test('AC-5: 교차수단 환불 재귀속 → 현금 총합 735,400 / 카드 net 반영 / 총계 불변', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; linked_payment_id?: string | null };
    const payments: Row[] = [
      { id: 'cash1', amount: 500_000, method: 'cash', payment_type: 'payment' },
      { id: 'cash2', amount: 235_400, method: 'cash', payment_type: 'payment' }, // 현금 결제 합 = 735,400
      { id: 'card1', amount: 100_000, method: 'card', payment_type: 'payment' }, // 이금득 원결제(card)
      // 이금득 08-18 교차수단 환불: 환불행 method=cash, 원결제=card(linked_payment_id → card1)
      { id: 'ref1', amount: 100_000, method: 'cash', payment_type: 'refund', linked_payment_id: 'card1' },
    ];

    // Closing.tsx 와 동일한 원결제 method 조회 맵 + bucketOf.
    const payMethodById = new Map<string, string>();
    for (const p of payments) payMethodById.set(p.id, p.method);
    const bucketOf = (r: Row): string => {
      if (r.payment_type === 'refund' && r.linked_payment_id) {
        const origM = payMethodById.get(r.linked_payment_id);
        if (origM && origM !== r.method) return origM;
      }
      return r.method;
    };
    // net(drawer): 저장 method 축. revenue(rev): 원결제 method 재귀속 축.
    const sumNet = (m: string) =>
      payments.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumRev = (m: string) =>
      payments.filter(r => bucketOf(r) === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    // ★AC-1: revenue-basis 현금 총합 = 735,400 (교차수단 환불 미차감).
    expect(sumRev('cash')).toBe(735_400);
    // 카드 total 은 환불 net 반영(원결제=card): 100k(결제) − 100k(환불) = 0.
    expect(sumRev('card')).toBe(0);

    // ★net(drawer) 축은 불변: 현금 635,400(물리 금고), 카드 100,000.
    expect(sumNet('cash')).toBe(635_400);
    expect(sumNet('card')).toBe(100_000);

    // ★총계 불변 불변식: rev 3소계 합 ≡ net 3소계 합(버킷 간 이동일 뿐).
    const revSum = sumRev('cash') + sumRev('card') + sumRev('transfer');
    const netSum = sumNet('cash') + sumNet('card') + sumNet('transfer');
    expect(revSum).toBe(netSum);
  });

  test('AC-5 회귀: 교차수단 환불 없는 경우 rev ≡ net (동일 method 재귀속 없음)', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; linked_payment_id?: string | null };
    const payments: Row[] = [
      { id: 'cash1', amount: 300_000, method: 'cash', payment_type: 'payment' },
      { id: 'card1', amount: 200_000, method: 'card', payment_type: 'payment' },
      // 동일 method 환불(현금 결제 → 현금 환불): 재귀속 없음.
      { id: 'ref1', amount: 50_000, method: 'cash', payment_type: 'refund', linked_payment_id: 'cash1' },
    ];
    const payMethodById = new Map<string, string>();
    for (const p of payments) payMethodById.set(p.id, p.method);
    const bucketOf = (r: Row): string => {
      if (r.payment_type === 'refund' && r.linked_payment_id) {
        const origM = payMethodById.get(r.linked_payment_id);
        if (origM && origM !== r.method) return origM;
      }
      return r.method;
    };
    const sumNet = (m: string) =>
      payments.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumRev = (m: string) =>
      payments.filter(r => bucketOf(r) === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    // 교차수단 없음 → rev 와 net 완전 동일(회귀 0).
    for (const m of ['cash', 'card', 'transfer']) expect(sumRev(m)).toBe(sumNet(m));
    expect(sumRev('cash')).toBe(250_000); // 300k − 50k
    expect(sumRev('card')).toBe(200_000);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거) ─────────────────────────
 * [ ] 일마감 화면 → 08-18(이금득 교차수단 환불일) 선택 → 합계(결제수단별) 박스 '현금 총합' = 735,400 확인
 * [ ] 강력 새로고침(캐시 초기화) 후에도 735,400 유지 확인
 * [ ] 교차수단 환불 없는 일반 마감일 → 현금 총합 = 기존 값 그대로(회귀 0) 확인
 * [ ] 실수령 대사(정산) 현금 '시스템' 값 = 물리 금고 기준(drawer) 유지 확인
 */
