// T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 출력물 중앙·여백 배치 실측 하니스(엔진-충실).
//
// 직전 CENTER-ALIGN 하니스의 맹점: 양식을 .page(전폭 210mm) 안에서만 측정 → CSS상 중앙(좌10/우10mm)이라
//   PASS 였으나, 실제 프린트 엔진의 @page 물리 여백/shrink-to-fit 을 시뮬하지 못해 현장 좌상단 쏠림을 놓쳤다.
// 본 하니스: 인쇄창이 소유하는 @page margin(12mm 10mm)을 "시트(전체 A4) 안쪽 padding"으로 물리 재현하고,
//   콘텐츠박스(.page, A4-여백)를 그 안에 깔아 양식 wrap 의 위치를 "시트(인쇄 시트 전체) 기준"으로 측정한다.
//   = 프린터가 @page 여백을 존중해 시트 중앙에 배치한 실제 출력물 좌표와 동치.
// 실행: node scripts/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT_render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient@example.com',
  patient_birthdate: '1990-01-01', patient_rrn: '900101-1******', patient_address: '서울특별시 종로구 ○○로 00',
  birth_date: '1990-01-01', rrn_front: '900101', rrn_back: '1234567', remark: '-',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: '주',
  diag_code_2: 'M21.6', diag_name_2: '후천성 발 변형', diag_flag_2: '부',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속. 보존적 치료 반응 미흡하여 추가 관리 요함.',
  treatment_opinion: '족저근막 스트레칭 및 체외충격파 치료 6주 시행 권고.',
  diagnosis: '족저근막염 (M72.2)', medical_history: '3개월 전부터 좌측 발뒤꿈치 통증 지속.',
  referral_content: '정밀 영상검사 및 추가 진료 의뢰드립니다.', referral_to_hospital: '서울대학교병원',
  referring_doctor: '김원장', dept_name: '정형외과',
  referral_year: '2026', referral_month: '06', referral_day: '29',
  visit_date: '2026-06-29', treat_period: '2026-06-01 ~ 2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
  items_html: '<tr><td>2026-06-29</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
  total_amount: '120,000', patient_pay: '120,000',
};

// koh_result 는 별도 티켓(BACTCHECK) + §11 의료게이트(KOH 발급) 영역 → 본 인쇄-CSS 티켓 범위 외.
const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

// 인쇄창 @page margin (DocumentPrintPanel/printOpinionDoc 와 동일)
const PAGE_MARGIN_TB = 12; // 상·하
const PAGE_MARGIN_LR = 10; // 좌·우

fs.mkdirSync('evidence/docprint-v2', { recursive: true });
const browser = await chromium.launch();
let fail = 0;

async function measure(formKey, orient) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { console.log(`  ⚠ ${formKey}: NO TEMPLATE`); fail++; return; }
  const html = bindHtmlTemplate(raw, SAMPLE);
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print' });
  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  await page.setViewportSize({ width: Math.round(sheetWmm * 96 / 25.4), height: Math.round(sheetHmm * 96 / 25.4) });
  const boxWmm = sheetWmm - 2 * PAGE_MARGIN_LR;   // 콘텐츠박스(= A4 - @page 좌우여백)
  const boxHmm = sheetHmm - 2 * PAGE_MARGIN_TB;
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  // 시트(전체 인쇄 시트, A4) 안쪽 padding = @page margin(물리 재현) → 그 안에 콘텐츠박스(.page).
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .sheet { box-sizing: border-box; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm;
             padding: ${PAGE_MARGIN_TB}mm ${PAGE_MARGIN_LR}mm; background: #fff; }
    .page { position: relative; width: 100%; min-height: ${boxHmm}mm; overflow: visible; }
    .page-landscape { width: 100%; min-height: 186mm; }
  </style></head><body><div class="sheet"><div class="${pageCls}">${html}</div></div></body></html>`,
    { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const wrap = document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap').getBoundingClientRect();
    return {
      // 양식 wrap 외곽 위치 = 인쇄 시트(전체 A4) 기준 물리 여백
      left: wrap.left - sheet.left, right: sheet.right - wrap.right,
      top: wrap.top - sheet.top, bottom: sheet.bottom - wrap.bottom,
      wrapW: wrap.width, sheetH: document.querySelector('.sheet').scrollHeight,
    };
  });

  const pxPerMm = (sheetWmm * 96 / 25.4) / sheetWmm;
  const leftMm = m.left / pxPerMm, rightMm = m.right / pxPerMm;
  const topMm = m.top / pxPerMm, bottomMm = m.bottom / pxPerMm;
  const wrapWmm = m.wrapW / pxPerMm, sheetHpx = m.sheetH / pxPerMm;

  // 판정 — 시트(전체 A4) 기준 물리 여백
  const symLR = Math.abs(leftMm - rightMm) < 3;            // 좌우 대칭(중앙정렬, AC-2)
  const symTB = Math.abs(topMm - bottomMm) < 4;            // 상하 균형(AC-3)
  const noShift = leftMm > 5 && topMm > 5;                 // 좌·상단 쏠림 없음(AC-2/3)
  const bottomOK = bottomMm > 5;                           // 하단 여백 확보(클립 없음, AC-3)
  const fitsBox = wrapWmm <= boxWmm + 0.5;                 // 콘텐츠박스 내(축소 유발 없음, AC-2)
  const onePage = sheetHpx <= sheetHmm + 2;                // 단일 페이지(넘침 없음, AC-3)
  const ok = symLR && symTB && noShift && bottomOK && fitsBox && onePage;
  if (!ok) fail++;

  console.log(`  ${ok ? '✅' : '❌'} ${formKey} [${orient}]  ` +
    `여백 좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}/상${topMm.toFixed(1)}/하${bottomMm.toFixed(1)}mm  ` +
    `wrap폭 ${wrapWmm.toFixed(1)}mm(박스 ${boxWmm}mm)  시트 ${sheetHpx.toFixed(0)}mm`);
  if (!ok) {
    console.log(`      [실패] 좌우대칭=${symLR} 상하균형=${symTB} 쏠림없음=${noShift} 하단여백=${bottomOK} 박스적합=${fitsBox} 단일페이지=${onePage}`);
  }
  await page.screenshot({ path: `evidence/docprint-v2/${formKey}.png`, fullPage: true });
  await page.close();
}

console.log('=== T-20260629 DOCOUTPUT 인쇄 정렬 실측(엔진-충실: @page 여백 물리 재현) ===');
for (const k of PORTRAIT) await measure(k, 'portrait');
for (const k of LANDSCAPE) await measure(k, 'landscape');
await browser.close();
console.log(`\n결과: ${fail === 0 ? '전 양식 PASS ✅' : `${fail}건 FAIL ❌`}`);
process.exit(fail === 0 ? 0 : 1);
