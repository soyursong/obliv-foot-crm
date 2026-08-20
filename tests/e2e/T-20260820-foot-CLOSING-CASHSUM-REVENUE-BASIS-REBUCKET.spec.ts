/**
 * E2E spec — T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET
 * DA: da_decision_foot_closing_cashsum_revenue_basis_rebucket_20260820 (CONDITIONAL-GO·coherence-extension)
 * 김주연 총괄 / 풋센터 (U0ATDB587PV, ts 1787189112, 08-18 정답=735,400) / 2026-08-20
 *
 * 일마감 > 합계(결제수단별): 결제수단별 총합을 revenue-basis(원결제수단 기준)로 표시.
 *   교차수단 환불(원결제 method ≠ 환불 실지급 method)을 원결제 method 버킷으로 재귀속(display-only projection).
 *
 * ★ DA HARD 준수 (code-gate 오라클):
 *   Q1 전-수단 rebucket(conservation·INV5): …Rev 3소계 합 ≡ net 3소계 합 (버킷 간 이동일 뿐 Σ 불변).
 *      cash-only(cash만 올리고 card 미변경)=HARD REJECT.
 *   Q2 dual-axis: revenue(매출) primary + revenue≠drawer 수단은 '시재(실지급)' distinct 라벨 병존(drawer 표면 보존).
 *   Q3 DISPLAY-ONLY: daily_closings persist(single_cash_total=singleCash)·정산 대사(totalCash)·payload·A6 = drawer net 불변.
 *   Q4 read-source = payment-linkage(원결제 charge.method) UNIFORM(cutover-safe). pre-B-1 저장 refund.method 신뢰 0.
 *      NULL/미해결 linkage → anti-fabrication honest fallback(저장 method 유지·합성 0·미verify 노출).
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 가드 + 앱 로드(HTTP 200) + 재귀속/해결 로직 자립 시뮬레이션.
 *   실브라우저 수치 정합(08-18 현금 총합 735,400)은 하단 갤탭 실기기 현장 confirm 체크리스트(done 판정 근거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── Q1: revenue-basis 소계(sumRev) + conservation 산식 ──────────────────────
  test('Q1: revenue-basis 소계(…Rev) + sumRev + conservation 주석', () => {
    const c = closing();
    expect(c).toContain('const sumRev');
    expect(c).toContain('const totalCardRev');
    expect(c).toContain('const totalCashRev');
    expect(c).toContain('const totalTransferRev');
    // conservation 불변식 명시(Q1·INV5).
    expect(c).toMatch(/totalCardRev\+CashRev\+TransferRev\s*≡/);
  });

  // ── Q2: [SUPERSEDED by T-20260820-foot-CLOSING-CASHSUM-SINGLELINE-DRAWERHIDE] ──
  //   부모 dual-axis(시재 실지급 보조행 병존)는 Q2 field-confirm (B)로 단일 라인으로 축약됨.
  //   drawer 보조 줄 제거 → revenue(…Rev) 단일 라인만. 상세 assert = SINGLELINE-DRAWERHIDE.spec.ts.
  //   본 테스트는 revenue 단일 라인 유지 + drawer 보조 줄 부재만 회귀 가드로 남긴다.
  test('Q2(superseded→single-line): 합계 카드 = revenue(…Rev) 단일 라인 + 시재(실지급) 보조행 부재', () => {
    const c = closing();
    // revenue 소계를 표시행으로 사용(유지).
    expect(c).toContain('totals.totalCardRev, totals.totalCardCount');
    expect(c).toContain('totals.totalCashRev, totals.totalCashCount');
    expect(c).toContain('totals.totalTransferRev, totals.totalTransferCount');
    // drawer(시재) 보조행 = field-confirm (B)로 제거됨.
    expect(c).not.toContain('시재 (실지급)');
  });

  // ── Q3: DISPLAY-ONLY — net(정산/DB/payload/print) 축 불변 ─────────────────────
  test('Q3: 정산 대사·DB 저장·grossTotal 은 drawer net 불변(projection 무유입)', () => {
    const c = closing();
    expect(c).toContain('const totalCard     = pkgCard + singleCard + manualCard;');
    expect(c).toContain('const totalCash     = pkgCash + singleCash + manualCash;');
    expect(c).toContain('const totalTransfer = pkgTransfer + singleTransfer + manualTransfer;');
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    expect(c).toContain('total={totals.grossTotal}');
    // 정산(ReconRow) 시스템값 = net(drawer).
    expect(c).toContain('system={totals.totalCash}');
    // daily_closings persist = net singleCash/pkgCash (revenue projection 무접촉).
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('package_cash_total: totals.pkgCash');
    // persist payload 에 …Rev 유입 0 (Q3 HARD BOUNDARY).
    const payloadIdx = c.indexOf('single_cash_total: totals.singleCash');
    const payloadBlock = c.slice(payloadIdx - 400, payloadIdx + 400);
    expect(payloadBlock).not.toContain('Rev');
  });

  // ── Q4: read-source = linkage(원결제 method) UNIFORM + anti-fabrication ────────
  test('Q4: linkage-uniform 해결 헬퍼 + NULL/미해결 honest fallback', () => {
    const c = closing();
    // 날짜무관 linkage 조회(교차일 원결제 포함) + 당일 맵 폴백.
    expect(c).toContain('origMethodMap');
    expect(c).toContain('origMethodOfSingle');
    expect(c).toContain('origMethodOfPkg');
    // 환불 버킷 해결 = 원결제 method(Axis-A), 미해결 시 unresolved 플래그(honest fallback).
    expect(c).toContain('revBucketOfPayment');
    expect(c).toContain('revBucketOfPkg');
    expect(c).toMatch(/unresolved:\s*true/);
    // 미verify 노출(anti-fabrication).
    expect(c).toContain('revUnverifiedCount');
    expect(c).toContain('closing-rev-unverified-note');
  });

  test('Q4: 원결제 method 조회 쿼리 = read-only SELECT(id, method) — write/rpc 0', () => {
    const c = closing();
    const idx = c.indexOf("queryKey: ['closing-refund-orig-method'");
    expect(idx).toBeGreaterThan(-1);
    const block = c.slice(idx, idx + 900);
    // read-only: select id/method 만, insert/update/delete/rpc 0.
    expect(block).toContain(".select('id, method')");
    expect(block).not.toContain('.insert(');
    expect(block).not.toContain('.update(');
    expect(block).not.toContain('.delete(');
    expect(block).not.toContain('.rpc(');
  });

  // ── SIM Q1/Q2: 이금득 08-18 교차수단(같은날) 환불 → 현금 735,400, conservation ──
  test('SIM: 같은날 교차수단 환불 재귀속 → 현금 735,400 / 카드 net / Σ 불변', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    const rows: Row[] = [
      { id: 'cash1', amount: 500_000, method: 'cash', payment_type: 'payment' },
      { id: 'cash2', amount: 235_400, method: 'cash', payment_type: 'payment' }, // 현금 결제 합 735,400
      { id: 'card1', amount: 100_000, method: 'card', payment_type: 'payment' }, // 원결제(card)
      { id: 'ref1', amount: 100_000, method: 'cash', payment_type: 'refund', link: 'card1' }, // 교차수단 현금환불
    ];
    // Closing.tsx 와 동형: 날짜무관 linkage 맵(같은날은 당일 맵과 동일) → 원결제 method 해결.
    const origMethod = new Map<string, string>(rows.map(r => [r.id, r.method]));
    const revBucket = (r: Row) => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const om = r.link ? origMethod.get(r.link) : undefined;
      if (!om) return { bucket: r.method, unresolved: true };
      return { bucket: om, unresolved: false };
    };
    const sumNet = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumRev = (m: string) => rows.filter(r => revBucket(r).bucket === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    expect(sumRev('cash')).toBe(735_400); // Q2 revenue 현금(교차수단 환불 미차감)
    expect(sumRev('card')).toBe(0);        // Q1 card -100k 동시 이동(100k 결제 - 100k 환불)
    expect(sumNet('cash')).toBe(635_400);  // Q3 drawer 물리 금고 불변
    expect(sumNet('card')).toBe(100_000);
    // Q1 conservation: Σ(rev) ≡ Σ(net) — cash-only 금지(net 부풀림 0).
    expect(sumRev('cash') + sumRev('card') + sumRev('transfer'))
      .toBe(sumNet('cash') + sumNet('card') + sumNet('transfer'));
  });

  // ── SIM Q4 cutover-safe: 교차일 환불(원결제 과거일) → linkage 조회로 해결 ───────
  test('SIM: 교차일 환불(원결제 당일 로드 밖) → origMethodMap 조회로 원결제 method 해결', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    // 당일 로드 = 환불행만(원결제는 과거일 → 당일 payments 에 없음).
    const dayRows: Row[] = [
      { id: 'ref1', amount: 1_260_000, method: 'card', payment_type: 'refund', link: 'pkgOrig' }, // 07-28 card 실지급 환불
    ];
    // 당일 맵(원결제 없음) — 폴백만으로는 미해결.
    const dayMap = new Map<string, string>(dayRows.map(r => [r.id, r.method]));
    // origMethodMap(날짜무관 조회) = 원결제 pkgOrig = transfer(07-20).
    const crossMap: Record<string, string> = { pkgOrig: 'transfer' };
    const origMethodOf = (id: string) => crossMap[id] ?? dayMap.get(id);
    const revBucket = (r: Row) => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const om = r.link ? origMethodOf(r.link) : undefined;
      if (!om) return { bucket: r.method, unresolved: true };
      return { bucket: om, unresolved: false };
    };
    // 저장 method=card 이지만 원결제=transfer 로 재귀속(pre-B-1 저장 method 신뢰 0).
    expect(revBucket(dayRows[0]).bucket).toBe('transfer');
    expect(revBucket(dayRows[0]).unresolved).toBe(false);
  });

  // ── SIM Q4 anti-fabrication: NULL-linkage 환불 → 합성 0, honest fallback + 미verify ──
  test('SIM: NULL-linkage 환불 → 원결제 method 합성 0(저장 method 유지) + unresolved 카운트', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    const rows: Row[] = [
      { id: 'cash1', amount: 300_000, method: 'cash', payment_type: 'payment' },
      { id: 'ref1', amount: 50_000, method: 'cash', payment_type: 'refund', link: null }, // NULL linkage
    ];
    const origMethod = new Map<string, string>(rows.map(r => [r.id, r.method]));
    const revBucket = (r: Row) => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const om = r.link ? origMethod.get(r.link) : undefined;
      if (!om) return { bucket: r.method, unresolved: true };
      return { bucket: om, unresolved: false };
    };
    const rb = revBucket(rows[1]);
    expect(rb.bucket).toBe('cash');       // 저장 method 유지(합성 금지)
    expect(rb.unresolved).toBe(true);     // 미verify 노출 대상
    // conservation 유지: 환불이 여전히 한 버킷에 계상됨(Σ 불변).
    const sumRev = (m: string) => rows.filter(r => revBucket(r).bucket === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    expect(sumRev('cash')).toBe(250_000); // 300k - 50k
  });

  // ── 회귀: 교차수단 환불 없는 정상일 → rev ≡ net(시재 행 미표기) ──────────────
  test('회귀: 교차수단 환불 없으면 rev ≡ net (dual-axis 시재 행 없음)', () => {
    type Row = { id: string; amount: number; method: string; payment_type: 'payment' | 'refund'; link?: string | null };
    const rows: Row[] = [
      { id: 'cash1', amount: 300_000, method: 'cash', payment_type: 'payment' },
      { id: 'card1', amount: 200_000, method: 'card', payment_type: 'payment' },
      { id: 'ref1', amount: 50_000, method: 'cash', payment_type: 'refund', link: 'cash1' }, // 동일 method
    ];
    const origMethod = new Map<string, string>(rows.map(r => [r.id, r.method]));
    const revBucket = (r: Row) => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const om = r.link ? origMethod.get(r.link) : undefined;
      if (!om) return { bucket: r.method, unresolved: true };
      return { bucket: om, unresolved: false };
    };
    const sumNet = (m: string) => rows.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumRev = (m: string) => rows.filter(r => revBucket(r).bucket === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    for (const m of ['cash', 'card', 'transfer']) expect(sumRev(m)).toBe(sumNet(m));
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거) ─────────────────────────
 * [ ] 일마감 화면 → 08-18(이금득 교차수단 환불일) → 합계(결제수단별) '현금 총합 (매출)' = 735,400 확인
 * [ ] (SUPERSEDED) 'ㄴ 현금 시재 (실지급)' 병존 → SINGLELINE-DRAWERHIDE 로 제거됨(단일 라인 확인)
 * [ ] 카드 총합(매출)에 원결제 -100k 반영 / 합계(총계) 값 불변 확인
 * [ ] 강력 새로고침(캐시 초기화) 후에도 735,400 유지 확인
 * [ ] 교차수단 환불 없는 일반 마감일 → 현금 총합 단일 표기·기존 값 그대로(회귀 0) 확인
 * [ ] 실수령 대사(정산) 현금 '시스템' 값 = 물리 금고(drawer) 635,400 유지 확인
 */
