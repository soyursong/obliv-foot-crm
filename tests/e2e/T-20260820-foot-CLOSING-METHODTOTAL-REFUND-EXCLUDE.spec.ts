/**
 * E2E spec — T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE
 * 요청: 김주연 총괄 / 풋센터 (U0ATDB587PV) / 2026-08-20 (thread 1787189374.436629)
 *   "카드/현금/이체 각 결제수단별 총합계에 환불금액이 포함돼 있음 → 환불 건 제외하고
 *    실 수납(정상수납)만 집계. 환불은 하단 별도 박스(기배포 SPLIT-CANCELEXCL)에서만 표시."
 *
 * ★선행 실측(§13.1.C 이중 authoring 금지):
 *   직전(0078597e ACTUALPAID)까지 합계(결제수단별) per-method 라인 = totals.total{...}Rev = sumRev(L1072)
 *   = 환불 1회 차감(NET·revenue-basis). 사용자 관측 '환불금액이 포함(=차감 반영)됨' = NET 이라는 뜻.
 *   본건 = per-method 표시축을 NET(…Rev) → GROSS(…Gross, 정상수납·환불행 제외)로 재전환.
 *
 * ★재사용(신규 병렬 refund 집계 신설 금지):
 *   totals.total{...}Gross = sumGross(L1023, payment_type!=='refund' 필터)로 환불행을 이미 '제외'한 기존 집계 재사용.
 *   환불 partition 집합(refund{Card,Cash,Transfer}Amount, SPLIT-CANCELEXCL part1)은 하단 '금일 환불' 박스에서만 소비.
 *
 * ★이중차감 가드(단일 refund 집합 기준 1회 제외):
 *   per-method = 환불 '제외'(미차감·GROSS) / 합계(grossTotal) = 환불 1회 '차감'(NET). 동일 refund 가 두 경로에서
 *   두 번 빠지지 않음(제외 ⊥ 차감). grossTotal SSOT(payload/daily_closings/정산 ReconRow) 무접촉·db_change=false.
 *
 * ★method 축 = Axis-A(원결제 승계): GROSS 는 환불행을 아예 제외 → 교차수단 환불 재귀속(Rev) 불요.
 *   정상수납은 저장 method = 원결제 method(수납 시점 확정) 그대로.
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 순수 fs-grep 정적 소스 가드 + GROSS/이중차감 자립 시뮬레이션.
 *   실브라우저 갤탭 수치 정합 = 하단 현장 confirm 체크리스트(done 판정 근거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

// '합계 (결제수단별)' SummaryCard rows={[...]} 블록만 절취.
const summaryRowsBlock = () => {
  const c = closing();
  const titleIdx = c.indexOf('title="합계 (결제수단별)"');
  expect(titleIdx).toBeGreaterThan(-1);
  const rowsIdx = c.indexOf('rows={[', titleIdx);
  const totalIdx = c.indexOf('total={totals.grossTotal}', rowsIdx);
  expect(rowsIdx).toBeGreaterThan(-1);
  expect(totalIdx).toBeGreaterThan(rowsIdx);
  return c.slice(rowsIdx, totalIdx);
};

test.describe('T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE', () => {

  // ── AC-1: per-method 라인 = GROSS(정상수납·환불 제외) ─────────────────────────────
  test('AC-1: 카드/현금/이체 총합 = totals.total{...}Gross (정상수납·환불행 제외)', () => {
    const block = summaryRowsBlock();
    expect(block).toContain('totals.totalCardGross, totals.totalCardCount');
    expect(block).toContain('totals.totalCashGross, totals.totalCashCount');
    expect(block).toContain('totals.totalTransferGross, totals.totalTransferCount');
    // 구 NET 소계(…Rev)를 표시행에 쓰지 않음(재전환 회귀 가드).
    expect(block).not.toContain('totals.totalCardRev, totals.totalCardCount');
    expect(block).not.toContain('totals.totalCashRev, totals.totalCashCount');
    expect(block).not.toContain('totals.totalTransferRev, totals.totalTransferCount');
    // 각 수단당 표시행 정확히 1개(중복/보조행 없음).
    expect((block.match(/totals\.totalCardGross, totals\.totalCardCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalCashGross, totals\.totalCashCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalTransferGross, totals\.totalTransferCount/g) || []).length).toBe(1);
  });

  // ── AC-2: totalCardGross = sumGross(환불행 제외) 재사용 — 신규 병렬 refund 집계 신설 없음 ──
  test('AC-2: sumGross 는 payment_type!==refund 필터(환불 제외) · totalCardGross 는 그 재사용', () => {
    const c = closing();
    // sumGross 정의: 결제행만(환불 제외) 합산.
    const idx = c.indexOf('const sumGross');
    expect(idx).toBeGreaterThan(-1);
    const sumGrossBlock = c.slice(idx, idx + 400);
    expect(sumGrossBlock).toMatch(/payment_type !== 'refund'/);
    // totalCardGross/CashGross/TransferGross = GROSS 소계 합(기존 집계 재사용).
    expect(c).toContain('const totalCardGross');
    expect(c).toContain('const totalCashGross');
    expect(c).toContain('const totalTransferGross');
    // per-method 표시행에 별도 환불 재차감(-refund) 연산이 붙지 않음(이중차감 gate).
    const block = summaryRowsBlock();
    expect(block).not.toMatch(/totalCardGross\s*-\s*/);
    expect(block).not.toMatch(/totalCashGross\s*-\s*/);
    expect(block).not.toMatch(/totalTransferGross\s*-\s*/);
    expect(block).not.toContain("'환불', -totals.refund");
  });

  // ── AC-3: 환불은 하단 '금일 환불' 별도 박스에서만 표시(SPLIT-CANCELEXCL part1 상존) ──
  test('AC-3: 환불 breakdown = 별도 박스(closing-refund-by-method)에서만 표시', () => {
    const c = closing();
    expect(c).toContain('closing-refund-by-method');
    expect(c).toContain('totals.refundCardAmount');
    expect(c).toContain('totals.refundCashAmount');
    expect(c).toContain('totals.refundTransferAmount');
    // 환불 별도 박스는 합계(결제수단별) SummaryCard '밖'(그 아래)에 위치.
    const totalIdx = c.indexOf('total={totals.grossTotal}');
    const refundBoxIdx = c.indexOf('closing-refund-by-method');
    expect(refundBoxIdx).toBeGreaterThan(totalIdx);
  });

  // ── AC-4: DISPLAY-ONLY 캡션 — '환불 제외 정상수납' 고지 ──────────────────────────
  test('AC-4: 합계 카드 하단 "환불 제외 정상수납" 캡션(closing-methodtotal-refundexcl-note) 존재', () => {
    const c = closing();
    expect(c).toContain('closing-methodtotal-refundexcl-note');
    expect(c).toContain('환불을 제외한 정상수납');
    // 구 캡션/testid 부재(회귀 가드).
    expect(c).not.toContain('closing-methodsum-refundexcl-note');
    expect(c).not.toContain('환불 금액이 이미 차감된');
    // 캡션은 합계(결제수단별) SummaryCard 직후에 위치.
    const cardIdx = c.indexOf('title="합계 (결제수단별)"');
    const noteIdx = c.indexOf('closing-methodtotal-refundexcl-note');
    expect(noteIdx).toBeGreaterThan(cardIdx);
  });

  // ── AC-5: DISPLAY-ONLY — grossTotal/persist/정산 = NET drawer 불변(db_change=false) ──
  test('AC-5: grossTotal(합계 total)·persist·정산 대사 = NET 불변(신규 basis/차감 무유입)', () => {
    const c = closing();
    // 합계 카드 total = grossTotal(NET, planner step3 '전체 NET 차감') 유지.
    expect(c).toContain('total={totals.grossTotal}');
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    // daily_closings persist·정산 ReconRow = net(drawer) 불변.
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('system={totals.totalCash}');
  });

  // ── SIM-1(시나리오①): 카드 환불 있는 영업일 → 카드 총합 = 정상수납(GROSS, 환불 제외) ──
  //   합계(grossTotal)는 NET(환불 1회 차감) 유지 → 이중차감 아님. 환불은 별도 박스.
  test('SIM-1: 카드 환불일 → per-method=GROSS(정상수납) / 합계=NET / 이중차감 없음', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund' };
    const rows: Row[] = [
      { amount: 500_000, method: 'card', payment_type: 'payment' },
      { amount: 300_000, method: 'card', payment_type: 'payment' },
      { amount: 300_000, method: 'card', payment_type: 'refund' }, // 카드 환불
      { amount: 200_000, method: 'cash', payment_type: 'payment' },
    ];
    // GROSS(정상수납): 결제행만 — 환불 '제외'(미차감).
    const sumGross = (m: string) =>
      rows.filter(r => r.method === m && r.payment_type !== 'refund').reduce((s, r) => s + r.amount, 0);
    // NET: 환불 1회 '차감'.
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumNet = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);

    // 카드 총합(정상수납) = 500k + 300k = 800,000 (환불 제외).
    expect(sumGross('card')).toBe(800_000);
    expect(sumGross('cash')).toBe(200_000);

    // 합계(grossTotal, NET) = 카드 NET(500k) + 현금(200k) = 700,000 (환불 1회 차감).
    const grossTotal = sumNet('card') + sumNet('cash');
    expect(grossTotal).toBe(700_000);

    // 정상수납(카드) − 환불(카드) = 카드 NET  → 이중차감 없음(제외 ⊥ 차감).
    const refundCard = rows.filter(r => r.method === 'card' && r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    expect(sumGross('card') - refundCard).toBe(sumNet('card')); // 800k - 300k = 500k
    // 정상수납 총합 − 환불 총액 = grossTotal(정상수납 − 환불 = 합계 실현).
    expect(sumGross('card') + sumGross('cash') - refundCard).toBe(grossTotal); // 1,000k - 300k = 700k
  });

  // ── SIM-2(시나리오②): 교차수단 환불(원결제 카드 → 현금 실지급 환불) → method 축 Axis-A ──
  //   GROSS 는 환불행을 '제외' → per-method 에 환불 자체가 안 들어옴 → 교차수단 재귀속(Rev) 이슈 소멸.
  //   환불 breakdown(박스)은 원결제 method(Axis-A, forward=저장 method) 기준 표기.
  test('SIM-2: 교차수단 환불 → GROSS per-method 는 환불 무영향 / 환불박스=Axis-A', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund'; origMethod?: string };
    const rows: Row[] = [
      { amount: 100_000, method: 'card', payment_type: 'payment' },  // 원결제 카드
      { amount: 500_000, method: 'cash', payment_type: 'payment' },
      // 교차수단 환불: 실지급 현금이나 forward 저장 method = 원결제 승계(card).
      { amount: 100_000, method: 'card', payment_type: 'refund', origMethod: 'card' },
    ];
    const sumGross = (m: string) =>
      rows.filter(r => r.method === m && r.payment_type !== 'refund').reduce((s, r) => s + r.amount, 0);

    // GROSS per-method: 환불 제외 → 카드 정상수납 100k, 현금 정상수납 500k (환불이 어느 수단이든 무영향).
    expect(sumGross('card')).toBe(100_000);
    expect(sumGross('cash')).toBe(500_000);

    // 환불 박스 = method(Axis-A 원결제 승계) 기준 partition — 카드 환불 100k.
    const refundByMethod = (m: string) =>
      rows.filter(r => r.payment_type === 'refund' && r.method === m).reduce((s, r) => s + r.amount, 0);
    expect(refundByMethod('card')).toBe(100_000);
    expect(refundByMethod('cash')).toBe(0);
  });

  // ── SIM-3(엣지): 환불 0건 날 → GROSS == 기존 NET(회귀 0) ─────────────────────────
  test('SIM-3: 환불 0건 날 → 정상수납(GROSS) == NET (회귀 0)', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund' };
    const rows: Row[] = [
      { amount: 400_000, method: 'card', payment_type: 'payment' },
      { amount: 100_000, method: 'cash', payment_type: 'payment' },
    ];
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumNet = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);
    const sumGross = (m: string) => rows.filter(r => r.method === m && r.payment_type !== 'refund').reduce((s, r) => s + r.amount, 0);
    expect(sumGross('card')).toBe(sumNet('card'));
    expect(sumGross('cash')).toBe(sumNet('cash'));
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거 · 김주연 총괄 U0ATDB587PV) ─────
 * [ ] 일마감 → 환불 있는 영업일 → 합계(결제수단별) 카드/현금/이체 총합 = '환불 제외한 정상수납(실수납)' 수치 확인
 * [ ] 합계 카드 하단 '※ …환불을 제외한 정상수납(실수납) 금액입니다 … 합계는 환불 차감 후 실현 매출' 캡션 표시 확인
 * [ ] 하단 '금일 환불' 박스에 카드/현금/이체 환불이 정상 표기(중복/이중차감 아님) 확인
 * [ ] 정상수납 3소계 − 환불 총액 = 합계(총계·실현) 관계 정합 확인
 * [ ] 환불 0건 날 → 총합 기존과 동일(회귀 0) 확인
 * [ ] (planner FOLLOWUP 확인 대상) 합계(총계) 행을 NET(환불 차감 실현)로 유지할지, 정상수납 총액(GROSS)으로
 *     바꿀지 — 현재는 planner step3('전체 NET 차감')에 따라 NET 유지. 총괄 선호 재확인 시 1줄 후속.
 */
