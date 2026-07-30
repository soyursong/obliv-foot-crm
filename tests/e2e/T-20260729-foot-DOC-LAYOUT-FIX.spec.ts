/**
 * E2E spec — T-20260729-foot-DOC-LAYOUT-FIX
 *
 * 풋센터 5개 서류 순수 HTML/CSS 레이아웃 정밀 수정 회귀 가드 (src/lib/htmlFormTemplates.ts).
 * db_change=false · DDL=0 · 데이터 바인딩/계산 로직 무접촉(레이아웃 diff만). 로그인 불요·결정론적.
 *
 *   ① 계산서·영수증(bill_receipt_new, .rn-wrap) : @media print width 210mm→190mm + margin:0 auto(A4 중앙정렬),
 *      하단 요양기관 정보표 colgroup 좌측군 50% / 우측(전화·대표·직인)군 50% 재분배.
 *   ② 통원확인서(visit_confirm, .form-wrap)     : 제목 margin-bottom 2px→12px, 용도표 width:auto→100%+table-layout:fixed(라벨 80px).
 *   ③ 진료확인서(treat_confirm_*, .form-wrap)   : 제목 여백 12px, 특정기호 헤더+값셀 nowrap(상병명 흡수·총폭 불변), 용도표 100%+fixed.
 *   ④ 세부산정내역서(bill_detail, .bill-wrap)   : 비고열 고정폭+fixed, diag-grid 좌/우 블록 50:50, 하단 발급기관표 직인 제외 명칭군/대표군 50:50.
 *   ⑤ 소견서(diag_opinion, .form-wrap)          : 환자정보표·하단서명표 라벨 중앙정렬, 하단서명표 fixed+colgroup 면허군/의사성명군 50:50.
 *
 * 🔴 격리 불변식: 통원·진료확인·소견서 3종은 COMMON_STYLE 공유 → COMMON_STYLE 절대 미변경(인라인/신규클래스만).
 *    진단서(diagnosis) 특정기호 무접촉(진료확인서 code블록만 nowrap).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractTemplate(name: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${name} 상수 존재`).not.toBeNull();
  return m![1];
}

const NEW_TPL = extractTemplate('BILL_RECEIPT_NEW_HTML');
const DETAIL_TPL = extractTemplate('BILL_DETAIL_HTML');
const VISIT_TPL = extractTemplate('VISIT_CONFIRM_HTML');
const TREAT_TPL = extractTemplate('TREAT_CONFIRM_HTML');
const DISEASE_BLOCK = extractTemplate('TREAT_CONFIRM_DISEASE_BLOCK');
const OPINION_TPL = extractTemplate('DIAG_OPINION_HTML');
const DIAGNOSIS_TPL = extractTemplate('DIAGNOSIS_HTML');

const SAMPLE: Record<string, string> = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', visit_no: 'V-0007',
  patient_name: '홍길동', patient_gender: '남', patient_age: '35',
  patient_phone: '010-1234-5678', patient_birthdate: '1990-01-01',
  patient_rrn: '900101-1******', patient_address: '서울특별시 종로구 종로12길 15 3층',
  onset_date: '2026-06-01', diag_code_1: 'M72.2', diag_name_1: '족저근막염', diag_flag_1: 'V193',
  diag_code_2: 'M25.5', diag_name_2: '관절통', diag_flag_2: 'V194',
  diag_row_3_style: 'display:none;', diag_row_4_style: 'display:none;',
  diagnosis_ko: '좌측 발뒤꿈치 통증 3개월 지속.', memo: '특이사항 없음', purpose: '보험 청구용',
  visit_date: '2026-06-29', visit_days: '1',
  issue_date: '2026년 06월 29일', clinic_name: '오블리브의원 종로점',
  clinic_address: '서울특별시 종로구 종로12길 15', clinic_phone: '02-6956-3438',
  clinic_code: '11111111', hira_institution_name: '오블리브의원',
  doctor_name: '문지은', doctor_license_no: '제12345호', doctor_seal_html: '', institution_seal_html: '[인]',
  receipt_no: 'RN-2026-0007', receipt_representative: '박영진',
  night_mark: ' ', holiday_mark: ' ',
  consult_copay: '8,800', consult_ins: '0', proc_copay: '', proc_ins: '', proc_noncov: '120,000',
  exam_copay: '', exam_ins: '', exam_noncov: '', etc_noncov: '',
  copayment: '8,800', insurance_covered: '0', non_covered: '120,000', total_amount: '128,800',
  patient_amount: '128,800', already_paid: '', due_amount: '', card_amount: '128,800',
  cashreceipt_amount: '', cash_amount: '', paid_total: '128,800', unpaid_amount: '0',
  cashreceipt_mark: ' ', cashreceipt_id_number: '', cashreceipt_approval_no: '',
  items_html: '<tr><td>기본</td><td>2026-06-29</td><td>SC001</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td>1</td><td class="num-cell">120,000</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">0</td><td class="num-cell">120,000</td></tr>',
  detail_subtotal: '120,000', subtotal_copayment: '0', subtotal_fund: '0', subtotal_noncovered: '120,000',
  detail_rounding: '0', detail_total: '120,000',
};

// ════════════════════════ 파트 A: 마크업 불변식 (결정론적, 브라우저 불요) ════════════════════════

test.describe('DOC-LAYOUT-FIX 마크업 불변식', () => {
  // ── ① 계산서·영수증 (rn-wrap, 독립수정 안전) ──
  test('①-a: @media print .rn-wrap = width:190mm + margin:0 auto (A4 중앙정렬, 210mm full-bleed 폐기)', () => {
    expect(NEW_TPL).toMatch(/\.rn-wrap\s*\{\s*width:190mm;\s*padding:5mm 7mm;\s*margin:0 auto;\s*\}/);
    expect(NEW_TPL).not.toMatch(/\.rn-wrap\s*\{\s*width:210mm;\s*padding:5mm 7mm;\s*\}/);
  });
  test('①-b: 하단 요양기관 정보표 colgroup 6칸, 우측군(전화·대표·직인) col5 17%+col6 33% = 50%', () => {
    expect(NEW_TPL).toMatch(/<colgroup><col style="width:12%"><col style="width:13%"><col style="width:10%"><col style="width:15%"><col style="width:17%"><col style="width:33%"><\/colgroup>/);
  });

  // ── ② 통원확인서 (form-wrap, 인라인만) ──
  test('②-a: 통원확인서 제목 margin-bottom:12px (2px 폐기, 인라인)', () => {
    expect(VISIT_TPL).toMatch(/margin-bottom:12px;">\s*<div style="flex:1"><\/div>\s*<div class="title" style="flex:none; padding:0 20px;">통 원 확 인 서<\/div>/);
  });
  test('②-b: 통원확인서 용도표 width:100% + table-layout:fixed, 라벨 80px', () => {
    expect(VISIT_TPL).toMatch(/<table style="margin-top:4px; width:100%; table-layout:fixed;">[\s\S]*?통원확인서 화면·인쇄 모두 미표시[\s\S]*?width:80px; background:#f8f8f8; text-align:center;">용/);
  });

  // ── ③ 진료확인서 (form-wrap, 인라인만) + 진단서 무접촉 ──
  test('③-a: 진료확인서 제목 margin-bottom:12px', () => {
    expect(TREAT_TPL).toMatch(/margin-bottom:12px;">\s*<div style="flex:1"><\/div>\s*<div class="title" style="flex:none; padding:0 20px;">진 료 확 인 서<\/div>/);
  });
  test('③-b: 특정기호 헤더 + diag_flag 값셀 4개 nowrap (상병명 흡수·총폭 불변)', () => {
    expect(DISEASE_BLOCK).toMatch(/width:70px; white-space:nowrap;">특 정 기 호/);
    for (let i = 1; i <= 4; i++) {
      expect(DISEASE_BLOCK, `diag_flag_${i} nowrap`).toMatch(new RegExp(`<td style="white-space:nowrap;">\\{\\{diag_flag_${i}\\}\\}</td>`));
    }
  });
  test('③-c: 진료확인서 용도표 width:100% + fixed, 라벨 80px', () => {
    expect(TREAT_TPL).toMatch(/<table style="margin-top:4px; width:100%; table-layout:fixed;">[\s\S]*?진료확인서 화면·인쇄 모두 미표시[\s\S]*?width:80px; background:#f8f8f8; text-align:center;">용/);
  });
  test('③-guard: 진단서(diagnosis) 특정기호 nowrap 무접촉 (회귀 가드)', () => {
    expect(DIAGNOSIS_TPL).not.toMatch(/white-space:nowrap;">\{\{diag_flag_/);
    expect(DIAGNOSIS_TPL).not.toMatch(/width:70px; white-space:nowrap;">특 정 기 호/);
  });

  // ── ④ 세부산정내역서 (bill-wrap, 독립수정 안전) ──
  test('④-a: 환자 기본정보표 table-layout:fixed + 비고 th 고정폭 100px', () => {
    expect(DETAIL_TPL).toMatch(/<table style="margin-bottom:4px; table-layout:fixed;">/);
    expect(DETAIL_TPL).toMatch(/<th style="width:100px;">비고<\/th>/);
  });
  test('④-b: diag-grid table-layout:fixed + colgroup 좌블록 50%(8+18+24) / 우블록 50%', () => {
    expect(DETAIL_TPL).toMatch(/<table class="diag-grid" style="margin-bottom:4px; table-layout:fixed;">/);
    expect(DETAIL_TPL).toMatch(/<col style="width:8%" \/><col style="width:18%" \/><col style="width:24%" \/>\s*<col style="width:8%" \/><col style="width:18%" \/><col style="width:24%" \/>/);
  });
  test('④-c: 하단 발급기관표 fixed + colgroup 명칭군 47.5% / 대표군 47.5% / 직인 5%', () => {
    expect(DETAIL_TPL).toMatch(/<table style="margin-top:8px; table-layout:fixed;">/);
    expect(DETAIL_TPL).toMatch(/<col style="width:16%" \/><col style="width:31.5%" \/><col style="width:14%" \/><col style="width:33.5%" \/><col style="width:5%" \/>/);
  });

  // ── ⑤ 소견서 (form-wrap, 인라인만) ──
  test('⑤-a: 환자정보표 라벨 6개 text-align:center', () => {
    for (const lbl of ['환 자 정 보', '주 민 번 호', '환자 성명', '성별', '생년월일', '연령', '환자의 주소']) {
      expect(OPINION_TPL, `${lbl} center`).toMatch(new RegExp(`background:#f8f8f8;[^"]*text-align:center;">${lbl.replace(/ /g, ' ')}`));
    }
    expect(OPINION_TPL).toMatch(/white-space:nowrap; text-align:center;">환자 연락처/);
  });
  test('⑤-b: 하단서명표 fixed + colgroup 면허군 50%(15+35) / 의사성명군 50%(15+35)', () => {
    expect(OPINION_TPL).toMatch(/<table style="margin-top:4px; table-layout:fixed;">\s*<colgroup><col style="width:15%" \/><col style="width:35%" \/><col style="width:15%" \/><col style="width:35%" \/><\/colgroup>/);
    expect(OPINION_TPL).toMatch(/background:#f8f8f8; text-align:center;">발 행 일/);
    expect(OPINION_TPL).toMatch(/text-align:center; white-space:nowrap;">의 사 성 명/);
  });

  // ── 🔴 격리 불변식: COMMON_STYLE 미변경 ──
  test('격리: COMMON_STYLE 기본 form-wrap 규칙(190mm margin auto) 미변경', () => {
    expect(HTML_SRC).toMatch(/\.form-wrap \{ width: 190mm; min-height: 262mm; padding: 6mm 8mm; margin: 0 auto; \}/);
  });
  test('격리: 3종(통원·진료확인·소견서) 모두 COMMON_STYLE 공유 유지', () => {
    for (const t of [VISIT_TPL, TREAT_TPL, OPINION_TPL]) {
      expect(t).toMatch(/\$\{COMMON_STYLE\}/);
      expect(t).toMatch(/<div class="form-wrap">/);
    }
  });
});

// ════════════════════════ 파트 B: 렌더 레이아웃 실측 (print emulation) ════════════════════════

async function renderPortrait(page: import('@playwright/test').Page, formKey: string) {
  const raw = getHtmlTemplate(formKey);
  expect(raw, `${formKey} 템플릿`).toBeTruthy();
  const html = bindHtmlTemplate(raw as string, SAMPLE);
  const vw = Math.round(210 * 96 / 25.4), vh = Math.round(297 * 96 / 25.4);
  await page.setViewportSize({ width: vw, height: vh });
  await page.emulateMedia({ media: 'print' });
  await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  return { pxPerMm: vw / 210 };
}

test.describe('DOC-LAYOUT-FIX 렌더 실측', () => {
  // ① A4 중앙정렬: rn-wrap 좌우 belt 대칭(≈10mm each), 폭 190mm.
  test('①-render: 계산서·영수증 rn-wrap A4 중앙정렬(좌우 대칭 belt)', async ({ page }) => {
    const { pxPerMm } = await renderPortrait(page, 'bill_receipt_new');
    const m = await page.evaluate(() => {
      const b = document.body.getBoundingClientRect();
      const w = (document.querySelector('.rn-wrap') as HTMLElement).getBoundingClientRect();
      return { left: w.left - b.left, right: b.right - w.right, width: w.width, bodyW: b.width };
    });
    const leftMm = m.left / pxPerMm, rightMm = m.right / pxPerMm, widthMm = m.width / pxPerMm;
    const tag = `[rn-wrap] 폭${widthMm.toFixed(1)}/좌${leftMm.toFixed(1)}/우${rightMm.toFixed(1)}mm`;
    expect(widthMm, `${tag} 폭≈190mm`).toBeGreaterThan(186);
    expect(widthMm, `${tag} 폭≈190mm`).toBeLessThan(194);
    expect(Math.abs(leftMm - rightMm), `${tag} 좌우 belt 대칭`).toBeLessThan(2);
  });

  // ④ diag-grid 좌/우 블록 50:50 — 2번째 '연번' 헤더가 테이블 폭 ~50% 지점에서 시작.
  test('④-render: 세부내역서 diag-grid 좌/우 블록 50:50', async ({ page }) => {
    const raw = getHtmlTemplate('bill_detail');
    const html = bindHtmlTemplate(raw as string, SAMPLE);
    const vw = Math.round(297 * 96 / 25.4), vh = Math.round(210 * 96 / 25.4);
    await page.setViewportSize({ width: vw, height: vh });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
    const r = await page.evaluate(() => {
      const grid = document.querySelector('.diag-grid') as HTMLElement;
      const gr = grid.getBoundingClientRect();
      const ths = Array.from(grid.querySelectorAll('thead th')) as HTMLElement[];
      const secondYeonbeon = ths[3].getBoundingClientRect(); // 4번째 th = 우블록 시작 '연번'
      return { midRatio: (secondYeonbeon.left - gr.left) / gr.width };
    });
    expect(r.midRatio, `diag-grid 우블록 시작 ${(r.midRatio * 100).toFixed(1)}% ≈ 50%`).toBeGreaterThan(0.46);
    expect(r.midRatio, `diag-grid 우블록 시작 ≈ 50%`).toBeLessThan(0.54);
  });

  // 🔴 격리: 3종 form-wrap 동시 렌더 — 각자 정상(제목·form-wrap 폭 190mm) = COMMON_STYLE 오염 없음.
  for (const [key, title] of [['visit_confirm', '통 원 확 인 서'], ['treat_confirm_code', '진 료 확 인 서'], ['diag_opinion', '소 견 서']] as const) {
    test(`격리-render: ${key} 정상 렌더(제목 존재 + form-wrap 폭 190mm)`, async ({ page }) => {
      const { pxPerMm } = await renderPortrait(page, key);
      const r = await page.evaluate((t) => {
        const w = document.querySelector('.form-wrap') as HTMLElement;
        return { width: w.getBoundingClientRect().width, hasTitle: document.body.innerText.includes(t) };
      }, title);
      const widthMm = r.width / pxPerMm;
      expect(r.hasTitle, `${key} 제목 렌더`).toBeTruthy();
      expect(widthMm, `${key} form-wrap 폭≈190mm(COMMON_STYLE 무붕괴) =${widthMm.toFixed(1)}`).toBeGreaterThan(186);
      expect(widthMm, `${key} form-wrap 폭≈190mm`).toBeLessThan(194);
    });
  }

  // ② 통원확인서 용도표 width:100% — 용도표 폭이 form-wrap 콘텐츠 폭과 근접(전폭).
  test('②-render: 통원확인서 용도표 전폭(width:100%)', async ({ page }) => {
    await renderPortrait(page, 'visit_confirm');
    const r = await page.evaluate(() => {
      const wrap = document.querySelector('.form-wrap') as HTMLElement;
      // 용도표 = "용 도" 라벨을 포함한 table
      const tables = Array.from(wrap.querySelectorAll('table')) as HTMLElement[];
      const purposeTable = tables.find(t => t.innerText.includes('용') && t.innerText.includes('보험 청구용'));
      if (!purposeTable) return { ratio: 0 };
      const cs = getComputedStyle(wrap);
      const contentW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { ratio: purposeTable.getBoundingClientRect().width / contentW };
    });
    expect(r.ratio, `용도표 폭/콘텐츠폭 ${(r.ratio * 100).toFixed(1)}% ≈ 100%`).toBeGreaterThan(0.95);
  });
});
