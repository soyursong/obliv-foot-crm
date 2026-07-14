/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#3, B안 field-confirm 2026-07-14T10:22 KST]
 * 김주연 총괄(U0ATDB587PV): "문지은 원장님 도장은 요청한 적 없는데 기존 대표 도장 어디갔어?"
 *   → 미지정 폴백 도장 = 문지은 원장 개인직인 거부 → 오블리브오리진 법인 인감(빨간, 기관 대표 도장) 복원.
 *
 * 검증 축(렌더 계약): buildAutoBindValues.doctor_seal_html 이
 *   (a) 미지정 폴백(clinicDoctor.seal_image_url=null, loadAutoBindContext의 sealFallbackToInstitution
 *       경로가 만드는 상태) → 법인 인감(getStampUrl / jongno-foot-stamp.png)으로 폴스루,
 *   (b) 지정 진료의(seal_image_url=개인 도장 storage path) → 해당 원장 개인 도장(오매핑 0),
 *   두 인장 슬롯이 섞이지 않는지(WARN-4 축 분리)를 계약으로 고정한다.
 *   ※ [REOPEN#4 보정] 미지정 서류의 진료의명은 문지은 개인명이 아니라 기관명으로 채운다(공란 방지 +
 *     이름↔도장 세트 정합). 이름=기관명, 도장=법인 인감으로 기관 서명자 정합. 개인명↔법인 도장 미스매치 제거.
 *
 * AC-R3-1: 미지정 폴백(seal null) → doctor_seal_html = 법인 인감(jongno-foot-stamp) <img>, 개인직인 아님.
 * AC-R3-2: 지정 진료의(한동훈/김윤기/김상은) → 해당 개인 도장 storage path <img> (법인 인감 아님).
 * AC-R3-3: 폴백 인장 src ≠ 지정 진료의 인장 src (인장 슬롯 분리 — 오매핑 0).
 * AC-R3-4: [REOPEN#4] 미지정 폴백 서류 진료의명 = 기관명(공란 방지) + 문지은 개인명 부재(이름↔도장 정합).
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const INSTITUTION_SEAL = 'jongno-foot-stamp'; // getStampUrl() = OBLIVORIGIN 법인 전자인감(byte-identical)

const SEALS: Record<string, string> = {
  한동훈: `seals/${CLINIC}/ab2819be-d56c-41b9-bc97-da01123ab2a6.png`,
  김윤기: `seals/${CLINIC}/57953f10-1427-438e-9406-ee0b02efef44.png`,
  김상은: `seals/${CLINIC}/ec70414e-27cc-4929-a73d-e1d5f3164716.png`,
};

const baseCheckIn = (): CheckIn => ({
  id: 'ci-instfb-0001', clinic_id: CLINIC, customer_id: 'cust-0001',
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

test.describe('T-20260713 REOPEN#3 — 미지정 폴백 = 오블리브오리진 법인 인감', () => {
  test('AC-R3-1: 미지정 폴백(대표원장 seal null) → 법인 인감 <img>, 개인직인 아님', () => {
    const v = build('문지은', null); // loadAutoBindContext.sealFallbackToInstitution 가 만드는 상태
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(INSTITUTION_SEAL); // 법인 인감(getStampUrl)
    // 어떤 원장 개인 도장 storage path 도 포함하지 않는다(displacement 제거 확인)
    for (const p of Object.values(SEALS)) expect(v.doctor_seal_html).not.toContain(p);
  });

  test('AC-R3-2: 지정 진료의 → 해당 개인 도장, 법인 인감 아님', () => {
    for (const [name, path] of Object.entries(SEALS)) {
      const v = build(name, path);
      expect(v.doctor_seal_html).toContain(path);          // 개인 도장 1:1
      expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL); // 법인 인감으로 대체되지 않음
      expect(v.doctor_name).toBe(name);
    }
  });

  test('AC-R3-3: 폴백 인장 src ≠ 지정 진료의 인장 src (슬롯 분리, 오매핑 0)', () => {
    const fb = build('문지은', null).doctor_seal_html;
    const assigned = Object.entries(SEALS).map(([n, p]) => build(n, p).doctor_seal_html);
    for (const a of assigned) expect(a).not.toBe(fb);
    expect(new Set([fb, ...assigned]).size).toBe(4); // 법인 + 3개 개인 모두 상이
  });

  test.describe('AC-R3-1/4: 두 빌링서식 라이브 렌더 — 미지정=법인 인감 + 기관명(문지은 개인명 부재)', () => {
    // [REOPEN#4] loadAutoBindContext.sealFallbackToInstitution 경로가 만드는 최종 상태:
    //   doctor=기관명, clinicDoctor.seal_image_url=null.
    const INSTITUTION_NAME = '오블리브 풋센터 종로';
    for (const formKey of ['bill_detail', 'bill_receipt']) {
      test(`${formKey} 미지정 폴백`, async ({ page }) => {
        const v = build(INSTITUTION_NAME, null);
        const tpl = getHtmlTemplate(formKey);
        expect(tpl, `${formKey} 템플릿 존재`).toBeTruthy();
        const html = bindHtmlTemplate(tpl as string, v);
        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
        const bodyText = await page.locator('body').innerText();
        // 진료의명 = 기관명(공란 아님) + 문지은 개인명 부재(이름↔도장 정합)
        expect(bodyText).toContain(INSTITUTION_NAME);
        expect(bodyText).not.toContain('문지은');
        // 법인 인감 <img> 존재 + 개인 도장 path 부재
        await expect(page.locator(`img[src*="${INSTITUTION_SEAL}"]`)).toHaveCount(1);
        for (const p of Object.values(SEALS)) await expect(page.locator(`img[src*="${p}"]`)).toHaveCount(0);
      });
    }
  });
});
