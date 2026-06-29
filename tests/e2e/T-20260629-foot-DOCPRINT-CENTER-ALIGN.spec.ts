/**
 * E2E spec — T-20260629-foot-DOCPRINT-CENTER-ALIGN
 * 전 서류 양식 A4 인쇄 정렬(중앙/여백 균형) 회귀 가드.
 *
 * 증상(현장): 서류 출력 시 내용이 상단/좌측으로 쏠림 + 하단 여백 과다.
 * 원인: 세로 양식들이 width:195mm(>A4 인쇄가능폭 ~184mm)에 @page 미지정/8mm 이라
 *       브라우저 축소맞춤(shrink-to-fit)이 콘텐츠를 좌·상단으로 anchor + 하단에 과대 빈 띠.
 * 수정(표현 레이어만 — @media print/@page, 구조/데이터/발행로직 불변):
 *   form-wrap/rx-wrap/br-wrap = A4 전면(210×297mm) 채움 + 좌우·상하 내부 padding 으로 여백 균형.
 *   bill_detail = A4 가로(297×210mm) 전면. referral_letter = 인라인 188mm/12mm auto 유지(min-height:273mm).
 *
 * AC-1: 콘텐츠 상단/좌측 쏠림 없음 (좌·상 여백 > 5mm)
 * AC-2: 하단 여백 확보 (하단 > 5mm, page 초과/클립 없음)
 * AC-3: 좌우 여백 대칭(중앙정렬) + 단일 페이지 적합 + 가로 page 미초과
 *
 * ⚠ 모델 진화(T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT 가 본 티켓을 정밀화·대체):
 *   직전 모델(form-wrap margin:12mm auto + .page 전폭 210mm)은 양식을 body 안에서만 측정해 CSS상 중앙
 *   이라 PASS 했으나, 실제 프린트 엔진의 @page 물리 여백/shrink-to-fit 을 시뮬 못 해 현장 좌상단 쏠림을
 *   놓쳤다. 현재 모델은 중앙배치를 "프린트 엔진의 @page margin(12mm 10mm)"이 직접 수행 → 본 가드도
 *   엔진-충실 측정(인쇄 시트 전체 안쪽 padding=@page 여백 물리 재현, 콘텐츠박스 안에 양식)을 사용한다.
 *   상세 가드·소스 introspection 은 DOCOUTPUT-PRINT-CENTER-LAYOUT.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const SAMPLE: Record<string, string> = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', request_no: 'R-2026-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'patient@example.com',
  patient_birthdate: '1990-01-01', patient_rrn: '900101-1******', patient_address: '서울특별시 종로구 ○○로 00',
  birth_date: '1990-01-01', rrn_front: '900101', rrn_back: '1234567', remark: '-',
  diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: '주',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속. 보존적 치료 반응 미흡하여 추가 관리 요함.',
  treatment_opinion: '족저근막 스트레칭 및 체외충격파 치료 6주 시행 권고.',
  diagnosis: '족저근막염 (M72.2)', medical_history: '3개월 전부터 좌측 발뒤꿈치 통증 지속.',
  referral_content: '정밀 영상검사 및 추가 진료 의뢰드립니다.', referral_to_hospital: '서울대학교병원',
  referring_doctor: '김원장', dept_name: '정형외과',
  referral_year: '2026', referral_month: '06', referral_day: '29',
  visit_date: '2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호', doctor_seal_html: '',
  items_html: '<tr><td>2026-06-29</td><td>체외충격파</td><td>120,000</td><td>1</td><td>120,000</td></tr>',
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
};

// 세로 양식 11종 + 가로 1종. koh_result 는 별도 티켓(BACTCHECK) 진행 영역 + 양식 범위 외라 제외.
const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

async function measureForm(page: import('@playwright/test').Page, formKey: string, orient: 'portrait' | 'landscape') {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿 존재`).toBeTruthy();
  const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  const vw = Math.round(sheetWmm * 96 / 25.4);
  const vh = Math.round(sheetHmm * 96 / 25.4);
  const pxPerMm = vw / sheetWmm;
  // 인쇄창 @page margin(12mm 10mm) — DocumentPrintPanel/printOpinionDoc 와 동일
  const mTB = 12, mLR = 10;
  const boxWmm = sheetWmm - 2 * mLR, boxHmm = sheetHmm - 2 * mTB;

  await page.setViewportSize({ width: vw, height: vh });
  await page.emulateMedia({ media: 'print' });
  // 엔진-충실: @page 여백을 시트(전체 A4) 안쪽 padding 으로 물리 재현 → 콘텐츠박스(.page)에 양식.
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .sheet { box-sizing: border-box; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm; padding: ${mTB}mm ${mLR}mm; background:#fff; }
    .page { position: relative; width: 100%; min-height: ${boxHmm}mm; overflow: visible; }
    .page-landscape { width: 100%; min-height: 186mm; }
  </style></head><body><div class="sheet"><div class="${pageCls}">${formHtml}</div></div></body></html>`, { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = (document.querySelector('.sheet') as HTMLElement);
    const sr = sheet.getBoundingClientRect();
    const wr = (document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap') as HTMLElement).getBoundingClientRect();
    return {
      left: wr.left - sr.left, right: sr.right - wr.right, top: wr.top - sr.top, bottom: sr.bottom - wr.bottom,
      wrapW: wr.width, scrollH: sheet.scrollHeight,
    };
  });

  const leftMm = m.left / pxPerMm;
  const rightMm = m.right / pxPerMm;
  const topMm = m.top / pxPerMm;
  const bottomMm = m.bottom / pxPerMm;
  const wrapWmm = m.wrapW / pxPerMm;
  const contentMm = m.scrollH / pxPerMm;
  const tag = `[${formKey}/${orient}] 좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}/상${topMm.toFixed(1)}/하${bottomMm.toFixed(1)}mm wrap${wrapWmm.toFixed(1)}mm`;

  // AC-1: 좌/상단 쏠림 없음 (시트 전체 기준 물리 여백)
  expect(leftMm, `${tag} 좌 여백>5mm(좌측 쏠림 방지)`).toBeGreaterThan(5);
  expect(topMm, `${tag} 상 여백>5mm(상단 쏠림 방지)`).toBeGreaterThan(5);
  // AC-2: 하단 여백 확보 + 콘텐츠 시트 미초과(클립/2페이지 방지)
  expect(bottomMm, `${tag} 하 여백>5mm`).toBeGreaterThan(5);
  expect(contentMm, `${tag} 단일 페이지(콘텐츠≤시트)`).toBeLessThanOrEqual(sheetHmm + 2);
  // AC-3: 좌우 대칭(중앙정렬) + 콘텐츠박스 미초과(축소 유발 없음)
  expect(Math.abs(leftMm - rightMm), `${tag} 좌우 대칭`).toBeLessThan(3);
  expect(wrapWmm, `${tag} 콘텐츠박스 미초과`).toBeLessThanOrEqual(boxWmm + 0.5);
}

test.describe('T-20260629-foot-DOCPRINT-CENTER-ALIGN — 전 서류 인쇄 정렬/여백 균형', () => {
  for (const formKey of PORTRAIT) {
    test(`세로 양식 ${formKey} — 중앙정렬 + 여백 균형`, async ({ page }) => {
      await measureForm(page, formKey, 'portrait');
    });
  }
  for (const formKey of LANDSCAPE) {
    test(`가로 양식 ${formKey} — 중앙정렬 + 여백 균형`, async ({ page }) => {
      await measureForm(page, formKey, 'landscape');
    });
  }
});
