/**
 * T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT
 * 진료비 계산서·영수증 출력 3축 미구현 — 세부산정내역 착지 SSOT 를 계산서·영수증(별도 렌더)로 확장.
 *
 * diagnose-first RC(실브라우저/DB 실측):
 *   - 대상 방문(최***트 2026-07-13, insurance_grade=null): 초진진찰료 AA154(급여 18,840),
 *     KOH도말 D620300HZ(급여 10,540), 레이저 SZ035(비급여 300,000), 피검사 D2501001(비급여 50,000).
 *   - (a)(c) 구조버그: BILL_RECEIPT_HTML 이 정적 그리드 — 전 금액을 '처치 및 수술료' 한 행 비급여 열에
 *     뭉뚱그리고 항목 카테고리·급여/비급여 미분리(렌더가 이미 산출된 SSOT fb 를 per-item 소비 못함).
 *   - (b): grade=null → (T-20260707-RECUR 총괄 확정 스펙으로 역전) 본인=급여전액/공단=0.
 *     과거엔 copaymentTotal=0(공단=전액/본인=0)이었으나 확정 스펙으로 반전(공란 금지).
 *
 * 해소: 세부산정내역과 **동일 SSOT**(computeFootBilling→buildFootBillDetailItems 출력)를 HIRA 항목분류로
 *   집계하는 buildBillReceiptFeeGridHtml → 템플릿 정적 그리드를 {{fee_grid_html}} 로 교체. 병렬 경로 신설 0.
 *
 * AC-1: 항목 카테고리(진찰료/검사료/처치 및 수술료 …) 구분 표기.
 * AC-2: 각 급여 항목에 공단부담/본인부담 분리 표기(세부산정내역과 동일 split).
 * AC-3: 급여는 급여, 비급여는 비급여로 분류(전체 비급여 묶임 해소).
 * AC-4: 회귀 금지 — 소계행 정합(Σ행 = insurance_covered/copayment/non_covered/total_amount).
 * AC-5: 실브라우저 렌더 대조(page.setContent 로 실제 표 렌더 후 셀 육안 대조).
 * AC-6: insurance_grade=null 방문 → 급여 rows 본인=급여전액/공단=0(T-20260707-RECUR 확정), 항목구분·급여분류 정상.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBillReceiptFeeGridHtml,
  getHtmlTemplate,
  bindHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const ROOT = process.cwd();
const TPL = path.join(ROOT, 'src/lib/htmlFormTemplates.ts');

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

// 최***트 2026-07-13 방문(insurance_grade=null) 실측 재현 — 세부산정내역과 동일 SSOT 로 파생.
const VISIT: FootBillingItem[] = [
  { service: svc({ id: 'c1', name: '초진진찰료-의원', service_code: 'AA154', hira_code: 'AA154', is_insurance_covered: true, category_label: '기본', price: 18840 }), qty: 1, unitPrice: 18840 },
  { service: svc({ id: 'k1', name: 'KOH도말진균검사', service_code: 'D620300HZ', hira_code: 'D620300HZ', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
  { service: svc({ id: 's1', name: '진균증 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 300000 }), qty: 1, unitPrice: 300000 },
  { service: svc({ id: 'b1', name: '피검사', service_code: 'D2501001', is_insurance_covered: false, category_label: '검사', price: 50000 }), qty: 1, unitPrice: 50000 },
];

// grade=null → SSOT 폴백(T-20260707-RECUR 총괄 확정): 본인=급여전액/공단=0. 세부산정내역과 동일 산출.
const FB = computeFootBilling(VISIT, null);
const BILL_ITEMS = buildFootBillDetailItems(FB.pricingItems, '2026-07-13', {
  insuranceGrade: null, copaymentTotal: FB.copaymentTotal,
});

/** page 에서 특정 행(첫 td 라벨 일치)의 br-num 셀 텍스트 배열 반환. */
async function rowCells(page: import('@playwright/test').Page, label: string): Promise<string[]> {
  return page.evaluate((lbl) => {
    const trs = Array.from(document.querySelectorAll('tr'));
    for (const tr of trs) {
      const first = tr.querySelector('td.br-label');
      if (first && first.textContent?.replace(/\s+/g, '') === lbl.replace(/\s+/g, '')) {
        return Array.from(tr.querySelectorAll('td.br-num')).map((td) => (td.textContent ?? '').trim());
      }
    }
    return [];
  }, label);
}

function renderReceipt(billItems: typeof BILL_ITEMS): string {
  const grid = buildBillReceiptFeeGridHtml(billItems);
  // 소계 집계(급여 공단 = 항목총 − copay, 본인 = copay, 비급여, 합계) — 렌더 경로가 fb.liveBillingValues 로 주입하는 값과 동일.
  let gongdan = 0, bonin = 0, bigy = 0, hap = 0;
  for (const b of billItems) {
    const t = b.amount * (b.count ?? 1) * (b.days ?? 1);
    if (b.is_insurance_covered) { gongdan += t - (b.copayment_amount ?? 0); bonin += (b.copayment_amount ?? 0); }
    else bigy += t;
    hap += t;
  }
  return bindHtmlTemplate(getHtmlTemplate('bill_receipt')!, {
    fee_grid_html: grid,
    insurance_covered: gongdan.toLocaleString('ko-KR'),
    copayment: bonin.toLocaleString('ko-KR'),
    non_covered: bigy.toLocaleString('ko-KR'),
    total_amount: hap.toLocaleString('ko-KR'),
    // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY(B안) 이후 소계·총 진료비 합계 셀 = {{receipt_total}}(본인+비급여, 공단 제외).
    //   grade=null 이라 본인=급여전액 → 합계=hap(공단 0). 렌더 경로(PMW/DocumentPrintPanel)와 동일하게 별도 세팅.
    receipt_total: hap.toLocaleString('ko-KR'),
    patient_name: '최***트',
    visit_date: '2026-07-13',
    clinic_name: '오블리브 풋센터',
  });
}

test.describe('T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT', () => {
  test('AC-5: 실브라우저 렌더 — 템플릿 바인딩 후 미치환 placeholder 0', async ({ page }) => {
    const html = renderReceipt(BILL_ITEMS);
    expect(html.match(/\{\{/g) ?? []).toHaveLength(0);
    await page.setContent(html);
    await expect(page.locator('.br-title')).toContainText('진료비 계산서·영수증');
  });

  test('AC-1: 항목 카테고리별 구분 표기 (진찰료/검사료/처치 및 수술료 각 행에 금액)', async ({ page }) => {
    await page.setContent(renderReceipt(BILL_ITEMS));
    const 진찰료 = await rowCells(page, '진찰료');
    const 검사료 = await rowCells(page, '검사료');
    const 처치 = await rowCells(page, '처치 및 수술료');
    // 합계 열(마지막) 기준 — 항목이 자기 카테고리 행에 들어감(전액 처치 및 수술료 뭉침 아님)
    expect(진찰료[3]).toBe('18,840');
    expect(검사료[3]).toBe('60,540');   // 급여 10,540 + 비급여 50,000
    expect(처치[3]).toBe('300,000');
  });

  test('AC-2/AC-6: 급여 항목 공단/본인 분리 (grade=null → 공단=0, 본인=급여전액 · T-20260707-RECUR 역전)', async ({ page }) => {
    await page.setContent(renderReceipt(BILL_ITEMS));
    const 진찰료 = await rowCells(page, '진찰료');
    // [공단, 본인, 비급여, 합계] — 총괄 확정: 본인=급여전액/공단=0, 공란 금지.
    expect(진찰료[0]).toBe('0');       // 공단 = 0
    expect(진찰료[1]).toBe('18,840'); // 본인 = 급여 전액
    const 검사료 = await rowCells(page, '검사료');
    expect(검사료[0]).toBe('0');       // 급여분 공단 = 0
    expect(검사료[1]).toBe('10,540'); // 급여분 본인 = 급여 전액
  });

  test('AC-3: 급여/비급여 분류 — 전체 비급여 묶임 해소 (검사료·처치 각 비급여 열 분리)', async ({ page }) => {
    await page.setContent(renderReceipt(BILL_ITEMS));
    const 검사료 = await rowCells(page, '검사료');
    const 처치 = await rowCells(page, '처치 및 수술료');
    expect(검사료[2]).toBe('50,000');   // 피검사 비급여 → 검사료 행(레이저와 한덩어리 아님)
    expect(처치[2]).toBe('300,000');    // 레이저 비급여 → 처치 및 수술료 행
    // 급여 항목은 비급여 열이 공란
    const 진찰료 = await rowCells(page, '진찰료');
    expect(진찰료[2]).toBe('');
  });

  test('AC-4: 소계 정합 — Σ(행 공단/본인/비급여/합계) = 소계행', async ({ page }) => {
    await page.setContent(renderReceipt(BILL_ITEMS));
    const 소계 = await rowCells(page, '소계');
    expect(소계[0]).toBe('0');         // 공단 = 0 (grade-null, T-20260707-RECUR)
    expect(소계[1]).toBe('29,380');   // 본인 = 급여전액 18,840 + 10,540
    expect(소계[2]).toBe('350,000');  // 비급여 = 300,000 + 50,000
    expect(소계[3]).toBe('379,380');  // 합계
  });

  test('AC-4 회귀가드: 항목 0건 → 표준 빈 그리드 rows 렌더(본문 공란 회귀 방지)', async ({ page }) => {
    await page.setContent(renderReceipt([]));
    // 표준 행 라벨이 그대로 존재해야 함(정적 그리드 제거로 인한 빈 본문 회귀 방지)
    await expect(page.locator('td.br-label', { hasText: '진찰료' }).first()).toBeVisible();
    await expect(page.locator('td.br-label', { hasText: '처치 및 수술료' }).first()).toBeVisible();
  });

  test('구조가드: 템플릿이 정적 그리드 대신 {{fee_grid_html}} 를 사용(전액-처치및수술료 뭉침 하드코딩 제거)', () => {
    const src = fs.readFileSync(TPL, 'utf-8');
    expect(src).toContain('{{fee_grid_html}}');
    // 옛 하드코딩(처치 및 수술료 행에 {{non_covered}}/{{total_amount}} 직결)이 BILL_RECEIPT_HTML 에서 제거됐는지
    const receiptBlock = src.slice(src.indexOf('const BILL_RECEIPT_HTML'), src.indexOf('const INS_CLAIM_FORM_HTML'));
    expect(receiptBlock).not.toContain('처치 및 수술료</td>\n        <td class="br-num"></td><td class="br-num"></td>');
  });
});
