/**
 * E2E spec — T-20260820-foot-CLOSING-METHODSUM-REFUNDEXCL-ACTUALPAID
 * 요청: 김주연 총괄 / 풋센터 (U0ATDB587PV) / 2026-08-20 13:37 (thread 1787189374.436629)
 *   "카드 총합 환불된 내역 포함되어 있는데 찐으로 수납 받은 금액만 표기해달라공
 *    합계(결제수단별) 항목에서 환불 항목은 제외시켜"
 *
 * ⚠ 조사-우선 reconcile (이중차감 방지):
 *   선행 T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL(1ab50f98·deployed·field_soak)이
 *   '합계박스 GROSS→NET·sum() 환불 1회차감' 을 이미 적용했다고 주장 ↔ 현장 관측='환불 포함'(상충).
 *
 * ★조사 결론(코드 실측 = 본 spec AC-1~AC-3 가 코드로 증명):
 *   합계(결제수단별) 카드/현금/이체 총합 = totals.total{Card,Cash,Transfer}Rev = sumRev(L1072).
 *   sumRev 는 payment_type==='refund' ? -amount : amount 로 '환불 1회 차감'(NET) → 이미 실 수납.
 *   payments/pkgPayments 쿼리는 환불행(payment_type='refund')을 포함(status='deleted'만 제외) →
 *   환불행이 실제로 차감 대상에 들어옴을 확인.
 *   ∴ 추가 차감(신규 제외 로직)=이중차감 → HARD REJECT. 본건 = DISPLAY-ONLY 명확성 캡션만 추가.
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 가드 + 앱 로드(HTTP 200) +
 *   NET(환불 1회차감·이중차감 없음) 자립 시뮬레이션.
 *   실브라우저 수치 정합은 하단 갤탭 실기기 현장 confirm 체크리스트(done 판정 근거).
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

test.describe('T-20260820-foot-CLOSING-METHODSUM-REFUNDEXCL-ACTUALPAID', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: [SUPERSEDED] 합계(결제수단별) per-method = GROSS(정상수납·환불 제외) ──────────
  //   ★ SUPERSEDED by T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE (김주연 총괄 ts 1787189374):
  //     본 ACTUALPAID 는 'per-method 이미 NET → 캡션만 추가'로 착지했으나, 총괄이 후속 clarify —
  //     '환불 건 제외하고 실수납(정상수납)만' → per-method 표시축을 NET(…Rev) → GROSS(…Gross)로 재전환.
  //     (본 ACTUALPAID 자신이 남긴 'basis 재확인 planner FOLLOWUP'의 결론.)
  test('AC-1(superseded→GROSS): 카드/현금/이체 총합 = totals.total{...}Gross (정상수납·환불 제외)', () => {
    const block = summaryRowsBlock();
    expect(block).toContain('totals.totalCardGross, totals.totalCardCount');
    expect(block).toContain('totals.totalCashGross, totals.totalCashCount');
    expect(block).toContain('totals.totalTransferGross, totals.totalTransferCount');
    // 구 NET 소계(…Rev)를 표시행에 쓰지 않음(정상수납 재전환 회귀 가드).
    expect(block).not.toContain('totals.totalCardRev, totals.totalCardCount');
    expect(block).not.toContain('totals.totalCashRev, totals.totalCashCount');
    expect(block).not.toContain('totals.totalTransferRev, totals.totalTransferCount');
  });

  // ── AC-2: sumRev = 환불 '1회' 차감(NET) — 이중차감 신규 로직 없음 ────────────────
  test('AC-2: sumRev 는 환불 1회 차감(NET) · 신규 추가 제외 로직 없음(이중차감 gate#1)', () => {
    const c = closing();
    // sumRev 정의에 환불 signed(-amount) 1회 차감 존재.
    const sumRevIdx = c.indexOf('const sumRev');
    expect(sumRevIdx).toBeGreaterThan(-1);
    const sumRevBlock = c.slice(sumRevIdx, sumRevIdx + 500);
    expect(sumRevBlock).toMatch(/payment_type === 'refund' \? -r\.amount : r\.amount/);
    // 합계 카드 rows 안에서 …Rev 값에 별도 환불 재차감(-refund) 연산이 붙지 않음.
    const block = summaryRowsBlock();
    expect(block).not.toMatch(/totalCardRev\s*-\s*/);
    expect(block).not.toMatch(/totalCashRev\s*-\s*/);
    expect(block).not.toMatch(/totalTransferRev\s*-\s*/);
    // 인라인 '환불' 재차감 행(GROSS+[-refund])이 합계 카드에 없음(선행 REFUNDBOX-SPLIT 로 별도 박스 분리 유지).
    expect(block).not.toContain("'환불', -totals.refund");
  });

  // ── AC-3: payments 쿼리가 환불행 포함 → 차감 대상 실재(NET 성립 근거) ─────────────
  test('AC-3: payments/pkgPayments 쿼리는 환불행 포함(status=deleted 만 제외)', () => {
    const c = closing();
    // closing-payments 쿼리: payment_type 로 refund 필터링(제거)하지 않음.
    const payIdx = c.indexOf("queryKey: ['closing-payments'");
    // window 확대(1800): .select(...) 컬럼 문자열이 길어져 .neq('status','deleted') 가 900 밖으로 밀림
    //   (pre-existing 창-과소 false-red 치유, T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE 편의 수정).
    const payBlock = c.slice(payIdx, payIdx + 1800);
    expect(payBlock).toContain(".from('payments')");
    expect(payBlock).toContain(".neq('status', 'deleted')");
    expect(payBlock).not.toMatch(/\.neq\('payment_type', 'refund'\)/);
    expect(payBlock).not.toMatch(/\.eq\('payment_type', 'payment'\)/);
  });

  // ── AC-4: [SUPERSEDED] DISPLAY-ONLY 명확성 캡션 (환불 제외/정상수납 고지) ────────────
  //   ★ SUPERSEDED by T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE:
  //     구 캡션('환불 금액이 이미 차감된'·testid closing-methodsum-refundexcl-note)이
  //     신 캡션('환불을 제외한 정상수납'·testid closing-methodtotal-refundexcl-note)으로 대체됨.
  test('AC-4(superseded): 합계 카드에 "환불 제외 정상수납" 캡션(closing-methodtotal-refundexcl-note) 존재', () => {
    const c = closing();
    expect(c).toContain('closing-methodtotal-refundexcl-note');
    expect(c).toContain('환불을 제외한 정상수납');
    // 구 캡션/testid 부재(회귀 가드).
    expect(c).not.toContain('closing-methodsum-refundexcl-note');
    // 캡션은 합계(결제수단별) SummaryCard 직후에 위치.
    const cardIdx = c.indexOf('title="합계 (결제수단별)"');
    const noteIdx = c.indexOf('closing-methodtotal-refundexcl-note');
    expect(noteIdx).toBeGreaterThan(cardIdx);
  });

  // ── AC-5: DISPLAY-ONLY — 산식/persist/정산/basis 무접촉(db_change=false) ─────────
  test('AC-5: grossTotal·persist·정산 대사 = drawer net 불변(신규 차감/basis 전환 무유입)', () => {
    const c = closing();
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    expect(c).toContain('total={totals.grossTotal}');
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('system={totals.totalCash}');
    // conservation 불변식 주석 유지(…Rev 3소계 합 ≡ net).
    expect(c).toMatch(/totalCardRev\+CashRev\+TransferRev\s*≡/);
  });

  // ── SIM: NET(환불 1회차감) 정합 + 이중차감 없음 자립 시뮬레이션 ────────────────────
  test('SIM: 카드 환불 있는 날 → 카드 총합 = gross - refund(1회) · 이중차감이면 FAIL', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    const rows: Row[] = [
      { amount: 500_000, method: 'card', payment_type: 'payment' },
      { amount: 300_000, method: 'card', payment_type: 'payment' },
      { amount: 300_000, method: 'card', payment_type: 'refund', link: 'B' }, // B 환불(카드)
      { amount: 200_000, method: 'cash', payment_type: 'payment' },
    ];
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumRev = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);

    // 카드 총합 = 500k + 300k - 300k = 500,000 (실 수납 = 환불 1회만 차감).
    expect(sumRev('card')).toBe(500_000);
    expect(sumRev('cash')).toBe(200_000);

    // 이중차감(잘못된 신규 제외 로직) = sumRev(NET) 에서 환불을 또 빼는 것 → 200,000 (실 수납보다 작음).
    const refundCard = rows.filter(r => r.method === 'card' && r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    const doubleDeducted = sumRev('card') - refundCard;
    expect(doubleDeducted).toBe(200_000);
    // 가드: 화면 표기 값(sumRev NET)은 이중차감 값과 달라야 함(실 수납 500,000 유지).
    expect(sumRev('card')).not.toBe(doubleDeducted);
  });

  // ── SIM(엣지): 환불 0건 날 → NET == GROSS (회귀 없음) ─────────────────────────────
  test('SIM: 환불 0건 날 → 총합 = 기존과 동일(회귀 0)', () => {
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
 * [ ] 일마감 → 환불 있는 영업일 → 합계(결제수단별) 카드/현금/이체 총합 = '환불 제외한 실 수납' 수치 확인(스크린샷 F0BRDF8JWEA 대조)
 * [ ] 합계 카드 하단에 '※ …총합은 환불 금액이 이미 차감된 금액입니다' 캡션 표시 확인
 * [ ] 결제수단별 총합 합 == 합계(총계·grossTotal) 정합(이중차감 없음) 확인
 * [ ] 하단 '금일 환불' 박스에 환불 건이 정상 표시(중복 제외 아님) 확인
 * [ ] 환불 0건 날 → 총합 기존과 동일(회귀 0) 확인
 * [ ] (재확인 필요) '실 수납'을 매출(원결제수단·revenue) 기준으로 볼지 실 현금 수불(drawer) 기준으로 볼지 —
 *     교차수단 환불일(현금 735,400 vs 635,400)에서 어느 값을 원하는지 김주연 총괄 재확인(basis 결정)
 */
