/**
 * E2E spec — T-20260820-foot-CLOSING-CASHSUM-SINGLELINE-DRAWERHIDE
 * 부모: T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET (8a70dde8·deployed·field_soak)
 * 부모 DA: da_decision_foot_closing_cashsum_revenue_basis_rebucket_20260820 (Q2 envelope 내 field-switch)
 * 김주연 총괄 / 풋센터 (U0ATDB587PV) / 2026-08-20
 *
 * 부모는 dual-axis(revenue 매출 행 + 'ㄴ …시재(실지급)' drawer 보조 행 병존)로 착지했으나,
 * Q2 field-confirm 이 (B)로 해소: "매출 확인용으로만 봅니다 → 현금 매출 735,400 단일 표시"
 * (drawer 실사(reconciliation) 용도 불사용 확정).
 *   → 마감 합계(결제수단별) 카드에서 drawer 보조 줄('ㄴ …시재(실지급)')을 화면에서 제거하고
 *     수단별 revenue(…Rev) 단일 라인만 표시.
 *
 * ★ DISPLAY-ONLY (부모 Q3 HARD BOUNDARY 절대 준수):
 *   daily_closings persist(single_cash_total 등)·outbox payload totals{}·일일감사 A6·정산 대사(totalCash=cashDiff)
 *   = drawer grain(net 저장 method, cash 635,400) 그대로 무접촉·불변. revenue projection 무유입. db_change=false.
 *   부모 impl(8a70dde8) revert 아님 — …Rev 소계·conservation(INV5)·linkage 조회 전부 유지, 화면 라인만 축약.
 *   honest fallback(revUnverifiedCount / closing-rev-unverified-note) 유지.
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 가드 + 앱 로드(HTTP 200) + conservation 자립 시뮬레이션.
 *   실브라우저 수치 정합(08-18 현금 총합 735,400 단일 라인)은 하단 갤탭 실기기 현장 confirm 체크리스트(done 판정 근거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

// '합계 (결제수단별)' SummaryCard rows={[...]} 블록만 절취(다른 카드/프린트 영향 배제).
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

test.describe('T-20260820-foot-CLOSING-CASHSUM-SINGLELINE-DRAWERHIDE', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: drawer 보조 줄('ㄴ …시재(실지급)') 화면 제거 ──────────────────────────
  test('AC-1: 합계 카드 rows 에 시재(실지급) drawer 보조 줄 0건', () => {
    const block = summaryRowsBlock();
    expect(block).not.toContain('시재 (실지급)');
    expect(block).not.toContain('ㄴ 현금 시재');
    expect(block).not.toContain('ㄴ 카드 시재');
    expect(block).not.toContain('ㄴ 이체 시재');
    // drawer net 을 표시행 값으로 쓰는 spread 조건행도 제거(단일 라인화).
    expect(block).not.toMatch(/\[\s*['"]ㄴ[^\]]*totals\.totalCash\b/);
  });

  // ── AC-2: 수단별 단일 라인 유지 (표시축은 하위 티켓서 재전환) ───────────────────
  //   ★ SUPERSEDED by T-20260820-foot-CLOSING-METHODTOTAL-REFUND-EXCLUDE:
  //     per-method 값 …Rev(NET) → …Gross(정상수납·환불 제외)로 재전환. '단일 라인(수단당 1행)' 회귀 가드는 유효 유지.
  test('AC-2: 카드/현금/이체 = 정상수납 소계(…Gross) 단일 라인 표시', () => {
    const block = summaryRowsBlock();
    expect(block).toContain('totals.totalCardGross, totals.totalCardCount');
    expect(block).toContain('totals.totalCashGross, totals.totalCashCount');
    expect(block).toContain('totals.totalTransferGross, totals.totalTransferCount');
    // 각 수단당 표시행 정확히 1개(중복/보조행 없음).
    expect((block.match(/totals\.totalCashGross, totals\.totalCashCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalCardGross, totals\.totalCardCount/g) || []).length).toBe(1);
    expect((block.match(/totals\.totalTransferGross, totals\.totalTransferCount/g) || []).length).toBe(1);
  });

  // ── AC-3: DISPLAY-ONLY — drawer grain(persist/payload/A6/정산) 무접촉 ──────────
  test('AC-3: daily_closings persist·정산 대사·grossTotal = drawer net 불변(projection 무유입)', () => {
    const c = closing();
    // persist = net singleCash/pkgCash (revenue projection 무접촉).
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('package_cash_total: totals.pkgCash');
    const payloadIdx = c.indexOf('single_cash_total: totals.singleCash');
    const payloadBlock = c.slice(payloadIdx - 400, payloadIdx + 400);
    expect(payloadBlock).not.toContain('Rev');
    // 정산 대사(ReconRow) 시스템값 = net(drawer) / grossTotal = net 합.
    expect(c).toContain('system={totals.totalCash}');
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    expect(c).toContain('total={totals.grossTotal}');
  });

  // ── AC-4: 부모 impl(revenue-basis 재버킷·linkage·conservation) 유지(revert 아님) ──
  test('AC-4: sumRev/…Rev 소계 + linkage 조회 + conservation 주석 유지', () => {
    const c = closing();
    expect(c).toContain('const sumRev');
    expect(c).toContain('const totalCashRev');
    expect(c).toContain('origMethodMap');
    expect(c).toContain('revBucketOfPayment');
    expect(c).toMatch(/totalCardRev\+CashRev\+TransferRev\s*≡/);
  });

  // ── AC-5: honest fallback(anti-fabrication) 유지 ─────────────────────────────
  test('AC-5: revUnverifiedCount / closing-rev-unverified-note honest fallback 유지', () => {
    const c = closing();
    expect(c).toContain('revUnverifiedCount');
    expect(c).toContain('closing-rev-unverified-note');
    expect(c).toMatch(/unresolved:\s*true/);
  });

  // ── SIM: INV5 conservation 무회귀(Σ4버킷==total) — 재버킷 로직 불변 확인 ────────
  test('SIM: 교차수단 환불 재귀속 → 현금 revenue 735,400 / Σ(rev) ≡ Σ(net) 불변', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    const rows: Row[] = [
      { id: 'cash1', amount: 500_000, method: 'cash', payment_type: 'payment' },
      { id: 'cash2', amount: 235_400, method: 'cash', payment_type: 'payment' },
      { id: 'card1', amount: 100_000, method: 'card', payment_type: 'payment' },
      { id: 'ref1', amount: 100_000, method: 'cash', payment_type: 'refund', link: 'card1' }, // 교차수단 현금환불
    ];
    const origMethod = new Map<string, string>(rows.map(r => [r.id, r.method]));
    const revBucket = (r: Row) => {
      if (r.payment_type !== 'refund') return r.method;
      const om = r.link ? origMethod.get(r.link) : undefined;
      return om ?? r.method;
    };
    const signed = (r: Row) => (r.payment_type === 'refund' ? -r.amount : r.amount);
    const sumNet = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + signed(r), 0);
    const sumRev = (m: string) => rows.filter(r => revBucket(r) === m).reduce((s, r) => s + signed(r), 0);

    // 단일 라인이 보여주는 값 = revenue(…Rev): 현금 735,400.
    expect(sumRev('cash')).toBe(735_400);
    expect(sumRev('card')).toBe(0);
    // drawer grain(persist/정산)은 여전히 net 635,400 (화면에서만 숨김, 값 자체는 무접촉).
    expect(sumNet('cash')).toBe(635_400);
    // INV5 conservation: Σ(rev) ≡ Σ(net) — 단일 라인화가 Σ 를 깨지 않음.
    expect(sumRev('cash') + sumRev('card') + sumRev('transfer'))
      .toBe(sumNet('cash') + sumNet('card') + sumNet('transfer'));
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거) ─────────────────────────
 * [ ] 일마감 화면 → 08-18(이금득 교차수단 환불일) → 합계(결제수단별) '현금 총합 (매출)' = 735,400 단일 라인 확인
 * [ ] 같은 카드에 'ㄴ 현금 시재 (실지급)' 보조 줄이 더 이상 표시되지 않음(제거) 확인
 * [ ] 카드/이체 총합도 '시재(실지급)' 보조 줄 없이 단일 라인 표기 확인
 * [ ] 합계(총계) 값 불변 확인(단일 라인화가 총계·Σ 를 바꾸지 않음)
 * [ ] 강력 새로고침(캐시 초기화) 후에도 735,400 단일 라인 유지 확인
 * [ ] 실수령 대사(정산) 현금 '시스템' 값 = 물리 금고(drawer) 635,400 유지 확인(화면 축약과 무관)
 * [ ] 교차수단 환불 없는 일반 마감일 → 현금 총합 단일 표기·기존 값 그대로(회귀 0) 확인
 */
