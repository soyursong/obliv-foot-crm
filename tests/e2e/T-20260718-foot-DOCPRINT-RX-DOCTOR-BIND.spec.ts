/**
 * E2E Spec — T-20260718-foot-DOCPRINT-RX-DOCTOR-BIND
 *
 * 실사고: 풋센터 발행 처방전이 약국에서 반려. 결함 = 법정 처방전(의료법 시행규칙 §12①4) 빨간박스
 * '처방의료인' 성명·면허번호 미표시/오표시. reporter=문지은 대표원장(C0ATE5P6JTH).
 *
 * ── RC (triage-first, 실코드 판정) ─────────────────────────────────────────────
 *  · rx_standard(표준처방전) 처방의료인 성명은 공유 토큰 {{doctor_name}} 를 썼다.
 *  · {{doctor_name}} 은 billing '대표자' 축 — 진료의 미지정 시 loadAutoBindContext 의
 *    sealFallbackToInstitution 분기에서 기관명(clinics.name)으로 덮인다(T-20260713 UNLINKED,
 *    field-confirmed: 세부산정 '대표자'/영수증 '진료의사'는 미지정 시 기관명+법인 인감).
 *  · 치료건 대다수가 진료의 미지정(174건 중 지정 8건) → 처방전 처방의료인 성명이 기관명
 *    ('오블리브의원…')으로 출력 → §12①4 처방의료인 성명 부재 → 약국 조제 거부(실사고).
 *  · 면허번호는 clinicDoctor(사람)에서 오지만 성명이 기관명이라 이름↔면허 불일치.
 *
 * ── FIX ────────────────────────────────────────────────────────────────────────
 *  처방전 처방의료인 축을 billing 대표자 축과 분리. rx_standard 템플릿의 성명·면허번호를
 *  전용 토큰 {{prescriber_name}}/{{prescriber_license_no}} 로 교체하고, 이를 clinicDoctor
 *  (실 의료인·사람) 기준으로 결선한다(기관명 폴백 오염 차단).
 *  · 지정 진료의(치료테이블) / 드롭다운 선택 원장 → 그 원장의 성명·면허(발행시점 스냅샷, AC-1).
 *  · 미지정 폴백 → 대표원장(is_default) 실인물의 성명·면허(clinicDoctor 유지, AC-2). 도장은
 *    기존대로 법인 인감(seal 축 무접촉, AC-3). 기관명은 처방의료인 성명에 절대 안 들어간다.
 *  · billing 대표자 축({{doctor_name}}) 은 무접촉 → 세부산정/영수증 회귀 없음(AC-3).
 *
 * 본 spec 은 실제 바인딩 SSOT(buildAutoBindValues) + 실제 처방전 템플릿(RX_STANDARD_HTML)을
 * 그대로 렌더(bindHtmlTemplate)해 처방의료인 성명·면허가 실 의료인으로 찍히는지 단언한다.
 * 실브라우저 dual/PATH-4 렌더 field-soak 는 supervisor E2E 에서 최종 확정.
 *
 * 실행: npx playwright test T-20260718-foot-DOCPRINT-RX-DOCTOR-BIND.spec.ts
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type AutoBindContext } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

const CHECK_IN = {
  id: 'ci-rx', clinic_id: 'clinic-jongno-foot', customer_id: 'cust-1',
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

/** 실제 처방전 템플릿을 바인딩해 정규화 HTML 반환. */
const renderRx = (v: Record<string, string>): string => {
  const tpl = getHtmlTemplate('rx_standard');
  expect(tpl, 'rx_standard 템플릿 존재').toBeTruthy();
  return bindHtmlTemplate(tpl!, v).replace(/\s+/g, ' ');
};

// ── 시나리오 1: 처방전 발행 시 처방의료인 성명·면허번호 표시 ─────────────────────────
test.describe('시나리오1 — 처방의료인 성명·면허번호(§12①4) 정상 표시', () => {
  test('AC-1/AC-2: 지정/선택 진료의(한동훈) → 성명·면허 = 그 원장', () => {
    const v = buildAutoBindValues(ctxOf('한동훈', 한동훈));
    expect(v.prescriber_name).toBe('한동훈');
    expect(v.prescriber_license_no).toBe('136963');
    const box = renderRx(v);
    expect(box).toContain('한동훈');   // 처방의료인 성명
    expect(box).toContain('136963');   // 면허번호
  });

  test('AC-1/AC-2: 원장 교체 시 성명·면허 동반 교체(발행시점 스냅샷)', () => {
    const v = buildAutoBindValues(ctxOf('문지은', 문지은));
    expect(v.prescriber_name).toBe('문지은');
    expect(v.prescriber_license_no).toBe('145617');
    expect(renderRx(v)).toContain('145617');
  });
});

// ── 시나리오 2: 진료의 미지정/스냅샷 엣지 (핵심 회귀 방지) ────────────────────────────
test.describe('시나리오2 — 미지정 폴백은 기관명이 아니라 실 의료인', () => {
  test('★RC: 미지정 폴백 시 처방의료인 성명 = 대표원장(문지은), 기관명 아님', () => {
    // loadAutoBindContext: 미지정 → sealFallbackToInstitution → doctor(=doctorName)만 기관명으로 덮이고
    //   clinicDoctor 는 대표원장(is_default) 실인물로 유지된다.
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    expect(v.prescriber_name).toBe('문지은');       // 실 의료인
    expect(v.prescriber_name).not.toBe(INSTITUTION); // ★기관명 오염 없음
    expect(v.prescriber_license_no).toBe('145617');  // 이름↔면허 정합
    const box = renderRx(v);
    expect(box).toContain('문지은');
    expect(box).toContain('145617');
  });

  test('처방의료인 성명 슬롯에 기관명이 절대 안 들어감', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    // 처방의료인 성명 셀(rowspan=4, width:130px)에 prescriber_name(문지은)이, 기관명은 처방의료인
    //   성명·면허 축엔 부재(요양기관 명칭 셀은 별개 hira_institution_name 축).
    const box = renderRx(v);
    const nameCell = box.match(/rowspan="4" style="width:130px;">([^<]*)/);
    expect(nameCell?.[1] ?? '').toContain('문지은');
    expect(nameCell?.[1] ?? '').not.toContain('오블리브의원');
  });

  test('엣지: 결선된 clinicDoctor 없음 → 처방의료인 공란(기관명 추정 금지)', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, null));
    expect(v.prescriber_name).toBe('');
    expect(v.prescriber_license_no).toBe('');
  });
});

// ── AC-3: billing 대표자 축 + 도장 세트 무회귀 ───────────────────────────────────────
test.describe('AC-3 — billing 대표자 축·도장 무회귀(축 분리)', () => {
  test('billing {{doctor_name}} 은 미지정 시 여전히 기관명 폴백 유지(회귀 없음)', () => {
    const v = buildAutoBindValues(ctxOf(INSTITUTION, 문지은));
    // 세부산정 '대표자'/영수증 '진료의사'는 field-confirmed 기관명 폴백 그대로.
    expect(v.doctor_name).toBe(INSTITUTION);
  });

  test('도장(doctor_seal_html) 은 처방의료인 결선과 무관하게 항상 렌더(존치)', () => {
    const v = buildAutoBindValues(ctxOf('한동훈', 한동훈));
    expect(typeof v.doctor_seal_html).toBe('string');
    expect(v.doctor_seal_html.length).toBeGreaterThan(0);
    // 처방전 템플릿에도 도장 슬롯 존치(성명 근방 직인).
    expect(renderRx(v)).toContain(v.doctor_seal_html.slice(0, 12));
  });
});
