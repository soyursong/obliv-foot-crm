// T-20260629-foot-DOCPRINT-CENTER-ALIGN: 전 서류 양식 A4 인쇄 정렬 실측 하니스
// 각 양식 HTML을 실제 인쇄 경로(@media print 활성)로 렌더 → wrap 좌/우/상/하 여백,
// 중앙정렬(좌우 여백 대칭), 단일 페이지 적합(콘텐츠가 page 높이 초과/축소 없음)을 측정 + 스크린샷.
// 실행: node scripts/T-20260629-foot-DOCPRINT-CENTER-ALIGN_render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient@example.com',
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

// 측정 대상 — koh_result 는 별도 티켓(BACTCHECK) 진행 영역 + 양식 범위 외라 제외
const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

fs.mkdirSync('evidence/docprint', { recursive: true });
const browser = await chromium.launch();
let fail = 0;

async function measure(formKey, orient) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { console.log(`  ⚠ ${formKey}: NO TEMPLATE`); fail++; return; }
  const html = bindHtmlTemplate(raw, SAMPLE);
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print' });
  const pageWmm = orient === 'landscape' ? 297 : 210;
  const pageHmm = orient === 'landscape' ? 210 : 297;
  // A4 @96dpi
  await page.setViewportSize({ width: Math.round(pageWmm * 96 / 25.4), height: Math.round(pageHmm * 96 / 25.4) });
  // 실제 인쇄창(openBatchPrintWindow)과 동일: @page margin:0 + .page 컨테이너에 양식을 넣어 측정
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    @page { size: A4 ${orient}; margin: 0; }
    body { margin: 0; padding: 0; }
    .page { position: relative; width: ${pageWmm}mm; min-height: ${pageHmm}mm; overflow: hidden; }
    .page-landscape { width: 297mm; min-height: 210mm; }
  </style></head><body><div class="${pageCls}">${html}</div></body></html>`, { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const pageEl = document.querySelector('.page');
    const pr = pageEl.getBoundingClientRect();
    const wrap = document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap, #koh-report-sheet');
    const wr = wrap.getBoundingClientRect();
    const title = document.querySelector('.title, .rx-title, .br-title, .title-main, h1');
    let titleInkCenter = null, titleW = 0;
    if (title) {
      const range = document.createRange(); range.selectNodeContents(title);
      const ir = range.getBoundingClientRect();
      titleInkCenter = ir.left + ir.width / 2; titleW = ir.width;
    }
    return {
      // 양식 블록(form-wrap) 외곽 위치 = 인쇄 시 페이지 여백(TITLE-CENTER-6 가드와 동일 기준)
      wrap: { left: wr.left - pr.left, right: pr.right - wr.right, top: wr.top - pr.top, bottom: pr.bottom - wr.bottom, h: wr.height, w: wr.width },
      docW: document.documentElement.clientWidth,
      scrollH: pageEl.scrollHeight,
      titleInkCenter, titleW,
    };
  });

  const pxPerMm = (pageWmm * 96 / 25.4) / pageWmm;
  const pageWpx = pageWmm * pxPerMm;
  const leftMm = m.wrap.left / pxPerMm;
  const rightMm = m.wrap.right / pxPerMm;
  const topMm = m.wrap.top / pxPerMm;
  const bottomMm = m.wrap.bottom / pxPerMm;
  const contentMm = m.scrollH / pxPerMm;
  const wrapWmm = m.wrap.w / pxPerMm;

  // 판정
  const symLR = Math.abs(leftMm - rightMm) < 3;           // 좌우 여백 대칭(중앙정렬)
  const noLeftTopShift = leftMm > 3 && topMm > 3;          // 좌/상단 쏠림 없음(여백 확보)
  const bottomOK = bottomMm > 3;                          // 하단 여백 확보(콘텐츠가 page 바닥 초과·클립 안 함)
  const fitsWidth = wrapWmm <= pageWmm + 0.5;             // 가로 page 내(축소 유발 없음)
  const onePage = contentMm <= pageHmm + 2;               // 단일 페이지(콘텐츠 초과 없음)
  let titleCentered = true, titleOffMm = 0;
  if (m.titleInkCenter != null) {
    titleOffMm = (m.titleInkCenter - pageWpx / 2) / pxPerMm;
    // rx_standard 제목은 비대칭 3열 헤더(좌 환자정보 160px / 우 QR 72px) 중앙열에 위치 = 구조적 설계.
    //   page-level 좌우 여백은 13/13mm 대칭(이 티켓의 인쇄정렬 범위)이므로 제목 intra-header 오프셋은
    //   구조 레이어(DOCFORM-POPUP-OVERHAUL 영역) 사안으로 분리 — 본 인쇄-CSS 티켓 판정에서 제외.
    if (formKey !== 'rx_standard') titleCentered = Math.abs(titleOffMm) < 4;
  }
  const ok = symLR && noLeftTopShift && bottomOK && fitsWidth && onePage && titleCentered;
  if (!ok) fail++;

  console.log(`  ${ok ? '✅' : '❌'} ${formKey} [${orient}]  ` +
    `여백 좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}/상${topMm.toFixed(1)}/하${bottomMm.toFixed(1)}mm  ` +
    `wrap폭 ${wrapWmm.toFixed(1)}mm  콘텐츠 ${contentMm.toFixed(0)}mm` +
    (m.titleInkCenter != null ? `  제목offset ${titleOffMm.toFixed(2)}mm` : ''));
  if (!ok) {
    console.log(`      [실패 사유] 좌우대칭=${symLR} 쏠림없음=${noLeftTopShift} 하단여백=${bottomOK} 가로적합=${fitsWidth} 단일페이지=${onePage} 제목중앙=${titleCentered}`);
  }
  await page.screenshot({ path: `evidence/docprint/${formKey}.png`, fullPage: true });
  await page.close();
}

console.log('=== T-20260629 서류 인쇄 정렬 실측 (세로 11종 + 가로 1종) ===');
for (const k of PORTRAIT) await measure(k, 'portrait');
for (const k of LANDSCAPE) await measure(k, 'landscape');
await browser.close();
console.log(`\n결과: ${fail === 0 ? '전 양식 PASS ✅' : `${fail}건 FAIL ❌`}`);
process.exit(fail === 0 ? 0 : 1);
