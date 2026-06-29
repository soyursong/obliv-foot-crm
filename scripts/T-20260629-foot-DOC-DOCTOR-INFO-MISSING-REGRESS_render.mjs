// T-20260629-foot-DOC-DOCTOR-INFO-MISSING-REGRESS — 의사정보 렌더 실측 하니스 (read-only)
// 현장: "서류에 의사 정보(면허번호·성명) 다 누락".
// autoBindContext 가 라이브 데이터로 산출하는 실제 의사정보 값을 그대로 주입해
// 면허번호-보유 양식 전수를 렌더 → 의사 성명/면허번호 노출 여부를 assert + 캡처.
// 라이브 DB 실측값: clinic_doctors = 문지은 / license_no=145617 / specialist_no=145617 / seal_image=없음.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

// autoBindContext.buildAutoBindValues(L243-255) 가 라이브 데이터로 채우는 의사정보 (실측 그대로):
const DOCTOR = {
  doctor_name: '문지은',
  doctor_license_no: '145617',
  doctor_specialist_no: '145617',
  // seal_image_url 가 null → autoBindContext SEAL-NULL-FALLBACK(텍스트 직인). 성명/면허와 무관.
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
};
const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', visit_no: '1', request_no: 'R-2026-0007',
  patient_name: '홍길동', patient_gender: '☑ 남  ☐ 여', patient_age: '35', patient_rrn: '900101-1******',
  patient_phone: '010-1234-5678', patient_address: '서울 종로구', patient_email: 'p@example.com',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: '주',
  treatment_opinion: '체외충격파 6주 권고.', onset_date: '2026-03-01', issue_date: '2026년 06월 29일',
  visit_date: '2026-06-29', memo: '-', purpose: '제출용',
  clinic_name: '오블리브 풋센터 종로', clinic_address: '서울 종로구 ○○로 00', clinic_phone: '02-123-4567',
  clinic_nhis_code: '12345678', clinic_business_no: '123-45-67890',
  items_html: '<tr><td>2026-06-29</td><td>체외충격파</td><td class="num-cell">120,000</td></tr>',
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td></tr>',
  total_amount: '120,000', insurance_covered: '0', copayment: '0', non_covered: '120,000',
  ...DOCTOR,
};

// 면허번호 placeholder 를 가진 양식 = 의사정보 노출 대상 (grep 결과: 286/417/546/696/1248/1385)
const LICENSE_FORMS = ['diagnosis', 'diag_opinion', 'diag_opinion_v2', 'payment_cert',
  'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];

fs.mkdirSync('evidence/doctor-info-regress', { recursive: true });
const browser = await chromium.launch();
let fail = 0, checked = 0;

for (const formKey of LICENSE_FORMS) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { console.log(`  ⚠ ${formKey}: NO TEMPLATE (skip)`); continue; }
  const hasLicensePh = raw.includes('{{doctor_license_no}}');
  const hasNamePh = raw.includes('{{doctor_name}}');
  const html = bindHtmlTemplate(raw, SAMPLE);

  const nameOk = html.includes('문지은');
  const licOk = html.includes('145617');
  checked++;

  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
    <style>@page{size:A4 portrait;margin:0}body{margin:0}.page{width:210mm;min-height:297mm}</style>
    </head><body><div class="page">${html}</div></body></html>`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `evidence/doctor-info-regress/${formKey}.png`, fullPage: true });
  await page.close();

  const verdict = (hasNamePh ? (nameOk ? '성명OK' : '성명누락❌') : '성명placeholder없음')
    + ' / ' + (hasLicensePh ? (licOk ? '면허OK' : '면허누락❌') : '면허placeholder없음');
  if ((hasNamePh && !nameOk) || (hasLicensePh && !licOk)) fail++;
  console.log(`  ${formKey}: ${verdict}`);
}

await browser.close();
console.log(`\n검사 ${checked}건 / 누락 ${fail}건`);
console.log(fail === 0
  ? '✅ 모든 면허/성명 placeholder 보유 양식에서 의사정보 정상 렌더 (데이터·바인딩·렌더 무결)'
  : '❌ 일부 양식 의사정보 누락 — 코드 회귀 확인됨');
process.exit(fail === 0 ? 0 : 1);
