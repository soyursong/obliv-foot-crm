/**
 * E2E spec — T-20260820-foot-REFUNDLIST-METHODTOTALS-FOOTER
 * 김주연 총괄 / 풋센터 (C0ATE5P6JTH, thread 1787189374.436629) / 2026-08-20
 *
 * 요청: 일마감 > '금일 환불 내역'(환불 건별 목록) 하단에 결제수단별 총 환불금액
 *       (카드/현금/이체) 각각 표기.
 *
 * ★설계 요약(구현 근거):
 *   - '금일 환불' 카드의 환불 건별 목록(closing-refund-list) table footer 에
 *     '카드 환불 합계 / 현금 환불 합계 / 이체 환불 합계' 행을 추가(기타수단 잔여>0 시만 표기).
 *   - method 축 = sibling T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL(합계박스 breakdown) 및
 *     REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX(원결제 method 승계) 확정 Axis-A 와 동일.
 *   - 동일 refund method partition(totals.refund{Card,Cash,Transfer,Other}Amount/Count)을 그대로 재사용
 *     — 신규 산식 0(§13.1.C dual-authoring 금지). 표시 위치만 상이(sibling=상단 breakdown 박스 /
 *     본건=목록 table footer) → 중복 아님.
 *   - 합계(카드+현금+이체+기타) ≡ refundAmount(SSOT) — silent-drop 방지(기타수단 잔여 가드).
 *   - 순수 표시전용(FE display-only) → canonical 매출 산식/쿼리 무접촉·db_change=false·DA CONSULT 불요.
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

test.describe('T-20260820-foot-REFUNDLIST-METHODTOTALS-FOOTER', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 금일 환불 내역 목록 하단 결제수단별 합계 행 ─────────────────────────
  test('AC-1: 목록 하단에 카드/현금/이체 환불 합계 행 각각 표기', () => {
    const c = closing();
    // 목록 table footer 의 결제수단별 합계 행 마커.
    expect(c).toContain('data-testid="closing-refund-list-method-total"');
    expect(c).toContain('카드 환불 합계');
    expect(c).toContain('현금 환불 합계');
    expect(c).toContain('이체 환불 합계');
  });

  test('AC-1: 합계 행은 금일 환불 내역 목록(closing-refund-list) 안(=하단)에 위치', () => {
    const c = closing();
    const listIdx = c.indexOf('data-testid="closing-refund-list"');
    const methodTotalIdx = c.indexOf('data-testid="closing-refund-list-method-total"');
    const listEnd = c.indexOf('</table>', listIdx);
    expect(listIdx).toBeGreaterThan(-1);
    expect(methodTotalIdx).toBeGreaterThan(-1);
    // 결제수단별 합계 행은 목록 table 안에 존재하고, 목록 '환불 합계' 행보다 아래(하단)에 위치.
    expect(methodTotalIdx).toBeGreaterThan(listIdx);
    expect(methodTotalIdx).toBeLessThan(listEnd);
    const refundSumRowIdx = c.indexOf('환불 합계 ({totals.totalRefundCount}건)');
    expect(refundSumRowIdx).toBeGreaterThan(-1);
    expect(methodTotalIdx).toBeGreaterThan(refundSumRowIdx);
  });

  // ── AC-2: 수치 = totals 재사용(신규 산식 0, §13.1.C dual-authoring 금지) ────────
  test('AC-2: 결제수단별 환불 합계 수치 = totals SSOT 재사용(신규 산식 0)', () => {
    const c = closing();
    const idx = c.indexOf('data-testid="closing-refund-list-method-total"');
    // footer 합계 행 인근 블록에서 totals.refund* 필드를 그대로 사용(신규 파생 산식 없음).
    const start = c.lastIndexOf('REFUNDLIST-METHODTOTALS-FOOTER', idx);
    expect(start).toBeGreaterThan(-1);
    const block = c.slice(start, idx + 600);
    expect(block).toContain('totals.refundCardAmount');
    expect(block).toContain('totals.refundCashAmount');
    expect(block).toContain('totals.refundTransferAmount');
    expect(block).toContain('totals.refundCardCount');
    expect(block).toContain('totals.refundCashCount');
    expect(block).toContain('totals.refundTransferCount');
  });

  test('AC-2: silent-drop 방지 — 기타수단(refundOther) 잔여 가드로 합계=refundAmount 정합', () => {
    const c = closing();
    const idx = c.indexOf('data-testid="closing-refund-list-method-total"');
    const start = c.lastIndexOf('REFUNDLIST-METHODTOTALS-FOOTER', idx);
    const block = c.slice(start, idx + 600);
    // 카드/현금/이체 외 잔여(기타수단) 환불이 있으면 표기 → 3수단 합≠refundAmount 인 날에도 총합 정합.
    expect(block).toContain('totals.refundOtherAmount');
    expect(block).toContain('totals.refundOtherCount');
  });

  // ── AC-3: 엣지(특정 수단 0건 / 환불 0건) ─────────────────────────────────────
  test('AC-3: 특정 수단 환불 0건 — 카드/현금/이체 3행 상시 표기(0원 표기)', () => {
    const c = closing();
    const idx = c.indexOf('data-testid="closing-refund-list-method-total"');
    const start = c.lastIndexOf('REFUNDLIST-METHODTOTALS-FOOTER', idx);
    const block = c.slice(start, idx + 600);
    // 카드/현금/이체 3행은 조건부가 아니라 상시 배열(기타수단만 잔여>0 조건). 0원은 formatAmount(0) 표기.
    expect(block).toContain('카드 환불 합계');
    expect(block).toContain('현금 환불 합계');
    expect(block).toContain('이체 환불 합계');
    expect(block).toContain('formatAmount(0)');
  });

  test('AC-3: 환불 0건인 날 — 목록/합계 대신 빈 상태 문구 유지(기존 보존)', () => {
    const c = closing();
    // refundRows.length===0 이면 목록 table(및 그 footer 합계 행) 대신 빈 상태 문구. 기존 보존.
    expect(c).toContain('data-testid="closing-refund-empty"');
    expect(c).toContain('금일 환불 내역이 없습니다.');
  });

  // ── db_change=false 근거: 표시 전용, 신규 DDL/쿼리 없음 ──────────────────────
  test('db_change=false: 목록 하단 합계 행이 신규 supabase from/rpc 를 도입하지 않음', () => {
    const c = closing();
    const idx = c.indexOf('data-testid="closing-refund-list-method-total"');
    const start = c.lastIndexOf('REFUNDLIST-METHODTOTALS-FOOTER', idx);
    const block = c.slice(start, idx + 700);
    expect(block).not.toContain('supabase.from(');
    expect(block).not.toContain('.rpc(');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — done 판정 근거):
 *
 * [시나리오1] 정상 동선
 *   1. 로그인 → 일마감(/admin/closing) 진입 → 날짜=검증일
 *   2. '금일 환불' 카드로 스크롤 → 환불 건별 목록 확인
 *   3. 목록 하단(환불 합계 행 아래)에 '카드 환불 합계 / 현금 환불 합계 / 이체 환불 합계' 3행 각각 표기 확인
 *   4. 각 결제수단 합계 = 목록의 해당 수단 건별 환불액 합과 정합(카드 건 합 == 카드 환불 합계 등)
 *   Expected: 카드+현금+이체(+기타수단) 합계 = 환불 합계(총 환불액)와 정확히 일치(이중/누락 없음).
 *
 * [시나리오2] 엣지 케이스
 *   a. 특정 결제수단 환불이 0건인 날 → 해당 수단 합계 '0건 ₩0' 로 표기(3행 상시 유지).
 *   b. 환불 자체가 0건인 날 → 목록/합계 행 대신 '금일 환불 내역이 없습니다.' 빈 상태(기존 보존).
 *   c. 교차수단/기타수단(membership 등) 환불 잔여>0 → '기타수단 환불 합계' 행 추가 표기(총합 정합 유지).
 *
 * 비고(NO-DDL, db_change=false): sibling(SPLIT-CANCELEXCL)이 이미 산출한 method partition
 *   (totals.refundCard/Cash/Transfer/Other Amount·Count)만 재사용 — 신규 컬럼/테이블/enum/CHECK/RLS/RPC/쿼리 = 0.
 *   canonical 매출 산식·grossTotal 무접촉 → DA CONSULT 불요.
 */
