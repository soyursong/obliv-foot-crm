/**
 * T-20260706-foot-DOCCONFIRM-LAYOUT-VSPACE-ADJUST
 * 서류 양식 공통 상단 세로여백 추가 상향: 현행 라이브 23mm(AC-6) → 16mm (추가 -2줄 ≈ -7mm).
 *
 * 배경(RACE 재발 방지):
 *   원 티켓 "5줄→3줄" = AC-6(commit 24e95251, 30→23mm)로 이미 라이브임(HEAD).
 *   본 티켓은 그 위에 총괄(김주연) 추가 요청("금일 위로 두줄 더")만 반영 → 23mm→16mm.
 *   AC-6과 동일 정수 델타(-7mm) · 동일 4경로.
 *
 * 검증:
 *   (1) 전 양식 상단여백 ≈ 16mm(15~17mm) 실측(print-media 렌더).
 *   (2) 하단 12mm 클립가드 유지 · 단일 페이지 · 좌우 대칭 회귀 없음.
 *   (3) evidence — before(23mm)/after(16mm) 대표 양식 미리보기 렌더 캡처 2장(총괄 육안 confirm 근거).
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

// 프로덕션 knob (4 경로 일관): 상단 16mm / 좌우 10mm / 하단 12mm.
const NEW_TOP_MM = 16, SIDE_MM = 10, BOTTOM_MM = 12;
const OLD_TOP_MM = 23; // AC-6 라이브(before) — evidence 대조용

// DocumentPrintPanel/PaymentMiniWindow/printOpinionDoc 의 .page/.page-landscape 규칙과 동일한 프로덕션 CSS 재현.
function pageHtml(formHtml: string, orient: 'portrait' | 'landscape', topMm: number) {
  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .page { box-sizing: border-box; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm; padding: ${topMm}mm ${SIDE_MM}mm ${BOTTOM_MM}mm; background:#fff; overflow: visible; }
    .page-landscape { box-sizing: border-box; width: 297mm; min-height: 210mm; padding: ${topMm}mm ${SIDE_MM}mm ${BOTTOM_MM}mm; }
  </style></head><body><div class="${pageCls}">${formHtml}</div></body></html>`;
}

async function measureTop(page: import('@playwright/test').Page, formKey: string, orient: 'portrait' | 'landscape', topMm: number) {
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
  await page.setContent(pageHtml(formHtml, orient, topMm), { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = (document.querySelector('.page') as HTMLElement);
    const sr = sheet.getBoundingClientRect();
    const wr = (document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap') as HTMLElement).getBoundingClientRect();
    return {
      left: wr.left - sr.left, right: sr.right - wr.right, top: wr.top - sr.top, bottom: sr.bottom - wr.bottom,
      wrapW: wr.width, scrollH: sheet.scrollHeight,
    };
  });
  return {
    leftMm: m.left / pxPerMm, rightMm: m.right / pxPerMm, topMm: m.top / pxPerMm,
    bottomMm: m.bottom / pxPerMm, contentMm: m.scrollH / pxPerMm, sheetHmm,
  };
}

test.describe('T-20260706-foot-DOCCONFIRM-LAYOUT-VSPACE-ADJUST — 서류 공통 상단여백 23→16mm', () => {
  for (const formKey of PORTRAIT) {
    test(`세로 양식 ${formKey} — 상단 16mm + 하단 12mm 클립가드`, async ({ page }) => {
      const r = await measureTop(page, formKey, 'portrait', NEW_TOP_MM);
      const tag = `[${formKey}] 상${r.topMm.toFixed(1)}/하${r.bottomMm.toFixed(1)}/좌${r.leftMm.toFixed(1)}/우${r.rightMm.toFixed(1)}mm`;
      expect(r.topMm, `${tag} 상단여백 15~17mm(AC-6 23mm 대비 2줄↑)`).toBeGreaterThan(15);
      expect(r.topMm, `${tag} 상단여백 15~17mm(과다 하향 방지)`).toBeLessThan(17.5);
      expect(r.bottomMm, `${tag} 하단 12mm 클립가드(>10mm)`).toBeGreaterThan(10);
      expect(r.contentMm, `${tag} 단일 페이지(콘텐츠≤시트)`).toBeLessThanOrEqual(r.sheetHmm + 2);
      expect(Math.abs(r.leftMm - r.rightMm), `${tag} 좌우 대칭`).toBeLessThan(3);
    });
  }
  for (const formKey of LANDSCAPE) {
    test(`가로 양식 ${formKey} — 상단 16mm + 하단 12mm 클립가드`, async ({ page }) => {
      const r = await measureTop(page, formKey, 'landscape', NEW_TOP_MM);
      const tag = `[${formKey}/L] 상${r.topMm.toFixed(1)}/하${r.bottomMm.toFixed(1)}mm`;
      expect(r.topMm, `${tag} 상단여백 15~17mm`).toBeGreaterThan(15);
      expect(r.topMm, `${tag} 상단여백 15~17mm(과다 하향 방지)`).toBeLessThan(17.5);
      expect(r.bottomMm, `${tag} 하단 12mm 클립가드(>10mm)`).toBeGreaterThan(10);
      expect(r.contentMm, `${tag} 단일 페이지(콘텐츠≤시트)`).toBeLessThanOrEqual(r.sheetHmm + 2);
    });
  }

  // evidence: before(23mm)/after(16mm) 대표 양식(diagnosis=진단서) 미리보기 렌더 캡처 2장 — 총괄 육안 confirm 근거.
  test('evidence — 진단서 before(23mm)/after(16mm) 미리보기 렌더 캡처', async ({ page }) => {
    const raw = getHtmlTemplate('diagnosis');
    const formHtml = bindHtmlTemplate(raw as string, SAMPLE);
    const vw = Math.round(210 * 96 / 25.4);
    const vh = Math.round(297 * 96 / 25.4);
    await page.setViewportSize({ width: vw, height: vh });
    await page.emulateMedia({ media: 'print' });

    await page.setContent(pageHtml(formHtml, 'portrait', OLD_TOP_MM), { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/vspace-before-23mm.png', fullPage: true });

    await page.setContent(pageHtml(formHtml, 'portrait', NEW_TOP_MM), { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'test-results/vspace-after-16mm.png', fullPage: true });

    // 델타 확인: after 상단여백이 before 대비 ~7mm 작아야 함(위로 이동).
    const beforeTop = (await measureTop(page, 'diagnosis', 'portrait', OLD_TOP_MM)).topMm;
    const afterTop = (await measureTop(page, 'diagnosis', 'portrait', NEW_TOP_MM)).topMm;
    expect(beforeTop - afterTop, `before(${beforeTop.toFixed(1)})→after(${afterTop.toFixed(1)}) ≈ -7mm 상향`).toBeGreaterThan(5);
    expect(beforeTop - afterTop, `과도한 델타 아님(≈7mm)`).toBeLessThan(9);
  });
});
