/**
 * E2E spec — T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT
 * 출력물(서류 print/PDF) 페이지 중앙·여백 배치 전면 재검토 회귀 가드.
 *
 * 현장(박장군님): "서류 출력해보니 전체적으로 중앙 배치가 안 되고 위·좌측으로 쏠림.
 *   아래 공간 많으니 전체적으로 좀 내려와도 될 듯. 전체 재검토 후 반영."
 *
 * [근본원인] 직전 CENTER-ALIGN 은 양식(form-wrap)을 margin:12mm auto 로 .page(전폭 210mm) 안에서
 *   CSS 중앙정렬했고, 헤드리스 하니스도 .page 안에서만 측정해 좌10/우10mm 로 PASS 했다. 그러나 실제
 *   프린트 엔진은 전폭(210mm) page + @page margin:0 이 인쇄가능영역(기본여백 ~190mm)을 초과하면
 *   페이지 전체를 좌상단 앵커로 shrink-to-fit 축소 → 현장이 본 "위·좌측 쏠림 + 하단 공백"이 잔존.
 *   (= 하니스가 @page 물리 여백/축소를 시뮬하지 못해 갭을 놓침.)
 *
 * [수정] 중앙배치를 CSS margin 이 아니라 "프린트 엔진의 @page 물리 여백"이 직접 수행하도록 모델 전환:
 *   인쇄창(openBatchPrintWindow)·raw 경로(printOpinionDoc)가 @page margin:12mm 10mm 를 소유.
 *   콘텐츠박스(A4-여백 = 190×273 / 277×186mm)가 엔진에 의해 시트 중앙에 배치되고, 박스가
 *   인쇄가능영역 안에 들어와 축소 자체가 사라진다. 양식 wrap 은 박스를 채움(자체 page 여백 0 auto).
 *   레거시 IMG-오버레이(page-img, field_map px=210mm 기준)는 좌표 보존 위해 @page margin:0/전폭 유지.
 *
 * AC-2: 좌우 중앙정렬 — 좌측 쏠림 제거(좌·우 여백 대칭, 둘 다 >5mm)
 * AC-3: 상단 쏠림 완화·상하 균형 — 상·하 여백 대칭 + 하단 여백 확보(클립/넘침 없음, 단일 페이지)
 * AC-4: 공통 print 레이아웃(@page/@media print)에서 일괄 처리 — 문서별 인라인 땜질 없음(소스 가드)
 *
 * 측정(엔진-충실): 인쇄창 @page margin 을 "시트(전체 A4) 안쪽 padding"으로 물리 재현하고,
 *   콘텐츠박스(.page) 안에 양식을 깔아 wrap 외곽을 시트 기준으로 측정 = 실제 출력물 좌표와 동치.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const SAMPLE: Record<string, string> = {
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
  visit_date: '2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호', doctor_seal_html: '',
  items_html: '<tr><td>2026-06-29</td><td>체외충격파</td><td>120,000</td><td>1</td><td>120,000</td></tr>',
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
};

// 세로 11종 + 가로 1종. koh_result 는 별도 티켓(BACTCHECK) + §11 의료게이트(KOH 발급) 영역 → 범위 외.
const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

// 인쇄창 @page margin (DocumentPrintPanel.openBatchPrintWindow / PaymentMiniWindow.buildPrintHtml / printOpinionDoc 동일)
// T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 현장 2차 — 상단 더 하향 요청 → 비대칭(상30/하12).
const PAGE_MARGIN_TOP = 30; // 상단(1차 12mm → 30mm, 약 +68px 하향)
const PAGE_MARGIN_BOT = 12; // 하단
const PAGE_MARGIN_LR = 10; // 좌·우
const BASELINE_TOP = 12;    // 1차(DOCOUTPUT) 상단여백 — 하향 비교 기준

async function measureForm(page: import('@playwright/test').Page, formKey: string, orient: 'portrait' | 'landscape') {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿 존재`).toBeTruthy();
  const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  const vw = Math.round(sheetWmm * 96 / 25.4);
  const vh = Math.round(sheetHmm * 96 / 25.4);
  const pxPerMm = vw / sheetWmm;
  const boxWmm = sheetWmm - 2 * PAGE_MARGIN_LR;
  const boxHmm = sheetHmm - PAGE_MARGIN_TOP - PAGE_MARGIN_BOT;

  await page.setViewportSize({ width: vw, height: vh });
  await page.emulateMedia({ media: 'print' });
  // 인쇄창 @page margin(상30/하12/좌우10) 을 시트(전체 A4) 안쪽 padding 으로 물리 재현 → 실제 프린터가 여백 존중 배치한 좌표와 동치.
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .sheet { box-sizing: border-box; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm;
             padding: ${PAGE_MARGIN_TOP}mm ${PAGE_MARGIN_LR}mm ${PAGE_MARGIN_BOT}mm; background: #fff; }
    .page { position: relative; width: 100%; min-height: ${boxHmm}mm; overflow: visible; }
    .page-landscape { width: 100%; min-height: ${boxHmm}mm; }
  </style></head><body><div class="sheet"><div class="${pageCls}">${formHtml}</div></div></body></html>`,
    { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
    const wrap = document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap')!.getBoundingClientRect();
    return {
      left: wrap.left - sheet.left, right: sheet.right - wrap.right,
      top: wrap.top - sheet.top, bottom: sheet.bottom - wrap.bottom,
      wrapW: wrap.width, sheetH: (document.querySelector('.sheet') as HTMLElement).scrollHeight,
    };
  });

  const leftMm = m.left / pxPerMm, rightMm = m.right / pxPerMm;
  const topMm = m.top / pxPerMm, bottomMm = m.bottom / pxPerMm;
  const wrapWmm = m.wrapW / pxPerMm, sheetHmmActual = m.sheetH / pxPerMm;
  const tag = `[${formKey}/${orient}] 좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}/상${topMm.toFixed(1)}/하${bottomMm.toFixed(1)}mm wrap${wrapWmm.toFixed(1)}mm(박스${boxWmm})`;

  // AC-2: 좌우 중앙정렬(좌측 쏠림 제거)
  expect(leftMm, `${tag} 좌 여백>5mm`).toBeGreaterThan(5);
  expect(rightMm, `${tag} 우 여백>5mm`).toBeGreaterThan(5);
  expect(Math.abs(leftMm - rightMm), `${tag} 좌우 대칭(중앙정렬)`).toBeLessThan(3);
  expect(wrapWmm, `${tag} 콘텐츠박스 내(축소 유발 없음)`).toBeLessThanOrEqual(boxWmm + 0.5);
  // AC-5(REOPEN): 상단 하향 — 1차(12mm) 대비 ≥14mm(≈53px) 더 아래 + 하단 여백 확보 + 단일 페이지(클립/넘침 없음).
  //   현장 2차 피드백("아직 위로 쏠림, 엔터 4~5줄≈60~80px 더 아래로") 충족. 상하 '대칭'은 의도적으로 비대칭화(상>하).
  expect(topMm, `${tag} 상 여백 충분 하향(>20mm)`).toBeGreaterThan(20);
  expect(topMm - BASELINE_TOP, `${tag} 1차 대비 ≥14mm 하향(현장 60~80px↑)`).toBeGreaterThanOrEqual(14);
  expect(bottomMm, `${tag} 하 여백>5mm(클립 없음)`).toBeGreaterThan(5);
  expect(sheetHmmActual, `${tag} 단일 페이지(콘텐츠≤시트)`).toBeLessThanOrEqual(sheetHmm + 2);
}

test.describe('T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT — 출력물 중앙·여백 배치', () => {
  // 시나리오 1: 일괄/재발급 출력 양식들(세로) — 엔진 @page 여백 중앙 배치
  for (const formKey of PORTRAIT) {
    test(`세로 양식 ${formKey} — 시트 중앙배치 + 상하 균형`, async ({ page }) => {
      await measureForm(page, formKey, 'portrait');
    });
  }
  // 시나리오 2: 진료비 세부산정내역(가로) — 가로 시트 중앙 배치
  for (const formKey of LANDSCAPE) {
    test(`가로 양식 ${formKey} — 시트 중앙배치 + 상하 균형`, async ({ page }) => {
      await measureForm(page, formKey, 'landscape');
    });
  }

  // 시나리오 3: AC-4 — 공통 print 레이아웃에서 일괄 처리(엔진 @page 여백 메커니즘) 소스 가드.
  //   문서별 인라인 땜질·전폭 full-bleed 회귀(@page margin:0)로 되돌아가면 실패한다.
  test('AC-4/AC-5 — 공통 @page 물리 여백(상30/하12) 메커니즘 소스 가드(인라인 땜질/전폭 회귀 + 경로 divergence 차단)', () => {
    const root = process.cwd(); // playwright 는 레포 루트에서 실행
    const panel = fs.readFileSync(path.join(root, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
    const opinion = fs.readFileSync(path.join(root, 'src/lib/printOpinionDoc.ts'), 'utf8');
    const tpl = fs.readFileSync(path.join(root, 'src/lib/htmlFormTemplates.ts'), 'utf8');
    const mini = fs.readFileSync(path.join(root, 'src/components/PaymentMiniWindow.tsx'), 'utf8');

    // AC-5: 인쇄창(배치)·raw(소견서/진단서)·결제미니창(1순위) 모두 HTML 양식 @page 에 상단 하향 물리 여백(30mm 10mm 12mm).
    expect(panel, 'openBatchPrintWindow HTML 세로 @page 상30/하12').toContain('@page { size: A4 portrait; margin: 30mm 10mm 12mm; }');
    expect(panel, 'openBatchPrintWindow HTML 가로 @page 상30/하12').toContain('@page { size: A4 landscape; margin: 30mm 10mm 12mm; }');
    expect(opinion, 'printOpinionDoc raw @page 상30/하12').toContain('@page { size: A4 portrait; margin: 30mm 10mm 12mm; }');
    // [경로 divergence 가드] 1순위 메인 출력(PaymentMiniWindow.buildPrintHtml)이 경로1과 동일 @page 모델을 쓰는지.
    //   직전엔 이 경로만 구 @page:0/전폭 full-bleed 로 방치되어 현장 상단 쏠림 → 통일 후 회귀 차단.
    expect(mini, 'buildPrintHtml HTML 세로 @page 상30/하12(경로1과 통일)').toContain('@page { size: A4 portrait; margin: 30mm 10mm 12mm; }');
    expect(mini, 'buildPrintHtml HTML 가로 @page 상30/하12(경로1과 통일)').toContain('@page { size: A4 landscape; margin: 30mm 10mm 12mm; }');
    expect(mini, 'buildPrintHtml IMG-오버레이 격리 분기 유지').toContain('isLegacyImg');

    // 회귀 가드: 1차 대칭(12mm 10mm) 으로 되돌아가면 실패.
    expect(panel.match(/margin: 12mm 10mm;/g), 'openBatchPrintWindow 1차 대칭(12mm 10mm) 잔재 0건').toBeNull();
    expect(opinion.match(/margin: 12mm 10mm;/g), 'printOpinionDoc 1차 대칭(12mm 10mm) 잔재 0건').toBeNull();

    // 레거시 IMG-오버레이 격리 마커 유지(좌표 px=210mm 기준 양식 보존).
    expect(panel, 'IMG-오버레이 page-img 격리 마커').toContain('page-img');
    expect(panel, 'IMG-오버레이 레거시 @page margin:0 유지').toMatch(/@page \{ size: A4 (portrait|landscape); margin: 0; \}/);

    // 양식 wrap 은 자체 page 여백을 갖지 않는다(margin:0 auto) + 콘텐츠박스 255mm(=297-30-12).
    expect(tpl, 'form-wrap @media print 콘텐츠박스 255mm + margin:0 auto').toContain('.form-wrap { width: 190mm; min-height: 255mm; padding: 6mm 8mm; margin: 0 auto; }');
    expect(tpl.match(/margin: 12mm auto/g), 'wrap @media print 잔재 margin:12mm auto 0건').toBeNull();
    // 처방전 양식이 래퍼 @page 를 덮어쓰던 템플릿-레벨 @page 0건.
    expect(tpl.match(/@page \{ size: A4 portrait; margin: 0; \}/g), '템플릿-레벨 @page margin:0 잔재 0건').toBeNull();
  });
});
