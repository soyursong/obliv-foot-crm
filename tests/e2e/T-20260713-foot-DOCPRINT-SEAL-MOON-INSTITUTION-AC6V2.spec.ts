/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [AC-6 v2, 김주연 총괄 U0ATDB587PV 최종 확정
 *   2026-07-14T10:30 KST, MSG-20260714-104310-1b9f / planner FIX-REQUEST MSG-20260714-104648-wwls]
 *
 * B안 확장: "문지은 원장 = 항상 법인 인감". 도장 매핑 최종 3분기 —
 *   ① 한동훈·김윤기·김상은 지정 → 각 개인 도장(印)             (is_default=false, 폴백 아님)
 *   ② 문지은 원장(대표원장 is_default) 지정 → 법인 인감(개인 직인 아님)
 *   ③ 진료의 미지정 → 법인 인감
 *
 * ★핵심 차이(②): 문지은 '지정'은 도장만 법인 인감으로 폴스루하고 이름(문지은)은 유지한다
 *   (문지은이 실제 지정 진료의 → 이름란=문지은). vs ③미지정은 이름·도장 둘 다 기관.
 *
 * 검증 2축:
 *   (A) shouldForceInstitutionSeal 판정 진리표 — 3분기 예외 없음(오매핑 0).
 *   (B) buildAutoBindValues 렌더 계약 — seal 비움 → 법인 인감 <img> 폴스루 + 이름 정합.
 *
 * AC-V2-1: 문지은 지정(is_default) → forceInstitutionSeal=true (개인직인 사용 안 함).
 * AC-V2-2: 한동훈·김윤기·김상은 지정(비 is_default, 폴백 아님) → forceInstitutionSeal=false (개인 도장).
 * AC-V2-3: 미지정 폴백 → forceInstitutionSeal=true (법인 인감).
 * AC-V2-4: 문지은 지정 렌더 = 도장 법인 인감 + 이름 문지은 유지(기관명으로 치환하지 않음).
 * AC-V2-5: 지정 3인 렌더 = 각 개인 도장 storage path(법인 인감 아님, 오매핑 0).
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues, shouldForceInstitutionSeal } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const INSTITUTION_SEAL = 'jongno-foot-stamp'; // getStampUrl() = OBLIVORIGIN 법인 전자인감(byte-identical)

const SEALS: Record<string, string> = {
  한동훈: `seals/${CLINIC}/ab2819be-d56c-41b9-bc97-da01123ab2a6.png`,
  김윤기: `seals/${CLINIC}/57953f10-1427-438e-9406-ee0b02efef44.png`,
  김상은: `seals/${CLINIC}/ec70414e-27cc-4929-a73d-e1d5f3164716.png`,
};

const baseCheckIn = (): CheckIn => ({
  id: 'ci-moonv2-0001', clinic_id: CLINIC, customer_id: 'cust-0001',
  customer_name: '홍길동', customer_phone: '01012345678',
  checked_in_at: '2026-07-14T09:00:00+09:00',
} as unknown as CheckIn);

// buildAutoBindValues 는 loadAutoBindContext 가 clinicDoctor 결선(+가드 seal 비움)을 끝낸 뒤 넘기는 상태를 받는다.
// 아래 build()는 그 최종 상태(가드 반영: 문지은 seal=null)를 시뮬레이션한다.
const build = (doctor: string, sealPath: string | null) =>
  buildAutoBindValues({
    checkIn: baseCheckIn(),
    customer: { name: '홍길동', phone: '01012345678' } as never,
    doctor,
    clinicDoctor: { name: doctor, license_no: '제12345호', specialist_no: null, seal_image_url: sealPath, is_default: doctor === '문지은' } as never,
  });

test.describe('T-20260713 AC-6 v2 — 도장 매핑 3분기(문지은=항상 법인 인감)', () => {
  // ── (A) 판정 진리표 — shouldForceInstitutionSeal ──
  test('AC-V2-1: 문지은 지정(is_default) → forceInstitutionSeal=true', () => {
    expect(shouldForceInstitutionSeal(true, false)).toBe(true);
  });

  test('AC-V2-2: 한동훈·김윤기·김상은 지정(비 is_default, 폴백 아님) → false', () => {
    expect(shouldForceInstitutionSeal(false, false)).toBe(false);
    expect(shouldForceInstitutionSeal(null, false)).toBe(false);
    expect(shouldForceInstitutionSeal(undefined, false)).toBe(false);
  });

  test('AC-V2-3: 미지정 폴백 → forceInstitutionSeal=true (도장=법인 인감)', () => {
    expect(shouldForceInstitutionSeal(false, true)).toBe(true);
    expect(shouldForceInstitutionSeal(true, true)).toBe(true);
  });

  // ── (B) 렌더 계약 — buildAutoBindValues ──
  test('AC-V2-4: 문지은 지정 → 도장=법인 인감 <img>, 이름=문지은 유지', () => {
    // 가드가 문지은 seal 을 null 로 비운 뒤의 상태 → doctor_seal_html 은 법인 인감으로 폴스루.
    const v = build('문지은', null);
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(INSTITUTION_SEAL);
    // 이름은 문지은 유지(미지정 폴백처럼 기관명으로 치환하지 않는다 — 문지은이 지정 진료의).
    expect(v.doctor_name).toBe('문지은');
    // 어떤 원장 개인 도장 storage path 도 포함하지 않는다.
    for (const p of Object.values(SEALS)) expect(v.doctor_seal_html).not.toContain(p);
  });

  test('AC-V2-5: 지정 3인 → 각 개인 도장 storage path(법인 인감 아님, 오매핑 0)', () => {
    for (const [name, path] of Object.entries(SEALS)) {
      const v = build(name, path);
      expect(v.doctor_seal_html).toContain('<img');
      expect(v.doctor_seal_html).toContain(path);
      expect(v.doctor_name).toBe(name);
      // 개인 도장 경로가 법인 인감(getStampUrl 자산명)으로 덮이지 않는다.
      expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
      // 타 원장 도장 미혼입(오매핑 0).
      for (const [other, otherPath] of Object.entries(SEALS)) {
        if (other !== name) expect(v.doctor_seal_html).not.toContain(otherPath);
      }
    }
  });
});
