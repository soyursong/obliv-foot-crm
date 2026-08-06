/**
 * E2E spec — T-20260806-foot-DOCPRINT-PAGEBOX-BLANK2P
 *
 * 영수증(신, bill_receipt_new)·KOH결과지(printKohResult) 인쇄 시 빈 2페이지가 한 장 더
 * 출력되던 문제 수정 회귀 가드. db_change=false · 순수 FE print-CSS · 각 파일 1줄(둘 다 @media print 내부).
 *
 *   ① 영수증(신) .rn-wrap : @media print 규칙에 min-height:auto 추가.
 *      기본 .rn-wrap 은 min-height:285mm(≈A4 297mm) 강제 → padding+콘텐츠와 합쳐져 2페이지로 넘침.
 *      print 시 min-height:auto 로 콘텐츠 높이만큼만 → 빈 2페이지 소멸.
 *   ② KOH결과지 body : @media print { body { padding:0 } } 추가.
 *      body padding:12mm(@page margin:0 하 콘텐츠 인셋)이 print 시 A4 경계 초과 → 빈 2페이지.
 *      print 시 padding:0(콘텐츠 자체 스코프 <style> 내부 여백 보유) → 빈 2페이지 소멸.
 *
 * 🔴 스코프 불변식: .rn-wrap = bill_receipt_new 전용(타 서류는 .form-wrap/.bill-wrap),
 *    body 규칙 = printKohResult window.open 인쇄문서 전용 → 비대상 9종 무영향.
 * 로그인 불요·결정론적.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const KOH_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/printKohResult.ts'), 'utf8');

function extractTemplate(name: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${name} 상수 존재`).not.toBeNull();
  return m![1];
}

const NEW_TPL = extractTemplate('BILL_RECEIPT_NEW_HTML');

// ════════════════════════ 파트 A: 소스 불변식 (결정론적, 브라우저 불요) ════════════════════════

test.describe('DOCPRINT-PAGEBOX-BLANK2P 소스 불변식', () => {
  test('①-a: @media print .rn-wrap 규칙에 min-height:auto 존재', () => {
    // print 오버라이드 한 줄에 min-height:auto 포함 (기존 width/padding/margin 유지).
    expect(NEW_TPL).toMatch(/\.rn-wrap\s*\{\s*width:190mm;\s*padding:5mm 7mm;\s*margin:0 auto;\s*min-height:auto;\s*\}/);
  });

  test('①-b: min-height:auto 는 @media print 블록 안에 위치 (화면 285mm 기본값 무변경)', () => {
    // 기본 .rn-wrap 은 여전히 min-height:285mm (화면 렌더 회귀 0).
    expect(NEW_TPL).toMatch(/min-height:\s*285mm;/);
    const printBlockMatch = NEW_TPL.match(/@media print\s*\{([\s\S]*?)\n\s*\}\s*<\/style>/);
    expect(printBlockMatch, '@media print 블록 추출').not.toBeNull();
    expect(printBlockMatch![1]).toContain('min-height:auto');
  });

  test('②-a: KOH printKohResult 소스에 @media print { body { padding:0 } } 존재', () => {
    expect(KOH_SRC).toMatch(/@media print\s*\{\s*body\s*\{\s*padding:0\s*\}\s*\}/);
  });

  test('②-b: KOH 기본 body padding:12mm 유지 (화면 인셋 회귀 0)', () => {
    expect(KOH_SRC).toMatch(/body\s*\{\s*box-sizing:\s*border-box;\s*padding:\s*12mm;\s*\}/);
    expect(KOH_SRC).toMatch(/@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*\}/);
  });
});

// ════════════════════════ 파트 B: 렌더 실측 (print emulation) ════════════════════════

const SAMPLE: Record<string, string> = {
  record_no: 'C-2026-00123', patient_name: '홍길동', visit_date: '2026-08-06',
  night_mark: ' ', holiday_mark: ' ',
  consult_copay: '8,800', consult_ins: '0', proc_noncov: '120,000',
  copayment: '8,800', insurance_covered: '0', non_covered: '120,000', total_amount: '128,800',
  patient_amount: '128,800', card_amount: '128,800', paid_total: '128,800', unpaid_amount: '0',
  cashreceipt_mark: ' ', receipt_no: 'RN-2026-0007', receipt_representative: '박영진',
  clinic_name: '오블리브의원 종로점', issue_date: '2026년 08월 06일', doctor_name: '문지은',
  items_html: '<tr><td>기본</td><td>2026-08-06</td><td>SC001</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td>1</td><td class="num-cell">120,000</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">120,000</td></tr>',
};

test.describe('DOCPRINT-PAGEBOX-BLANK2P 렌더 실측', () => {
  // ① print 미디어에서 .rn-wrap computed min-height = auto (285mm 강제 해제) + 콘텐츠 클리핑 0.
  test('①-render: 영수증(신) print 시 .rn-wrap min-height 285mm 강제 해제 (빈 2페이지 원인 소멸)', async ({ page }) => {
    const raw = getHtmlTemplate('bill_receipt_new');
    expect(raw, 'bill_receipt_new 템플릿').toBeTruthy();
    const html = bindHtmlTemplate(raw as string, SAMPLE);
    const vw = Math.round(210 * 96 / 25.4), vh = Math.round(297 * 96 / 25.4);
    await page.setViewportSize({ width: vw, height: vh });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
    const r = await page.evaluate(() => {
      const el = document.querySelector('.rn-wrap') as HTMLElement;
      const cs = getComputedStyle(el);
      // min-height:auto → computed 'auto' (또는 0px). 285mm(≈1077px)로 강제되지 않아야 함.
      const mh = cs.minHeight;
      const A4mm = 297;
      const pxPerMm = document.body.getBoundingClientRect().width / 210;
      const heightMm = el.getBoundingClientRect().height / pxPerMm;
      return { minHeight: mh, heightMm };
    });
    // 285mm 강제 흔적이 없어야 함 (auto 또는 콘텐츠 실높이).
    expect(r.minHeight === 'auto' || r.minHeight === '0px', `.rn-wrap min-height=${r.minHeight} (auto 기대)`).toBeTruthy();
    // 콘텐츠 실높이가 A4 1장(297mm) 이내 → 2페이지 미유발.
    expect(r.heightMm, `.rn-wrap 실높이 ${r.heightMm.toFixed(1)}mm < 297mm(A4 1장)`).toBeLessThan(297);
  });

  // ② KOH 인쇄 래퍼: print 미디어에서 body padding=0, 화면 미디어에서 12mm.
  //    printKohResult 의 <style> 문자열을 그대로 재현해 미디어별 body padding 을 실측.
  const KOH_WRAP_STYLE =
    '@page { size: A4 portrait; margin: 0; } html, body { margin: 0; } body { box-sizing: border-box; padding: 12mm; } @media print { body { padding:0 } }';

  test('②-render: KOH 인쇄문서 body padding — print=0 / screen=12mm', async ({ page }) => {
    const doc = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${KOH_WRAP_STYLE}</style></head><body><div id="koh-report-sheet">검사결과 보고서 본문</div></body></html>`;

    // screen: 12mm 인셋 유지 (회귀 0).
    await page.emulateMedia({ media: 'screen' });
    await page.setContent(doc, { waitUntil: 'networkidle' });
    const screenPad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);

    // print: padding 0 (빈 2페이지 원인 소멸).
    await page.emulateMedia({ media: 'print' });
    await page.setContent(doc, { waitUntil: 'networkidle' });
    const printPad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);

    const mm12 = Math.round(12 * 96 / 25.4); // ≈45px
    expect(Math.abs(parseFloat(screenPad) - mm12), `screen body padding ${screenPad} ≈ 12mm`).toBeLessThan(3);
    expect(parseFloat(printPad), `print body padding ${printPad} = 0`).toBe(0);
  });
});
