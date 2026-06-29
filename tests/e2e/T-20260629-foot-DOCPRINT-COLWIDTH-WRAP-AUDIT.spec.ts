/**
 * E2E spec — T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT
 * 전 서류 양식 출력 시 데이터 칸(컬럼) 줄바꿈 회귀 가드.
 *
 * 증상(현장, 김주연 총괄): 서류 출력물에서 텍스트가 칸 안에서 줄바꿈돼 레이아웃이 엉망.
 *                         특히 주소 기입칸 줄바꿈이 심함.
 * 원인: 4종 양식(진단서·진료확인서·통원확인서·소견서·보험청구서)에서 주소 값 칸이
 *       좁은 컬럼(콜스팬 2 또는 단일 컬럼 ~140px)에 묶여 긴 도로명주소가 2~3줄로 줄바꿈.
 *       bill_detail(가로) 등록번호·일자 칸 폭 부족으로 줄바꿈.
 * 수정(표현 레이어만 — print HTML/CSS·컬럼 width·colspan·nowrap, 데이터 바인딩 불변):
 *   주소 = 전폭(colspan=3) 단독 행으로 분리 → 단일 줄. 연령/연락처는 인접 칸/별행으로 재배치.
 *   진단서 병명 블록 = 별도 표 분리(상병명 컬럼 잔여폭 확보). bill_detail 데이터 칸 nowrap + 폭 확대.
 *
 * AC-1: 긴 도로명주소(상세주소·동호수 포함) worst-case 에서도 주소 값 칸이 단일 줄.
 * AC-2: 모든 데이터 값 칸이 2줄 이상 줄바꿈/가로 overflow 없음(의도적 <br>·서명도장·자유서술 제외).
 *
 * 실제 인쇄 경로(window.open + window.print)는 헤드리스 재현 불가 → 양식 HTML 을 print 미디어
 * 에뮬레이션으로 setContent 하여 값 칸의 시각 줄 수(Range client rect 묶음)를 측정한다.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate, buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

// worst-case 현장 데이터: 긴 도로명주소(상세주소·동호수·건물명) + 긴 기관명/상병명
const LONG_ADDR = '서울특별시 종로구 종로12길 45, 6층 601호 (관철동, 오블리브빌딩)';
const LONG_CLINIC_ADDR = '서울특별시 종로구 우정국로 26, 3층 (종로1가, 센트로폴리스빌딩 A동)';

const BILL_ITEMS = buildBillDetailItemsHtml([
  { category: '처치', date: '2026-06-29', code: 'MM072', name: '체외충격파 치료(족저근막염)', amount: 120000, count: 1, days: 1, is_insurance_covered: false },
  { category: '검사', date: '2026-06-29', code: 'B2001', name: '균검사(KOH)', amount: 30000, count: 1, days: 1, is_insurance_covered: true, copayment_amount: 9000 },
]);

const SAMPLE: Record<string, string> = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007', visit_no: 'V-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient.longname@example-clinic.com',
  patient_birthdate: '1990-01-01', patient_rrn: '900101-1******',
  patient_address: LONG_ADDR,
  birth_date: '1990-01-01', rrn_front: '900101', rrn_back: '1234567', remark: '-',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: '주',
  diag_code_2: 'M21.6', diag_name_2: '후천성 발 변형(요족)', diag_flag_2: '부',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속.', treatment_opinion: '체외충격파 6주 권고.',
  diagnosis: '족저근막염 (M72.2)', medical_history: '3개월 전 발병.',
  referral_content: '정밀검사 의뢰.', referral_to_hospital: '서울대학교병원 정형외과',
  referring_doctor: '김원장', dept_name: '정형외과',
  referral_year: '2026', referral_month: '06', referral_day: '29',
  visit_date: '2026-06-29', treat_period: '2026-06-01 ~ 2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: LONG_CLINIC_ADDR, clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
  items_html: BILL_ITEMS, rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
  total_amount: '120,000', patient_pay: '120,000',
};

const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

async function findWraps(page: import('@playwright/test').Page, formKey: string, orient: string) {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿 존재`).toBeTruthy();
  const html = bindHtmlTemplate(raw as string, SAMPLE);
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

  return page.evaluate(() => {
    const LABEL_BG = ['rgb(248, 248, 248)', 'rgb(240, 240, 240)'];
    const out: Array<{ lines: number; overflowX: boolean; w: number; text: string }> = [];
    const cells = [...document.querySelectorAll('td, .value-cell, span[style*="border-bottom"]')];
    for (const el of cells as HTMLElement[]) {
      const cs = getComputedStyle(el);
      if (LABEL_BG.includes(cs.backgroundColor)) continue;             // 라벨 셀 제외
      if (el.classList.contains('label-cell')) continue;
      if (el.classList.contains('large-area') || el.classList.contains('legal-text')) continue;
      if (cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'pre') continue;  // 자유서술 칸 제외
      if ((el.innerHTML || '').includes('<br')) continue;             // 의도적 줄바꿈 제외
      if ((el.textContent || '').includes('직인')) continue;          // 서명+도장 블록 제외
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length < 4) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
      const tops = new Set(rects.map(r => Math.round(r.top)));
      const overflowX = el.scrollWidth - el.clientWidth > 2;
      if (tops.size >= 2 || overflowX) out.push({ lines: tops.size, overflowX, w: Math.round(el.clientWidth), text: txt.slice(0, 40) });
    }
    return out;
  });
}

for (const formKey of PORTRAIT) {
  test(`[${formKey}] 데이터 칸 줄바꿈 없음 (긴 주소 worst-case)`, async ({ page }) => {
    const wraps = await findWraps(page, formKey, 'portrait');
    expect(wraps, `${formKey} 줄바꿈/overflow 칸: ${JSON.stringify(wraps)}`).toEqual([]);
  });
}

for (const formKey of LANDSCAPE) {
  test(`[${formKey}] 데이터 칸 줄바꿈 없음 (가로)`, async ({ page }) => {
    const wraps = await findWraps(page, formKey, 'landscape');
    expect(wraps, `${formKey} 줄바꿈/overflow 칸: ${JSON.stringify(wraps)}`).toEqual([]);
  });
}
