/**
 * T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — 기관명 strip('점') 렌더 회귀 가드
 * parent: T-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP (CEO MSG-waza)
 *
 * 확정값: clinics.name(jongno-foot) = '오블리브의원 서울 오리진' (점 제거).
 *   body/derm 동일 canonical(단일 요양기관 정합). songdo-foot = '오블리브 풋센터 송도'(무영향, AC-5).
 *
 * 기관명은 전 출력서류에서 데이터 구동({{clinic_name}} ← clinics.name, autoBindContext).
 * 하드코딩 지점명 없음. 본 스펙은 순수 함수 계층에서
 *   (a) 확정값이 전 서류에 정상 렌더 + (b) stale '점' 재유입 회귀 차단을 양방향 고정한다.
 * (실제 브라우저 서류 렌더 스크린샷은 evidence/oblivorigin-identity-4set/ 참조)
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const CANONICAL = '오블리브의원 서울 오리진';  // 점 제거 확정값
const STALE = '오블리브의원 서울 오리진점';     // strip 이전 stale — 재유입 금지

// 기관명 슬롯을 가진 전 출력서류 form_key.
const FORM_KEYS_WITH_CLINIC_NAME = [
  'diagnosis', 'treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode',
  'visit_confirm', 'diag_opinion', 'bill_detail', 'payment_cert', 'referral_letter',
  'medical_record_request', 'diag_opinion_v2', 'rx_standard', 'bill_receipt', 'ins_claim_form',
];

test.describe('기관명 strip(점) 렌더 회귀 가드 (T-20260714 OBLIVORIGIN)', () => {
  for (const formKey of FORM_KEYS_WITH_CLINIC_NAME) {
    test(`${formKey}: {{clinic_name}} → '${CANONICAL}' (점 없음·미치환 없음)`, () => {
      const tpl = getHtmlTemplate(formKey);
      expect(tpl).not.toBeNull();
      // 슬롯 존재 전제
      expect(tpl as string).toContain('{{clinic_name}}');
      const html = bindHtmlTemplate(tpl as string, { clinic_name: CANONICAL });
      expect(html).toContain(CANONICAL);        // AC-1: 확정값 렌더
      expect(html).not.toContain(STALE);        // 회귀: stale '점' 재유입 없음
      expect(html).not.toContain('{{clinic_name}}'); // 미치환 잔존 없음
    });
  }

  test('데이터 구동 증명: 하드코딩 지점명 없음 — 입력값 그대로 렌더', () => {
    // 임의 다른 값을 넣으면 그 값이 나오고, 확정값/stale이 새어들지 않음.
    const tpl = getHtmlTemplate('bill_receipt');
    const html = bindHtmlTemplate(tpl as string, { clinic_name: '테스트기관XYZ' });
    expect(html).toContain('테스트기관XYZ');
    expect(html).not.toContain(CANONICAL);
    expect(html).not.toContain(STALE);
  });
});
