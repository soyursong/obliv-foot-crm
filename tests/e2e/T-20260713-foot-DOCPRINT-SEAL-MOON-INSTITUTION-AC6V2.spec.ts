/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [원 AC-6 v2]
 *   ⚠ SUPERSEDED by T-20260716-foot-DOCFEE-NONPAY-SEAL AC2 (슬롯키드 최종 규칙, 현장 owner
 *   김주연 총괄 U0ATDB587PV [A] 2026-07-16T13:52, planner FIX-REQUEST MSG-20260716-135623-ngmk).
 *
 * 원 AC-6 v2 규칙('문지은 원장=항상 법인 인감')은 폐기됨. 현행 슬롯키드 규칙(슬롯 주체로 결정):
 *   - 박영진 대표자 성함 슬롯(영수증/계산서/세부내역서 대표자란) → 법인 인감({{institution_seal_html}}).
 *   - 문지은 원장 서명란(진료의 축) → 개인직인({{doctor_seal_html}} = clinic_doctors.seal_image_url).
 *     문지은도 한동훈·김윤기·김상은과 동일하게 지정 시 개인직인 렌더(is_default 강제 제거).
 *   - 도장을 법인 인감으로 강제하는 유일 경로 = 진료의 미지정 자동발행 폴백(sealFallbackToInstitution).
 *
 * 본 spec은 위 supersede 반영으로 갱신 — shouldForceInstitutionSeal 진리표는 이제 is_default 무관,
 * sealFallbackToInstitution 만 참일 때 true. 미지정 폴백 렌더(이름·도장=기관) 회귀 보호는 유지한다.
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues, shouldForceInstitutionSeal } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const INSTITUTION_SEAL = 'jongno-foot-stamp'; // getStampUrl() = OBLIVORIGIN 법인 전자인감

const SEALS: Record<string, string> = {
  문지은: `seals/${CLINIC}/e435af73-fc72-4bb5-8ace-1fe8423377ee.png`, // T-20260716 신규 매핑(개인직인)
  한동훈: `seals/${CLINIC}/ab2819be-d56c-41b9-bc97-da01123ab2a6.png`,
  김윤기: `seals/${CLINIC}/57953f10-1427-438e-9406-ee0b02efef44.png`,
  김상은: `seals/${CLINIC}/ec70414e-27cc-4929-a73d-e1d5f3164716.png`,
};

const baseCheckIn = (): CheckIn => ({
  id: 'ci-moonv2-0001', clinic_id: CLINIC, customer_id: 'cust-0001',
  customer_name: '홍길동', customer_phone: '01012345678',
  checked_in_at: '2026-07-14T09:00:00+09:00',
} as unknown as CheckIn);

const build = (doctor: string, sealPath: string | null) =>
  buildAutoBindValues({
    checkIn: baseCheckIn(),
    customer: { name: '홍길동', phone: '01012345678' } as never,
    doctor,
    clinicDoctor: { name: doctor, license_no: '제12345호', specialist_no: null, seal_image_url: sealPath, is_default: doctor === '문지은' } as never,
  });

test.describe('T-20260713 AC-6 v2 [SUPERSEDED→슬롯키드] — 도장 강제는 미지정 폴백 한정', () => {
  // ── (A) 판정 진리표 — shouldForceInstitutionSeal (is_default 무관) ──
  test('문지은 지정(is_default)이라도 → forceInstitutionSeal=false (개인직인, 강제 아님)', () => {
    expect(shouldForceInstitutionSeal(true, false)).toBe(false);
  });

  test('한동훈·김윤기·김상은 지정(비 is_default, 폴백 아님) → false', () => {
    expect(shouldForceInstitutionSeal(false, false)).toBe(false);
    expect(shouldForceInstitutionSeal(null, false)).toBe(false);
    expect(shouldForceInstitutionSeal(undefined, false)).toBe(false);
  });

  test('미지정 폴백 → forceInstitutionSeal=true (is_default 값과 무관, 도장=법인 인감)', () => {
    expect(shouldForceInstitutionSeal(false, true)).toBe(true);
    expect(shouldForceInstitutionSeal(true, true)).toBe(true);
  });

  // ── (B) 렌더 계약 — buildAutoBindValues ──
  test('문지은 지정 → 도장=개인직인 <img> storage path, 이름=문지은 유지', () => {
    const v = build('문지은', SEALS.문지은);
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(SEALS.문지은);
    expect(v.doctor_name).toBe('문지은');
    // 개인직인 경로가 법인 인감 자산명으로 덮이지 않는다.
    expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
  });

  test('지정 3인 → 각 개인 도장 storage path(법인 인감 아님, 오매핑 0)', () => {
    for (const name of ['한동훈', '김윤기', '김상은']) {
      const path = SEALS[name];
      const v = build(name, path);
      expect(v.doctor_seal_html).toContain('<img');
      expect(v.doctor_seal_html).toContain(path);
      expect(v.doctor_name).toBe(name);
      expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
      for (const [other, otherPath] of Object.entries(SEALS)) {
        if (other !== name) expect(v.doctor_seal_html).not.toContain(otherPath);
      }
    }
  });

  test('미지정 폴백 렌더(회귀 보호): seal=null(가드가 비움) → 법인 인감 <img> 폴스루', () => {
    // loadAutoBindContext 의 미지정 폴백은 seal_image_url 을 null 로 비운 상태를 넘긴다.
    const v = build('문지은', null);
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(INSTITUTION_SEAL);
  });
});
