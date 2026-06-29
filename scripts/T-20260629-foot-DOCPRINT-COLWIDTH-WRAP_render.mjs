// T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 전 서류 양식 칸(컬럼) 너비·줄바꿈 실측 하니스
// 각 양식을 실제 인쇄 경로(@media print)로 렌더 → 값(데이터) 셀이 칸 안에서 2줄 이상으로
// 줄바꿈되는지 측정. 특히 주소칸. 긴 현장 데이터(장주소·장명칭)로 worst-case 재현.
// 실행: node scripts/T-20260629-foot-DOCPRINT-COLWIDTH-WRAP_render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate, buildBillDetailItemsHtml } from '../src/lib/htmlFormTemplates.ts';

// bill_detail 은 실제 운영 경로(buildBillDetailItemsHtml)로 항목행을 생성해야 충실한 측정이 된다.
// (수기 items_html 은 운영 스타일(7.5pt·nowrap)을 반영하지 못해 거짓 줄바꿈을 만든다.)
const BILL_ITEMS = buildBillDetailItemsHtml([
  { category: '처치', date: '2026-06-29', code: 'MM072', name: '체외충격파 치료(족저근막염)', amount: 120000, count: 1, days: 1, is_insurance_covered: false },
  { category: '검사', date: '2026-06-29', code: 'B2001', name: '균검사(KOH)', amount: 30000, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 9000 },
]);

// worst-case 현장 데이터: 긴 도로명주소(상세주소·동호수 포함) + 긴 기관명
const LONG_ADDR = '서울특별시 종로구 종로12길 45, 6층 601호 (관철동, 오블리브빌딩)';
const LONG_CLINIC_ADDR = '서울특별시 종로구 우정국로 26, 3층 (종로1가, 센트로폴리스빌딩 A동)';
const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007',
  visit_no: 'V-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient.longname@example-clinic.com',
  patient_birthdate: '1990-01-01', patient_rrn: '900101-1******',
  patient_address: LONG_ADDR,
  birth_date: '1990-01-01', rrn_front: '900101', rrn_back: '1234567', remark: '-',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: '주',
  diag_code_2: 'M21.6', diag_name_2: '후천성 발 변형(요족)', diag_flag_2: '부',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속. 보존적 치료 반응 미흡하여 추가 관리 요함.',
  treatment_opinion: '족저근막 스트레칭 및 체외충격파 치료 6주 시행 권고.',
  diagnosis: '족저근막염 (M72.2)', medical_history: '3개월 전부터 좌측 발뒤꿈치 통증 지속.',
  referral_content: '정밀 영상검사 및 추가 진료 의뢰드립니다.', referral_to_hospital: '서울대학교병원 정형외과',
  referring_doctor: '김원장', dept_name: '정형외과',
  referral_year: '2026', referral_month: '06', referral_day: '29',
  visit_date: '2026-06-29', treat_period: '2026-06-01 ~ 2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: LONG_CLINIC_ADDR, clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
  items_html: BILL_ITEMS,
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
  total_amount: '120,000', patient_pay: '120,000',
};

const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

fs.mkdirSync('evidence/docprint-wrap', { recursive: true });
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
  await page.setViewportSize({ width: Math.round(pageWmm * 96 / 25.4), height: Math.round(pageHmm * 96 / 25.4) });
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    @page { size: A4 ${orient}; margin: 0; }
    body { margin: 0; padding: 0; }
    .page { position: relative; width: ${pageWmm}mm; min-height: ${pageHmm}mm; overflow: hidden; }
    .page-landscape { width: 297mm; min-height: 210mm; }
  </style></head><body><div class="${pageCls}">${html}</div></body></html>`, { waitUntil: 'networkidle' });

  // 값 셀(데이터 칸) 중 2줄 이상 줄바꿈 / 가로 overflow 검출.
  // 라벨 셀(배경 f8f8f8/f0f0f0, .label-cell)·자유서술 영역(large-area/legal-text/min-height 큰 칸)은 제외.
  const wraps = await page.evaluate(() => {
    const LABEL_BG = ['rgb(248, 248, 248)', 'rgb(240, 240, 240)'];
    const out = [];
    const cells = [...document.querySelectorAll('td, .value-cell, span[style*="border-bottom"]')];
    for (const el of cells) {
      const cs = getComputedStyle(el);
      if (LABEL_BG.includes(cs.backgroundColor)) continue;          // 라벨 셀 제외
      if (el.classList.contains('label-cell')) continue;
      if (el.classList.contains('large-area') || el.classList.contains('legal-text')) continue;
      if (cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'pre') continue;  // 자유서술(소견/참고) 칸 제외
      const html = el.innerHTML || '';
      if (html.includes('<br')) continue;                          // 의도적 줄바꿈(라벨 2줄·코드 stacked) 제외
      if (el.textContent && el.textContent.includes('직인')) continue;  // 의사 서명+도장 블록(설계상 다줄) 제외
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      if (txt.length < 4) continue;                                // 짧은 코드/플래그 칸 제외
      // 줄 수 = 텍스트 range client rect 개수(시각 줄 수 근사)
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
      // 같은 top 끼리 묶어 줄 수 계산
      const tops = new Set(rects.map(r => Math.round(r.top)));
      const lineCount = tops.size;
      const overflowX = el.scrollWidth - el.clientWidth > 2;
      if (lineCount >= 2 || overflowX) {
        out.push({ tag: el.tagName, lines: lineCount, overflowX, w: Math.round(el.clientWidth), text: txt.slice(0, 40) });
      }
    }
    return out;
  });

  const ok = wraps.length === 0;
  if (!ok) fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${formKey} [${orient}]  줄바꿈/overflow 칸 ${wraps.length}건`);
  for (const w of wraps) {
    console.log(`      · ${w.lines}줄${w.overflowX ? '+overflowX' : ''}  폭${w.w}px  "${w.text}"`);
  }
  await page.screenshot({ path: `evidence/docprint-wrap/${formKey}.png`, fullPage: true });
  await page.close();
}

console.log('=== T-20260629 서류 칸 너비·줄바꿈 실측 (긴 주소/명칭 worst-case) ===');
for (const k of PORTRAIT) await measure(k, 'portrait');
for (const k of LANDSCAPE) await measure(k, 'landscape');
await browser.close();
console.log(`\n결과: ${fail === 0 ? '전 양식 줄바꿈 0건 ✅' : `${fail}건 양식에 줄바꿈/overflow 잔존 ❌`}`);
process.exit(fail === 0 ? 0 : 1);
