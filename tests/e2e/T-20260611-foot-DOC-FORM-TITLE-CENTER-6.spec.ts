/**
 * E2E spec — T-20260611-foot-DOC-FORM-TITLE-CENTER-6
 * 의뢰서 외 HTML 양식 제목 중앙정렬 회귀 가드 (사전경보·예방).
 *
 * 증상: 기본 form-wrap(190mm)이 margin auto 미적용 → A4 page 중앙 대비 양식(및 제목)이
 *       ~10mm 좌측으로 이탈. 의뢰서가 직전 수정 전 가졌던 동일 패턴이 나머지 양식에 잔존.
 * 원인: COMMON_STYLE .form-wrap 규칙에 margin auto 누락 (좌측정렬).
 * 수정: .form-wrap 에 margin:0 auto 추가 → 공통 폼랩 사용 전 양식 일괄 가로 중앙정렬.
 *       의뢰서(referral_letter)는 인라인 margin:12mm auto 가 본 규칙을 override → 회귀 없음.
 *
 * AC-1: 각 양식 form-wrap 좌/우 여백 대칭 (|좌-우| < 1mm) → 가로 중앙정렬
 * AC-2: 각 양식 좌측 여백 > 5mm (좌측 이탈/짤림 해소)
 * AC-3: 의뢰서(referral_letter) 회귀 없음 — 기존 중앙정렬 유지
 *
 * 실제 인쇄창(openBatchPrintWindow)과 동일한 .page(width:210mm; overflow:hidden) 컨테이너에
 * 양식 HTML 을 setContent 하여 print media 단위 렌더로 측정한다.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const PX_PER_MM = 794 / 210; // A4 @96dpi

// 공통 SAMPLE — bindHtmlTemplate 은 미존재 키를 빈 문자열로 치환하므로 중앙정렬 측정엔 충분.
const SAMPLE: Record<string, string> = {
  record_no: 'R-001', visit_no: '12', patient_name: '홍길동',
  patient_rrn: '900101-1234567', rrn_front: '900101', rrn_back: '1234567',
  patient_address: '서울시 종로구', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_email: 'p@example.com',
  diagnosis: '족저근막염 (M72.2)', clinic_name: '오블리브의원 종로점',
  clinic_phone: '02-123-4567', doctor_name: '박의사', doctor_seal_html: '',
  issue_date: '2026-06-11', purpose: '제출용',
};

// 의뢰서를 제외한 공통 form-wrap 사용 양식 (좌측정렬 버그 대상).
// 진단서·진료확인서·통원확인서·소견서·진료비납입증명서·의무기록사본발급신청서·소견서v2·보험청구서.
const FORM_KEYS = [
  'diagnosis',
  'treat_confirm',
  'visit_confirm',
  'diag_opinion',
  'payment_cert',
  'medical_record_request',
  'diag_opinion_v2',
  'ins_claim_form',
];

function buildPageHtml(formHtml: string): string {
  // openBatchPrintWindow 와 동일한 .page 컨테이너
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: 0; }
    body { margin:0; padding:0; }
    .page { position:relative; width:210mm; min-height:297mm; overflow:hidden; }
  </style></head><body><div class="page">${formHtml}</div></body></html>`;
}

async function measureWrap(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.page') as HTMLElement;
    const wrap = document.querySelector('.form-wrap') as HTMLElement;
    const pr = pageEl.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    return { pageW: pr.width, wrapLeft: wr.left, wrapRight: wr.right };
  });
}

test.describe('T-20260611-foot-DOC-FORM-TITLE-CENTER-6 — 양식 제목 중앙정렬', () => {
  for (const key of FORM_KEYS) {
    test(`AC-1/2: ${key} form-wrap 가로 중앙정렬`, async ({ page }) => {
      const raw = getHtmlTemplate(key);
      expect(raw, `${key} 템플릿 존재`).toBeTruthy();
      const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

      await page.setViewportSize({ width: 794, height: 1123 });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(buildPageHtml(formHtml), { waitUntil: 'networkidle' });

      const m = await measureWrap(page);
      const leftMm = m.wrapLeft / PX_PER_MM;
      const rightMm = (m.pageW - m.wrapRight) / PX_PER_MM;

      // AC-1: 좌우 대칭 (가로 중앙정렬)
      expect(Math.abs(leftMm - rightMm), `${key} 좌${leftMm.toFixed(1)}mm/우${rightMm.toFixed(1)}mm 대칭`).toBeLessThan(1);
      // AC-2: 좌측 이탈/짤림 해소
      expect(leftMm, `${key} 좌 여백 ${leftMm.toFixed(1)}mm > 5mm`).toBeGreaterThan(5);
    });
  }

  test('AC-3: referral_letter 회귀 없음 (기존 중앙정렬 유지)', async ({ page }) => {
    const raw = getHtmlTemplate('referral_letter');
    expect(raw, 'referral_letter 템플릿 존재').toBeTruthy();
    const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

    await page.setViewportSize({ width: 794, height: 1123 });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(buildPageHtml(formHtml), { waitUntil: 'networkidle' });

    const m = await measureWrap(page);
    const leftMm = m.wrapLeft / PX_PER_MM;
    const rightMm = (m.pageW - m.wrapRight) / PX_PER_MM;
    // 의뢰서는 인라인 margin:12mm auto → 좌우 대칭 + 약 11mm 여백 유지
    expect(Math.abs(leftMm - rightMm), `의뢰서 좌${leftMm.toFixed(1)}mm/우${rightMm.toFixed(1)}mm 대칭 유지`).toBeLessThan(1);
    expect(leftMm, `의뢰서 좌 여백 ${leftMm.toFixed(1)}mm > 5mm`).toBeGreaterThan(5);
  });
});
