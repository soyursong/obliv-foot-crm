// T-20260629-foot-DOCPRINT-RRN-OMIT-RECUR: 전 서류 양식 주민번호(RRN) 바인딩·가시성 실측 하니스
// 목적(AC-1 진단 / AC-2 검증): 각 양식을 실제 인쇄 경로(@media print)로 렌더하여
//   (1) RRN 플레이스홀더가 존재하는가  (2) 바인딩된 RRN 값이 렌더 결과 텍스트에 실제로 보이는가
//   (3) RRN 셀이 칸 안에서 잘리거나(overflow) 줄바꿈되어 "안 보임" 상태인가 를 측정.
// 실행: node scripts/T-20260629-foot-DOCPRINT-RRN-OMIT-RECUR_audit.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate, buildBillDetailItemsHtml } from '../src/lib/htmlFormTemplates.ts';

const RRN_FULL = '900101-1234567';           // 현실적 13자리(하이픈 포함 14자) — 마스킹 없는 worst-case 폭
const RRN_FRONT = '900101';
const RRN_BACK = '1234567';

const BILL_ITEMS = buildBillDetailItemsHtml([
  { category: '처치', date: '2026-06-29', code: 'MM072', name: '체외충격파 치료(족저근막염)', amount: 120000, count: 1, days: 1, is_insurance_covered: false },
  { category: '검사', date: '2026-06-29', code: 'B2001', name: '균검사(KOH)', amount: 30000, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 9000 },
]);

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007', visit_no: 'V-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient@example.com',
  patient_birthdate: '1990-01-01', birth_date: '1990-01-01',
  patient_rrn: RRN_FULL, rrn_front: RRN_FRONT, rrn_back: RRN_BACK,
  patient_address: '서울특별시 종로구 종로12길 45, 6층 601호',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염',
  diagnosis_ko: '좌측 발뒤꿈치 통증.', treatment_opinion: '체외충격파 6주.',
  diagnosis: '족저근막염', medical_history: '3개월 통증.',
  referral_content: '추가 진료 의뢰.', referral_to_hospital: '서울대병원',
  referral_year: '2026', referral_month: '06', referral_day: '29',
  visit_date: '2026-06-29', issue_date: '2026년 06월 29일',
  clinic_name: '오블리브의원 종로점', clinic_address: '서울 종로구 우정국로 26',
  clinic_phone: '02-123-4567', doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: '<span>직인</span>',
  items_html: BILL_ITEMS,
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
  total_amount: '120,000', patient_pay: '120,000', dept_name: '정형외과',
};

const FORMS = [
  ['diagnosis', 'portrait'], ['treat_confirm', 'portrait'], ['visit_confirm', 'portrait'],
  ['diag_opinion', 'portrait'], ['diag_opinion_v2', 'portrait'], ['payment_cert', 'portrait'],
  ['referral_letter', 'portrait'], ['medical_record_request', 'portrait'], ['rx_standard', 'portrait'],
  ['bill_receipt', 'portrait'], ['ins_claim_form', 'portrait'], ['koh_result', 'portrait'],
  ['bill_detail', 'landscape'],
];

fs.mkdirSync('evidence/docprint-rrn', { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const [formKey, orient] of FORMS) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { results.push({ formKey, placeholder: false, note: 'NO TEMPLATE' }); continue; }
  const hasPlaceholder = /\{\{patient_rrn\}\}|\{\{rrn_front\}\}|\{\{rrn_back\}\}/.test(raw);
  const html = bindHtmlTemplate(raw, SAMPLE);
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print' });
  const pageWmm = orient === 'landscape' ? 297 : 210;
  const pageHmm = orient === 'landscape' ? 210 : 297;
  await page.setViewportSize({ width: Math.round(pageWmm * 96 / 25.4), height: Math.round(pageHmm * 96 / 25.4) });
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    @page { size: A4 ${orient}; margin: 0; }
    body { margin: 0; padding: 0; }
    .page { position: relative; width: ${pageWmm}mm; min-height: ${pageHmm}mm; overflow: hidden; }
    .page-landscape { width: 297mm; min-height: 210mm; }
  </style></head><body><div class="${pageCls}">${html}</div></body></html>`, { waitUntil: 'networkidle' });

  // 1) RRN 값이 렌더 텍스트에 보이는가  2) RRN 셀이 잘리거나(overflow) 다줄로 깨지는가
  const probe = await page.evaluate(({ rrnFull, rrnFront }) => {
    const bodyText = document.body.innerText || '';
    const visibleFull = bodyText.replace(/\s/g, '').includes(rrnFull.replace(/\s/g, ''));
    const visibleSplit = bodyText.includes(rrnFront);  // 진료의뢰서 rrn_front/back 분리형
    // RRN 텍스트를 품은 셀의 clip/wrap 측정
    let clipped = false, lines = 0, cellW = 0;
    const cells = [...document.querySelectorAll('td, span, div')];
    for (const el of cells) {
      const t = (el.textContent || '').replace(/\s/g, '');
      if (!t.includes(rrnFull.replace(/\s/g, '')) && !t.includes(rrnFront + '-')) continue;
      // 가장 안쪽(리프) 셀만
      if ([...el.children].some(c => (c.textContent || '').includes(rrnFront))) continue;
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
      lines = new Set(rects.map(r => Math.round(r.top))).size;
      cellW = Math.round(el.clientWidth);
      clipped = el.scrollWidth - el.clientWidth > 2;
      break;
    }
    return { visibleFull, visibleSplit, clipped, lines, cellW };
  }, { rrnFull: RRN_FULL, rrnFront: RRN_FRONT });

  await page.screenshot({ path: `evidence/docprint-rrn/${formKey}.png`, fullPage: true });
  await page.close();
  results.push({ formKey, placeholder: hasPlaceholder, ...probe });
}
await browser.close();

console.log('=== T-20260629 서류 RRN 바인딩·가시성 실측 ===');
console.log('form'.padEnd(26), 'placeholder', 'rrn_visible', 'clipX', 'lines', 'cellW');
// 회귀 판정(BIND-FAIL): 플레이스홀더가 있는데 렌더 텍스트에 RRN 값이 안 보임 = 진짜 바인딩 회귀.
// clip/lines 는 정보성(칸너비는 별도 COLWIDTH-WRAP 축) — 본 가드의 실패 조건 아님.
let bindFail = 0;
for (const r of results) {
  const vis = r.visibleFull || r.visibleSplit;
  const isBindFail = r.placeholder && !vis;
  if (isBindFail) bindFail++;
  const flag = isBindFail ? ' ❌BIND-FAIL'
    : (r.placeholder && (r.clipped || r.lines >= 2) ? ' ⓘclip/wrap(정보성·COLWIDTH축)' : '');
  console.log(
    r.formKey.padEnd(26),
    String(r.placeholder).padEnd(11),
    String(!!vis).padEnd(11),
    String(!!r.clipped).padEnd(5),
    String(r.lines ?? '').padEnd(5),
    String(r.cellW ?? ''), flag, r.note ? `(${r.note})` : ''
  );
}
const bound = results.filter(r => r.placeholder).length;
const visible = results.filter(r => r.placeholder && (r.visibleFull || r.visibleSplit)).length;
console.log(`\nRRN 플레이스홀더 보유 양식: ${bound}종 / 그중 RRN 값 렌더 가시: ${visible}종 / BIND-FAIL: ${bindFail}종`);
console.log('플레이스홀더 부재(설계상 RRN 미표기 — NHIS 세부산정내역 첨부·균검사 결과지): '
  + results.filter(r => !r.placeholder && !r.note).map(r => r.formKey).join(', '));
console.log(bindFail === 0
  ? '\n✅ AC-2 충족: RRN-보유 전 양식에서 주민번호 값이 실제 바인딩·렌더됨 (회귀 0건).'
  : `\n❌ 회귀 감지: ${bindFail}종 양식에서 RRN 플레이스홀더가 값으로 치환되지 않음.`);
process.exit(bindFail === 0 ? 0 : 1);
