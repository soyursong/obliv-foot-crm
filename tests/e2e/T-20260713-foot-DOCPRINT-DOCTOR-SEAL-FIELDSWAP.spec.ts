/**
 * E2E spec — T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN2 asset-swap]
 * 현장(김주연 총괄) 확정 도장 3종("맨처음 시안", 성함+印 붉은 네모)으로 storage seal 재기록 후,
 * 진료의(한동훈/김윤기/김상은)별 해당 도장만 두 빌링서식에 찍히는지(오매핑 0) 렌더 계약 검증.
 *
 * 배경: seal_image_url(storage path)은 무변경. 스토리지 오브젝트 바이트만 현장 확정 소스로 재기록.
 *   render 경로(buildAutoBindValues.doctor_seal_html)는 clinicDoctor.seal_image_url을 <img src>로 방출.
 *   실 storage 바이트 == 현장 소스 대조 + 실 signed URL 로드는 별도 라이브 하니스
 *   (scripts/..._seal_fieldswap.mjs verify / ..._seal_render.mjs)에서 실측 — 여기선 렌더 전달·매핑 축.
 *
 * AC-S1: clinicDoctor.seal_image_url이 있으면 doctor_seal_html이 그 url을 담은 <img>로 방출된다.
 * AC-S2: 진료의별 서로 다른 seal url → 서로 다른 img src (오매핑 0, per-doctor 1:1).
 * AC-S3: 두 빌링서식(bill_detail '대표자' / bill_receipt '진료의사')에 진료의 이름+도장 <img>가
 *        고정 플레이스홀더 위치에 함께 렌더된다(위치 무변경).
 * 회귀: seal_image_url null이면 로컬자산 폴백 <img>(DOC-SEAL-NULL-FALLBACK AC-1) 유지.
 */
import { test, expect } from '@playwright/test';
import { buildAutoBindValues, type ClinicDoctorInfo } from '../../src/lib/autoBindContext';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import type { CheckIn } from '../../src/lib/types';

const baseCheckIn = (): CheckIn => ({
  id: 'ci-seal-0001',
  clinic_id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  customer_id: 'cust-0001',
  customer_name: '홍길동',
  customer_phone: '01012345678',
  checked_in_at: '2026-07-14T09:00:00+09:00',
} as unknown as CheckIn);

const doctor = (name: string, sealPath: string): ClinicDoctorInfo => ({
  name,
  license_no: '제12345호',
  specialist_no: null,
  seal_image_url: sealPath,
  is_default: false,
} as unknown as ClinicDoctorInfo);

// 3인 storage path (seals/{clinic}/{doctor_id}.png) — 현장 확정 도장 재기록 대상
const SEALS: Record<string, string> = {
  한동훈: 'seals/74967aea-a60b-4da3-a0e7-9c997a930bc8/ab2819be-d56c-41b9-bc97-da01123ab2a6.png',
  김윤기: 'seals/74967aea-a60b-4da3-a0e7-9c997a930bc8/57953f10-1427-438e-9406-ee0b02efef44.png',
  김상은: 'seals/74967aea-a60b-4da3-a0e7-9c997a930bc8/ec70414e-27cc-4929-a73d-e1d5f3164716.png',
};

test.describe('T-20260713-foot-DOCPRINT-DOCTOR-SEAL-FIELDSWAP — 진료의별 확정 도장 매핑', () => {
  test('AC-S1: seal_image_url이 doctor_seal_html <img src>로 방출된다', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '한동훈',
      clinicDoctor: doctor('한동훈', SEALS.한동훈),
    });
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(SEALS.한동훈);
    expect(v.doctor_name).toBe('한동훈');
  });

  test('AC-S2: 진료의별 서로 다른 seal url → 서로 다른 img src (오매핑 0)', () => {
    const srcs = Object.entries(SEALS).map(([name, path]) => {
      const v = buildAutoBindValues({
        checkIn: baseCheckIn(),
        customer: { name: '홍길동', phone: '01012345678' },
        doctor: name,
        clinicDoctor: doctor(name, path),
      });
      expect(v.doctor_seal_html).toContain(path); // 이름↔도장 1:1
      return v.doctor_seal_html;
    });
    // 3개 img html 이 모두 상이 (도장 뒤섞임 없음)
    expect(new Set(srcs).size).toBe(3);
  });

  test.describe('AC-S3: 두 빌링서식에 진료의 이름+도장이 고정 위치에 렌더', () => {
    for (const [name, sealPath] of Object.entries(SEALS)) {
      for (const formKey of ['bill_detail', 'bill_receipt']) {
        test(`${formKey} / ${name}`, async ({ page }) => {
          const v = buildAutoBindValues({
            checkIn: baseCheckIn(),
            customer: { name: '홍길동', phone: '01012345678' },
            doctor: name,
            clinicDoctor: doctor(name, sealPath),
          });
          const tpl = getHtmlTemplate(formKey);
          expect(tpl, `${formKey} 템플릿 존재`).toBeTruthy();
          const html = bindHtmlTemplate(tpl as string, v);
          await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
          // 진료의 이름이 서류 본문에 존재
          const text = await page.locator('body').innerText();
          expect(text).toContain(name);
          // 해당 진료의 도장 <img>가 존재 + src에 그 진료의 storage path 포함(오매핑 0)
          const sealImg = page.locator(`img[src*="${sealPath}"]`);
          await expect(sealImg).toHaveCount(1);
        });
      }
    }
  });

  test('회귀: seal_image_url null이면 로컬자산 폴백 <img> 유지', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn(),
      customer: { name: '홍길동', phone: '01012345678' },
      doctor: '문지은',
      clinicDoctor: doctor('문지은', null as unknown as string),
    });
    expect(v.doctor_seal_html).toContain('<img'); // getStampUrl() 폴백
  });
});
