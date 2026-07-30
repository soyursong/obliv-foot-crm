/**
 * E2E spec — T-20260730-foot-DOC-LAYOUT-REFIX-3
 *
 * f92dd989(T-20260729-foot-DOC-LAYOUT-FIX) 회귀 + 잔여 결함 3건 정정에 대한 "수용성(acceptance)" 회귀 가드.
 *   기존 22 스펙은 전부 문자열/기하 검증뿐이라 "칸 안의 내용이 실제로 들어가는가"를 보는 단언이 0건이었다.
 *   → 도장이 칸 밖으로 걸치고, 상호명이 전화칸을 침범해도 22 PASS 로 통과했다. 이번엔 @media print 실렌더 불변식을 넣는다.
 *
 *   ① 세부산정내역 직인: 도장 img 가 직인칸(8%) 안에 여유 있게 수용(img.offsetWidth <= td.clientWidth - paddingLR).
 *   ② 계산서·영수증 상호 값칸(21%): nowrap 상호명이 넘치지 않음(td.scrollWidth <= td.clientWidth).
 *   ③ 계산서·영수증 전화번호 라벨칸(11%): 넘침 0(동일 단언).
 *   ④ 소견서 '특 정 기 호' 헤더: nowrap 으로 1줄(Range.getClientRects().length === 1).
 *   ⑤ 진단서(DIAGNOSIS_HTML) 무접촉: 특정기호 + nowrap 조합 부재(회귀 가드).
 *   ⑥ 총폭 불변: 세부내역 하단표·영수증 하단표가 width:100% 로 컨테이너 콘텐츠폭을 채움(colgroup 재분배는 총폭 불변).
 *
 * 렌더 하니스는 openBatchPrintWindow(DocumentPrintPanel.tsx:475~)의 styleBlock 을 그대로 복제해
 * .page/.page-landscape 로 감싼다. @page 는 래퍼가 소유한다(템플릿 무접촉).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractTemplate(name: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${name} 상수 존재`).not.toBeNull();
  return m![1];
}

// 52px 도장 img (현장 인장 실크기 = autoBindContext.ts:416 width:52px 와 동일)
const SEAL_IMG =
  '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="width:52px; height:52px;" alt="인" />';

// 현장 사진 실값(서울오리진점, nowrap 상호명 worst-case). ③ 침범 재현/해소 검증용.
const SAMPLE: Record<string, string> = {
  record_no: 'F-5049', chart_number: 'F-5049', visit_no: 'V-0007',
  patient_name: '고현석', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_birthdate: '1990-01-01',
  patient_rrn: '900101-1******', patient_address: '서울 종로구 청계천로 93 5층',
  onset_date: '2026-06-01',
  diag_code_1: 'K297', diag_name_1: '위염', diag_flag_1: '',
  diag_code_2: 'B351', diag_name_2: '손발톱백선', diag_flag_2: '',
  diag_code_3: 'B353', diag_name_3: '체부백선', diag_flag_3: '',
  diag_code_4: 'L600', diag_name_4: '함입발톱', diag_flag_4: '',
  diag_row_3_style: '', diag_row_4_style: '',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속.', memo: '특이사항 없음', purpose: '보험 청구용',
  visit_date: '2026-06-29', visit_days: '1',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 서울오리진점',
  clinic_address: '서울 종로구 청계천로 93 5층', clinic_phone: '02-6956-3438',
  clinic_code: '11111111', hira_institution_name: '오블리브의원 서울오리진점',
  doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: SEAL_IMG, institution_seal_html: SEAL_IMG,
  receipt_no: 'RN-2026-0007', receipt_representative: '박영진',
  night_mark: ' ', holiday_mark: ' ',
  consult_copay: '8,800', consult_ins: '0', proc_copay: '', proc_ins: '', proc_noncov: '120,000',
  exam_copay: '', exam_ins: '', exam_noncov: '', etc_noncov: '',
  copayment: '8,800', insurance_covered: '0', non_covered: '120,000', total_amount: '128,800',
  patient_amount: '128,800', already_paid: '', due_amount: '', card_amount: '128,800',
  cashreceipt_amount: '', cash_amount: '', paid_total: '128,800', unpaid_amount: '0',
  cashreceipt_mark: ' ', cashreceipt_id_number: '', cashreceipt_approval_no: '',
  items_html: '<tr><td>기본</td><td>2026-06-29</td><td>SC001</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td>1</td><td class="num-cell">120,000</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">120,000</td></tr>',
  detail_subtotal: '120,000', subtotal_copayment: '0', subtotal_fund: '0', subtotal_noncovered: '120,000',
  detail_rounding: '0', detail_total: '120,000',
};

// openBatchPrintWindow(DocumentPrintPanel.tsx:475~) styleBlock 복제. @page 는 래퍼 소유.
function styleBlock(landscape: boolean): string {
  const pageRule = landscape ? '@page { size: A4 landscape; margin: 0; }' : '@page { size: A4 portrait; margin: 0; }';
  const pageW = landscape ? '297mm' : '210mm';
  const pageH = landscape ? '210mm' : '297mm';
  return `
  ${pageRule}
  html, body { margin: 0; padding: 0; }
  .page {
    box-sizing: border-box; position: relative;
    width: ${pageW}; min-height: ${pageH};
    padding: 23mm 10mm 12mm; overflow: visible; page-break-after: always;
  }
  .page-landscape { box-sizing: border-box; width: 297mm; min-height: 210mm; padding: 23mm 10mm 12mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page:last-child { page-break-after: avoid; }
  }`;
}

// bill_detail 만 landscape (DocumentPrintPanel.tsx:313 isLandscape = form_key==='bill_detail').
async function renderPrint(page: import('@playwright/test').Page, formKey: string) {
  const landscape = formKey === 'bill_detail';
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿`).toBeTruthy();
  const bound = bindHtmlTemplate(raw as string, SAMPLE);
  const vwmm = landscape ? 297 : 210, vhmm = landscape ? 210 : 297;
  const vw = Math.round(vwmm * 96 / 25.4), vh = Math.round(vhmm * 96 / 25.4);
  await page.setViewportSize({ width: vw, height: vh });
  await page.emulateMedia({ media: 'print' });
  const cls = landscape ? 'page page-landscape' : 'page';
  await page.setContent(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${styleBlock(landscape)}</style></head>` +
    `<body><div class="${cls}">${bound}</div></body></html>`,
    { waitUntil: 'networkidle' }
  );
}

test.describe('DOC-LAYOUT-REFIX-3 수용성 실렌더 불변식', () => {
  // ① 세부내역 직인칸: 도장 img 가 칸 안에 여유 있게 수용 (넘침 0).
  test('①-render: 세부산정내역 직인이 직인칸(8%) 안에 수용(여유 ≥ 0)', async ({ page }) => {
    await renderPrint(page, 'bill_detail');
    const r = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('.bill-wrap table')) as HTMLElement[];
      const t = tables.find(x => x.innerText.includes('요양기관 명칭') && x.innerText.includes('대 표 자'));
      if (!t) return null;
      const img = t.querySelector('img') as HTMLElement | null;
      if (!img) return null;
      const td = img.closest('td') as HTMLElement;
      const cs = getComputedStyle(td);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      return { imgW: img.offsetWidth, avail: td.clientWidth - pad };
    });
    expect(r, '발급기관표+직인 img 존재').not.toBeNull();
    expect(r!.imgW, `직인 img=${r!.imgW}px, 칸 가용=${r!.avail.toFixed(1)}px (여유 ${(r!.avail - r!.imgW).toFixed(1)}px ≥ 0)`).toBeLessThanOrEqual(r!.avail);
  });

  // ② 영수증 상호 값칸(21%): nowrap 상호명 넘침 0.
  test('②-render: 계산서·영수증 상호 값칸(21%) 넘침 0(scrollWidth ≤ clientWidth)', async ({ page }) => {
    await renderPrint(page, 'bill_receipt_new');
    const r = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('.rn-wrap td')) as HTMLElement[];
      const lbl = tds.find(x => x.textContent?.trim() === '상호');
      const val = lbl?.nextElementSibling as HTMLElement | null; // 상호 값칸(col4)
      if (!val) return null;
      return { scroll: val.scrollWidth, client: val.clientWidth, text: val.textContent };
    });
    expect(r, '상호 라벨+값칸 존재').not.toBeNull();
    expect(r!.scroll, `상호값 "${r!.text}" scroll=${r!.scroll} ≤ client=${r!.client}`).toBeLessThanOrEqual(r!.client);
  });

  // ③ 영수증 전화번호 라벨칸(11%): 넘침 0.
  test('③-render: 계산서·영수증 전화번호 라벨칸(11%) 넘침 0', async ({ page }) => {
    await renderPrint(page, 'bill_receipt_new');
    const r = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('.rn-wrap td')) as HTMLElement[];
      const lbl = tds.find(x => x.textContent?.trim() === '전화번호');
      if (!lbl) return null;
      return { scroll: lbl.scrollWidth, client: lbl.clientWidth };
    });
    expect(r, '전화번호 라벨칸 존재').not.toBeNull();
    expect(r!.scroll, `전화번호 라벨 scroll=${r!.scroll} ≤ client=${r!.client}`).toBeLessThanOrEqual(r!.client);
  });

  // ④ 소견서 '특 정 기 호' 헤더: nowrap → 1줄.
  test('④-render: 소견서 특 정 기 호 헤더 1줄(nowrap, getClientRects===1)', async ({ page }) => {
    await renderPrint(page, 'diag_opinion');
    const lines = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('td')) as HTMLElement[];
      const cell = tds.find(x => x.textContent?.replace(/\s/g, '') === '특정기호');
      if (!cell || !cell.firstChild) return -1;
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getClientRects().length;
    });
    expect(lines, '특 정 기 호 셀 존재').toBeGreaterThan(0);
    expect(lines, `특 정 기 호 줄수=${lines} (1줄이어야 함)`).toBe(1);
  });

  // ⑤ 진단서(DIAGNOSIS_HTML) 무접촉 — 특정기호 + nowrap 조합 부재(회귀 가드). 문자열 검증.
  test('⑤: 진단서 DIAGNOSIS_HTML 특정기호 nowrap 무접촉(회귀 가드)', () => {
    const DIAG = extractTemplate('DIAGNOSIS_HTML');
    expect(DIAG).not.toMatch(/width:70px; white-space:nowrap;">특 정 기 호/);
    expect(DIAG).toMatch(/width:70px;">특 정 기 호/); // 원형(nowrap 없음) 보존 확인
  });

  // ⑥ 총폭 불변 — 하단표는 width:100% 로 컨테이너 콘텐츠폭을 채움(colgroup 재분배는 총폭 무영향).
  test('⑥-render: 세부내역 하단표·영수증 하단표 총폭 = 컨테이너 콘텐츠폭(재분배 무영향)', async ({ page }) => {
    await renderPrint(page, 'bill_detail');
    const detail = await page.evaluate(() => {
      const wrap = document.querySelector('.bill-wrap') as HTMLElement;
      const tables = Array.from(wrap.querySelectorAll('table')) as HTMLElement[];
      const t = tables.find(x => x.innerText.includes('요양기관 명칭') && x.innerText.includes('대 표 자'))!;
      const cs = getComputedStyle(wrap);
      const content = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { table: t.getBoundingClientRect().width, content };
    });
    expect(Math.abs(detail.table - detail.content), `세부내역 하단표 폭=${detail.table.toFixed(1)} ≈ 콘텐츠폭=${detail.content.toFixed(1)}`).toBeLessThan(2);

    await renderPrint(page, 'bill_receipt_new');
    const receipt = await page.evaluate(() => {
      const wrap = document.querySelector('.rn-wrap') as HTMLElement;
      const tables = Array.from(wrap.querySelectorAll('table')) as HTMLElement[];
      const t = tables.find(x => x.innerText.includes('요양기관 종류') && x.innerText.includes('상호'))!;
      const cs = getComputedStyle(wrap);
      const content = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { table: t.getBoundingClientRect().width, content };
    });
    expect(Math.abs(receipt.table - receipt.content), `영수증 하단표 폭=${receipt.table.toFixed(1)} ≈ 콘텐츠폭=${receipt.content.toFixed(1)}`).toBeLessThan(2);
  });
});
