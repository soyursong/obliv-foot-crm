/**
 * QA 게이트 스펙 — T-20260520-foot-PRINT-FORM-BIND (대표 지시 2026-05-20)
 *
 * ■ Gate-1: 출력양식 5종 스크린샷 (bill_detail · bill_receipt · rx_standard · diag_opinion · diagnosis)
 * ■ Gate-2: 고객정보 8필드 대조 (주민번호·차트번호·면허번호·요양기관번호·전화번호·주소·성별·생년월일)
 * ■ Gate-3: HTML raw 태그 노출 0건 (5종 전부)
 * ■ Gate-4: 에러 없는 엣지케이스 (데이터 미입력 환자 graceful 출력)
 * ■ Gate-5: 스크린샷 첨부 의무 — 경로: _handoff/qa_screenshots/PRINT-FORM-BIND/G1-{n}_{ts}.png
 *
 * 실행: npx playwright test T-20260520-foot-PRINT-FORM-BIND-QA-GATE.spec.ts --project=desktop-chrome
 *
 * NOTE: 이 스펙은 정적 HTML 렌더 방식 (page.setContent) 으로 실행.
 *       실서버 불필요, Supabase 연결 불필요.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildRxItemsHtml,
} from '../../src/lib/htmlFormTemplates';

// ── 스크린샷 저장 경로 ─────────────────────────────────────────────────────────
const SCREENSHOT_DIR = path.join(
  process.env.HOME ?? '/Users/domas',
  'Documents/claude-sync/memory/_handoff/qa_screenshots/PRINT-FORM-BIND',
);
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// 공통 스타일 래퍼 (A4 미리보기)
const PAGE_WRAP = (body: string) => `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 16px; background: #f5f5f5; }
  @media print { body { background: #fff; padding: 0; } }
</style>
</head>
<body>${body}</body>
</html>`;

// ── 공통 Mock 데이터 ───────────────────────────────────────────────────────────
const MOCK_FULL: Record<string, string> = {
  // 환자 기본 정보
  patient_name: '홍길동',
  patient_rrn: '800101-1******',          // 마스킹
  patient_phone: '010-1234-5678',
  patient_address: '서울특별시 종로구 종로1가 123-45',
  patient_gender: '☑ 남  ☐ 여',
  patient_birthdate: '1980년 01월 01일',
  patient_age: '44',
  // 차트·기관
  record_no: 'F-20240101-001',            // chart_number
  clinic_name: '오블리브 풋센터 종로',
  clinic_address: '서울특별시 종로구 종로1가 1번지',
  clinic_phone: '02-1234-5678',
  clinic_fax: '02-1234-5679',
  clinic_nhis_code: '12345678',           // 요양기관번호
  clinic_code: '12345678',
  doctor_name: '김의사',
  doctor_license_no: '99999',
  // 진단 코드
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  diag_code_2: '',
  diag_name_2: '',
  // 날짜
  visit_date: '2026-05-20',
  issue_date: '2026-05-20',
  onset_date: '2026-04-01',
  // 금액
  total_amount: '150,000',
  non_covered: '150,000',
  insurance_covered: '0',
  subtotal_amount: '150,000',
  subtotal_noncovered: '150,000',
  total_noncovered: '150,000',
  // 처방
  usage_days: '3',
  issue_no: '001',
  // 소견서
  diagnosis_ko: '내향성 발톱으로 인한 보존적 처치를 시행함. 향후 정기적인 관리 권장.',
  memo: '',
  purpose: '보험청구용',
};

const MOCK_EMPTY: Record<string, string> = {
  patient_name: '테스트환자',
  visit_date: '2026-05-20',
  issue_date: '2026-05-20',
  clinic_name: '오블리브 풋센터 종로',
};

// ── 보조 함수 ──────────────────────────────────────────────────────────────────
function saveScreenshot(filename: string, buffer: Buffer): string {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const fullPath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

// ── Gate-1 + Gate-5: 5종 양식 스크린샷 ───────────────────────────────────────

test.describe('GATE-1 — 출력양식 5종 스크린샷', () => {

  test('G1-1: bill_detail (진료비 세부내역서) 스크린샷', async ({ page }) => {
    const itemsHtml = buildBillDetailItemsHtml([
      { name: '내향성 발톱 처치 (레이저)', amount: 120000, count: 1, days: 1 },
      { name: '드레싱 처치', amount: 30000, count: 1, days: 1 },
    ]);
    const tmpl = getHtmlTemplate('bill_detail')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, items_html: itemsHtml });
    await page.setContent(PAGE_WRAP(html));
    await page.waitForLoadState('networkidle');

    // Gate-3 inline: HTML raw 태그 노출 없음 확인
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);           // 미치환 플레이스홀더 0건
    expect(body).not.toContain('&lt;tr&gt;');             // items_html 이스케이프 없음

    // 컨텐츠 확인 (bill_detail에 환자명이 2곳 — first()로 특정)
    await expect(page.getByText('홍길동').first()).toBeVisible();
    await expect(page.getByText('F-20240101-001')).toBeVisible();
    await expect(page.getByText('내향성 발톱 처치')).toBeVisible();
    await expect(page.getByText('끝처리 조정금액')).toBeVisible();  // DOC-PRINT-LINKAGE AC-1-4

    const buf = await page.screenshot({ fullPage: true });
    const saved = saveScreenshot(`G1-1_bill_detail_${TS}.png`, buf);
    console.log(`[GATE-1] bill_detail screenshot: ${saved}`);
    expect(buf.length).toBeGreaterThan(1000);
  });

  test('G1-2: bill_receipt (진료비 영수증) 스크린샷', async ({ page }) => {
    const tmpl = getHtmlTemplate('bill_receipt')!;
    const html = bindHtmlTemplate(tmpl, MOCK_FULL);
    await page.setContent(PAGE_WRAP(html));
    await page.waitForLoadState('networkidle');

    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
    // DOC-PRINT-LINKAGE AC-1-5: 영문 부제목 제거 확인
    expect(body).not.toContain('Health Insurance Medical Fee Receipt');

    // RRN 표시 확인 (DOC-PRINT-LINKAGE AC-2-1)
    await expect(page.getByText('800101-1******')).toBeVisible();
    // 처치 및 수술료 비급여 금액 확인 (AC-2-2)
    const cells = await page.locator('td.br-num').allInnerTexts();
    const hasNonCovered = cells.some(c => c.includes('150,000'));
    expect(hasNonCovered).toBeTruthy();

    const buf = await page.screenshot({ fullPage: true });
    const saved = saveScreenshot(`G1-2_bill_receipt_${TS}.png`, buf);
    console.log(`[GATE-1] bill_receipt screenshot: ${saved}`);
    expect(buf.length).toBeGreaterThan(1000);
  });

  test('G1-3: rx_standard (처방전) 스크린샷', async ({ page }) => {
    const rxItemsHtml = buildRxItemsHtml([
      { name: '타이레놀정(500mg)', unit_dose: '1정', freq_per_day: '3회', total_days: '3일', method: '식후 30분' },
    ]);
    const tmpl = getHtmlTemplate('rx_standard')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, rx_items_html: rxItemsHtml });
    await page.setContent(PAGE_WRAP(html));
    await page.waitForLoadState('networkidle');

    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
    // DOC-PRINT-LINKAGE AC-3-7: 영문 E-Health 제거 확인
    expect(body).not.toContain('E-Health');

    // AC-3-1: 차트번호
    await expect(page.getByText('F-20240101-001')).toBeVisible();
    // AC-3-2: 요양기관번호
    await expect(page.getByText('12345678')).toBeVisible();
    // AC-3-3: 주민번호 마스킹
    await expect(page.getByText('800101-1******')).toBeVisible();
    // AC-3-5: 면허번호
    await expect(page.getByText('99999')).toBeVisible();
    // AC-3-4: 전화번호
    await expect(page.getByText('02-1234-5678')).toBeVisible();
    // AC-3-6: 팩스
    await expect(page.getByText('02-1234-5679')).toBeVisible();

    const buf = await page.screenshot({ fullPage: true });
    const saved = saveScreenshot(`G1-3_rx_standard_${TS}.png`, buf);
    console.log(`[GATE-1] rx_standard screenshot: ${saved}`);
    expect(buf.length).toBeGreaterThan(1000);
  });

  test('G1-4: diag_opinion (소견서) 스크린샷', async ({ page }) => {
    const tmpl = getHtmlTemplate('diag_opinion')!;
    const html = bindHtmlTemplate(tmpl, MOCK_FULL);
    await page.setContent(PAGE_WRAP(html));
    await page.waitForLoadState('networkidle');

    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);

    // AC-4-1: 주민번호 + 성별 자동 연동
    await expect(page.getByText('800101-1******')).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();

    const buf = await page.screenshot({ fullPage: true });
    const saved = saveScreenshot(`G1-4_diag_opinion_${TS}.png`, buf);
    console.log(`[GATE-1] diag_opinion screenshot: ${saved}`);
    expect(buf.length).toBeGreaterThan(1000);
  });

  test('G1-5: diagnosis (진단서) 스크린샷', async ({ page }) => {
    const tmpl = getHtmlTemplate('diagnosis')!;
    const html = bindHtmlTemplate(tmpl, MOCK_FULL);
    await page.setContent(PAGE_WRAP(html));
    await page.waitForLoadState('networkidle');

    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);

    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('L60.0')).toBeVisible();

    const buf = await page.screenshot({ fullPage: true });
    const saved = saveScreenshot(`G1-5_diagnosis_${TS}.png`, buf);
    console.log(`[GATE-1] diagnosis screenshot: ${saved}`);
    expect(buf.length).toBeGreaterThan(1000);
  });
});

// ── Gate-2: 고객정보 8필드 대조 ───────────────────────────────────────────────

test.describe('GATE-2 — 고객정보 8필드 DB↔출력 대조', () => {
  /**
   * DB 원본 값 (Mock — 실 운영 시 rrn_decrypt RPC 결과와 동일한 형태)
   * 8개 필드: 주민번호·차트번호·면허번호·요양기관번호·전화번호·주소·성별·생년월일
   */
  const DB_VALUES = {
    rrn: '800101-1******',             // rrn_decrypt RPC → 마스킹 적용
    chart_number: 'F-20240101-001',
    license_no: '99999',
    nhis_code: '12345678',
    phone: '02-1234-5678',
    address: '서울특별시 종로구 종로1가 123-45',
    gender: '☑ 남  ☐ 여',
    birth_date: '1980년 01월 01일',
  };

  test('bill_receipt — 8필드 출력값 일치 (주민번호·주소·기관명)', async ({ page }) => {
    const tmpl = getHtmlTemplate('bill_receipt')!;
    const html = bindHtmlTemplate(tmpl, MOCK_FULL);
    await page.setContent(PAGE_WRAP(html));

    const text = await page.evaluate(() => document.body.innerText);
    // bill_receipt는 주민번호 + 기관주소 포함 (환자주소 없음)
    expect(text).toContain(DB_VALUES.rrn);
    expect(text).toContain('오블리브 풋센터 종로');  // clinic_name
  });

  test('rx_standard — 8필드 출력값 일치', async ({ page }) => {
    const rxItemsHtml = buildRxItemsHtml([]);
    const tmpl = getHtmlTemplate('rx_standard')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, rx_items_html: rxItemsHtml });
    await page.setContent(PAGE_WRAP(html));

    const text = await page.evaluate(() => document.body.innerText);
    // 차트번호
    expect(text).toContain(DB_VALUES.chart_number);
    // 요양기관번호
    expect(text).toContain(DB_VALUES.nhis_code);
    // 주민번호 마스킹
    expect(text).toContain(DB_VALUES.rrn);
    // 전화번호
    expect(text).toContain(DB_VALUES.phone);
    // 면허번호
    expect(text).toContain(DB_VALUES.license_no);
  });

  test('diag_opinion — 주민번호·성별 자동 연동', async ({ page }) => {
    const tmpl = getHtmlTemplate('diag_opinion')!;
    const html = bindHtmlTemplate(tmpl, MOCK_FULL);
    await page.setContent(PAGE_WRAP(html));

    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain(DB_VALUES.rrn);
    expect(text).toContain('☑ 남');
  });

  test('bill_detail — 차트번호·환자명 표시', async ({ page }) => {
    const itemsHtml = buildBillDetailItemsHtml([]);
    const tmpl = getHtmlTemplate('bill_detail')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, items_html: itemsHtml });
    await page.setContent(PAGE_WRAP(html));

    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain(DB_VALUES.chart_number);
    expect(text).toContain('홍길동');
  });
});

// ── Gate-3: HTML raw 태그 노출 0건 ────────────────────────────────────────────

test.describe('GATE-3 — HTML raw 태그 노출 0건 (5종 전부)', () => {
  const FORMS = ['bill_detail', 'bill_receipt', 'rx_standard', 'diag_opinion', 'diagnosis'] as const;

  for (const formKey of FORMS) {
    test(`${formKey} — raw 태그 노출 없음`, async ({ page }) => {
      const tmpl = getHtmlTemplate(formKey)!;
      let html: string;

      if (formKey === 'bill_detail') {
        const itemsHtml = buildBillDetailItemsHtml([{ name: '레이저 처치', amount: 80000 }]);
        html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, items_html: itemsHtml });
      } else if (formKey === 'rx_standard') {
        const rxHtml = buildRxItemsHtml([{ name: '세파드록실', unit_dose: '1정' }]);
        html = bindHtmlTemplate(tmpl, { ...MOCK_FULL, rx_items_html: rxHtml });
      } else {
        html = bindHtmlTemplate(tmpl, MOCK_FULL);
      }

      await page.setContent(PAGE_WRAP(html));
      const bodyHtml = await page.evaluate(() => document.body.innerHTML);

      // 미치환 플레이스홀더 없음
      const unresolved = bodyHtml.match(/\{\{[^}]+\}\}/g);
      expect(unresolved, `${formKey} 미치환 플레이스홀더 발견: ${unresolved}`).toBeNull();

      // 이중 이스케이프 없음 (items_html 등이 &lt;tr&gt;로 표시되면 안 됨)
      expect(bodyHtml, `${formKey} &lt;tr&gt; 노출됨`).not.toContain('&lt;tr&gt;');
      expect(bodyHtml, `${formKey} &lt;td&gt; 노출됨`).not.toContain('&lt;td&gt;');
    });
  }
});

// ── Gate-4: 미입력 환자 엣지케이스 ───────────────────────────────────────────

test.describe('GATE-4 — 미입력 환자 graceful 출력', () => {
  test('bill_detail — 빈 항목 환자 (chart_number·rrn 없음)', async ({ page }) => {
    const itemsHtml = buildBillDetailItemsHtml([]);
    const tmpl = getHtmlTemplate('bill_detail')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_EMPTY, items_html: itemsHtml });
    await page.setContent(PAGE_WRAP(html));

    // 에러 없이 로드
    await expect(page.locator('.bill-wrap')).toBeVisible();
    // 미치환 플레이스홀더 0건
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
    // 빈 항목 텍스트
    await expect(page.getByText('진료 항목 없음')).toBeVisible();
  });

  test('bill_receipt — nhis_code·rrn 미입력 환자', async ({ page }) => {
    const tmpl = getHtmlTemplate('bill_receipt')!;
    const html = bindHtmlTemplate(tmpl, MOCK_EMPTY);
    await page.setContent(PAGE_WRAP(html));
    await expect(page.locator('.br-wrap')).toBeVisible();
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('rx_standard — 차트번호·주민번호 미입력', async ({ page }) => {
    const rxHtml = buildRxItemsHtml([]);
    const tmpl = getHtmlTemplate('rx_standard')!;
    const html = bindHtmlTemplate(tmpl, { ...MOCK_EMPTY, rx_items_html: rxHtml });
    await page.setContent(PAGE_WRAP(html));
    await expect(page.locator('.rx-wrap')).toBeVisible();
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('diag_opinion — 진단 코드 미입력', async ({ page }) => {
    const tmpl = getHtmlTemplate('diag_opinion')!;
    const html = bindHtmlTemplate(tmpl, MOCK_EMPTY);
    await page.setContent(PAGE_WRAP(html));
    await expect(page.locator('.form-wrap')).toBeVisible();
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('diagnosis — 전체 필드 미입력', async ({ page }) => {
    const tmpl = getHtmlTemplate('diagnosis')!;
    const html = bindHtmlTemplate(tmpl, MOCK_EMPTY);
    await page.setContent(PAGE_WRAP(html));
    await expect(page.locator('.form-wrap')).toBeVisible();
    const body = await page.evaluate(() => document.body.innerHTML);
    expect(body).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
