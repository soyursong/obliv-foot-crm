/**
 * E2E spec — T-20260820-foot-CLOSING-METHODTOTAL-REVBASIS-RESTORE
 * 요청: 김주연 총괄 / 풋센터 (U0ATDB587PV) / 2026-08-20
 * 결정: planner adjudication MSG-20260820-160234-cfbi — DECISION=(A) revenue-basis 복원.
 *
 * ★배경(conflict adjudicated):
 *   선행 METHODTOTAL-REFUND-EXCLUDE(476ed6e2)가 합계(결제수단별) per-method 표시축을 NET(…Rev)→GROSS(…Gross,
 *   payment_type!=='refund' 필터)로 전환. 그러나 GROSS 는 08-18 팬텀 자기상쇄쌍(dfe01821, 4.7M pay+refund) 의
 *   결제 leg 를 '제외'하지 못하고 잔존시켜 현금 총합을 5,435,400 으로 부풀림 → '찐 수납만' intent 자체 위반
 *   (환불된 돈은 '찐 수납' 아님). 김주연 총괄 confirmed value = 현금 735,400(08-18 본인 결정 + 08-20 재확인).
 *   ∴ per-method 표시축을 GROSS→…Rev(revenue-basis, 환불 1회 차감·NET) 로 복원. REFUND-EXCLUDE = superseded.
 *
 * ★재사용(§13.1.C·신규 병렬 집계 신설 0): total{Card,Cash,Transfer}Rev = sumRev(L1072, 환불 1회 차감·NET,
 *   교차수단 환불은 원결제 method 로 재귀속) 기존 집계 그대로 재사용.
 *
 * ★교차수단 재귀속(Axis-A·DA-20260819-REFUND-CROSSMETHOD-METHOD-INHERIT): 환불은 원결제 method 버킷으로
 *   재귀속되어 차감(예: card→cash 100k). conservation(INV5): …Rev 3소계 합 ≡ grossTotal.
 *
 * ★DA Q3 HARD BOUNDARY(부모 da_decision_foot_closing_cashsum_revenue_basis_rebucket): 합계(grossTotal)·
 *   daily_closings persist·outbox payload totals{}·A6·정산 cashDiff drawer-grain(635,400) 무접촉. db_change=false.
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 순수 fs-grep 정적 소스 가드 + revenue-basis/팬텀쌍 자립 시뮬레이션.
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

test.describe('T-20260820-foot-CLOSING-METHODTOTAL-REVBASIS-RESTORE', () => {

  // ── AC-1: per-method 라인 = revenue-basis(…Rev) 복원 ─────────────────────────────
  test('AC-1: 카드/현금/이체 총합 = totals.total{...}Rev (revenue-basis·환불 1회 차감)', () => {
    const block = summaryRowsBlock();
    expect(block).toContain('totals.totalCardRev, totals.totalCardCount');
    expect(block).toContain('totals.totalCashRev, totals.totalCashCount');
    expect(block).toContain('totals.totalTransferRev, totals.totalTransferCount');
    // GROSS(정상수납·환불 미차감)를 표시행에 쓰지 않음(REFUND-EXCLUDE supersede 회귀 가드).
    expect(block).not.toContain('totals.totalCardGross, totals.totalCardCount');
    expect(block).not.toContain('totals.totalCashGross, totals.totalCashCount');
    expect(block).not.toContain('totals.totalTransferGross, totals.totalTransferCount');
    // 각 수단당 표시행 정확히 1개.
    expect((block.match(/totals\.totalCardRev, totals\.totalCardCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalCashRev, totals\.totalCashCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalTransferRev, totals\.totalTransferCount/g) || []).length).toBe(1);
  });

  // ── AC-2: sumRev = revenue-basis NET(환불 1회 차감·원결제 method 재귀속) 재사용 ──
  test('AC-2: sumRev 는 revenue-basis(환불 차감·bucketOf 재귀속) · total…Rev 는 그 재사용(신규 집계 0)', () => {
    const c = closing();
    const idx = c.indexOf('const sumRev');
    expect(idx).toBeGreaterThan(-1);
    const sumRevBlock = c.slice(idx, idx + 500);
    // 환불행은 차감(-amount) — NET.
    expect(sumRevBlock).toMatch(/payment_type === 'refund' \? -r\.amount : r\.amount/);
    // bucketOf(원결제 method 재귀속) 축으로 필터 — 교차수단 revenue-basis.
    expect(sumRevBlock).toMatch(/bucketOfPayment\(r\) === method/);
    // total…Rev = sumRev(...) 재사용.
    expect(c).toContain("const totalCardRev     = sumRev('card')");
    expect(c).toContain("const totalCashRev     = sumRev('cash')");
    expect(c).toContain("const totalTransferRev = sumRev('transfer')");
    // per-method 표시행에 별도 환불 재차감(-refund) 연산이 붙지 않음(이중차감 gate).
    const block = summaryRowsBlock();
    expect(block).not.toMatch(/totalCardRev\s*-\s*/);
    expect(block).not.toContain("'환불', -totals.refund");
  });

  // ── AC-3: '(매출)' 마커 복원 — 교차수단 재귀속으로 revenue≠drawer 인 수단 표기 ──
  test('AC-3: 교차수단 재귀속 표기 — revenue≠drawer 수단에 "(매출)" 마커', () => {
    const block = summaryRowsBlock();
    expect(block).toContain("totals.totalCardRev !== totals.totalCard ? ' (매출)' : ''");
    expect(block).toContain("totals.totalCashRev !== totals.totalCash ? ' (매출)' : ''");
    expect(block).toContain("totals.totalTransferRev !== totals.totalTransfer ? ' (매출)' : ''");
  });

  // ── AC-4: DISPLAY-ONLY 캡션 복원 — '환불 이미 차감' 고지(closing-methodsum-refundexcl-note) ──
  test('AC-4: 합계 카드 하단 "환불 이미 차감" 캡션(closing-methodsum-refundexcl-note) 복원', () => {
    const c = closing();
    expect(c).toContain('closing-methodsum-refundexcl-note');
    expect(c).toContain('환불 금액이 이미 차감된');
    // REFUND-EXCLUDE 캡션/testid 부재(supersede 회귀 가드).
    expect(c).not.toContain('closing-methodtotal-refundexcl-note');
    expect(c).not.toContain('환불을 제외한 정상수납');
    // 캡션은 합계(결제수단별) SummaryCard 직후에 위치.
    const cardIdx = c.indexOf('title="합계 (결제수단별)"');
    const noteIdx = c.indexOf('closing-methodsum-refundexcl-note');
    expect(noteIdx).toBeGreaterThan(cardIdx);
  });

  // ── AC-5: DA Q3 HARD BOUNDARY — grossTotal/persist/정산 = drawer NET 불변(db_change=false) ──
  test('AC-5: grossTotal(합계 total)·persist·정산 대사 = drawer grain 불변(revenue projection 무유입)', () => {
    const c = closing();
    // 합계 카드 total = grossTotal(환불 1회 차감 NET) 유지.
    expect(c).toContain('total={totals.grossTotal}');
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    // daily_closings persist·정산 ReconRow = net(drawer) 불변.
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('system={totals.totalCash}');
  });

  // ── SIM-1(회귀·팬텀쌍 dfe01821): 현금 revenue-basis = 735,400 (GROSS 5,435,400 부풀림 배제) ──
  //   08-18 팬텀 자기상쇄쌍(pay 4.7M + refund 4.7M)이 GROSS 를 5,435,400 으로 부풀리나, revenue-basis(NET)는
  //   환불 leg 로 상계되어 정확히 735,400. 이것이 김주연 총괄 confirmed value.
  test('SIM-1: 팬텀 자기상쇄쌍 → 현금 …Rev=735,400 / …Gross=5,435,400(부풀림) → Rev 채택', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund' };
    const rows: Row[] = [
      { amount: 735_400, method: 'cash', payment_type: 'payment' },     // 실제 현금 매출
      { amount: 4_700_000, method: 'cash', payment_type: 'payment' },   // 팬텀쌍 pay leg (dfe01821)
      { amount: 4_700_000, method: 'cash', payment_type: 'refund' },    // 팬텀쌍 refund leg (자기상쇄)
    ];
    // revenue-basis NET: 환불 1회 차감 → 팬텀쌍 자기상쇄 → 735,400.
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumRev = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);
    // GROSS: 환불행 제외 → 팬텀 pay leg 잔존 → 5,435,400 부풀림(intent 위반).
    const sumGross = (m: string) => rows.filter(r => r.method === m && r.payment_type !== 'refund').reduce((s, r) => s + r.amount, 0);

    expect(sumRev('cash')).toBe(735_400);       // ← confirmed value
    expect(sumGross('cash')).toBe(5_435_400);   // ← 부풀림(팬텀 leg 잔존)
    expect(sumGross('cash')).not.toBe(735_400); // GROSS 는 confirmed 와 불일치 → REFUND-EXCLUDE superseded
  });

  // ── SIM-2(교차수단 재귀속·Axis-A): 원결제 card → 현금 실지급 환불 100k → revenue-basis 카드 반전 ──
  //   drawer basis(저장 method=cash) 라면 현금 -100k 이나, revenue-basis 는 원결제 card 버킷으로 재귀속.
  //   conservation: 카드 …Rev + 현금 …Rev ≡ NET 총합(버킷 간 이동, Σ 불변).
  test('SIM-2: card→cash 교차수단 환불 100k → revenue-basis 원결제(card) 재귀속·Σ 불변', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund'; origMethod: string };
    const rows: Row[] = [
      { amount: 635_400, method: 'cash', payment_type: 'payment', origMethod: 'cash' }, // 순수 현금 매출
      { amount: 100_000, method: 'cash', payment_type: 'payment', origMethod: 'cash' }, // 현금 매출(합산 735,400)
      { amount: 500_000, method: 'card', payment_type: 'payment', origMethod: 'card' }, // 카드 매출
      // 교차수단 환불: 실지급 현금(method=cash)이나 원결제 card → revenue 버킷 = card.
      { amount: 100_000, method: 'cash', payment_type: 'refund', origMethod: 'card' },
    ];
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    // revenue-basis: 환불행은 origMethod(원결제) 버킷으로 재귀속.
    const revBucket = (r: Row) => (r.payment_type === 'refund' ? r.origMethod : r.method);
    const sumRev = (m: string) => rows.filter(r => revBucket(r) === m).reduce((s, r) => s + signed(r), 0);
    // drawer basis: 저장 method 그대로(환불 실지급 수단 차감).
    const sumDrawer = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);

    // revenue-basis: 현금 = 735,400(교차수단 환불 미차감·카드로 이전) / 카드 = 500k-100k=400,000.
    expect(sumRev('cash')).toBe(735_400);
    expect(sumRev('card')).toBe(400_000);
    // drawer basis: 현금 = 635,400(교차수단 환불 실지급 차감) / 카드 = 500,000.
    expect(sumDrawer('cash')).toBe(635_400);
    expect(sumDrawer('card')).toBe(500_000);
    // conservation(INV5): revenue-basis Σ ≡ drawer Σ (버킷 간 이동, 총합 불변).
    expect(sumRev('cash') + sumRev('card')).toBe(sumDrawer('cash') + sumDrawer('card')); // 1,135,400
  });

  // ── SIM-3(엣지): 환불 0건 날 → revenue-basis(…Rev) == GROSS == drawer (회귀 0) ──
  test('SIM-3: 환불 0건 날 → …Rev == GROSS == drawer (회귀 0)', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund' };
    const rows: Row[] = [
      { amount: 400_000, method: 'card', payment_type: 'payment' },
      { amount: 100_000, method: 'cash', payment_type: 'payment' },
    ];
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumRev = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);
    const sumGross = (m: string) => rows.filter(r => r.method === m && r.payment_type !== 'refund').reduce((s, r) => s + r.amount, 0);
    expect(sumRev('card')).toBe(sumGross('card'));
    expect(sumRev('cash')).toBe(sumGross('cash'));
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거 · 김주연 총괄 U0ATDB587PV) ─────
 * [ ] 08-18 영업일 → 합계(결제수단별) '현금 총합' = 735,400 표시 확인 (구 5,435,400 부풀림 아님)
 * [ ] 합계 카드 하단 '※ …환불 금액이 이미 차감된 금액입니다' 캡션 표시 확인
 * [ ] 교차수단 환불(원결제 card→현금 실지급) 있는 날 → '현금 총합 (매출)' 마커 + revenue-basis 재귀속 확인
 * [ ] 하단 '금일 환불' 박스 환불 표기 정상(중복/이중차감 아님) 확인
 * [ ] …Rev 3소계 합 ≡ 합계(grossTotal) 관계 정합 확인
 * [ ] 정산 대사 카드의 현금(drawer, 635,400)·차이는 revenue projection 무유입(불변) 확인
 */
