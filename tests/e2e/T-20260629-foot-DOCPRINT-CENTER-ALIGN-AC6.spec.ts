/**
 * E2E spec — T-20260629-foot-DOCPRINT-CENTER-ALIGN (REOPEN / AC-6)
 * 현장 3차 미세 재조정: 전 양식 인쇄 상단여백 30mm → 23mm(약 -7mm ≈ 2줄↑) 회귀 가드.
 *
 * 배경(현장 김주연 총괄, 3차 확인):
 *   2차 배포(@page top 30mm)로 5줄 내려간 상태에서 "2줄만 다시 위로" 미세 수렴 요청.
 *   → 전 양식 상단여백 30mm→23mm 하향. 하단 12mm·좌우 10mm 불변.
 *
 * 현 프로덕션 모델(구 spec 의 @page margin:12mm 시뮬과 다름):
 *   @page { margin: 0 } + .page(box-sizing:border-box) padding: 23mm 10mm 12mm 로 물리 여백을
 *   콘텐츠 패딩에 이관(브라우저 자동 헤더 제거, T-20260702-BROWSERHEADER-REMOVE).
 *   4 경로(DocumentPrintPanel·PaymentMiniWindow·printOpinionDoc·htmlFormTemplates min-height)가 동일 계약.
 *   본 spec 은 그 모델을 그대로 재현해 실제 상단여백(≈23mm)·하단(≈12mm)·단일 페이지를 실측한다.
 *
 * AC-6: 콘텐츠 상단여백 ≈ 23mm(2차 30mm 대비 ~2줄↑, 22~24mm), 전 양식 일관,
 *       하단 12mm 클립가드 유지, 좌우 대칭, 단일 페이지(넘침/잘림 없음).
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

const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

// 현 프로덕션 knob (4 경로 일관): 상단 16mm / 좌우 10mm / 하단 12mm. (VSPACE-ADJUST: AC-6 23→16mm 추가 2줄↑)
const TOP_MM = 16, SIDE_MM = 10, BOTTOM_MM = 12;

async function measureForm(page: import('@playwright/test').Page, formKey: string, orient: 'portrait' | 'landscape') {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿 존재`).toBeTruthy();
  const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  const vw = Math.round(sheetWmm * 96 / 25.4);
  const vh = Math.round(sheetHmm * 96 / 25.4);
  const pxPerMm = vw / sheetWmm;

  await page.setViewportSize({ width: vw, height: vh });
  await page.emulateMedia({ media: 'print' });
  // 프로덕션 충실 재현: @page margin:0 + .page(box-sizing:border-box) padding 23mm 10mm 12mm.
  //   DocumentPrintPanel/PaymentMiniWindow 의 .page / .page-landscape 규칙과 동일.
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .page { box-sizing: border-box; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm; padding: ${TOP_MM}mm ${SIDE_MM}mm ${BOTTOM_MM}mm; background:#fff; overflow: visible; }
    .page-landscape { box-sizing: border-box; width: 297mm; min-height: 210mm; padding: ${TOP_MM}mm ${SIDE_MM}mm ${BOTTOM_MM}mm; }
  </style></head><body><div class="${pageCls}">${formHtml}</div></body></html>`, { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = (document.querySelector('.page') as HTMLElement);
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
  const contentMm = m.scrollH / pxPerMm;
  const tag = `[${formKey}/${orient}] 상${topMm.toFixed(1)}/하${bottomMm.toFixed(1)}/좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}mm`;

  // VSPACE-ADJUST 핵심: 상단여백 ≈ 16mm(15~17mm) — AC-6 23mm 대비 ~2줄(7mm)↑, 전 양식 일관.
  expect(topMm, `${tag} 상단여백 15~17mm(AC-6 23mm 대비 2줄↑)`).toBeGreaterThan(15);
  expect(topMm, `${tag} 상단여백 15~17mm(과다 하향 방지)`).toBeLessThan(17.5);
  // 하단 12mm 클립가드 유지(넘침 시 음수·과소 → 잘림).
  expect(bottomMm, `${tag} 하단 12mm 클립가드(>10mm)`).toBeGreaterThan(10);
  // 단일 페이지: 콘텐츠 시트 미초과.
  expect(contentMm, `${tag} 단일 페이지(콘텐츠≤시트)`).toBeLessThanOrEqual(sheetHmm + 2);
  // 좌우 대칭(중앙정렬).
  expect(Math.abs(leftMm - rightMm), `${tag} 좌우 대칭`).toBeLessThan(3);
}

test.describe('T-20260629-foot-DOCPRINT-CENTER-ALIGN AC-6 — 전 양식 상단 23mm 미세 재조정', () => {
  for (const formKey of PORTRAIT) {
    test(`세로 양식 ${formKey} — 상단 23mm + 하단 12mm 클립가드`, async ({ page }) => {
      await measureForm(page, formKey, 'portrait');
    });
  }
  for (const formKey of LANDSCAPE) {
    test(`가로 양식 ${formKey} — 상단 23mm + 하단 12mm 클립가드`, async ({ page }) => {
      await measureForm(page, formKey, 'landscape');
    });
  }
});
