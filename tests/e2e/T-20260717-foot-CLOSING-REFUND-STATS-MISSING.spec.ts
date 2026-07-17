/**
 * E2E spec — T-20260717-foot-CLOSING-REFUND-STATS-MISSING (REOPEN — 요구 재구성)
 * 풋센터 총괄(김주연, C0ATE5P6JTH / MSG-20260717-184445-ygx4):
 *   일마감(/admin/closing)에 '금일 환불 별도 집계 섹션' 표시 신설.
 *
 * ★[REOPEN 실제 요구 재구성]
 *   - ❌(오해) "환불이 매출에서 차감되는가?" → 이전 RCA 결론=이미 정상 차감(재검토 불요, 무접촉).
 *   - ✅(실제) 일마감 화면에 오늘 환불 건을 '별도 집계 섹션(건수+총액)'으로 표시(aggregate).
 *   즉 additive 표시 작업 — 차감/합계/담당자별 로직 무변경.
 *
 * ★환불 식별·산식 = 이전 RCA·RECONCILE 확정 소스 재사용(새 산식 발명 금지):
 *   - 단건 환불 = payments(payment_type='refund')  → totals.refundSingleAmount / singleRefundCount
 *   - 패키지 환불 = package_payments(payment_type='refund') → totals.refundPkgAmount / pkgRefundCount
 *   - 총액/건수 = totals.refundAmount / totalRefundCount (기존 SSOT 그대로).
 *   - 목록 = enrichedRows 의 refund 행 파생(refundRows) — 신규 쿼리/산식 0.
 *
 * ★db_change=false (read-only 표시 추가). 신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0.
 * ★divergence 방지: T-20260715 REFUNDROW(원결제행 병합 표기) 되돌리지 않음 — 별도 '요약 섹션' 신설.
 *
 * 검증: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 F-4840(홍미옥 350k) 수치 정합은 하단 갤탭 실기기 현장 confirm 체크리스트.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260717-foot-CLOSING-REFUND-STATS-MISSING — 금일 환불 별도 집계 섹션', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-R1: /admin/closing 에 금일 환불 요약(건수+총액) 별도 표시 ──────────────
  test('AC-R1: 금일 환불 별도 집계 섹션(카드) 존재 — 건수 + 총액', () => {
    const c = closing();
    expect(c).toContain('data-testid="closing-refund-summary-card"');
    expect(c).toContain('금일 환불');
    // 건수 배지 + 총 환불액 표기.
    expect(c).toContain('data-testid="closing-refund-count-badge"');
    expect(c).toContain('data-testid="closing-refund-total-amount"');
    expect(c).toContain('총 환불액');
  });

  test('AC-R1: 최소요건(건수+총액) 및 목록(고객/차트/금액/처리담당) 표시', () => {
    const c = closing();
    // 금일 환불 목록(가능 요건) — 고객/차트번호/금액/담당자/유형/시각.
    expect(c).toContain('data-testid="closing-refund-list"');
    expect(c).toContain('환불액');
    expect(c).toContain('차트번호');
    // 0건 상태에서도 섹션은 렌더(빈 상태 안내).
    expect(c).toContain('data-testid="closing-refund-empty"');
    expect(c).toContain('금일 환불 내역이 없습니다');
  });

  // ── AC-R2 / AC-R4: 수치가 실제 금일 환불과 일치 & RECONCILE/REFUNDROW 정합 ─────
  test('AC-R2/AC-R4: 확정 SSOT(totals.refundAmount·totalRefundCount) 재사용 — 새 산식 0', () => {
    const c = closing();
    // 요약 수치는 기존 totals SSOT 를 그대로 표시(재계산 금지).
    expect(c).toContain('totals.refundAmount');
    expect(c).toContain('totals.totalRefundCount');
    // 유형별 소계도 기존 totals 필드 재사용.
    expect(c).toContain('totals.refundSingleAmount');
    expect(c).toContain('totals.refundPkgAmount');
    expect(c).toContain('totals.singleRefundCount');
    expect(c).toContain('totals.pkgRefundCount');
  });

  test('AC-R4: 환불 목록 소스 = enrichedRows 의 refund 행(신규 쿼리/산식 발명 금지)', () => {
    const c = closing();
    // refundRows 파생은 enrichedRows 를 필터링 — 별도 supabase 쿼리 신설 없음.
    expect(c).toContain('const refundRows');
    expect(c).toMatch(/enrichedRows[\s\S]*?payment_type === 'refund'/);
    // 환불 식별 소스가 확정 계약(payments/package_payments payment_type='refund')과 동일.
    expect(c).toContain("payment_type === 'refund'");
  });

  // ── AC-R3: 기존 매출 합계·차감·담당자별 수치 불변(before/after) ───────────────
  test('AC-R3 회귀: grossTotal(NET 차감) 산식 무변경 — 이미 정상 차감 유지', () => {
    const c = closing();
    // 차감 산식(net = payment - refund)·grossTotal 정의 보존.
    expect(c).toContain("r.payment_type === 'refund' ? -r.amount : r.amount");
    expect(c).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
    // 합계 카드의 기존 환불 차감행(SummaryCard) 보존.
    expect(c).toContain("['환불', -totals.refundAmount, totals.totalRefundCount]");
  });

  test('AC-R3 회귀: 담당자별 매출(staffTotals) 집계 무접촉', () => {
    const c = closing();
    expect(c).toContain('const staffTotals');
    expect(c).toContain('담당자별 매출');
    // 담당자별도 refund 를 -amount 로 차감(기존 로직) 유지.
    expect(c).toContain("const amt = r.payment_type === 'refund' ? -r.amount : r.amount");
  });

  test('AC-R3/divergence 회귀: T-20260715 REFUNDROW(원결제행 병합) 표기 미회귀', () => {
    const c = closing();
    // merged_refund 병합 규칙(목록 표기) 보존 — 되돌리지 않음.
    expect(c).toContain('merged_refund');
    expect(c).toContain('DAYCLOSE-PAYGATE-REFUNDROW');
    // 신설 섹션 코멘트가 병합과 별개(요약 섹션) 임을 명시.
    expect(c).toContain('CLOSING-REFUND-STATS-MISSING');
  });

  // ── db_change=false 근거: 표시 전용, 신규 DDL/쿼리 없음 ──────────────────────
  test('db_change=false: 환불 섹션이 신규 supabase from/rpc 호출을 도입하지 않음', () => {
    const c = closing();
    // refundRows 블록은 enrichedRows 파생만 — 신규 supabase 호출 문자열이 이 블록에 없음.
    const marker = 'CLOSING-REFUND-STATS-MISSING: 금일 환불 별도 집계';
    const idx = c.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const block = c.slice(idx, idx + 900);
    expect(block).not.toContain('supabase.from(');
    expect(block).not.toContain('.rpc(');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — done 판정 근거):
 *
 * [시나리오1] 금일 환불 요약 표시 — 정상 동선
 *   1. 로그인 → 일마감(/admin/closing) 진입 → 날짜=오늘(2026-07-17)
 *   2. 요약(summary) 탭 → 매출 요약(패키지/단건/수기/합계) 카드 그리드 바로 아래
 *   3. '금일 환불' 카드 확인:
 *      - 상단: "금일 환불  N건  ·  총 환불액 ○○원"
 *      - 유형별 소계: 단건 환불 / 패키지 환불 (금액·건수)
 *      - 목록: 시각 / 고객 / 차트번호 / 유형 / 결제수단 / 담당자 / 환불액(빨강 -표기)
 *   Expected(AC-R2): F-4840 홍미옥 350,000(패키지, 2026-07-17 11:31 KST)이 목록에 정확히 잡히고
 *     '패키지 환불' 소계·'총 환불액'·건수에 반영. 표시 수치 = 결제내역 탭 환불 합계와 일치.
 *
 * [시나리오2] 회귀 대조(AC-R3, before/after 수치 불변)
 *   a. 합계(결제수단별) 카드의 총합·환불 차감행·grossTotal 값이 신설 전과 동일.
 *   b. 결제내역 탭의 담당자별 매출·목록(원결제행 병합 환불 표기) 무변화.
 *   c. 환불 0건 인 날짜 → '금일 환불' 카드는 렌더되되 "금일 환불 내역이 없습니다." 표시.
 *
 * 비고(NO-DDL, db_change=false): 신설 섹션은 기존 react-query 결과(payments/package_payments)와
 *   totals SSOT(refundAmount/totalRefundCount/refundSingleAmount/refundPkgAmount) + enrichedRows 파생
 *   (refundRows)만 사용. 신규 컬럼/테이블/enum/CHECK/RLS/RPC/쿼리 = 0.
 *   차감·합계·담당자별 로직 무접촉(이미 정상). T-20260715 REFUNDROW 병합 표기 무회귀.
 */
