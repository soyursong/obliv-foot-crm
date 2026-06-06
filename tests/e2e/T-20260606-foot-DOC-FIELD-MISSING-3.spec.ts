/**
 * E2E spec — T-20260606-foot-DOC-FIELD-MISSING-3
 * 라이브 발행 서류 3종 필드 미표기 버그 — 렌더 레벨 검증.
 *
 * 검증 전략: 발행 서류는 순수 HTML 템플릿(`htmlFormTemplates.ts`, import 0) +
 *   `bindHtmlTemplate` 파이프라인으로 생성된다. DB/auth 없이 실제 브라우저 렌더
 *   (page.setContent)로 "현장이 보는 출력물"에 필드가 실제로 찍히는지 확인한다.
 *
 * AC-1: 보험청구서 출력물에 공단부담금 금액이 표기된다.
 * AC-2: 보험청구서 출력물에 비급여 금액이 표기된다.
 * AC-3: 진료비계산서(영수증) 출력물에 비급여 금액이 표기된다.
 * AC-4: 처방전 출력물에 "제 N호" 기재란이 채워진다.
 * AC-5: 처방전에 입력한 총 투약일수가 출력물에 표기된다.
 * AC-6: 기존 서류 출력 회귀 없음 — 미입력 총투약일수는 공란(수기 기입) 유지(8FIX AC-3③ 정신 보존).
 *
 * 회귀 출처: T-20260601-foot-DOC-PRINT-8FIX (buildRxItemsHtml total_days 강제 공란),
 *           PaymentMiniWindow issue_no='' 강제, PATH-4 service_charges 미기록.
 */
import { test, expect } from '@playwright/test';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  buildRxItemsHtml,
} from '../../src/lib/htmlFormTemplates';

/** 템플릿을 바인딩해 한 페이지로 렌더 후 본문 텍스트 반환 */
async function renderBound(
  page: import('@playwright/test').Page,
  formKey: string,
  values: Record<string, string>,
): Promise<string> {
  const tpl = getHtmlTemplate(formKey);
  expect(tpl, `${formKey} 템플릿 존재`).toBeTruthy();
  const html = bindHtmlTemplate(tpl as string, values);
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  return (await page.locator('body').innerText()).replace(/ /g, ' ');
}

test.describe('T-20260606-foot-DOC-FIELD-MISSING-3 — 서류 3종 필드 표기', () => {
  // ── AC-1/2: 보험청구서 공단부담금 + 비급여 ──
  test('AC-1/2: 보험청구서에 공단부담금·비급여 금액이 렌더된다', async ({ page }) => {
    const body = await renderBound(page, 'ins_claim_form', {
      patient_name: '홍길동',
      insurance_covered: '12,300', // 공단부담금
      copayment: '5,200', // 본인부담금
      non_covered: '88,000', // 비급여
      total_amount: '105,500',
    });
    // 공단부담금 (AC-1)
    expect(body).toContain('공단부담금');
    expect(body).toContain('12,300');
    // 비급여 (AC-2)
    expect(body).toContain('88,000');
    // 본인부담금도 표기
    expect(body).toContain('5,200');
  });

  // ── AC-3: 진료비계산서(영수증) 비급여 ──
  test('AC-3: 진료비계산서에 비급여 금액이 렌더된다', async ({ page }) => {
    const body = await renderBound(page, 'bill_receipt', {
      patient_name: '홍길동',
      clinic_name: '오블리브 풋센터 종로',
      insurance_covered: '0',
      non_covered: '150,000',
      total_amount: '150,000',
    });
    expect(body).toContain('비'); // 비급여 헤더
    expect(body).toContain('150,000');
  });

  // ── AC-4: 처방전 "제 N호" ──
  test('AC-4: 처방전 "제 N호" 기재란이 채워진다', async ({ page }) => {
    const body = await renderBound(page, 'rx_standard', {
      patient_name: '홍길동',
      issue_date: '2026-06-06',
      issue_no: 'A3F2B',
      clinic_name: '오블리브 풋센터 종로',
      rx_items_html: buildRxItemsHtml([
        { name: '아세트아미노펜', unit_dose: '1', daily_freq: '3', total_days: '5', method: '식후' },
      ]),
    });
    // "제 A3F2B 호" — 발번이 비어있지 않음
    expect(body).toMatch(/제\s*A3F2B\s*호/);
    expect(body).not.toMatch(/제\s*호/); // 빈 발번 회귀 방지
  });

  // ── AC-5: 처방전 총 투약일수 입력값 표기 ──
  test('AC-5: 입력한 총 투약일수가 처방전에 표기된다', async ({ page }) => {
    const rxHtml = buildRxItemsHtml([
      { name: '아세트아미노펜', unit_dose: '1', daily_freq: '3', total_days: '5', method: '식후' },
    ]);
    // 빌드된 row HTML에 입력값 5가 들어감 (강제 공란 회귀 방지)
    expect(rxHtml).toContain('>5<');

    const body = await renderBound(page, 'rx_standard', {
      patient_name: '홍길동',
      issue_no: 'X1',
      rx_items_html: rxHtml,
    });
    expect(body).toContain('아세트아미노펜');
    expect(body).toContain('5'); // 총투약일수 5 렌더
  });

  // ── AC-6: 회귀 — 미입력 총투약일수는 공란(수기) 유지 ──
  test('AC-6: 총투약일수 미입력 시 공란 유지(8FIX 수기 기입 정신 보존)', async () => {
    const rxHtml = buildRxItemsHtml([
      { name: '연고', unit_dose: '1', daily_freq: '1', total_days: '', method: '환부' },
    ]);
    // 총투약일수 셀이 비어 있어야 함 (자동 '7' 폴백 부활 금지)
    expect(rxHtml).not.toContain('>7<');
    // 약품명은 정상 표기
    expect(rxHtml).toContain('연고');
  });
});
