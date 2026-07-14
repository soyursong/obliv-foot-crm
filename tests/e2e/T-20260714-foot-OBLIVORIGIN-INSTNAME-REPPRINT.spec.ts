/**
 * T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — 요양기관명 전용 축 재배선 + 대표자 print 분리(Q2)
 * parent: T-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP / CEO DECISION swc6 / DA z2af
 *
 * 확정(CEO swc6 + DA z2af):
 *   - Q-C: 요양기관명 값 = 사업자상호와 동일 → hira_institution_name = '오블리브의원 서울오리진점'.
 *          (현재 동일값이나 축 분리 = 정식발번 divergence 대비)
 *   - Q2 : representative_name(박영진) = 기관/사업자 대표자 필드에만. 진료의({{doctor_name}}) 셀 보존,
 *          박영진 주입 금지.
 *   - DA z2af: hira_institution_name ADDITIVE nullable canonical, 요양기관명 셀은 이 컬럼 바인딩,
 *          silent 폴백 금지(affirmative).
 *
 * axis A(요양기관명 재배선): bill_detail '요양기관 명칭' / bill_receipt '요양기관 명칭'·footer '요양기관명'
 *   셀을 {{clinic_name}}(=clinics.name=사업자상호 옵션B) → {{hira_institution_name}} 전용 축으로 재배선.
 *   ⚠ 사업자상호 셀(및 rebind 비대상 서류)은 {{clinic_name}} 유지 — ins_claim_form 의료기관명은 축분리 스코프 밖.
 * axis B(대표자 print, Q2): bill_detail '대 표 자' 셀 = 기관 대표자 필드 → {{representative_name}}(박영진).
 *   bill_receipt '진료의사' 셀 = {{doctor_name}} 보존(박영진 미주입).
 *
 * 본 스펙은 순수 함수 계층(getHtmlTemplate/bindHtmlTemplate)에서 (a) 축 재배선 (b) silent 폴백 금지
 *   (c) 대표자/진료의 분리 (d) 스코프 격리를 양방향 고정하고, page.setContent+print media 로 실 렌더
 *   스크린샷을 남긴다(DoD#2, WARN-A). DB axis(hira 컬럼 populate=오블리브의원 서울오리진점 / songdo=NULL /
 *   nhis 13328581 페어)는 prod introspection 으로 별도 검증(마이그 evidence).
 *
 * 실행: npx playwright test T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT
 */
import { test, expect } from '@playwright/test';
import { homedir } from 'os';
import path from 'path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const HIRA = '오블리브의원 서울오리진점';      // 요양기관명(hira_institution_name) 확정값
const BIZ = '상호전용테스트XYZ(사업자)';       // 사업자상호(clinic_name) — 요양기관명 셀에 새어들면 안 됨
const REP = '박영진';                          // 기관 대표자(representative_name)
const DOC = '문지은';                          // 진료의(doctor_name) — 보존

const OUT_DIR = path.join(
  homedir(),
  'claude-sync/memory/_handoff/qa_screenshots/T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT',
);

test.describe('OBLIVORIGIN-INSTNAME-REPPRINT — 요양기관명 축 재배선 + 대표자 분리', () => {
  test('axisA 슬롯: bill_detail·bill_receipt 요양기관명 셀 = {{hira_institution_name}}, {{clinic_name}} 제거', () => {
    const detail = getHtmlTemplate('bill_detail') as string;
    const receipt = getHtmlTemplate('bill_receipt') as string;
    expect(detail).not.toBeNull();
    expect(receipt).not.toBeNull();
    // 요양기관명 전용 축 슬롯 존재
    expect(detail).toContain('{{hira_institution_name}}');
    expect(receipt).toContain('{{hira_institution_name}}');
    // 축 분리: 두 form 은 더 이상 사업자상호 슬롯({{clinic_name}})을 갖지 않음
    expect(detail).not.toContain('{{clinic_name}}');
    expect(receipt).not.toContain('{{clinic_name}}');
  });

  test('axisB 슬롯: bill_detail 대표자 셀 = {{representative_name}} / bill_receipt 진료의 셀 = {{doctor_name}} 보존', () => {
    const detail = getHtmlTemplate('bill_detail') as string;
    const receipt = getHtmlTemplate('bill_receipt') as string;
    // 기관 대표자 필드 → representative_name (박영진 축)
    expect(detail).toContain('대 표 자');
    expect(detail).toContain('{{representative_name}}');
    // 진료의({{doctor_name}}) 셀 박영진 주입 금지 — bill_detail 에는 doctor_name 슬롯이 없어야(대표자셀 재정의됨)
    expect(detail).not.toContain('{{doctor_name}}');
    // bill_receipt 진료의사 슬롯 보존
    expect(receipt).toContain('진료의사');
    expect(receipt).toContain('{{doctor_name}}');
    // bill_receipt 에는 기관 대표자 셀 없음 → representative_name 슬롯 부재(박영진 미주입)
    expect(receipt).not.toContain('{{representative_name}}');
  });

  test('AC-1 렌더: 요양기관명 = 오블리브의원 서울오리진점 (affirmative, 사업자상호 미유입)', () => {
    const bind = { hira_institution_name: HIRA, clinic_name: BIZ, representative_name: REP, doctor_name: DOC };
    const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail') as string, bind);
    const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt') as string, bind);
    expect(detailHtml).toContain(HIRA);      // AC-1 요양기관명 렌더
    expect(receiptHtml).toContain(HIRA);
    // 사업자상호(clinic_name)가 요양기관명 자리(또는 어디에도) 새어들지 않음 — 슬롯 제거됐으므로 미렌더
    expect(detailHtml).not.toContain(BIZ);
    expect(receiptHtml).not.toContain(BIZ);
    expect(detailHtml).not.toContain('{{hira_institution_name}}');  // 미치환 잔존 없음
    expect(receiptHtml).not.toContain('{{hira_institution_name}}');
  });

  test('AC-3 렌더: bill_detail 대표자=박영진 / bill_receipt 진료의=문지은 (교차주입 없음)', () => {
    const bind = { hira_institution_name: HIRA, clinic_name: BIZ, representative_name: REP, doctor_name: DOC };
    const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail') as string, bind);
    const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt') as string, bind);
    // bill_detail: 기관 대표자 = 박영진, 진료의 문지은은 미유입(슬롯 없음)
    expect(detailHtml).toContain(REP);
    expect(detailHtml).not.toContain(DOC);
    // bill_receipt: 진료의사 = 문지은 보존, 대표자(박영진) 미유입(진료의 셀에 박영진 주입 금지 준수)
    expect(receiptHtml).toContain(DOC);
    expect(receiptHtml).not.toContain(REP);
  });

  test('silent 폴백 금지: hira 미설정(공란) → 요양기관명 셀 공란, clinic_name(사업자상호)으로 복귀하지 않음', () => {
    // FE 바인딩은 ctx.clinic?.hira_institution_name ?? '' — 미설정 시 affirmative 공란.
    const bind = { hira_institution_name: '', clinic_name: BIZ, representative_name: REP, doctor_name: DOC };
    const detailHtml = bindHtmlTemplate(getHtmlTemplate('bill_detail') as string, bind);
    const receiptHtml = bindHtmlTemplate(getHtmlTemplate('bill_receipt') as string, bind);
    // 축 미구성이 공란으로 드러남 — 사업자상호로 silent 복귀 금지
    expect(detailHtml).not.toContain(BIZ);
    expect(receiptHtml).not.toContain(BIZ);
  });

  test('AC-5 스코프 격리: ins_claim_form(보험청구서 의료기관명)은 rebind 비대상 → {{clinic_name}} 유지', () => {
    const ins = getHtmlTemplate('ins_claim_form') as string;
    expect(ins).toContain('{{clinic_name}}');
    expect(ins).not.toContain('{{hira_institution_name}}');
  });

  test('DoD#2 렌더 evidence: bill_detail·bill_receipt 인쇄 미리보기 스크린샷', async ({ page }) => {
    const bind = {
      hira_institution_name: HIRA, clinic_name: BIZ, representative_name: REP, doctor_name: DOC,
      patient_name: '홍길동', patient_rrn: '900101-1******', clinic_address: '서울시 종로구',
      visit_date: '2026-07-14', issue_date: '2026-07-14', record_no: 'F-4621', chart_number: 'F-4621',
    };
    for (const [key, file] of [['bill_detail', 'detail-instname.png'], ['bill_receipt', 'receipt-instname.png']] as const) {
      const html = bindHtmlTemplate(getHtmlTemplate(key) as string, bind);
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
      expect(html).toContain(HIRA);
    }
  });
});
