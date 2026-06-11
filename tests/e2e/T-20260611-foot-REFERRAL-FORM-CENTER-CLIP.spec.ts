/**
 * E2E spec — T-20260611-foot-REFERRAL-FORM-CENTER-CLIP
 * 진료의뢰서(referral_letter) 인쇄 양식 짤림/중앙배치 회귀 가드.
 *
 * 증상: 인쇄된 진료의뢰서에서 (1) 제목 중앙정렬 어긋남, (2) 상·하단이 A4 인쇄영역을 벗어나 짤림.
 * 원인: 직전 수정(REFERRAL-PRINT-CLIP-CENTER)이 좌우 여백(margin:0 auto)만 줘서 form-wrap이
 *       page 최상단(top 0mm)에 붙음 → 프린터 unprintable 상단영역이 제목을 자름.
 * 수정: 좌우와 동일 논리로 상하 12mm 여백 추가(margin:12mm auto). 의뢰서 한정 인라인 변경.
 *
 * AC-1: 제목 페이지 가로 중앙정렬 (|offset| < 2px)
 * AC-2: A4 상·하단 짤림 0 (top margin > 5mm, bottom clearance > 5mm, overflow 없음)
 * AC-3: 좌우 중앙 유지 (좌/우 여백 차 < 1mm)
 *
 * 실제 인쇄창(openBatchPrintWindow)과 동일한 .page(width:210mm; min-height:297mm; overflow:hidden)
 * 컨테이너에 양식을 넣어 단위 렌더로 검증한다. window.open 인쇄 경로는 헤드리스에서 재현 불가하므로
 * 양식 HTML 자체를 동일 컨테이너에 setContent 하여 측정한다.
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const PX_PER_MM = 794 / 210; // A4 @96dpi

const SAMPLE: Record<string, string> = {
  referral_year: '2026', referral_month: '06', referral_day: '11',
  dept_name: '정형외과', referring_doctor: '김원장',
  patient_name: '홍길동', rrn_front: '900101', rrn_back: '1234567',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678',
  patient_email: 'patient@example.com',
  diagnosis: '족저근막염 (M72.2)',
  medical_history: '3개월 전부터 좌측 발뒤꿈치 통증 지속. 보존적 치료 반응 미흡.',
  referral_content: '정밀 영상검사 및 추가 진료 의뢰드립니다. 결과 회신 부탁드립니다.',
  referral_to_hospital: '서울대학교병원',
  clinic_phone: '02-123-4567',
  doctor_name: '박의사',
  doctor_seal_html: '',
  clinic_name: '오블리브의원 종로점',
};

function buildPageHtml(formHtml: string): string {
  // openBatchPrintWindow 와 동일한 .page 컨테이너
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    @page { size: A4 portrait; margin: 0; }
    body { margin:0; padding:0; }
    .page { position:relative; width:210mm; min-height:297mm; overflow:hidden; }
  </style></head><body><div class="page">${formHtml}</div></body></html>`;
}

test.describe('T-20260611-foot-REFERRAL-FORM-CENTER-CLIP — 진료의뢰서 인쇄 정렬/짤림', () => {
  test('AC-1/2/3: 제목 중앙정렬 + 상·하단/좌우 짤림 0', async ({ page }) => {
    const raw = getHtmlTemplate('referral_letter');
    expect(raw, 'referral_letter 템플릿 존재').toBeTruthy();
    const formHtml = bindHtmlTemplate(raw as string, SAMPLE);

    await page.setViewportSize({ width: 794, height: 1123 });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(buildPageHtml(formHtml), { waitUntil: 'networkidle' });

    const m = await page.evaluate(() => {
      const pageEl = document.querySelector('.page') as HTMLElement;
      const wrap = document.querySelector('.form-wrap') as HTMLElement;
      const title = document.querySelector('.title') as HTMLElement;
      const pr = pageEl.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(title);
      const inkr = range.getBoundingClientRect();
      return {
        pageW: pr.width, pageH: pr.height,
        pageCenterX: pr.left + pr.width / 2,
        titleInkCenterX: inkr.left + inkr.width / 2,
        wrapLeft: wr.left, wrapRight: wr.right, wrapTop: wr.top, wrapBottom: wr.bottom,
        scrollH: pageEl.scrollHeight,
      };
    });

    // AC-1: 제목 가로 중앙정렬
    const titleOffsetPx = m.titleInkCenterX - m.pageCenterX;
    expect(Math.abs(titleOffsetPx), `제목 중앙 offset ${titleOffsetPx.toFixed(2)}px`).toBeLessThan(2);

    // AC-3: 좌우 여백 대칭 (중앙 배치)
    const leftMm = m.wrapLeft / PX_PER_MM;
    const rightMm = (m.pageW - m.wrapRight) / PX_PER_MM;
    expect(Math.abs(leftMm - rightMm), `좌${leftMm.toFixed(1)}mm/우${rightMm.toFixed(1)}mm 대칭`).toBeLessThan(1);
    expect(leftMm, '좌 여백 > 5mm (좌측 짤림 방지)').toBeGreaterThan(5);

    // AC-2: 상·하단 짤림 0
    const topMm = m.wrapTop / PX_PER_MM;
    const bottomClearanceMm = (m.pageH - m.wrapBottom) / PX_PER_MM;
    expect(topMm, `상단 여백 ${topMm.toFixed(1)}mm > 5mm (상단 짤림 방지)`).toBeGreaterThan(5);
    expect(bottomClearanceMm, `하단 클리어런스 ${bottomClearanceMm.toFixed(1)}mm > 5mm (하단 짤림 방지)`).toBeGreaterThan(5);
    expect(m.wrapRight, '우측 페이지 미초과').toBeLessThanOrEqual(m.pageW + 0.5);
    expect(m.scrollH, 'overflow:hidden 클립 없음 (콘텐츠 ≤ page 높이)').toBeLessThanOrEqual(m.pageH + 1);
  });
});
