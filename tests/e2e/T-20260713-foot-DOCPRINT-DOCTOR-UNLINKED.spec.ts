/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED
 * 치료테이블에서 진료의(담당 의사) 지정 후 서류 출력 시 그 의사 정보가 서류에 미반영(연동 끊김).
 *
 * RC (진단 결과, 저장 O · 렌더 전달 X):
 *   치료테이블 '진료의' 선택은 check_ins.treating_doctor_id(=clinic_doctors.id)에 저장되나
 *   (TreatingDoctorSelect → 진료콜 명단·진료환자이력 공용 write), 서류 렌더 경로
 *   (loadAutoBindContext / DocumentPrintPanel)는 이 필드를 전혀 읽지 않고 duty_roster/fallback
 *   director로만 진료의를 결정 → 지정 의사가 서류에 안 나옴(처음부터 결선 누락, 100% 재현).
 * 수정: loadAutoBindContext가 check_ins.treating_doctor_id를 읽어 진료의(이름+면허/직인)를 결정
 *   (우선순위: 명시 override > 치료테이블 지정 진료의 > duty_roster > fallback). DocumentPrintPanel
 *   드롭다운 기본 선택도 지정 진료의로. loadTreatingDoctorName 헬퍼 신설.
 *
 * 검증 전략: DB/auth 없이 (1) buildAutoBindValues 순수 함수의 진료의 바인딩 계약 + (2) 실제 브라우저
 *   HTML 렌더(page.setContent)로 "현장이 보는 출력물"에 진료의 이름이 실제로 찍히는지 확인.
 *   (treating_doctor_id → doctor 결정 로직은 loadAutoBindContext 내부 DB 조회 — 여기서는 결정된
 *    doctor가 출력에 도달하는 '렌더 전달' 축을 검증. 결선 축은 코드 + 진단으로 확인.)
 *
 * AC-1: 진료의 지정 후 서류 출력 시 그 진료의 이름(+ 면허/직인 정보)이 정확히 표시된다.
 * AC-2: 진료의 미지정 시 서류 출력(공란/기본값)은 회귀 없이 유지된다(에러 없음).
 * AC-3: RC 명시 + 서류 렌더 스택 공유 티켓(RRN-OMIT)에 회귀 없음(patient_rrn 바인딩 불변).
 *
 * 관련 락: L-006 (DOC-PRINT-UNIFY) — bindHtmlTemplate 단일 경로 유지(무변경).
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

/** 최소 CheckIn (buildAutoBindValues가 읽는 필드만) */
const baseCheckIn = (): CheckIn => ({
  id: 'ci-test-0001',
  clinic_id: 'clinic-test',
  customer_id: 'cust-0001',
  customer_name: '홍길동',
  customer_phone: '01012345678',
  checked_in_at: '2026-07-13T09:00:00+09:00',
} as unknown as CheckIn);

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

test.describe('T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED — 지정 진료의 서류 반영', () => {
  // ── AC-1: 결정된 진료의(ctx.doctor)가 모든 진료의 플레이스홀더로 흐른다 ──
  test('AC-1: buildAutoBindValues가 진료의를 doctor_name·referring_doctor에 바인딩한다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은', // ← 치료테이블 지정 진료의가 loadAutoBindContext에서 여기로 결정됨
    });
    expect(v.doctor_name).toBe('문지은');
    // 진료의뢰서 등 다른 진료의 플레이스홀더에도 동일 반영
    expect(v.referring_doctor).toBe('문지은');
  });

  // ── AC-1: 지정 진료의의 상세(면허번호·전문의번호·직인)도 서류에 흐른다 ──
  test('AC-1: 지정 진료의의 clinic_doctors 상세(면허/직인)가 바인딩된다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은',
      clinicDoctor: {
        name: '문지은',
        license_no: '제12345호',
        specialist_no: '제999호',
        seal_image_url: 'https://example.test/seal.png',
      },
    });
    expect(v.doctor_name).toBe('문지은');
    expect(v.doctor_license_no).toBe('제12345호');
    expect(v.doctor_specialist_no).toBe('제999호');
    // 직인: seal_image_url 있으면 img 태그로 렌더(텍스트 (인) fallback 아님)
    expect(v.doctor_seal_html).toContain('https://example.test/seal.png');
    expect(v.doctor_seal_html).toContain('<img');
  });

  // ── AC-1 (렌더): 진단서 출력물에 지정 진료의 이름이 실제로 찍힌다 ──
  test('AC-1: 진단서 출력물에 지정 진료의 이름이 렌더된다', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은',
    });
    const body = await renderBound(page, 'diagnosis', v);
    expect(body).toContain('문지은');
  });

  // ── AC-2: 진료의 미지정 시 공란 — 에러/이상 문자열 없음(회귀 방지) ──
  test('AC-2: 진료의 미지정(null) 시 doctor_name 공란·크래시 없음', async ({ page }) => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: null, // 미지정 → 공란(기존 동작 유지)
    });
    expect(v.doctor_name).toBe('');
    expect(v.referring_doctor).toBe('');
    // 미지정이어도 직인은 SEAL-NULL-FALLBACK(로컬자산/(인)) 유지 — 렌더 크래시 없음
    const body = await renderBound(page, 'diagnosis', v);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });

  // ── AC-3: 서류 렌더 스택 공유(RRN-OMIT) 무회귀 — patient_rrn 바인딩 불변 ──
  test('AC-3: 진료의 결선 수정이 RRN 바인딩(공유 렌더 스택)에 회귀를 유발하지 않는다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678', rrn: '9005151234567' },
      doctor: '문지은',
    });
    // 진료의 반영과 무관하게 주민번호 바인딩(하이픈 삽입)은 그대로
    expect(v.patient_rrn).toBe('900515-1234567');
    expect(v.rrn_front).toBe('900515');
    expect(v.rrn_back).toBe('1234567');
    // 진료의도 함께 정상
    expect(v.doctor_name).toBe('문지은');
  });
});
