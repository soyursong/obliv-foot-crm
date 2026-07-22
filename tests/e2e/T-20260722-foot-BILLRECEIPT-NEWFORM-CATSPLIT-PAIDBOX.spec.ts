/**
 * T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX
 *
 * 진료비 계산서·영수증 '신양식'(form_key=bill_receipt_new, 별지 제6호서식) 확정 결함 2건 불변식.
 * (T-20260708 / T-20260719 부분수정 후 재발 → 2차+ 재오픈. 진단·검증팀 RC + codex 교차검증 확정.)
 *
 *   결함A — 검사료(급여) 공란: 급여 항목을 진찰료 행 aggregate 로만 바인딩 → 급여 검사(KOH 등)가
 *           진찰료로 흡수돼 검사료 행 급여열 공란. 처방: category별 (본인/공단) 분해 + 진찰료 행 = remainder.
 *           불변식: Σ(행별 본인) == {{copayment}}, Σ(행별 공단) == {{insurance_covered}}.
 *   결함B — 납부박스 공란: ⑪ 카드/현금/현금영수증 셀 토큰 부재 + 합계만 FE 수기 {{prepaid_amount}}.
 *           처방: payments 원장(status=active) method별 groupBy 실수납 표기. 완납 가정(허위영수증) 금지.
 *
 * ★Σ정합 가드(재오픈 함정 #1): 진찰료 행 remainder 는 반드시 야간가산 fold '이후' 최종 aggregate 기준.
 *   → applyBillReceiptNewCoveredTokens 는 values.copayment/insurance_covered(post-surcharge)를 소비.
 *
 * 골든 테스트 = F-4990: 검사(급여) 10,540 + 진찰료(급여) 18,840 + 처치(비급여) 300,000, 카드 8,800 active.
 *   aggregate: 급여총액 29,380 / 공단 20,580 / 본인 8,800. 환자부담총액 ⑧⑩ = 308,800.
 *
 * 라이브 앱 회귀 아님 — 템플릿 렌더/바인딩 + 순수 산식 불변식 강제(로그인 불요, 결정론적).
 * 회귀: draftFormTemplates 라이브 import 금지(토큰 명명만 재사용), 신규 토큰 창안 금지.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  computeBillReceiptNewCoveredBreakdown,
  applyBillReceiptNewCoveredTokens,
  applyBillReceiptPaidBoxTokens,
} from '../../src/lib/footBilling';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractNewTemplate(): string {
  const m = HTML_SRC.match(/const BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
  expect(m, 'BILL_RECEIPT_NEW_HTML 상수 존재').not.toBeNull();
  return m![1];
}

// ── 골든 F-4990 급여 항목(buildFootBillDetailItems 가 채우는 per-item copayment_amount 재현) ──
//   copaymentTotal 8,800 을 급여 금액(검사 10,540 + 진찰 18,840 = 29,380) 비례배분:
//   검사 floor(8800*10540/29380)=3,157 / 진찰 floor(8800*18840/29380)=5,642, 잔차 1 → frac 큰 진찰로 → 5,643.
const GOLDEN_COVERED_ITEMS = [
  { category: '검사료', amount: 10540, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 3157 },
  { category: '진찰료', amount: 18840, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 5643 },
  { category: '처치및수술료', amount: 300000, count: 1, days: 1, is_insurance_covered: false },
];

test.describe('BILLRECEIPT 신양식 CATSPLIT+PAIDBOX — 급여분해(A) / 납부박스 payments(B)', () => {
  // ══════════════ 결함A — 검사료(급여) 분해 ══════════════

  test('A-static: 진찰료 행 = remainder 토큰({{consult_copay}}/{{consult_ins}}) — aggregate 직결 아님', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(
      /<td>진찰료<\/td><td class="rn-num">\{\{consult_copay\}\}<\/td><td class="rn-num">\{\{consult_ins\}\}<\/td>/,
    );
    // 회귀: 진찰료 행에 aggregate {{copayment}}/{{insurance_covered}} 직결 잔존 금지(흡수 원인).
    expect(tpl).not.toMatch(/<td>진찰료<\/td><td class="rn-num">\{\{copayment\}\}<\/td>/);
  });

  test('A-static: 검사료 행 급여칸 = {{exam_copay}}/{{exam_ins}} (진찰료 흡수 방지)', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(
      /<td>검사료<\/td><td class="rn-num">\{\{exam_copay\}\}<\/td><td class="rn-num">\{\{exam_ins\}\}<\/td><td class="rn-num"><\/td><td class="rn-num">\{\{exam_noncov\}\}<\/td>/,
    );
  });

  test('A-static: 처치 및 수술료 행 급여칸 = {{proc_copay}}/{{proc_ins}} + 비급여 {{proc_noncov}} 유지', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(
      /<td>처치 및 수술료<\/td><td class="rn-num">\{\{proc_copay\}\}<\/td><td class="rn-num">\{\{proc_ins\}\}<\/td><td class="rn-num"><\/td><td class="rn-num">\{\{proc_noncov\}\}<\/td>/,
    );
  });

  test('A-logic: computeBillReceiptNewCoveredBreakdown — 급여 검사/처치만 버킷(진찰료 등은 미계상)', () => {
    const bd = computeBillReceiptNewCoveredBreakdown(GOLDEN_COVERED_ITEMS);
    // 검사료 급여: 총액 10,540 / 본인(copay) 3,157 → 공단 7,383.
    expect(bd.examCovered).toBe(10540);
    expect(bd.examCopay).toBe(3157);
    // 처치는 비급여라 급여 버킷 0(진찰료는 remainder 로 흡수 — 버킷 대상 아님).
    expect(bd.procCovered).toBe(0);
    expect(bd.procCopay).toBe(0);
  });

  test('A-logic: 비급여 항목은 급여 버킷에 계상되지 않음(is_insurance_covered=false skip)', () => {
    const bd = computeBillReceiptNewCoveredBreakdown([
      { category: '검사료', amount: 15000, count: 1, days: 1, is_insurance_covered: false },
      { category: '처치및수술료', amount: 300000, count: 1, days: 1, is_insurance_covered: false },
    ]);
    expect(bd.examCovered).toBe(0);
    expect(bd.procCovered).toBe(0);
  });

  test('A-golden: applyBillReceiptNewCoveredTokens — F-4990 진찰료 remainder + 검사료 급여 별도표기', () => {
    const values: Record<string, string> = {
      // 최종 aggregate(post-surcharge): 본인 8,800 / 공단 20,580.
      copayment: '8,800',
      insurance_covered: '20,580',
    };
    applyBillReceiptNewCoveredTokens(values, GOLDEN_COVERED_ITEMS);

    // 검사료 행: 급여 본인/공단 표시(0·공란 아님) — 진찰료 흡수 안 됨.
    expect(values.exam_copay).toBe('3,157');
    expect(values.exam_ins).toBe('7,383');
    // 진찰료 행 = aggregate 잔여: 본인 8,800−3,157=5,643 / 공단 20,580−7,383=13,197.
    expect(values.consult_copay).toBe('5,643');
    expect(values.consult_ins).toBe('13,197');
    // 처치는 비급여 → 급여칸 공란.
    expect(values.proc_copay).toBe('');
    expect(values.proc_ins).toBe('');
  });

  test('A-invariant: Σ(행별 본인)=={{copayment}}, Σ(행별 공단)=={{insurance_covered}} (총계 불변)', () => {
    const values: Record<string, string> = { copayment: '8,800', insurance_covered: '20,580' };
    applyBillReceiptNewCoveredTokens(values, GOLDEN_COVERED_ITEMS);
    const num = (s: string) => Number((s || '0').replace(/,/g, ''));
    // 진찰료 + 검사료(처치 급여 0) 본인 합 == aggregate 본인.
    expect(num(values.consult_copay) + num(values.exam_copay) + num(values.proc_copay)).toBe(8800);
    // 공단 동일.
    expect(num(values.consult_ins) + num(values.exam_ins) + num(values.proc_ins)).toBe(20580);
    // 검사료 행 급여총액 = 본인+공단 = 항목 급여총액 10,540 정합.
    expect(num(values.exam_copay) + num(values.exam_ins)).toBe(10540);
  });

  test('A-order-guard: aggregate 키({{copayment}}/{{insurance_covered}})는 무접촉 — remainder 는 신 토큰 전용', () => {
    const values: Record<string, string> = { copayment: '8,800', insurance_covered: '20,580' };
    applyBillReceiptNewCoveredTokens(values, GOLDEN_COVERED_ITEMS);
    // aggregate 원본 값 보존(표시 전용 additive).
    expect(values.copayment).toBe('8,800');
    expect(values.insurance_covered).toBe('20,580');
  });

  // ══════════════ 결함B — ⑪ 납부박스 payments 배선 ══════════════

  test('B-static: ⑪ 납부한 금액 = method별 셀 토큰(카드/현금영수증/현금) + 합계 {{paid_total}}', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(/카드 <span style="float:right;">\{\{card_amount\}\}<\/span>/);
    expect(tpl).toMatch(/현금영수증 <span style="float:right;">\{\{cashreceipt_amount\}\}<\/span>/);
    expect(tpl).toMatch(/현금 <span style="float:right;">\{\{cash_amount\}\}<\/span>/);
    expect(tpl).toMatch(/합계 <span style="float:right;font-weight:bold;">\{\{paid_total\}\}<\/span>/);
    // 납부하지 않은 금액(⑩-⑪) = {{unpaid_amount}} 유지.
    expect(tpl).toMatch(/납부하지 않은 금액<br>\(⑩-⑪\)<\/td><td class="rn-num">\{\{unpaid_amount\}\}<\/td>/);
  });

  test('B-golden: applyBillReceiptPaidBoxTokens — 카드 8,800 active → 카드칸+합계 8,800, 현금·현금영수증 공란, 미납 300,000', () => {
    const values: Record<string, string> = {};
    // F-4990: 카드결제 8,800 active 1건. 환자부담총액(절사 후) 308,800.
    applyBillReceiptPaidBoxTokens(
      values,
      [{ method: 'card', amount: 8800, cash_receipt_issued: false }],
      308800,
    );
    expect(values.card_amount).toBe('8,800');
    expect(values.cash_amount).toBe('');
    expect(values.cashreceipt_amount).toBe('');
    expect(values.paid_total).toBe('8,800');
    // 납부하지 않은 금액 = 308,800 − 8,800 = 300,000.
    expect(values.unpaid_amount).toBe('300,000');
  });

  test('B-groupBy: 결제수단별 분리 배선 — 카드/현금/현금영수증 각 칸(합계 퉁치기 금지)', () => {
    const values: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(
      values,
      [
        { method: 'card', amount: 50000, cash_receipt_issued: false },
        { method: 'cash', amount: 30000, cash_receipt_issued: true }, // 현금영수증 발급분
        { method: 'cash', amount: 20000, cash_receipt_issued: false }, // 그 외 현금
      ],
      100000,
    );
    expect(values.card_amount).toBe('50,000');
    expect(values.cashreceipt_amount).toBe('30,000');
    expect(values.cash_amount).toBe('20,000');
    expect(values.paid_total).toBe('100,000');
    expect(values.unpaid_amount).toBe('0'); // 완납.
  });

  test('B-nopay: 미수납(active payments 없음) → 납부박스 공란 + 미납=전액(완납 가정 금지)', () => {
    const values: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(values, [], 308800);
    expect(values.card_amount).toBe('');
    expect(values.cash_amount).toBe('');
    expect(values.cashreceipt_amount).toBe('');
    expect(values.paid_total).toBe('');
    // 허위영수증 방지: 미수납이면 미납 = 환자부담총액 전액.
    expect(values.unpaid_amount).toBe('308,800');
  });

  // ══════════════ 금지선 회귀 ══════════════

  test('금지선: 신양식 템플릿에 draftFormTemplates 라이브 import 없음(토큰 명명만 재사용)', () => {
    // htmlFormTemplates.ts 는 draftFormTemplates 를 import 하지 않는다(총괄 C1/C3 하드제약).
    expect(HTML_SRC).not.toMatch(/from ['"]\.\/draftFormTemplates['"]/);
    expect(HTML_SRC).not.toMatch(/import .*draftFormTemplates/);
  });

  test('금지선: 재발급 PATH-3 구양식(bill_receipt) 그리드 무접촉 — 신 토큰 유입 없음', () => {
    // 구양식 bill_receipt 는 fee_grid_html(buildBillReceiptFeeGridHtml) 경로 — 신 remainder 토큰과 무관.
    const m = HTML_SRC.match(/const BILL_RECEIPT_HTML\s*=\s*`([\s\S]*?)`;/);
    if (m) {
      expect(m[1]).not.toMatch(/\{\{consult_copay\}\}/);
      expect(m[1]).not.toMatch(/\{\{card_amount\}\}/);
    }
  });
});
