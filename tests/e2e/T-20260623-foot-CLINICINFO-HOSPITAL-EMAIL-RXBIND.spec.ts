/**
 * E2E Spec — T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND
 *
 * 요청(김주연 총괄): 사이드바 공간·배정 > 원장정보 > 병원정보 폼에 "병원 이메일" 칸 추가 +
 *   처방전 의료기관 블록 E-mail 주소 칸에 그 값 자동 연동.
 *
 * 핵심: 병원(기관) 이메일이며 환자 이메일(patient_email / customers.customer_email)과 별개.
 *   - clinics.email(nullable text) 신설 → ClinicSettings 폼 입력/저장.
 *   - autoBindContext: clinic.email → clinic_email 바인딩.
 *   - 처방전(rx_standard) 의료기관 E-mail 주소 칸: {{clinic_email}} 렌더.
 *
 * AC-1: clinic.email 존재 시 clinic_email로 바인딩.
 * AC-2: clinic.email 미존재(null/undefined/clinic null) 시 공란('') — 회귀 방지(빈칸 유지).
 * AC-3: {{clinic_email}} 처방전 의료기관 E-mail 주소 칸에 실제 렌더.
 * AC-4: 병원 이메일과 환자 이메일은 독립 — 한쪽만 채워도 서로 침범 없음.
 *
 * 실행: npx playwright test T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND.spec.ts
 * NOTE: buildAutoBindValues는 순수 함수 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type AutoBindContext } from '../../src/lib/autoBindContext';
import { bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

const baseCheckIn = {
  id: 'ci-1',
  customer_id: 'cust-1',
  clinic_id: 'clinic-1',
  customer_name: '홍길동',
  customer_phone: '01011112222',
  checked_in_at: '2026-06-23T09:00:00+09:00',
} as unknown as CheckIn;

function ctxWithClinicEmail(email: string | null | undefined): AutoBindContext {
  return {
    checkIn: baseCheckIn,
    clinic: {
      name: '오블리브 풋센터 종로',
      address: '서울시 종로구',
      email,
    },
  };
}

// ── AC-1: 병원 이메일 존재 시 clinic_email 바인딩 ────────────────────────────
test.describe('AC-1: clinic.email → clinic_email 바인딩', () => {
  test('병원 이메일 있으면 clinic_email에 그대로 출력', () => {
    const values = buildAutoBindValues(ctxWithClinicEmail('clinic@oblivseoul.kr'));
    expect(values.clinic_email).toBe('clinic@oblivseoul.kr');
  });
});

// ── AC-2: 병원 이메일 미존재 시 안전 공란(회귀 방지) ─────────────────────────
test.describe('AC-2: clinic.email 없을 때 공란 fallback', () => {
  test('null 이면 빈 문자열', () => {
    const values = buildAutoBindValues(ctxWithClinicEmail(null));
    expect(values.clinic_email).toBe('');
  });

  test('undefined(필드 자체 없음) 이면 빈 문자열', () => {
    const values = buildAutoBindValues({
      checkIn: baseCheckIn,
      clinic: { name: '오블리브 풋센터 종로', address: '서울시 종로구' },
    });
    expect(values.clinic_email).toBe('');
  });

  test('clinic 자체가 null 이어도 키는 존재 + 공란', () => {
    const values = buildAutoBindValues({ checkIn: baseCheckIn, clinic: null });
    expect(values.clinic_email).toBe('');
  });
});

// ── AC-3: {{clinic_email}} 처방전 의료기관 E-mail 주소 칸 렌더 ────────────────
test.describe('AC-3: {{clinic_email}} 처방전 렌더', () => {
  test('처방전 의료기관 E-mail 주소 칸에 병원 이메일 치환', async ({ page }) => {
    const values = buildAutoBindValues(ctxWithClinicEmail('clinic@oblivseoul.kr'));
    // 처방전 의료기관 블록 E-mail 주소 행 모사
    const tpl = '<html><body><table><tr><td>E-mail 주소</td><td>{{clinic_email}}</td></tr></table></body></html>';
    const bound = bindHtmlTemplate(tpl, values);
    await page.setContent(bound);
    const body = await page.locator('body').textContent() ?? '';
    expect(body).toContain('clinic@oblivseoul.kr');
  });

  test('병원 이메일 미입력 시 처방전 E-mail 칸 공란(빈칸 유지)', async ({ page }) => {
    const values = buildAutoBindValues(ctxWithClinicEmail(null));
    const tpl = '<html><body><table><tr><td>E-mail 주소</td><td id="cell">{{clinic_email}}</td></tr></table></body></html>';
    const bound = bindHtmlTemplate(tpl, values);
    await page.setContent(bound);
    const cell = await page.locator('#cell').textContent() ?? '';
    expect(cell.trim()).toBe('');
  });
});

// ── AC-4: 병원 이메일과 환자 이메일 독립 ──────────────────────────────────────
test.describe('AC-4: clinic_email vs patient_email 독립', () => {
  test('병원 이메일만 채워도 patient_email은 공란', () => {
    const values = buildAutoBindValues(ctxWithClinicEmail('clinic@oblivseoul.kr'));
    expect(values.clinic_email).toBe('clinic@oblivseoul.kr');
    expect(values.patient_email).toBe('');
  });

  test('양쪽 모두 채우면 서로 침범 없이 각자 출력', () => {
    const values = buildAutoBindValues({
      checkIn: baseCheckIn,
      clinic: { name: '오블리브', address: '종로', email: 'clinic@oblivseoul.kr' },
      customer: { name: '홍길동', phone: '01011112222', customer_email: 'patient@example.com' },
    });
    expect(values.clinic_email).toBe('clinic@oblivseoul.kr');
    expect(values.patient_email).toBe('patient@example.com');
  });
});
