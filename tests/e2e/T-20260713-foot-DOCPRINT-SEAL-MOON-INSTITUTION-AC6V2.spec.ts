/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [원 AC-6 v2]
 *   ⚠ SUPERSEDED#1 by T-20260716-foot-DOCFEE-NONPAY-SEAL AC2 (슬롯키드 최종 규칙, 현장 owner
 *   김주연 총괄 U0ATDB587PV [A] 2026-07-16T13:52, planner FIX-REQUEST MSG-20260716-135623-ngmk).
 *   ⚠ SUPERSEDED#2 by T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND AC-B (이은상 팀장
 *   2026-07-31, 커밋 df9ed521) — 미지정 폴백 도장-우회 체인(shouldForceInstitutionSeal /
 *   sealFallbackToInstitution / forceInstitutionSeal) 전면 삭제.
 *
 * 현행 정본(슬롯키드 + AC-B):
 *   - 박영진 대표자 성함 슬롯(영수증/계산서/세부내역서 대표자란) → 법인 인감({{institution_seal_html}},
 *     getStampUrl — 진료의와 무관한 독립 경로).
 *   - 문지은 원장 서명란(진료의 축) → 개인직인({{doctor_seal_html}} = clinic_doctors.seal_image_url).
 *     문지은도 한동훈·김윤기·김상은과 동일하게 지정 시 개인직인 렌더(is_default 강제 제거).
 *   - ★AC-B: 진료의 미지정 자동발행 폴백도 이제 결선된 대표원장 '개인명 + 개인직인' 유지
 *     (구 07-14 UNLINKED '미지정폴백=기관명+법인인감' 잔재 제거). 도장을 법인 인감으로 강제하는
 *     경로는 더 이상 없다 → 판정함수 shouldForceInstitutionSeal 폐기.
 *
 * 본 spec 갱신: 폐기된 판정함수 truth-table(런타임 import) → 정적 소스 가드로 대체. 지정 진료의
 *   개인직인 렌더 계약(오매핑 0)은 유지. buildAutoBindValues(seal=null)의 법인 인감 폴스루는
 *   '진짜 seal 부재' 안전망(T-20260601-DOC-SEAL-NULL-FALLBACK)으로 재해석(미지정 폴백 아님).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const ROOT = process.cwd();
const BIND_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/autoBindContext.ts'), 'utf8');

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

test.describe('T-20260713 AC-6 v2 [SUPERSEDED→슬롯키드+AC-B] — 도장 강제 체인 폐기, 전 경로 개인직인', () => {
  // ── (A)[갱신] 도장-우회 판정함수 폐기 정합 (정적 소스 가드) ──
  //   구 truth-table(shouldForceInstitutionSeal(is_default, fallback)) 는 함수 삭제로 폐기.
  //   AC-B3: 판정함수·플래그·seal 비움 강제·이름란 기관명 덮어쓰기 모두 코드에서 제거.
  test('(A) 도장-우회 체인(shouldForceInstitutionSeal/sealFallbackToInstitution/forceInstitutionSeal) 소거', () => {
    expect(BIND_SRC, 'shouldForceInstitutionSeal 함수 선언 잔존(AC-B3 미정리)').not.toMatch(/function\s+shouldForceInstitutionSeal/);
    expect(BIND_SRC, 'sealFallbackToInstitution let 선언 잔존').not.toMatch(/let\s+sealFallbackToInstitution/);
    expect(BIND_SRC, 'forceInstitutionSeal const 잔존').not.toMatch(/const\s+forceInstitutionSeal/);
  });

  test('(A) 미지정 폴백 도장 우회 잔재 소거 — seal 비움 강제·이름 기관명 덮어쓰기 없음', () => {
    expect(BIND_SRC, 'seal_image_url=null 강제(법인인감 우회) 잔존').not.toMatch(/seal_image_url:\s*null/);
    expect(BIND_SRC, '폴백 이름란 기관명 덮어쓰기 잔존').not.toMatch(/if\s*\(institutionName\)\s*doctorName\s*=\s*institutionName/);
    // 대표자란 법인 인감(별도 토큰)은 독립 경로 → 유지(무회귀).
    expect(BIND_SRC, 'institution_seal_html(getStampUrl) 축 무접촉이어야 함').toMatch(/institution_seal_html/);
  });

  // ── (B) 렌더 계약 — buildAutoBindValues (지정 진료의 개인직인, 오매핑 0) ──
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

  test('진짜 seal 부재(seal_image_url=null) → 법인 인감 <img> 폴스루(DOC-SEAL-NULL-FALLBACK 안전망)', () => {
    // buildAutoBindValues 는 순수 렌더 — 넘겨받은 seal_image_url 이 null 이면 getStampUrl(법인 인감)로 폴스루.
    //   ⚠ AC-B 이후 이 경로는 '미지정 폴백'이 아니라 'DB에 개인직인 미등록' 안전망이다(loadAutoBindContext 는
    //   미지정 폴백에서 seal 을 비우지 않고 대표원장 개인직인을 그대로 넘긴다 — 위 (A) 가드로 보장).
    const v = build('문지은', null);
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(INSTITUTION_SEAL);
  });
});
