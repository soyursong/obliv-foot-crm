/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#4 이름↔도장 축 정합]
 * planner FIX-REQUEST MSG-20260714-103328-mq1p / 김주연 총괄(U0ATDB587PV) field-confirm 2026-07-14T10:22 KST.
 *
 * 배경: REOPEN#3에서 미지정 폴백 도장을 문지은 개인직인 → 오블리브오리진 법인 인감으로 되돌렸으나,
 *   이름란(세부산정 '대표자'/계산서·영수증 '진료의사')은 문지은 개인명으로 남아 '문지은 이름 + 법인 도장'
 *   미스매치가 발생. 총괄 명시("문지은 원장님 도장은 요청한 적 없다") → 미지정 이름란도 문지은 개인명 제거,
 *   기관명으로 채워 이름↔도장 세트를 정합시킨다(공란은 AC-8/9 회귀 → 기관명 채택).
 *
 * 검증 축(SET 불변식): 미지정 폴백 서류는 (기관명 + 법인 인감) 세트로만, 지정 진료의 서류는
 *   (원장 개인명 + 원장 개인 도장) 세트로만 렌더된다. '개인명 + 법인 도장' / '기관명 + 개인 도장'의
 *   교차(미스매치) 조합은 발생하지 않는다.
 *
 * AC-R4-1: 미지정 폴백 → doctor_name = 기관명 (문지은 개인명 아님) + 도장 = 법인 인감.
 * AC-R4-2: 미지정 폴백 doctor_name 에 '문지은' 문자열 부재(개인명 제거 확인).
 * AC-R4-3: 지정 진료의 → doctor_name = 원장 개인명 + 도장 = 원장 개인 도장(불변, 오매핑 0).
 * AC-R4-4: 세트 불변식 — 이름축·도장축 조합이 (기관명,법인) | (개인명,개인) 두 세트로만 매칭.
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const INSTITUTION_SEAL = 'jongno-foot-stamp'; // getStampUrl() = OBLIVORIGIN 법인 전자인감
const INSTITUTION_NAME = '오블리브 풋센터 종로';

const SEALS: Record<string, string> = {
  한동훈: `seals/${CLINIC}/ab2819be-d56c-41b9-bc97-da01123ab2a6.png`,
  김윤기: `seals/${CLINIC}/57953f10-1427-438e-9406-ee0b02efef44.png`,
  김상은: `seals/${CLINIC}/ec70414e-27cc-4929-a73d-e1d5f3164716.png`,
};

const baseCheckIn = (): CheckIn => ({
  id: 'ci-namealign-0001', clinic_id: CLINIC, customer_id: 'cust-0001',
  customer_name: '홍길동', customer_phone: '01012345678',
  checked_in_at: '2026-07-14T09:00:00+09:00',
} as unknown as CheckIn);

// loadAutoBindContext.sealFallbackToInstitution 경로가 산출하는 최종 (doctor, seal) 상태를 그대로 반영.
const build = (doctor: string, sealPath: string | null) =>
  buildAutoBindValues({
    checkIn: baseCheckIn(),
    customer: { name: '홍길동', phone: '01012345678' } as never,
    doctor,
    clinicDoctor: { name: doctor, license_no: '제12345호', specialist_no: null, seal_image_url: sealPath, is_default: false } as never,
  });

test.describe('T-20260713 REOPEN#4 — 이름↔도장 축 정합(미스매치 제거)', () => {
  test('AC-R4-1/2: 미지정 폴백 → 기관명 + 법인 인감, 문지은 개인명 부재', () => {
    const v = build(INSTITUTION_NAME, null);
    expect(v.doctor_name).toBe(INSTITUTION_NAME);
    expect(v.doctor_name).not.toContain('문지은');
    expect(v.referring_doctor).not.toContain('문지은');
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(INSTITUTION_SEAL);
    for (const p of Object.values(SEALS)) expect(v.doctor_seal_html).not.toContain(p);
  });

  test('AC-R4-3: 지정 진료의 → 개인명 + 개인 도장(불변, 법인 인감 아님)', () => {
    for (const [name, path] of Object.entries(SEALS)) {
      const v = build(name, path);
      expect(v.doctor_name).toBe(name);
      expect(v.doctor_seal_html).toContain(path);
      expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
    }
  });

  test('AC-R4-4: SET 불변식 — (기관명,법인) | (개인명,개인) 두 세트만, 교차 미스매치 없음', () => {
    const fb = build(INSTITUTION_NAME, null);
    // 미지정 세트: 이름=기관명 이면 도장=법인 인감
    expect(fb.doctor_name === INSTITUTION_NAME && fb.doctor_seal_html.includes(INSTITUTION_SEAL)).toBe(true);
    // 개인명 + 법인 도장 미스매치가 어떤 지정 진료의에서도 나오지 않음
    for (const [name, path] of Object.entries(SEALS)) {
      const v = build(name, path);
      const isPersonalName = v.doctor_name === name && v.doctor_name !== INSTITUTION_NAME;
      const isPersonalSeal = v.doctor_seal_html.includes(path) && !v.doctor_seal_html.includes(INSTITUTION_SEAL);
      expect(isPersonalName && isPersonalSeal).toBe(true); // 개인명 ⟺ 개인 도장
    }
  });
});
