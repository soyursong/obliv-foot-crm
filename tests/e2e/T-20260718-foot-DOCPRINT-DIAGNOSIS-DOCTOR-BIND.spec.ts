/**
 * E2E Spec — T-20260718-foot-DOCPRINT-DIAGNOSIS-DOCTOR-BIND
 *
 * 선제(latent) 차단: 처방전 약국반려 실사고(P1 RX-DOCTOR-BIND)와 동일 근본원인 클래스가 진단서에도
 * 잠복. 진단서(diagnosis) = 법정 의료서식 — '의사 성명'은 실제 진료의(사람)여야 한다. reporter=내부
 * 파생(dev-foot 잔여관찰, 미신고). parent=T-20260718-foot-DOCPRINT-RX-DOCTOR-BIND.
 *
 * ── RC (AC-1 diagnose-first, 실코드 판정) ────────────────────────────────────────
 *  · DIAGNOSIS_HTML(진단서) '의사 성명' 셀은 공유 토큰 {{doctor_name}} 를 썼다.
 *  · {{doctor_name}} 은 billing '대표자' 축 — 진료의 미지정 시 loadAutoBindContext 의
 *    sealFallbackToInstitution 분기에서 기관명(clinics.name)으로 덮인다(T-20260713 UNLINKED,
 *    field-confirmed). → 미지정 진단서 '의사 성명'이 기관명으로 출력 = 진료의 신원 오표기(법정 결함).
 *  · 면허번호({{doctor_license_no}})는 clinicDoctor(사람)에서 오지만 성명이 기관명이면 이름↔면허 불일치.
 *
 * ── FIX (AC-2 진료의 축 분리) ────────────────────────────────────────────────────
 *  진단서 '의사 성명'을 billing 대표자 축과 분리. DIAGNOSIS_HTML 성명 셀을 진단서 전용 토큰
 *  {{attending_doctor_name}} 로 교체하고 이를 clinicDoctor(실 의료인·사람) 기준으로 결선한다.
 *  · 지정 진료의 → 그 원장의 성명(발행시점 스냅샷). · 미지정 폴백 → 대표원장(is_default) 실인물.
 *  · 도장(doctor_seal_html)·면허번호(doctor_license_no=clinicDoctor.license_no)·billing {{doctor_name}}
 *    무접촉 → 처방전·세부산정·영수증 회귀 없음(AC-3). 기관명은 진단서 '의사 성명'에 절대 안 들어간다.
 *
 * 본 spec 은 바인딩 SSOT(buildAutoBindValues) + 실제 진단서 템플릿(DIAGNOSIS_HTML)을 그대로
 * 렌더(bindHtmlTemplate)해 '의사 성명'이 실 의료인으로 찍히는지 단언한다. 실브라우저 field-soak 는
 * supervisor E2E 에서 최종 확정.
 *
 * 실행: npx playwright test T-20260718-foot-DOCPRINT-DIAGNOSIS-DOCTOR-BIND.spec.ts
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type AutoBindContext } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

const CHECK_IN = {
  id: 'ci-dx', clinic_id: 'clinic-jongno-foot', customer_id: 'cust-1',
  customer_name: '김발가', customer_phone: '01012345678',
  checked_in_at: '2026-07-18T02:00:00.000Z',
} as unknown as CheckIn;

const INSTITUTION = '오블리브의원 서울 오리진점';

type CD = { id: string; name: string; license_no: string | null; specialist_no: string | null; seal_image_url: string | null; is_default?: boolean };
const 한동훈: CD = { id: 'd2', name: '한동훈', license_no: '136963', specialist_no: null, seal_image_url: null };
const 문지은: CD = { id: 'd1', name: '문지은', license_no: '145617', specialist_no: null, seal_image_url: null, is_default: true };

/** loadAutoBindContext 산출과 동형인 ctx (doctor=표시성명, clinicDoctor=결선된 실 의료인). */
const ctxOf = (doctor: string | null, clinicDoctor: CD | null): AutoBindContext => ({
  customer: { name: '김발가', phone: '01012345678' },
  checkIn: CHECK_IN,
  clinic: { name: INSTITUTION, address: '서울 종로구' },
  doctor,
  clinicDoctor,
} as unknown as AutoBindContext);

/** 실제 진단서 템플릿을 바인딩해 정규화 HTML 반환. */
const renderDx = (v: Record<string, string>): string => {
  const tpl = getHtmlTemplate('diagnosis');
  expect(tpl, 'diagnosis 템플릿 존재').toBeTruthy();
  return bindHtmlTemplate(tpl!, v).replace(/\s+/g, ' ');
};

/** 진단서 '의사 성명' 셀(성명 라벨 직후 첫 colspan=2 셀) 내용만 추출. */
const nameCellOf = (box: string): string =>
  box.match(/의 사 성 명<\/td>[\s\S]*?<td colspan="2">([^<]*)<\/td>/)?.[1] ?? '';

// ── AC-1/AC-2 시나리오1: 진단서 발행 시 진료의 성명·면허 표시 ────────────────────────
test.describe('시나리오1 — 진단서 진료의 성명·면허 정상 표시', () => {
  test('지정 진료의(한동훈) → 성명·면허 = 그 원장', () => {
    const v = buildAutoBindValues(ctxOf('한동훈', 한동훈));
    expect(v.attending_doctor_name).toBe('한동훈');
    expect(v.doctor_license_no).toBe('136963');
    const box = renderDx(v);
    expect(nameCellOf(box)).toContain('한동훈');   // 의사 성명 = 기관명 아님
    expect(box).toContain('136963');               // 면허번호
  });

  test('원장 교체 시 성명·면허 동반 교체(발행시점 스냅샷)', () => {
    const v = buildAutoBindValues(ctxOf('문지은', 문지은));
    expect(v.attending_doctor_name).toBe('문지은');
    expect(v.doctor_license_no).toBe('145617');
    expect(nameCellOf(renderDx(v))).toContain('문지은');
  });
});

// ── AC-2 시나리오2: 진료의 미지정 폴백 엣지 (핵심 회귀 방지) ──────────────────────────
test.describe('시나리오2 — 미지정 폴백은 기관명이 아니라 실 의료인', () => {
  test('★RC: 미지정 폴백 시 진단서 의사 성명 = 대표원장(문지은), 기관명 아님', () => {
    // loadAutoBindContext: 미지정 → sealFallbackToInstitution → doctor(=doctorName)만 기관명으로 덮이고
    //   clinicDoctor 는 대표원장(is_default) 실인물로 유지된다.
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    expect(v.attending_doctor_name).toBe('문지은');       // 실 의료인
    expect(v.attending_doctor_name).not.toBe(INSTITUTION); // ★기관명 오염 없음
    expect(v.doctor_license_no).toBe('145617');            // 이름↔면허 정합
    const cell = nameCellOf(renderDx(v));
    expect(cell).toContain('문지은');
    expect(cell).not.toContain('오블리브의원');            // ★의사 성명 셀에 기관명 부재
  });

  test('엣지: 결선된 clinicDoctor 없음 → 진료의 성명 공란(기관명 추정 금지)', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, null));
    expect(v.attending_doctor_name).toBe('');
    expect(nameCellOf(renderDx(v))).not.toContain('오블리브의원');
  });
});

// ── AC-3: billing 대표자 축 + 처방전 축 + 도장 세트 무회귀 ────────────────────────────
test.describe('AC-3 — billing/처방전/도장 축 무회귀(진단서 축만 분리)', () => {
  test('billing {{doctor_name}} 은 미지정 시 여전히 기관명 폴백 유지(회귀 없음)', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    // 세부산정 '대표자'/영수증 '진료의사'는 field-confirmed 기관명 폴백 그대로.
    expect(v.doctor_name).toBe(INSTITUTION);
  });

  test('처방전 축(prescriber_name) 은 진단서 축과 독립·불변', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    expect(v.prescriber_name).toBe('문지은');
    expect(v.attending_doctor_name).toBe(v.prescriber_name); // 동일 clinicDoctor 실인물 기준
  });

  test('도장(doctor_seal_html) 은 진료의 결선과 무관하게 항상 렌더(존치)', () => {
    const v = buildAutoBindValues(ctxOf('한동훈', 한동훈));
    expect(typeof v.doctor_seal_html).toBe('string');
    expect(v.doctor_seal_html.length).toBeGreaterThan(0);
    expect(renderDx(v)).toContain(v.doctor_seal_html.slice(0, 12));
  });
});
