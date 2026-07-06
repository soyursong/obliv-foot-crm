/**
 * E2E spec — T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE
 * 서류/영수증/의료문서 인쇄 시 브라우저 window.print() 기본 헤더 2종 제거 회귀 가드.
 *
 * 증상(현장 김주연 총괄): 전 서식 인쇄 시 상단에 자동 삽입되는 2요소
 *   ① 좌측 상단 인쇄 날짜·시간 (예: '26. 7. 2. 오후 12:33')
 *   ② 우측 상단 문서명+출력자 (document.title = "서류 출력 …")
 * 원인(RC): 크롬/사파리는 @page margin 이 0 보다 크면 그 여백 박스에 인쇄일시(좌)·document.title(우)을
 *   자동 삽입한다(브라우저 네이티브 헤더, CSS 로 개별 숨김 불가). 직전 CENTER-ALIGN 모델이 중앙배치를
 *   @page margin(30 10 12) 로 수행 → 그 여백 자체가 헤더 캔버스가 되어 노출.
 * 수정(표현 레이어만 — 구조/데이터/발행로직 불변):
 *   @page margin:0 (여백 박스 소멸 → 브라우저 헤더 삽입 물리 불가) + 구 물리여백(상30·좌우10·하12mm)을
 *   콘텐츠 padding(.page / body) 으로 이관 → 중앙배치 물리 위치 불변. legacy-img 분기(이미 @page:0 +
 *   전폭 210mm 로 프로덕션 검증됨)와 동일 모델로 통일.
 *
 * ⚠ 브라우저 네이티브 헤더는 headless/print PDF 에 렌더되지 않아 픽셀 관측 불가 →
 *   본 가드는 (A) 소스 introspection 으로 "전 인쇄 경로가 @page margin:0 을 소유하고 비-0 여백 잔존 없음"을,
 *   (B) 렌더 측정으로 "헤더 제거 후에도 중앙배치(상~30·좌우~10·하>5mm)·단일페이지 회귀 없음"을 검증한다.
 *
 * AC-1: 전 인쇄 경로(openBatchPrintWindow·buildPrintHtml·printOpinionDoc·printKohResult·printInvoice·PhotoUpload)
 *       HTML-form 분기가 '@page … margin: 0' 을 소유 (헤더 여백 박스 제거)
 * AC-2: 인쇄 경로에 비-0 @page 여백('margin: 30mm 10mm 12mm' 등) 잔존 없음
 * AC-3: 헤더 제거 후 콘텐츠 중앙배치 유지 — 상단 ~30mm 하향·좌우 대칭·하단 클립 없음·단일 페이지 (전 양식)
 * AC-4: 본문 데이터/레이아웃 회귀 없음 (form-wrap 폭 ≤ 콘텐츠박스, wrap 존재)
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ── AC-1/AC-2: 소스 introspection — 전 인쇄 경로 @page margin:0 소유 + 비-0 여백 잔존 없음 ──
test.describe('AC-1/AC-2 브라우저 헤더 제거 구조 불변식', () => {
  const PATHS: { file: string; label: string }[] = [
    { file: 'components/DocumentPrintPanel.tsx', label: 'openBatchPrintWindow + printInvoice' },
    { file: 'components/PaymentMiniWindow.tsx', label: 'buildPrintHtml(경로4)' },
    { file: 'lib/printOpinionDoc.ts', label: '소견서/진단서' },
    { file: 'lib/printKohResult.ts', label: '검사결과 보고서' },
    { file: 'components/PhotoUpload.tsx', label: '비포/애프터 사진' },
  ];

  for (const { file, label } of PATHS) {
    test(`${label}: @page margin:0 소유`, () => {
      const src = read(file);
      // @page 선언이 존재하고 margin:0 을 포함
      expect(src, `${file} 에 @page 선언 필요`).toMatch(/@page\s*\{[^}]*margin:\s*0[^0-9]/);
    });

    test(`${label}: 비-0 @page 여백(헤더 캔버스) 잔존 없음`, () => {
      const src = read(file);
      // 구 헤더 유발 여백 패턴이 남아있으면 안 됨
      expect(src, `${file} 에 비-0 @page 여백 잔존`).not.toMatch(/margin:\s*30mm\s+10mm\s+12mm/);
      expect(src, `${file} 에 @page 12mm 단일여백 잔존`).not.toMatch(/@page[^}]*margin:\s*12mm\s*;/);
    });
  }
});

// ── AC-3/AC-4: 중앙배치 회귀 가드 — 신규 프로덕션 .page 모델(@page:0 + padding)로 실측 ──
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
  visit_date: '2026-06-29', treat_period: '2026-06-01 ~ 2026-06-29', memo: '특이사항 없음',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '제12345호',
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
  items_html: '<tr><td>2026-06-29</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
  rx_items_html: '<tr><td>이부프로펜정</td><td>1</td><td>3</td><td>5</td><td>15</td></tr>',
  total_amount: '120,000', patient_pay: '120,000',
};

const PORTRAIT = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion', 'diag_opinion_v2',
  'payment_cert', 'referral_letter', 'medical_record_request', 'rx_standard', 'bill_receipt', 'ins_claim_form'];
const LANDSCAPE = ['bill_detail'];

// 신규 프로덕션 인쇄창 CSS (openBatchPrintWindow / buildPrintHtml HTML-form 분기와 1:1 동일)
const PAD_TOP = 23, PAD_LR = 10, PAD_BOT = 12; // .page padding = 구 @page 물리여백 (AC-6: 상단 30→23mm)

async function measure(page: import('@playwright/test').Page, formKey: string, orient: 'portrait' | 'landscape') {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿 존재`).toBeTruthy();
  const html = bindHtmlTemplate(raw!, SAMPLE);
  const sheetWmm = orient === 'landscape' ? 297 : 210;
  const sheetHmm = orient === 'landscape' ? 210 : 297;
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: Math.round(sheetWmm * 96 / 25.4), height: Math.round(sheetHmm * 96 / 25.4) });
  const pageCls = orient === 'landscape' ? 'page page-landscape' : 'page';
  // @page margin:0 → .page 가 전폭(A4) 시트이자 콘텐츠박스. padding 이 여백을 물리 재현.
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    .page { box-sizing: border-box; position: relative; width: ${sheetWmm}mm; min-height: ${sheetHmm}mm;
            padding: ${PAD_TOP}mm ${PAD_LR}mm ${PAD_BOT}mm; overflow: visible; background: #fff; }
    .page-landscape { box-sizing: border-box; width: 297mm; min-height: 210mm; padding: ${PAD_TOP}mm ${PAD_LR}mm ${PAD_BOT}mm; }
  </style></head><body><div class="${pageCls}">${html}</div></body></html>`,
    { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const sheet = document.querySelector('.page')!.getBoundingClientRect();
    const wrapEl = document.querySelector('.form-wrap, .bill-wrap, .rx-wrap, .br-wrap');
    if (!wrapEl) return null;
    const wrap = wrapEl.getBoundingClientRect();
    return {
      left: wrap.left - sheet.left, right: sheet.right - wrap.right,
      top: wrap.top - sheet.top, bottom: sheet.bottom - wrap.bottom,
      wrapW: wrap.width, sheetH: (document.querySelector('.page') as HTMLElement).scrollHeight,
    };
  });
  expect(m, `${formKey}: form-wrap 렌더 존재(본문 회귀 없음)`).not.toBeNull();

  const pxPerMm = 96 / 25.4;
  const leftMm = m!.left / pxPerMm, rightMm = m!.right / pxPerMm;
  const topMm = m!.top / pxPerMm, bottomMm = m!.bottom / pxPerMm;
  const wrapWmm = m!.wrapW / pxPerMm, sheetHmmActual = m!.sheetH / pxPerMm;
  const boxWmm = sheetWmm - 2 * PAD_LR;

  // AC-3: 중앙배치 유지 (헤더 제거 후에도 물리 위치 불변)
  expect(Math.abs(leftMm - rightMm), `${formKey} 좌우 대칭`).toBeLessThan(3);
  expect(topMm, `${formKey} 상단 ~23mm 하향(AC-6, 쏠림 없음)`).toBeGreaterThan(20);
  expect(bottomMm, `${formKey} 하단 여백(클립 없음)`).toBeGreaterThan(5);
  // AC-4: 본문 회귀 없음 — 콘텐츠박스 내 적합 + 단일 페이지
  expect(wrapWmm, `${formKey} wrap 폭 ≤ 콘텐츠박스`).toBeLessThanOrEqual(boxWmm + 0.6);
  expect(sheetHmmActual, `${formKey} 단일 페이지(넘침 없음)`).toBeLessThanOrEqual(sheetHmm + 2);
}

test.describe('AC-3/AC-4 헤더 제거 후 중앙배치·본문 회귀 가드', () => {
  for (const k of PORTRAIT) {
    test(`portrait ${k}`, async ({ page }) => { await measure(page, k, 'portrait'); });
  }
  for (const k of LANDSCAPE) {
    test(`landscape ${k}`, async ({ page }) => { await measure(page, k, 'landscape'); });
  }
});
