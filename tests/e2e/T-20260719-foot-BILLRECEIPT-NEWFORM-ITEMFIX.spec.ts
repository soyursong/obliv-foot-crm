/**
 * T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX
 *
 * 진료비 계산서·영수증 '신양식'(form_key=bill_receipt_new, 별지 제6호서식) 3건 수정 불변식.
 * 김주연 총괄(2026-07-19, ch C0ATE5P6JTH) 현장 피드백, 빨간박스 스샷 F0BK4NYLPHN 기준.
 *
 *   AC-② 처치 및 수술료·검사료 항목 누락 표시(P1, 법정서식 정확성):
 *        비급여(non_covered)를 '기타' 행 하나에 뭉치던 것을 category 분해 —
 *        처치 및 수술료 행=비급여 {{proc_noncov}}(풋케어), 검사료 행=비급여 {{exam_noncov}}(검사),
 *        기타 행={{etc_noncov}}(잔여). 세 버킷 합 = ④ 합계 {{non_covered}} → 집계 grain 불변(표시≠grain).
 *        급여 split(진찰료 행 aggregate {{copayment}}/{{insurance_covered}})은 3FIX 배치 유지(무접촉).
 *   AC-③ 납부금액 사전 입력·출력: ⑪ 납부한 금액 합계={{prepaid_amount}}, 납부하지 않은 금액(⑩-⑪)={{unpaid_amount}}.
 *   AC-④ 레이아웃(빨간박스): 사업자등록번호 값칸 축소(13% 고정) + 상호(요양기관명) 값칸 확장(auto)·nowrap(1줄).
 *
 * 라이브 앱 브라우저 회귀가 아니라 템플릿 렌더/바인딩 + 순수 산식 불변식 강제(로그인 불요, 결정론적).
 * 회귀: 3FIX 사업자번호(457-23-00938)·진찰료 급여 split, REPNAME 대표자/도장 토큰 유지.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { computeBillReceiptNewCategoryBreakdown } from '../../src/lib/footBilling';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractNewTemplate(): string {
  const m = HTML_SRC.match(/const BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
  expect(m, 'BILL_RECEIPT_NEW_HTML 상수 존재').not.toBeNull();
  return m![1];
}

test.describe('BILLRECEIPT 신양식 ITEMFIX — 항목분해(②) / 사전납부(③) / 레이아웃(④)', () => {
  // ── AC-② 처치·수술료/검사료 항목 표시 ──
  test('②-static: 처치 및 수술료 행 비급여칸={{proc_noncov}}, 검사료 행 비급여칸={{exam_noncov}}', () => {
    const tpl = extractNewTemplate();
    // 처치 및 수술료 행: 앞 3 급여셀 공란 유지(3FIX) + 마지막 비급여셀 = {{proc_noncov}}
    expect(tpl).toMatch(
      /<td>처치 및 수술료<\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num">\{\{proc_noncov\}\}<\/td>/,
    );
    // 검사료 행: 마지막 비급여셀 = {{exam_noncov}}
    expect(tpl).toMatch(
      /<td>검사료<\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num">\{\{exam_noncov\}\}<\/td>/,
    );
  });

  test('②-static: 기타 행 비급여 = {{etc_noncov}}(前 {{non_covered}} 전액 → 분해분 제외 잔여)', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(/<td>기타<\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num"><\/td><td class="rn-num">\{\{etc_noncov\}\}<\/td>/);
    // 합계 ④ 는 여전히 aggregate {{non_covered}} (집계 grain 불변)
    expect(tpl).toMatch(/④ \{\{non_covered\}\}/);
  });

  test('②-logic: computeBillReceiptNewCategoryBreakdown 이 비급여를 처치/검사/기타로 분해 + 합 정합', () => {
    const items = [
      { category: '진찰료', amount: 8800, count: 1, days: 1, is_insurance_covered: true },   // 급여 → 분해 제외
      { category: '처치및수술료', amount: 120000, count: 1, days: 1, is_insurance_covered: false },
      { category: '처치및수술료', amount: 30000, count: 2, days: 1, is_insurance_covered: false }, // qty 반영 = 60000
      { category: '검사료', amount: 15000, count: 1, days: 1, is_insurance_covered: false },
      { category: '기타', amount: 5000, count: 1, days: 1, is_insurance_covered: false },
    ];
    const bd = computeBillReceiptNewCategoryBreakdown(items);
    expect(bd.procNonCov).toBe(180000);
    expect(bd.examNonCov).toBe(15000);
    expect(bd.etcNonCov).toBe(5000);
    // 불변식: 3버킷 합 = 전체 비급여 합(급여 제외)
    const totalNonCov = items.filter((i) => !i.is_insurance_covered)
      .reduce((s, i) => s + i.amount * i.count * i.days, 0);
    expect(bd.procNonCov + bd.examNonCov + bd.etcNonCov).toBe(totalNonCov);
  });

  test('②-logic: 급여(covered)분은 어느 버킷에도 계상되지 않음(진찰료 행 aggregate 표기 유지)', () => {
    const items = [
      { category: '진찰료', amount: 29400, count: 1, days: 1, is_insurance_covered: true },
      { category: '검사료', amount: 20000, count: 1, days: 1, is_insurance_covered: true }, // 급여 검사 → 분해 제외
    ];
    const bd = computeBillReceiptNewCategoryBreakdown(items);
    expect(bd.procNonCov).toBe(0);
    expect(bd.examNonCov).toBe(0);
    expect(bd.etcNonCov).toBe(0);
  });

  test('②-render: 처치/검사/기타 금액이 각 행에 표시됨', async ({ page }) => {
    const tpl = extractNewTemplate()
      .replace(/\{\{proc_noncov\}\}/g, '180,000')
      .replace(/\{\{exam_noncov\}\}/g, '15,000')
      .replace(/\{\{etc_noncov\}\}/g, '5,000')
      .replace(/\{\{non_covered\}\}/g, '200,000')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    await expect(page.locator('tr', { hasText: '처치 및 수술료' }).first()).toContainText('180,000');
    await expect(page.locator('tr', { hasText: '검사료' }).first()).toContainText('15,000');
    await expect(page.locator('tr', { hasText: '기타' }).first()).toContainText('5,000');
  });

  // ── AC-③ 납부금액 사전 입력 ──
  test('③-static: ⑪ 합계={{prepaid_amount}}, 납부하지 않은 금액(⑩-⑪)={{unpaid_amount}}', () => {
    const tpl = extractNewTemplate();
    // ⑪ 납부한 금액 합계 span
    expect(tpl).toMatch(/합계 <span style="float:right;font-weight:bold;">\{\{prepaid_amount\}\}<\/span>/);
    // 납부하지 않은 금액(⑩-⑪) 값칸
    expect(tpl).toMatch(/납부하지 않은 금액<br>\(⑩-⑪\)<\/td><td class="rn-num">\{\{unpaid_amount\}\}<\/td>/);
  });

  test('③-static: 출력 패널에 납부금액 사전입력 UI(state prepaidAmount) 존재', () => {
    const PANEL_SRC = fs.readFileSync(path.join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
    expect(PANEL_SRC).toMatch(/const \[prepaidAmount, setPrepaidAmount\] = useState\(''\)/);
    expect(PANEL_SRC).toContain('납부금액(사전입력)');
    // 신양식 전용 조건부 노출
    expect(PANEL_SRC).toMatch(/template\.form_key === 'bill_receipt_new' && \(/);
  });

  test('③-render: 미입력(공란) 시 ⑪ 합계·납부하지 않은 금액 공란 유지(기존 동작)', async ({ page }) => {
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('납부한');
    expect(body).toContain('납부하지 않은 금액');
    // 리터럴 토큰 누출 없음
    expect(body).not.toContain('{{prepaid_amount}}');
    expect(body).not.toContain('{{unpaid_amount}}');
  });

  // ── AC-④ 레이아웃(빨간박스) ──
  test('④-static: 하단 표 colgroup — 사업자번호 값칸 13% 고정·상호 값칸 auto·전화/대표자 8%/15%', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(
      /<colgroup><col style="width:12%"><col style="width:13%"><col style="width:7%"><col><col style="width:8%"><col style="width:15%"><\/colgroup>/,
    );
    // 前 과폭 colgroup(14%/auto/9%/12%/9%/16%) 잔존 없음
    expect(tpl).not.toContain('<col style="width:14%"><col><col style="width:9%"><col style="width:12%"><col style="width:9%"><col style="width:16%">');
  });

  test('④-static: 상호 값칸 nowrap(1줄 강제) + 사업자번호 값·대표자 토큰 회귀 유지', () => {
    const tpl = extractNewTemplate();
    // 상호 값칸 nowrap
    expect(tpl).toMatch(/<td class="rn-lbl">상호<\/td><td style="white-space:nowrap;">\{\{clinic_name\}\}<\/td>/);
    // 회귀: 사업자번호 정본(3FIX) 유지
    expect(tpl).toContain('457-23-00938');
    expect(tpl).not.toContain('511-60-00988');
    // 회귀: REPNAME 대표자·도장 토큰 유지
    expect(tpl).toContain('{{receipt_representative}}');
    expect(tpl).toContain('{{institution_seal_html}}');
  });

  test('④-render: 긴 상호명이 줄바꿈 없이 1줄로 표시(nowrap 반영)', async ({ page }) => {
    const tpl = extractNewTemplate()
      .replace(/\{\{clinic_name\}\}/g, '오블리브의원 서울오리진점')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const cell = page.locator('td', { hasText: '오블리브의원 서울오리진점' }).first();
    await expect(cell).toBeVisible();
    const ws = await cell.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(ws).toBe('nowrap');
  });

  // ── 격리/정합 ──
  test('격리: ITEMFIX 는 신양식(bill_receipt_new)에 한정 — 기존 bill_receipt 매핑 무접촉', () => {
    expect(HTML_SRC).toMatch(/bill_receipt:\s*BILL_RECEIPT_HTML/);
    expect(HTML_SRC).toMatch(/bill_receipt_new:\s*BILL_RECEIPT_NEW_HTML/);
  });

  test('회귀: 진찰료 행 급여 split(3FIX) 유지 — {{copayment}}/{{insurance_covered}} 진찰료 행 바인딩', () => {
    const tpl = extractNewTemplate();
    expect(tpl).toMatch(
      /<td>진찰료<\/td><td class="rn-num">\{\{copayment\}\}<\/td><td class="rn-num">\{\{insurance_covered\}\}<\/td>/,
    );
  });
});
