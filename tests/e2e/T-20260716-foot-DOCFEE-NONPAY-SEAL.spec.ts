/**
 * E2E spec — T-20260716-foot-DOCFEE-NONPAY-SEAL [AC2 슬롯키드 직인 최종 규칙]
 *   현장 owner 김주연 총괄 U0ATDB587PV [A] 2026-07-16T13:52, planner FIX-REQUEST MSG-20260716-135623-ngmk.
 *   현장 [A] 원문: "7/15 보내주신 개인 직인으로 교체 / 법인 인감은 박영진 대표자 성함 들어갈 때 매핑."
 *
 * 슬롯키드 규칙(슬롯 주체로 결정 — 문서 단위·doctor is_default 아님):
 *   - 박영진 대표자 성함 슬롯(영수증/계산서/세부내역서 대표자란) → 법인 인감({{institution_seal_html}}).
 *   - 문지은 원장 서명란(진료의 축 서류) → 개인직인({{doctor_seal_html}} = clinic_doctors.seal_image_url).
 *
 * 결정론적 템플릿/바인딩 불변식 강제(로그인 불요). BODYPORT(대표자·법인도장·3원장) + 본 티켓(문지은
 * 개인직인 release)을 단일 owner 로 reconcile — co-deploy 정합. 라이브 렌더 실측은 supervisor QA.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const BIND_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/autoBindContext.ts'), 'utf8');

function extractTemplate(constName: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${constName}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${constName} 상수 존재`).not.toBeNull();
  return m![1];
}
const stripComments = (tpl: string) => tpl.replace(/<!--[\s\S]*?-->/g, '');

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const INSTITUTION_SEAL = 'jongno-foot-stamp'; // getStampUrl() = 법인 전자인감
const MOON_SEAL = `seals/${CLINIC}/e435af73-fc72-4bb5-8ace-1fe8423377ee.png`; // 문지은 개인직인(7/15 clean asset)

const baseCheckIn = (): CheckIn => ({
  id: 'ci-nonpay-0001', clinic_id: CLINIC, customer_id: 'cust-0001',
  customer_name: '홍길동', customer_phone: '01012345678',
  checked_in_at: '2026-07-16T09:00:00+09:00',
} as unknown as CheckIn);

const build = (doctor: string, sealPath: string | null) =>
  buildAutoBindValues({
    checkIn: baseCheckIn(),
    customer: { name: '홍길동', phone: '01012345678' } as never,
    clinic: { representative_name: '박영진', name: '오블리브의원 서울오리진점' } as never,
    doctor,
    clinicDoctor: { name: doctor, license_no: '제12345호', specialist_no: null, seal_image_url: sealPath, is_default: doctor === '문지은' } as never,
  });

test.describe('DOCFEE-NONPAY-SEAL — 슬롯키드 직인(대표자란=법인 / 원장 서명란=개인직인)', () => {
  // ── AC2-1[갱신]: 도장-우회 체인 제거 정합 — 지정·미지정 모두 개인직인 ──
  //   ⚠ SUPERSEDED(T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND AC-B3, 이은상 팀장 2026-07-31):
  //   구 판정함수 shouldForceInstitutionSeal / sealFallbackToInstitution / forceInstitutionSeal 도장-우회
  //   체인이 전면 삭제됨(df9ed521). 07-16 AC2 의도('문지은 is_default 강제 제거 → 개인직인')는 이제 미지정
  //   폴백까지 확장돼 '전 경로 개인직인'으로 완결. 삭제된 함수 대신 정적 소스 가드로 정합 검증(런타임 import 불가).
  const BIND_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/autoBindContext.ts'), 'utf8');
  test('AC2-1[갱신]: shouldForceInstitutionSeal/seal-null 강제 체인 소거 — 지정·미지정 모두 개인직인', () => {
    // 판정함수·플래그·seal 비움 강제가 코드에서 사라졌다(AC-B3, is_default 강제뿐 아니라 폴백 우회까지 제거).
    expect(BIND_SRC, 'shouldForceInstitutionSeal 함수 선언 잔존(AC-B3 미정리)').not.toMatch(/function\s+shouldForceInstitutionSeal/);
    expect(BIND_SRC, 'sealFallbackToInstitution let 선언 잔존').not.toMatch(/let\s+sealFallbackToInstitution/);
    expect(BIND_SRC, 'forceInstitutionSeal const 잔존').not.toMatch(/const\s+forceInstitutionSeal/);
    expect(BIND_SRC, '미지정 폴백 seal_image_url=null 강제(법인인감 우회) 잔존').not.toMatch(/seal_image_url:\s*null/);
    // 미지정 폴백 이름란→기관명 덮어쓰기도 제거(폴백=대표원장 개인명 유지).
    expect(BIND_SRC, '폴백 기관명 덮어쓰기 잔존').not.toMatch(/if\s*\(institutionName\)\s*doctorName\s*=\s*institutionName/);
    // 대표자란 법인 인감(별도 토큰)은 독립 경로 → 유지(무회귀).
    expect(BIND_SRC, 'institution_seal_html(getStampUrl) 축 무접촉이어야 함').toMatch(/institution_seal_html/);
  });

  // ── AC2-2: 문지은 원장 서명란 = 개인직인(7/15 clean asset) ──
  test('AC2-2: 문지은 지정 → doctor_seal_html = 개인직인 storage path (법인 인감 아님)', () => {
    const v = build('문지은', MOON_SEAL);
    expect(v.doctor_seal_html).toContain('<img');
    expect(v.doctor_seal_html).toContain(MOON_SEAL);
    expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
    expect(v.doctor_name).toBe('문지은');
  });

  // ── AC2-3: 박영진 대표자란 = 법인 인감(institution_seal_html), 선택 진료의와 무관 ──
  test('AC2-3: institution_seal_html = 항상 법인 인감(getStampUrl), 문지은 개인직인 미유입', () => {
    const v = build('문지은', MOON_SEAL); // 진료의=문지은(개인직인 보유)이어도
    expect(v.institution_seal_html).toContain('<img');
    expect(v.institution_seal_html).toContain(INSTITUTION_SEAL);
    // 대표자란 법인 인감 슬롯에 문지은 개인직인이 새지 않는다(슬롯키드 격리).
    expect(v.institution_seal_html).not.toContain(MOON_SEAL);
    expect(v.receipt_representative).toBe('박영진');
    // 바인딩 소스 = getStampUrl(), clinicDoctor.seal_image_url 미참조.
    const m = BIND_SRC.match(/institution_seal_html:\s*\(\(\)\s*=>\s*\{([\s\S]*?)\}\)\(\),/);
    expect(m, 'institution_seal_html 정의 존재').not.toBeNull();
    expect(m![1]).toContain('getStampUrl()');
    expect(m![1]).not.toContain('seal_image_url');
  });

  // ── AC2-4: 템플릿 슬롯 분리 — 대표자란(기관 발행 서류)은 institution_seal_html, doctor_seal_html 아님 ──
  test('AC2-4: 계산서·영수증 신양식 대표자 근방 = receipt_representative + institution_seal_html', () => {
    const tpl = stripComments(extractTemplate('BILL_RECEIPT_NEW_HTML'));
    expect(tpl).toMatch(/\{\{receipt_representative\}\}[\s\S]*?\{\{institution_seal_html\}\}/);
    expect(tpl).not.toContain('{{doctor_seal_html}}'); // 기관 발행 축 — 진료의 개인직인 미유입
  });

  test('AC2-4: 세부내역서 대표자란 = receipt_representative + institution_seal_html (doctor_seal_html 아님)', () => {
    const tpl = stripComments(extractTemplate('BILL_DETAIL_HTML'));
    expect(tpl).toContain('{{institution_seal_html}}');
    expect(tpl).not.toContain('{{doctor_seal_html}}');
  });

  // ── AC3 회귀: 진료의 축 임상 서류는 doctor_seal_html 유지(개인직인 세트) ──
  test('AC3 회귀: 진료의 축 서류(진단서/처방전 등)는 {{doctor_seal_html}} 유지', () => {
    expect(HTML_SRC).toContain('{{doctor_seal_html}}');
    // doctor_seal_html = 진료의 개인직인(seal_image_url) 우선 → getStampUrl 폴스루.
    expect(BIND_SRC).toMatch(/doctor_seal_html:[\s\S]*?ctx\.clinicDoctor\?\.seal_image_url\s*\|\|\s*getStampUrl\(\)/);
  });

  test('AC3 회귀: 3원장 개인직인 유지(오매핑 0)', () => {
    const seals: Record<string, string> = {
      한동훈: `seals/${CLINIC}/ab2819be-d56c-41b9-bc97-da01123ab2a6.png`,
      김윤기: `seals/${CLINIC}/57953f10-1427-438e-9406-ee0b02efef44.png`,
      김상은: `seals/${CLINIC}/ec70414e-27cc-4929-a73d-e1d5f3164716.png`,
    };
    for (const [name, p] of Object.entries(seals)) {
      const v = build(name, p);
      expect(v.doctor_seal_html).toContain(p);
      expect(v.doctor_seal_html).not.toContain(INSTITUTION_SEAL);
    }
  });
});
