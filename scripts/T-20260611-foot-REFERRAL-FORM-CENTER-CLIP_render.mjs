// T-20260611-foot-REFERRAL-FORM-CENTER-CLIP: 진료의뢰서 A4 인쇄 실측 하니스
// 폼 HTML을 실제 인쇄 경로(.page width:210mm min-height:297mm overflow:hidden)에 넣어
// (1) 제목 중앙정렬 (2) 상·하단 짤림 여부를 측정 + 스크린샷.
import { chromium } from 'playwright';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const sample = {
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
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">박의사</span>',
  clinic_name: '오블리브의원 종로점',
};

const raw = getHtmlTemplate('referral_letter');
if (!raw) { console.error('NO TEMPLATE'); process.exit(1); }
const formHtml = bindHtmlTemplate(raw, sample);

// 실제 인쇄창과 동일한 .page 컨테이너
const pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4 portrait; margin: 0; }
  body { margin:0; padding:0; }
  .page { position:relative; width:210mm; min-height:297mm; overflow:hidden; }
  /* 실제 프린터 unprintable edge 가이드 (보통 상하좌우 ~5mm) */
  .safe { position:absolute; inset:5mm; border:1px dashed red; pointer-events:none; z-index:999; }
</style></head><body>
<div class="page"><div class="safe"></div>${formHtml}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 794, height: 1123 }); // A4 @96dpi
await page.setContent(pageHtml, { waitUntil: 'networkidle' });

// 측정: .page 높이 vs form-wrap 높이/위치, 제목 중앙정렬
const m = await page.evaluate(() => {
  const pageEl = document.querySelector('.page');
  const wrap = document.querySelector('.form-wrap');
  const title = document.querySelector('.title');
  const pr = pageEl.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const tr = title.getBoundingClientRect();
  // 제목 텍스트 실제 잉크 박스 중심 측정 (range)
  const range = document.createRange();
  range.selectNodeContents(title);
  const inkr = range.getBoundingClientRect();
  return {
    page: { w: pr.width, h: pr.height },
    wrap: { left: wr.left, right: wr.right, top: wr.top, bottom: wr.bottom, h: wr.height },
    pageCenterX: pr.left + pr.width / 2,
    titleBlockCenterX: tr.left + tr.width / 2,
    titleInkCenterX: inkr.left + inkr.width / 2,
    titleInk: { left: inkr.left, right: inkr.right, w: inkr.width },
    // form-wrap 이 page 아래로 넘치는지 (overflow:hidden 클립)
    wrapExceedsBottom: wr.bottom > pr.bottom + 0.5,
    wrapExceedsRight: wr.right > pr.right + 0.5,
    scrollH: document.querySelector('.page').scrollHeight,
  };
});

const pxPerMm = 794 / 210;
console.log('=== 진료의뢰서 A4 실측 ===');
console.log('page:', JSON.stringify(m.page), `(${(m.page.h/pxPerMm).toFixed(1)}mm tall)`);
console.log('form-wrap height:', m.wrap.h.toFixed(1), 'px =', (m.wrap.h/pxPerMm).toFixed(1), 'mm');
console.log('form-wrap left/right:', m.wrap.left.toFixed(1), '/', m.wrap.right.toFixed(1),
  `(좌여백 ${(m.wrap.left/pxPerMm).toFixed(1)}mm, 우여백 ${((m.page.w-m.wrap.right)/pxPerMm).toFixed(1)}mm)`);
console.log('form-wrap top/bottom:', m.wrap.top.toFixed(1), '/', m.wrap.bottom.toFixed(1),
  `(상여백 ${(m.wrap.top/pxPerMm).toFixed(1)}mm, page높이대비 하단 ${((m.page.h-m.wrap.bottom)/pxPerMm).toFixed(1)}mm)`);
console.log('scrollHeight (실제 콘텐츠):', m.scrollH, 'px =', (m.scrollH/pxPerMm).toFixed(1), 'mm');
console.log('--- 제목 중앙정렬 ---');
console.log('page center X:', m.pageCenterX.toFixed(1));
console.log('title INK center X:', m.titleInkCenterX.toFixed(1),
  `(offset ${(m.titleInkCenterX - m.pageCenterX).toFixed(1)}px = ${((m.titleInkCenterX-m.pageCenterX)/pxPerMm).toFixed(2)}mm)`);
console.log('--- 짤림 ---');
console.log('하단 짤림(wrap>page bottom):', m.wrapExceedsBottom);
console.log('우측 짤림(wrap>page right):', m.wrapExceedsRight);
console.log('콘텐츠 > page 높이(overflow clip):', m.scrollH > m.page.h + 1);

await page.screenshot({ path: 'evidence/referral_render_AFTER.png', fullPage: false });
console.log('\nscreenshot -> evidence/referral_render_AFTER.png');
await browser.close();
