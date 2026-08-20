/**
 * E2E spec — T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL
 * 김주연 총괄 / 풋센터 (C0ATE5P6JTH, thread 1787189374.436629) / 2026-08-20
 *
 * 일마감 > 합계(결제수단별) 화면 2건 수정:
 *   (part1) 환불을 '합계(결제수단별)' 박스에서 제거 → 별도 '환불 내역' 박스로 분리.
 *           별도 박스는 결제수단별(카드/현금/이체) 환불 건수+금액 + 총 -합계(음수) 표기.
 *   (part2) 결제수단별 총합계 = 당일 취소(=당일 환불행)를 제외한 실결제 = NET(환불 차감) 표기.
 *
 * ★설계 요약(구현 근거):
 *   - '합계(결제수단별)' 박스 행: GROSS(totalCardGross 등) → NET(totals.totalCard/Cash/Transfer) 전환.
 *     NET = 실제정산(ReconRow)·마감 저장(daily_closings)·print '합계(멤버십제외,환불차감)' 행과 동일 SSOT.
 *     → 당일 취소(당일 환불)가 method 축에서 이미 1회 차감돼 '실 결제내역만' 집계(reporter 요청2, AC-2).
 *   - 인라인 '환불' 차감행 제거 → '환불 내역' 박스(closing-refund-by-method)로 분리(reporter 요청1, AC-1).
 *   - 결제수단별 환불 = 환불행을 method(=Axis-A 원결제 승계 canonical bucket, REFUND-CROSSMETHOD-FWDFIX)로
 *     partition. 총합(카드+현금+이체+기타) ≡ refundAmount(SSOT) — silent-drop 방지(기타수단 잔여 가드).
 *   - ★이중 제외 없음(AC-2): 총합은 NET 로 환불 1회만 차감. 환불 박스는 표시(정보)용 — 총합 추가 차감 안 함.
 *   - grossTotal(마감 payload 권위총액)·canonical 산식 무변경(순수 표시축 재배치) → DA CONSULT 불요·db_change=false.
 *
 * ★part1 시퀀싱(GO_WARN gate#1): 결제수단별 환불 집계 축 = REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX
 *   (da_decision_foot_refund_crossmethod_method_inherit_fwdfix_20260819) 확정 Axis-A(method=원결제 승계)와 정합.
 *   forward 환불행=method 승계(정합) / 4 historical 교차수단행=현행 method 유지(김주연 총괄 GENUINE 결정, 소급 미접촉).
 *   동일 refund 행 집합(refundSingleAmount/refundPkgAmount SSOT)을 partition — 신규 산식 0(§13.1.C 이중 authoring 금지).
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 + 앱 로드(HTTP 200) + 회귀 가드.
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

test.describe('T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 환불 별도 박스(결제수단별 건수+금액 + 총 -합계) ─────────────────────
  test('AC-1: 환불 내역 별도 박스 — 결제수단별(카드/현금/이체) 건수+금액 표기', () => {
    const c = closing();
    // 결제수단별 환불 breakdown 블록 존재.
    expect(c).toContain('data-testid="closing-refund-by-method"');
    expect(c).toContain('카드 환불');
    expect(c).toContain('현금 환불');
    expect(c).toContain('이체 환불');
    // 결제수단별 환불 총 -합계(음수) 표기.
    expect(c).toContain('data-testid="closing-refund-by-method-total"');
  });

  test('AC-1: 결제수단별 환불 수치 = totals 재사용(신규 산식 0)', () => {
    const c = closing();
    // 결제수단별 환불 금액/건수는 totals SSOT 필드를 그대로 표시.
    expect(c).toContain('totals.refundCardAmount');
    expect(c).toContain('totals.refundCashAmount');
    expect(c).toContain('totals.refundTransferAmount');
    expect(c).toContain('totals.refundCardCount');
    expect(c).toContain('totals.refundCashCount');
    expect(c).toContain('totals.refundTransferCount');
    // 총 합계는 확정 SSOT(refundAmount / totalRefundCount).
    expect(c).toContain('totals.refundAmount');
    expect(c).toContain('totals.totalRefundCount');
  });

  test('AC-1: 결제수단별 환불 집계 = 환불행 method partition(Axis-A) — 동일 refund 집합 재사용', () => {
    const c = closing();
    // refundMethodAmount/Count = payment_type==='refund' 행을 method 로 partition.
    expect(c).toContain('const refundMethodAmount');
    expect(c).toContain('const refundMethodCount');
    expect(c).toMatch(/payment_type === 'refund' && r\.method === method/);
    // silent-drop 방지: 카드/현금/이체 외 잔여(기타수단) 가드 — 총합=refundAmount 정합.
    expect(c).toContain('refundOtherAmount');
    expect(c).toContain('refundOtherCount');
    // Axis-A 축(FWDFIX) 명시 주석.
    expect(c).toContain('REFUND-CROSSMETHOD');
  });

  // ── AC-2: 결제수단별 실결제 = NET(당일 취소 제외) & 인라인 환불행 제거 ────────
  //   ★ SUPERSEDE(T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET, DA CONDITIONAL-GO):
  //     합계 박스 표시축이 plain-NET → revenue-basis NET(…Rev, 교차수단 환불 원결제 method 재귀속)로 승격.
  //     AC-2 원의도(GROSS 아님 · 인라인 환불 이중차감 없음)는 유효 — …Rev 는 여전히 NET(환불 차감) 값이다.
  test('AC-2: 합계(결제수단별) 박스 = revenue-basis NET(…Rev) — GROSS/이중차감 아님', () => {
    const c = closing();
    // 합계 카드 행이 revenue-basis NET(…Rev) 값을 표시 — GROSS 인라인 아님.
    expect(c).toContain('totals.totalCardRev, totals.totalCardCount');
    expect(c).toContain('totals.totalCashRev, totals.totalCashCount');
    expect(c).toContain('totals.totalTransferRev, totals.totalTransferCount');
    // 인라인 GROSS 행 미사용(합계 박스 rows 에서 totalCardGross 등 제거).
    expect(c).not.toContain("['카드 총합', totals.totalCardGross");
    expect(c).not.toContain("['현금 총합', totals.totalCashGross");
    expect(c).not.toContain("['이체 총합', totals.totalTransferGross");
  });

  test('AC-2: 합계(결제수단별) 박스에서 인라인 환불행 제거(이중 제외 없음)', () => {
    const c = closing();
    // 인라인 '환불' 차감행이 합계 박스 rows 에서 제거됨(별도 박스로 분리).
    expect(c).not.toContain("['환불', -totals.refundAmount, totals.totalRefundCount]");
    // 이중 제외 방지 근거 주석 명시.
    expect(c).toContain('이중 제외');
  });

  // ── AC-4 / 회귀: grossTotal(마감 권위총액) 산식 무변경 ─────────────────────────
  test('AC-4 회귀: grossTotal·NET 산식 무변경 — 마감 payload/정산 SSOT 보존', () => {
    const c = closing();
    // NET 차감 산식 보존.
    expect(c).toContain("r.payment_type === 'refund' ? -r.amount : r.amount");
    // grossTotal 정의 보존(마감 저장/전령 권위총액) — 표시축 변경이 총액 산식을 건드리지 않음.
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    // 합계 박스 total prop = grossTotal(불변).
    expect(c).toContain('total={totals.grossTotal}');
    // 실제 정산(ReconRow) 시스템값 = NET(totalCard/Cash/Transfer) 그대로.
    expect(c).toContain('system={totals.totalCard}');
    expect(c).toContain('system={totals.totalCash}');
    expect(c).toContain('system={totals.totalTransfer}');
  });

  // ── AC-3: 엣지(환불 0건) — 박스 유지 ─────────────────────────────────────────
  test('AC-3: 환불 0건에도 결제수단별 환불 박스는 상시 렌더(카드/현금/이체 3행 고정)', () => {
    const c = closing();
    // 카드/현금/이체 3행은 조건부가 아니라 상시 배열 — 0건도 '0건 ₩0' 표기.
    const idx = c.indexOf('data-testid="closing-refund-by-method"');
    expect(idx).toBeGreaterThan(-1);
    const block = c.slice(idx, idx + 1400);
    expect(block).toContain('카드 환불');
    expect(block).toContain('현금 환불');
    expect(block).toContain('이체 환불');
    // 금일 환불 카드 자체도 0건 렌더 보존(기존 REFUND-STATS-MISSING).
    expect(c).toContain('data-testid="closing-refund-empty"');
  });

  // ── db_change=false 근거: 표시 전용, 신규 DDL/쿼리 없음 ──────────────────────
  test('db_change=false: 결제수단별 환불 집계가 신규 supabase from/rpc 를 도입하지 않음', () => {
    const c = closing();
    const idx = c.indexOf('결제수단별 환불 집계');
    expect(idx).toBeGreaterThan(-1);
    // 집계 블록(refundMethodAmount 정의 인접)에 신규 supabase 호출 없음 — 로드된 payments/pkgPayments 재사용.
    const block = c.slice(idx, idx + 900);
    expect(block).not.toContain('supabase.from(');
    expect(block).not.toContain('.rpc(');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — done 판정 근거):
 *
 * [시나리오1] 정상 동선
 *   1. 로그인 → 일마감(/admin/closing) 진입 → 날짜=검증일
 *   2. 요약(summary) 탭 → '합계 (결제수단별)' 박스 확인:
 *      - 카드/현금/이체 총합이 환불 차감된 NET(실 결제)로 표기(당일 취소/환불 제외).
 *      - 박스 안에 '환불' 차감행이 더 이상 없음(별도 박스로 이동).
 *   3. '금일 환불' 박스(별도) 확인:
 *      - 상단에 결제수단별 환불: '카드 환불 N건 -X원 / 현금 환불 N건 -X원 / 이체 환불 N건 -X원'
 *      - 하단 '합계 -X,XXX,XXX' (음수) 표기 = 총 환불액.
 *   Expected: 합계(결제수단별) 박스 카드/현금/이체 총합 + (환불 박스 합계) = 취소 전 GROSS 와 정합.
 *     즉 실결제 NET = GROSS − 환불(당일 취소 포함). 환불이 총합에서 정확히 1회만 차감(이중 제외 없음).
 *
 * [시나리오2] 엣지 케이스
 *   a. 환불 0건인 날 → '환불 내역' 박스는 카드/현금/이체 각 '0건 ₩0', 합계 ₩0 로 유지(박스 자체 유지).
 *   b. 당일 결제+당일 취소(환불) 건 → 해당 결제수단 실결제 총합에서 빠지고(NET), 환불 박스에 결제수단별로 1회 표기.
 *      → 총합(합계 박스)에서 이중 제외되지 않음(NET 1회 차감).
 *   c. 교차수단 환불(historical 4행, 김주연 총괄 GENUINE 현행유지) → 환불 박스에 저장 method 축으로 표기
 *      (forward 환불행은 원결제 method 승계로 정합). REFUND-CROSSMETHOD-FWDFIX 와 동일 축.
 *
 * 비고(NO-DDL, db_change=false): 표시축 재배치만 — 기존 react-query 결과(payments/package_payments/manual)와
 *   totals SSOT(refundAmount·totalRefundCount·refundSingle/PkgAmount·totalCard/Cash/Transfer) + 신규 파생
 *   (refundCard/Cash/Transfer Amount·Count = 환불행 method partition)만 사용. 신규 컬럼/테이블/enum/CHECK/RLS/RPC/쿼리 = 0.
 *   grossTotal(마감 payload 권위총액)·canonical 매출 산식 무접촉 → DA CONSULT 불요.
 */
