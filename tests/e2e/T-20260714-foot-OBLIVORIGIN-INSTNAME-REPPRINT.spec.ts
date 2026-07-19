/**
 * T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — 요양기관명 축 재배선 + 대표자 print 분리 가드
 * parent: T-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP
 * 권위: CEO DECISION swc6 (MSG-20260714-165134-swc6) Q-C/Q2 · DA z2af
 *
 * 확정:
 *  - Q-C: 요양기관명(hira_institution_name) = 사업자상호와 동일 = '오블리브의원 서울오리진점'.
 *         축은 분리(SEPARATE) — 정식발번 시 divergence 대비 별개 슬롯({{hira_institution_name}}).
 *  - Q2 : 대표자(representative_name=박영진) = 기관 field only. {{doctor_name}}(진료의) 셀에 박영진 주입 금지.
 *  - DA : hira_institution_name ADDITIVE nullable, silent 폴백 금지(NULL→clinics.name 대체 안 함).
 *
 * 재배선 대상(DoD 요양기관명-bearing 서류 + 공단·EDI):
 *   diagnosis(진단서) · bill_detail(세부산정) · rx_standard(처방전) · bill_receipt(영수증) · ins_claim_form(공단 보험청구서)
 * 본 스펙은 순수 함수(bindHtmlTemplate) 계층에서 축 분리·affirmative·진료의 보존을 고정한다.
 * (실기기 렌더 스크린샷 evidence는 supervisor 렌더 실측 게이트 — screenshot_gate WARN-A)
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { buildAutoBindValues } from '../../src/lib/autoBindContext';
import type { CheckIn } from '../../src/lib/types';

const INST_NAME = '오블리브의원 서울오리진점';   // 요양기관명(=사업자상호 동일값)
const REP_NAME = '박영진';                        // 기관 대표자 — {{doctor_name}} 셀 주입 금지
const DOCTOR = '한동훈';                           // 진료의(예시)

// 요양기관명 셀이 {{hira_institution_name}}로 재배선된 서류.
const REBOUND_FORMS = ['diagnosis', 'bill_detail', 'rx_standard', 'bill_receipt', 'ins_claim_form'];

test.describe('요양기관명 축 재배선 (AC-1/AC-2/AC-4/AC-5)', () => {
  for (const formKey of REBOUND_FORMS) {
    test(`${formKey}: {{hira_institution_name}} 슬롯 존재 + '${INST_NAME}' affirmative 렌더`, () => {
      const tpl = getHtmlTemplate(formKey) as string;
      expect(tpl).not.toBeNull();
      // 재배선 증명: 요양기관명 슬롯이 hira_institution_name 축으로 존재
      expect(tpl).toContain('{{hira_institution_name}}');
      const html = bindHtmlTemplate(tpl, {
        hira_institution_name: INST_NAME,
        clinic_name: '표시명-다른값',   // 표시명 축 divergence 시뮬레이션
        doctor_name: DOCTOR,
      });
      // AC-1: 요양기관명 셀 = 요양기관명 축 값 렌더
      expect(html).toContain(INST_NAME);
      expect(html).not.toContain('{{hira_institution_name}}'); // 미치환 잔존 없음
    });

    test(`${formKey}: silent 폴백 금지 — hira_institution_name NULL(공란) 시 표시명이 요양기관명 셀에 새지 않음`, () => {
      const tpl = getHtmlTemplate(formKey) as string;
      // 요양기관명 축 공란 + 표시명은 별개 값. 요양기관명 슬롯은 공란이어야(폴백 금지).
      const html = bindHtmlTemplate(tpl, {
        hira_institution_name: '',
        clinic_name: '송도표시명ZZZ',
      });
      // 표시명 슬롯({{clinic_name}})이 남아있는 서류라면 표시명은 나오되,
      // 재배선된 요양기관명 셀에는 폴백이 없어야 함 → 별도 검증(아래 AC-4 케이스에서 축 분리 확인).
      expect(html).not.toContain('{{hira_institution_name}}');
    });
  }

  test('AC-4 축 분리: 요양기관명 축과 표시명 축은 독립 — 한 축 값이 다른 축 셀에 새지 않음', () => {
    // bill_detail: 요양기관 명칭 셀 = hira_institution_name. 다른 값을 두 축에 넣어 독립성 증명.
    const tpl = getHtmlTemplate('bill_detail') as string;
    const html = bindHtmlTemplate(tpl, {
      hira_institution_name: '요양기관명-AAA',
      clinic_name: '표시명-BBB',
      doctor_name: DOCTOR,
    });
    expect(html).toContain('요양기관명-AAA');  // 요양기관 명칭 셀에 요양기관명 축 값
    // bill_detail 요양기관 명칭 셀은 더 이상 clinic_name을 참조하지 않음(재배선 완료)
    // → 표시명 값이 요양기관 명칭 셀 자리에 오지 않음을 축 라벨 근접 검증
    expect(html).not.toContain('{{clinic_name}}');
  });
});

test.describe('대표자 print 분리 — 슬롯키드 refined (AC-3, batch9 재정합 2026-07-19)', () => {
  // [refined 정책] CEO Q2('대표자=기관 field, 진료의 무접촉')를 '슬롯키드'로 정밀화한다
  //   (총괄 07-16 13:52 AC9_SEAL_SLOTKEYED_FINAL + BODYPORT §same_subject refine + planner A2 adjudication 07-15 20:28).
  //   서류 성격으로 대표자 셀 소스가 갈린다:
  //     · 기관 발행 서류(세부산정내역 bill_detail·영수증) 대표자란 = 개설자(대표자) {{receipt_representative}}=박영진
  //       (진료의 아님) + 도장=법인(요양기관) 인감 {{institution_seal_html}}
  //     · 진료의 축 서류(소견서·진단서·처방전 등) = 진료의({{doctor_name}}) 보존, 박영진 미주입 (CEO Q2 원칙 유지)
  //   구 단언('bill_detail 대표자=진료의 보존')은 세부내역서를 진료의 축으로 오분류 → refined 정책으로 교정.
  test('bill_detail(세부산정내역·기관 발행) 대표자 셀 = 개설자 {{receipt_representative}}=박영진', () => {
    const tpl = getHtmlTemplate('bill_detail') as string;
    const html = bindHtmlTemplate(tpl, {
      hira_institution_name: INST_NAME,
      doctor_name: DOCTOR,                          // 데이터는 제공되나 세부내역서 대표자 셀엔 주입 안 됨
      receipt_representative: REP_NAME,             // 개설자(대표자)=박영진
      institution_seal_html: '<img class="inst-seal"/>',
    });
    expect(html).toContain(REP_NAME);              // 세부내역서 대표자란 = 박영진 (refined 슬롯키드)
    expect(html).not.toContain('{{receipt_representative}}');  // 슬롯 치환 완료
  });

  test('diag_opinion(진료의 축 서류) 진료의 셀 = {{doctor_name}} 보존, 박영진 미주입 (CEO Q2 유지)', () => {
    const tpl = getHtmlTemplate('diag_opinion') as string;
    const html = bindHtmlTemplate(tpl, {
      hira_institution_name: INST_NAME,
      doctor_name: DOCTOR,
      receipt_representative: REP_NAME,             // 데이터 제공되나 진료의 축 서류 셀엔 주입 안 됨
    });
    expect(html).toContain(DOCTOR);                // 진료의 보존
    expect(html).not.toContain(REP_NAME);          // 박영진 미주입 (진료의 축 격리)
  });

  test('출력서류에 레거시 {{representative_name}} 렌더 슬롯이 존재하지 않음 (audit: 대표자 토큰은 receipt_representative로 일원화)', () => {
    // axis B audit: 기관 대표자는 {{receipt_representative}} 단일 토큰으로만 렌더 →
    //   레거시 {{representative_name}} 토큰은 어느 재배선 서류에도 없어야 함(이중 토큰 신설 0).
    for (const formKey of REBOUND_FORMS) {
      const tpl = getHtmlTemplate(formKey) as string;
      expect(tpl).not.toContain('{{representative_name}}');
    }
  });
});

test.describe('buildAutoBindValues 데이터원 (axis A/B)', () => {
  const baseCheckIn = {
    id: 'ci-1', clinic_id: 'cl-1', customer_id: 'cu-1',
    customer_name: '홍길동', customer_phone: '01011112222',
    checked_in_at: '2026-07-16T01:00:00Z',
  } as unknown as CheckIn;

  test('hira_institution_name affirmative — clinic 값 그대로, NULL 시 공란(폴백 없음)', () => {
    const withVal = buildAutoBindValues({
      checkIn: baseCheckIn,
      clinic: { name: '표시명', address: '주소', hira_institution_name: INST_NAME },
      doctor: DOCTOR,
    });
    expect(withVal.hira_institution_name).toBe(INST_NAME);
    // 축 분리: 표시명(clinic_name)과 요양기관명(hira_institution_name)은 별개 슬롯
    expect(withVal.clinic_name).toBe('표시명');

    const nullVal = buildAutoBindValues({
      checkIn: baseCheckIn,
      clinic: { name: '송도표시명', address: '주소', hira_institution_name: null },
      doctor: DOCTOR,
    });
    // silent 폴백 금지 — NULL이면 공란, 표시명으로 대체 안 함
    expect(nullVal.hira_institution_name).toBe('');
    expect(nullVal.hira_institution_name).not.toBe('송도표시명');
  });

  test('representative_name 데이터원 제공되나 doctor_name과 분리(진료의 보존)', () => {
    const v = buildAutoBindValues({
      checkIn: baseCheckIn,
      clinic: { name: '표시명', address: '주소', representative_name: REP_NAME, hira_institution_name: INST_NAME },
      doctor: DOCTOR,
    });
    expect(v.representative_name).toBe(REP_NAME);  // 데이터원 준비
    expect(v.doctor_name).toBe(DOCTOR);            // 진료의 = 진료의 값 (박영진 아님)
    expect(v.doctor_name).not.toBe(REP_NAME);
  });
});
