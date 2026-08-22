/**
 * E2E spec — T-20260822-foot-CLOSING-STAFFREV-REFUND-GROSS-DISPLAY (seed-0 C-1)
 * 요청: 김주연 총괄 / 풋센터 (U0ATDB587PV) / 2026-08-22 09:48 (thread 1787319811.523519)
 *   "실장 매출 환불액 −쳐서 나오잖아" = 일마감 '담당자별 매출'에서 환불이 하나의 net 숫자에
 *    −로 collapse 되어 '정상수납'이 얼마였는지가 안 보임 → 정상수납(GROSS) + 환불(별도라인) 표시 분해.
 *
 * DA: da_decision_foot_closing_staff_revenue_refund_basis_gross_20260822.md (CONDITIONAL-GO)
 *   · DISPLAY-decomposition 한정 — NET = GROSS − 환불 = 표시층 재배치이지 산식 재정의 아님.
 *   · NET-canonical 봉투(payments net·MGRSTAT·ARPU §9·payload·daily_closings·A6) 무접촉(REAFFIRM).
 *   · [Q2] 환불 귀속축 = 원결제 attributed_staff_id 스냅샷(linkage: 단건 linked_payment_id /
 *     패키지 parent_payment_id → 원결제행 staff). ★HARD REJECT: 처리자(created_by·processor_name)·
 *     registrar 귀속 / refund-time live-inversion. NULL-linkage(고아환불) → honest fallback(합성 금지).
 *   · [Q3] change-class = ADDITIVE display re-layout · db_change=false.
 *
 * ★선행 census 실측(scripts/T-20260822-foot-CLOSING-STAFFREV-REFUND-GROSS_census.mjs · 8월·jongno-foot):
 *   환불 67건 · linkage 11 / NULL-linkage 56 · 현행 live-assigned 축 vs DA 원결제-linkage 축 = 이동 0건
 *   (전건 동일 bucket) → 귀속 배선은 현재 데이터상 no-op(NET 봉투 byte-불변·conservation 유지)이나
 *   linkage 명시로 향후 재배정 inversion 차단. (refund·원결제 = 동일 고객 → 동일 배정담당 = delta 0.)
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 순수 fs-grep 정적 소스 가드 + 분해/귀속/conservation 자립 시뮬레이션.
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

// staffTotals useMemo 본문만 절취(정의 → 다음 useMemo 전까지).
const staffTotalsBlock = () => {
  const c = closing();
  const idx = c.indexOf('const staffTotals = useMemo<');
  expect(idx).toBeGreaterThan(-1);
  const end = c.indexOf('}, [enrichedRows]);', idx);
  expect(end).toBeGreaterThan(idx);
  return c.slice(idx, end);
};

// '담당자별 매출' 렌더 테이블 블록 절취.
const staffRevTableBlock = () => {
  const c = closing();
  const idx = c.indexOf('<CardTitle className="text-sm">담당자별 매출</CardTitle>');
  expect(idx).toBeGreaterThan(-1);
  const end = c.indexOf('</Card>', idx);
  expect(end).toBeGreaterThan(idx);
  return c.slice(idx, end);
};

test.describe('T-20260822-foot-CLOSING-STAFFREV-REFUND-GROSS-DISPLAY', () => {

  // ── AC-1: staffTotals 가 gross/refund/net 3성분으로 분해(단일 net collapse 제거) ──
  test('AC-1: staffTotals shape = { gross, refund, net } 분해 (구 total collapse 제거)', () => {
    const c = closing();
    // 새 shape 타입 시그니처.
    expect(c).toContain('gross: number; refund: number; net: number');
    const block = staffTotalsBlock();
    // gross = 비환불 amount 누적 / refund = 환불 magnitude(양수) 누적 / net = gross − refund.
    expect(block).toContain('existing.gross += r.amount');
    expect(block).toContain('existing.refund += r.amount');
    expect(block).toContain('existing.net = existing.gross - existing.refund');
    // 구 collapse 산식(net 한 컬럼으로 뭉침) 부재 — 회귀 가드.
    expect(block).not.toContain("const amt = r.payment_type === 'refund' ? -r.amount : r.amount");
    expect(block).not.toContain('existing.total += amt');
  });

  // ── AC-2: 환불 귀속 = 원결제(linkage) · 처리자/registrar/live-inversion 아님 ──
  test('AC-2: 환불행 귀속 = 원결제 staff(linkage linked/parent_payment_id) · 고아환불=honest fallback', () => {
    const block = staffTotalsBlock();
    // 원결제행(비환불) staff 색인 → 환불행이 그 색인으로 귀속 resolve.
    expect(block).toContain('origStaffByPayId');
    expect(block).toContain('origStaffByPkgId');
    expect(block).toContain('r.linked_payment_id');
    expect(block).toContain('r.parent_payment_id');
    // 고아환불(원결제 미로드) → refund 자체 staff_name honest fallback(합성 아님·동일 고객 배정담당).
    expect(block).toContain('origStaff ?? r.staff_name');
    // ★HARD REJECT: 환불 귀속에 처리자(created_by/processor_name)/registrar 축 미사용.
    expect(block).not.toContain('processor_name');
    expect(block).not.toContain('created_by');
    expect(block).not.toContain('registrar');
  });

  // ── AC-3: 렌더 = '정상수납' ⊥ '환불' ⊥ '순매출' distinct 라벨(split-dialect 금지) ──
  test('AC-3: 담당자별 매출 테이블 = 정상수납/환불/순매출 distinct 컬럼 라벨', () => {
    const block = staffRevTableBlock();
    expect(block).toContain('>정상수납<');
    expect(block).toContain('>환불<');
    expect(block).toContain('>순매출<');
    // 단일 ambiguous '합계'(gross/net 두 뜻 동시) 표시행 헤더 부재 — 구 라벨 회귀 가드.
    expect(block).not.toContain('>합계</th>');
    // 환불 라인 = 음수 시각(빨강) 표기.
    expect(block).toContain('text-rose-600');
    expect(block).toContain('`-${formatAmount(refund)}`');
  });

  // ── AC-4: DISPLAY-only — daily_closings persist / payload / net 봉투 무접촉 ──
  test('AC-4: NET-canonical 봉투(persist/payload) 무접촉 · db_change=false', () => {
    const c = closing();
    // daily_closings persist payload = 기존 drawer/net 필드 그대로(신규 basis 유입 없음).
    expect(c).toContain('single_cash_total: totals.singleCash');
    expect(c).toContain('package_card_total: totals.pkgCard');
    // staffTotals 는 표시 파생값 — persist payload 에 gross/refund 신규 컬럼 유입 없음.
    expect(c).not.toContain('staff_gross_total');
    expect(c).not.toContain('staff_refund_total');
  });

  // ── SIM-1: 재배정 없는 실장 → gross/refund 분해 · net == 旣 collapse 값(conservation) ──
  test('SIM-1: 정상수납/환불 분해 후 net = gross − refund == 구 net(합계) 회귀 0', () => {
    type Row = { amount: number; method: string; payment_type: 'payment' | 'refund' };
    // 실장 A 하루: 카드 500k + 현금 200k 정상수납 · 카드 100k 환불.
    const rows: Row[] = [
      { amount: 500_000, method: 'card', payment_type: 'payment' },
      { amount: 200_000, method: 'cash', payment_type: 'payment' },
      { amount: 100_000, method: 'card', payment_type: 'refund' },
    ];
    let gross = 0, refund = 0, card = 0, cash = 0;
    for (const r of rows) {
      if (r.payment_type === 'refund') { refund += r.amount; continue; }
      gross += r.amount;
      if (r.method === 'card' || r.method === 'membership') card += r.amount;
      else if (r.method === 'cash') cash += r.amount;
    }
    const net = gross - refund;
    // 구 collapse net(=Σ signed).
    const oldNet = rows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    expect(gross).toBe(700_000);      // 정상수납 = 환불 무영향
    expect(refund).toBe(100_000);     // 환불 별도(양수 magnitude)
    expect(net).toBe(600_000);        // 순매출 = 정상수납 − 환불
    expect(net).toBe(oldNet);         // ★conservation: 旣 표시값과 byte-동일
    // 방식별 소계 = 정상수납(gross) basis(환불 미포함).
    expect(card).toBe(500_000);
    expect(cash).toBe(200_000);
  });

  // ── SIM-2: 환불 귀속 = 원결제 실장(linkage) · 처리자 재배정 무관(inversion 방지) ──
  test('SIM-2: 실장A 판매 → 실장B 환불처리 → 환불은 원결제 실장A 에 귀속(B 아님)', () => {
    // 원결제행(실장 A). 환불행은 원결제 linkage 로 A 에 귀속돼야 함(처리자 B 귀속 금지).
    type Orig = { payment_id: string; staff_name: string; payment_type: 'payment' };
    type Refund = { linked_payment_id: string; processor_name: string; amount: number; payment_type: 'refund' };
    const orig: Orig = { payment_id: 'p1', staff_name: '실장A', payment_type: 'payment' };
    const refund: Refund = { linked_payment_id: 'p1', processor_name: '실장B', amount: 50_000, payment_type: 'refund' };

    const origStaffByPayId = new Map<string, string>([[orig.payment_id, orig.staff_name]]);
    // 코드 규칙: 환불 귀속 = origStaffByPayId.get(linked_payment_id) ?? honest fallback.
    const refundStaff = origStaffByPayId.get(refund.linked_payment_id) ?? '미지정';
    expect(refundStaff).toBe('실장A');       // 원결제 실장
    expect(refundStaff).not.toBe(refund.processor_name); // ★처리자(B) 귀속 아님
  });

  // ── SIM-3: 고아환불(원결제 미로드) → honest fallback(refund 자체 staff_name·합성 금지) ──
  test('SIM-3: 원결제 당일 미로드 고아환불 → refund staff_name fallback(미상 합성 아님)', () => {
    const origStaffByPayId = new Map<string, string>(); // 원결제 로드셋에 없음(cross-day 고아).
    const refund = { linked_payment_id: 'p-past', staff_name: '실장C' }; // refund·원결제 동일 고객 배정담당.
    const refundStaff = origStaffByPayId.get(refund.linked_payment_id) ?? refund.staff_name ?? '미지정';
    expect(refundStaff).toBe('실장C'); // honest fallback = 실재 스냅샷(합성/미상 발명 아님)
  });

  // ── SIM-4: 환불 0건 날 → 정상수납 == 순매출 (회귀 0) ──
  test('SIM-4: 환불 0건 → gross == net (회귀 0)', () => {
    const rows = [
      { amount: 400_000, payment_type: 'payment' as const },
      { amount: 100_000, payment_type: 'payment' as const },
    ];
    let gross = 0, refund = 0;
    for (const r of rows) { if (r.payment_type === 'refund') refund += r.amount; else gross += r.amount; }
    expect(refund).toBe(0);
    expect(gross - refund).toBe(gross);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (done 판정 근거 · 김주연 총괄 U0ATDB587PV) ─────
 * [ ] 일마감 → 환불 있는 영업일 → '담당자별 매출'에 정상수납 / 환불 / 순매출 3컬럼이 분리 표시되는지 확인
 * [ ] 실장별 정상수납(정상 수납 총액)이 환불에 −먹지 않고 그대로 보이는지 확인(요청 핵심)
 * [ ] 환불 컬럼이 빨강 −금액으로 별도 표기되고, 순매출 = 정상수납 − 환불 관계가 맞는지 확인
 * [ ] 실장별 순매출 합계가 종전 '합계'(net)와 동일한지(회귀 0) 확인
 * [ ] 판매 실장과 환불 처리 실장이 다른 케이스에서, 환불이 '판매(원결제) 실장'에 붙는지 확인(처리자 아님)
 */
