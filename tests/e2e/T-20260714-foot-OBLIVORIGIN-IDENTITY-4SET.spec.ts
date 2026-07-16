/**
 * T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — 기관명(옵션B) 렌더 회귀 가드
 * parent: T-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP
 * 권위: CEO DECISION MSG-xdax (planner FIX MSG-20260714-152258-e9j3, REVERSAL)
 *
 * 확정값(옵션B): clinics.name(jongno-foot) = '오블리브의원 서울오리진점'
 *   = 사업자등록증 상호 verbatim (붙임 + 끝 점). songdo-foot = '오블리브 풋센터 송도'(무영향, AC-5).
 *   ⚠ 폐기 이력: (1) 원본 '오블리브의원 서울 오리진점'(공백+점),
 *                (2) 옵션A '오블리브의원 서울 오리진'(strip, 공백·점없음) — planner #1 前 판정, CEO REVERSAL로 폐기.
 *   → 두 폐기값 모두 재유입 금지(stale 가드).
 *
 * 기관명은 전 출력서류에서 데이터 구동({{clinic_name}} ← clinics.name, autoBindContext).
 * 하드코딩 지점명 없음. 본 스펙은 순수 함수 계층에서
 *   (a) 확정값(옵션B)이 전 서류에 정상 렌더 + (b) 폐기값 재유입 회귀 차단을 양방향 고정한다.
 * (실제 브라우저 서류 렌더 스크린샷은 evidence/oblivorigin-identity-4set/ 참조)
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const CANONICAL = '오블리브의원 서울오리진점';   // 옵션B 확정값 (붙임 + 끝 점)
const STALE_A = '오블리브의원 서울 오리진';       // 폐기된 옵션A (strip, 공백·점없음) — 재유입 금지
const STALE_ORIG = '오블리브의원 서울 오리진점';  // 원본 (공백+점) — 재유입 금지

// 표시명(clinic_name) 슬롯을 가진 출력서류 form_key.
// T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT (요양기관명 축 델타): 아래 5종
//   (diagnosis·bill_detail·rx_standard·bill_receipt·ins_claim_form)의 '요양기관명' 셀은
//   {{clinic_name}}(표시명) → {{hira_institution_name}}(요양기관명 축)으로 재배선됨.
//   → 이 목록에서 제외하고, 별도 describe(요양기관명 축)에서 hira_institution_name 렌더를 고정한다.
//   나머지 서류의 병원명/의료기관 셀은 표시명(clinic_name) 축 유지(무변경).
const FORM_KEYS_WITH_CLINIC_NAME = [
  'treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode',
  'visit_confirm', 'diag_opinion', 'payment_cert', 'referral_letter',
  'medical_record_request', 'diag_opinion_v2',
];

// 요양기관명 축(hira_institution_name)으로 재배선된 서류 (INSTNAME-REPPRINT).
const FORM_KEYS_WITH_HIRA_INST_NAME = [
  'diagnosis', 'bill_detail', 'rx_standard', 'bill_receipt', 'ins_claim_form',
];

test.describe('기관명 옵션B 렌더 회귀 가드 (T-20260714 OBLIVORIGIN)', () => {
  for (const formKey of FORM_KEYS_WITH_CLINIC_NAME) {
    test(`${formKey}: {{clinic_name}} → '${CANONICAL}' (옵션B·미치환 없음)`, () => {
      const tpl = getHtmlTemplate(formKey);
      expect(tpl).not.toBeNull();
      // 슬롯 존재 전제
      expect(tpl as string).toContain('{{clinic_name}}');
      const html = bindHtmlTemplate(tpl as string, { clinic_name: CANONICAL });
      expect(html).toContain(CANONICAL);        // AC-1: 확정값(옵션B) 렌더
      expect(html).not.toContain(STALE_A);      // 회귀: 폐기 옵션A 재유입 없음
      expect(html).not.toContain(STALE_ORIG);   // 회귀: 원본(공백+점) 재유입 없음
      expect(html).not.toContain('{{clinic_name}}'); // 미치환 잔존 없음
    });
  }

  // T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 서류 —
  //   요양기관명 셀은 hira_institution_name 축으로 옵션B값 렌더(값 동일, 축만 분리).
  for (const formKey of FORM_KEYS_WITH_HIRA_INST_NAME) {
    test(`${formKey}: {{hira_institution_name}} → '${CANONICAL}' (요양기관명 축·미치환 없음)`, () => {
      const tpl = getHtmlTemplate(formKey) as string;
      expect(tpl).not.toBeNull();
      expect(tpl).toContain('{{hira_institution_name}}');
      const html = bindHtmlTemplate(tpl, { hira_institution_name: CANONICAL });
      expect(html).toContain(CANONICAL);
      expect(html).not.toContain(STALE_A);
      expect(html).not.toContain(STALE_ORIG);
      expect(html).not.toContain('{{hira_institution_name}}');
    });
  }

  test('데이터 구동 증명: 하드코딩 지점명 없음 — 입력값 그대로 렌더', () => {
    // 임의 다른 값을 넣으면 그 값이 나오고, 확정값/폐기값이 새어들지 않음.
    // bill_receipt 요양기관명 셀은 hira_institution_name 축으로 재배선됨(INSTNAME-REPPRINT).
    const tpl = getHtmlTemplate('bill_receipt');
    const html = bindHtmlTemplate(tpl as string, { hira_institution_name: '테스트기관XYZ' });
    expect(html).toContain('테스트기관XYZ');
    expect(html).not.toContain(CANONICAL);
    expect(html).not.toContain(STALE_A);
    expect(html).not.toContain(STALE_ORIG);
  });
});
