/**
 * E2E spec — T-20260609-foot-PAY-DOCPRINT-FEE-MISSING
 * 결제미니창에서 수납(결제 확인) 클릭 전 서류 출력 시 진료비(total_amount) 누락 버그.
 *
 * 근본 원인: total_amount/subtotal_amount는 autobind이 payments 테이블(payTotal)에서 읽는다.
 *   payments는 executeAutoDone(수납) 후에만 insert → 수납 전 출력 시 0/빈값 →
 *   영수증·진료비계산서·납입증명서 등에 진료비가 0으로 출력됨.
 * 수정: applyBillingFallback 에 진료비 총액 라이브 폴백(total) 추가. 화면 산출값으로 보강하되
 *   autobind 값(수납 후 payTotal)이 있으면 보존 → 수납 전/후 출력본 금액 동일.
 *
 * 검증 전략: DB/auth 없이 (1) applyBillingFallback 순수 함수 + (2) 실제 브라우저 HTML 렌더
 *   (page.setContent) 로 "현장이 보는 출력물"에 진료비가 실제로 찍히는지 확인한다.
 *
 * AC-1: 수납 클릭 전 서류 출력 시 진료비 항목(total_amount) 전체 표시.
 * AC-2: 레이저·일반·패키지 등 모든 진료비 항목 출력본에 포함(라이브 합계 보강).
 * AC-3: ⚠ 금액 회귀 금지 — 수납 전 출력본과 수납 후 출력본의 진료비 금액 동일.
 *        실제 수납/결제 금액 산정 로직 불변 (출력 데이터 소스만 '수납 완료 상태' 의존에서 분리).
 *
 * 관련 락: L-006 (DOC-PRINT-UNIFY) — DocumentPrintPanel/PaymentMiniWindow Zone 3 단일 경로 유지.
 */
import { test, expect } from '@playwright/test';
import { applyBillingFallback } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

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
  return (await page.locator('body').innerText()).replace(/ /g, ' ');
}

/** 수납 전 autobind 결과 모사 — payments 미기록이므로 total_amount 빈값 */
const preSettleAutoBind = (): Record<string, string> => ({
  patient_name: '홍길동',
  clinic_name: '오블리브 풋센터 종로',
  insurance_covered: '', // payments 미기록 → 빈값
  non_covered: '',
  total_amount: '', // ← 버그 원천: 수납 전 빈값(=진료비 누락)
  subtotal_amount: '',
});

test.describe('T-20260609-foot-PAY-DOCPRINT-FEE-MISSING — 수납 전 서류 진료비 누락', () => {
  // ── 시나리오 1 / AC-1·2: 수납 전 출력 시 진료비 전체 표시 ──
  test('AC-1/2: applyBillingFallback이 수납 전 빈 total_amount를 라이브 진료비로 채운다', () => {
    const values = preSettleAutoBind();
    // 화면 산출 진료비(레이저+일반+패키지 합계 = grandTotal). 수납 시 payments.amount로 기록될 값.
    const liveGrandTotal = 150000;
    applyBillingFallback(values, {
      insuranceCovered: 12300,
      copayment: 5200,
      nonCovered: 132500,
      total: liveGrandTotal,
    });
    // 진료비 누락 해소
    expect(values.total_amount).toBe('150,000');
    expect(values.subtotal_amount).toBe('150,000');
    // 보험 금액도 함께 보강 (기존 DOC-FIELD-MISSING-3 정신 유지)
    expect(values.insurance_covered).toBe('12,300');
    expect(values.non_covered).toBe('132,500');
  });

  // ── 시나리오 1 (렌더): 진료비계산서·영수증 출력물에 진료비가 실제로 찍힌다 ──
  test('AC-1/2: 진료비계산서(영수증)에 수납 전 라이브 진료비가 렌더된다', async ({ page }) => {
    const values = preSettleAutoBind();
    applyBillingFallback(values, { total: 240000 });
    expect(values.total_amount).toBe('240,000'); // 폴백 적용 확인

    const body = await renderBound(page, 'bill_receipt', values);
    // 출력물에 진료비 합계가 0이 아닌 실제 금액으로 표기
    expect(body).toContain('240,000');
    expect(body).not.toMatch(/총\s*진료비\s*합계[\s\S]*₩\s*0\b/); // 0원 누락 회귀 방지
  });

  // ── 시나리오 2 / AC-3: 수납 전/후 출력본 금액 일치 (회귀 방지) ──
  test('AC-3: 수납 후 autobind에 진료비가 있으면 보존(라이브로 덮어쓰지 않음) → 전후 동일', () => {
    // 수납 전: payTotal 미기록 → 빈값 → 라이브 220,000 폴백
    const pre = preSettleAutoBind();
    applyBillingFallback(pre, { total: 220000 });

    // 수납 후: executeAutoDone이 payments.amount=220,000 insert → autobind payTotal 채움
    const post: Record<string, string> = {
      ...preSettleAutoBind(),
      total_amount: '220,000', // payTotal 반영
      subtotal_amount: '220,000',
    };
    // 동일 라이브값으로 폴백 호출해도 기존 값 보존(덮어쓰기 금지)
    applyBillingFallback(post, { total: 220000 });

    // 수납 전 출력본 == 수납 후 출력본 (진료비 동일)
    expect(pre.total_amount).toBe(post.total_amount);
    expect(pre.subtotal_amount).toBe(post.subtotal_amount);
    expect(post.total_amount).toBe('220,000');
  });

  // ── AC-3 회귀: 실제 수납 금액 산정 로직 불변 — 0/음수 라이브값은 임의 보강 안 함 ──
  test('AC-3: 라이브 진료비가 0이면 임의 보강 금지(정상 0 처리, 금액 산정 로직 불변)', () => {
    const values = preSettleAutoBind();
    applyBillingFallback(values, { total: 0 });
    // 0/빈값을 임의 숫자로 날조하지 않음 — 빈값 유지
    expect(values.total_amount).toBe('');
    expect(values.subtotal_amount).toBe('');
  });

  // ── AC-3 회귀: autobind에 이미 진료비가 있으면(수납 후) 라이브로 절대 덮어쓰지 않음 ──
  test('AC-3: 기존 total_amount가 있으면 라이브값과 달라도 보존(금액 변조 금지)', () => {
    const values: Record<string, string> = {
      ...preSettleAutoBind(),
      total_amount: '300,000', // 이미 기록된 값
    };
    applyBillingFallback(values, { total: 999999 }); // 다른 라이브값
    // 기록된 값 보존 — 변조 금지
    expect(values.total_amount).toBe('300,000');
  });
});
