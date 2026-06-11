/**
 * E2E Spec — T-20260611-foot-EMAIL-BINDING-FIX
 *
 * 버그: 서류 출력 시 patient_email(이메일) 칸이 항상 공란.
 * 원인: 일부 양식 field_map은 {{patient_email}}를 참조하나(formTemplates.ts:550),
 *       buildAutoBindValues() 출력 객체에 patient_email 키 자체가 없어 항상 '' 바인딩.
 * 수정: CustomerBindInfo.customer_email 추가 + loadAutoBindContext select 확장 +
 *       buildAutoBindValues return에 patient_email: ctx.customer?.customer_email ?? ''.
 *
 * AC-1: customer.customer_email 존재 시 patient_email로 바인딩.
 * AC-2: customer_email 미존재(null/undefined) 시 공란('') — 안전 fallback.
 * AC-3: {{patient_email}} 플레이스홀더가 들어간 HTML 템플릿에 실제 렌더.
 *
 * 실행: npx playwright test T-20260611-foot-EMAIL-BINDING-FIX.spec.ts
 * NOTE: buildAutoBindValues는 순수 함수 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type AutoBindContext } from '../../src/lib/autoBindContext';
import { bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

// 최소 CheckIn 픽스처 — buildAutoBindValues가 참조하는 필드만 채움
const baseCheckIn = {
  id: 'ci-1',
  customer_id: 'cust-1',
  clinic_id: 'clinic-1',
  customer_name: '홍길동',
  customer_phone: '01011112222',
  checked_in_at: '2026-06-11T09:00:00+09:00',
} as unknown as CheckIn;

function ctxWith(email: string | null | undefined): AutoBindContext {
  return {
    checkIn: baseCheckIn,
    customer: {
      name: '홍길동',
      phone: '01011112222',
      customer_email: email,
    },
  };
}

// ── AC-1: 이메일 존재 시 patient_email 바인딩 ────────────────────────────────
test.describe('AC-1: customer_email → patient_email 바인딩', () => {
  test('이메일 있으면 patient_email에 그대로 출력', () => {
    const values = buildAutoBindValues(ctxWith('foot@example.com'));
    expect(values.patient_email).toBe('foot@example.com');
  });
});

// ── AC-2: 이메일 미존재 시 안전 공란 ──────────────────────────────────────────
test.describe('AC-2: customer_email 없을 때 공란 fallback', () => {
  test('null 이면 빈 문자열', () => {
    const values = buildAutoBindValues(ctxWith(null));
    expect(values.patient_email).toBe('');
  });

  test('undefined(필드 자체 없음) 이면 빈 문자열', () => {
    const values = buildAutoBindValues({
      checkIn: baseCheckIn,
      customer: { name: '홍길동', phone: '01011112222' },
    });
    expect(values.patient_email).toBe('');
  });

  test('customer 자체가 null 이어도 키는 존재 + 공란', () => {
    const values = buildAutoBindValues({ checkIn: baseCheckIn, customer: null });
    expect(values.patient_email).toBe('');
  });
});

// ── AC-3: {{patient_email}} HTML 템플릿 렌더 ──────────────────────────────────
test.describe('AC-3: {{patient_email}} 렌더', () => {
  test('템플릿에 이메일 치환되어 출력', async ({ page }) => {
    const values = buildAutoBindValues(ctxWith('foot@example.com'));
    const tpl = '<html><body><div>E-mail: {{patient_email}}</div></body></html>';
    const bound = bindHtmlTemplate(tpl, values);
    await page.setContent(bound);
    const body = await page.locator('body').textContent() ?? '';
    expect(body).toContain('foot@example.com');
  });
});
