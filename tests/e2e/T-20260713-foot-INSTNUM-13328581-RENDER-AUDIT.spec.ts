/**
 * T-20260713-foot-OBLIVORIGIN-SEAL-INSTNUM-REGISTER — 요양기관번호 13328581 렌더 감사
 * parent: T-20260714-ops-INSTNUM-13328581-ALLCRM-SWEEP (CEO 확정)
 *
 * 확정값: 종로(jongno-foot) nhis_code = 13328581 / 송도(songdo-foot) = null (DB 정본, probe PASS).
 *
 * 렌더는 전부 clinics.nhis_code 데이터 구동(하드코딩 지점번호 없음):
 *   - EDI export 헤더 institution_code  ← claim.clinic_nhis_code (ediExport.ts:178,269)
 *   - 진료비 세부산정내역(bill_detail) {{clinic_code}}  ← clinic.nhis_code (autoBindContext:280)
 *   - 처방전(rx_standard) {{clinic_code}}               ← clinic.nhis_code
 *
 * 본 스펙은 순수 함수 계층에서 (a) 13328581 정상 렌더 + (b) AC-5 BLOCK 가드 등록 후 해제를
 * 양방향으로 고정한다. (실제 브라우저 서류 렌더 스크린샷은 evidence/seal-swap/ 참조)
 */
import { test, expect } from '@playwright/test';
import { buildEdiExport, type EdiExportInput } from '../../src/lib/ediExport';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const INSTNUM = '13328581'; // 종로 오리진점 확정 요양기관번호

// general 등급 급여 1건 + 주상병 1건 = 모든 후속 가드 통과하는 최소 유효 청구.
function validInput(clinic_nhis_code: string | null | undefined): EdiExportInput {
  return {
    claim: {
      claim_id: 'CLAIM-AUDIT-1',
      clinic_nhis_code,
      clinic_name: '오블리브의원 서울 오리진점',
      visit_date: '2026-07-14',
      patient_name: '홍길동',
      patient_chart_no: '00001',
      total_base: 10000,
      total_copayment: 3000,
      total_covered: 7000,
    },
    items: [
      {
        service_id: 'svc-1',
        service_name: '초진 진찰료',
        hira_code: 'AA154',
        hira_category: '진찰료',
        base_amount: 10000,
        copayment_amount: 3000,
        insurance_covered_amount: 7000,
        grade_at_charge: 'general',
        copayment_rate_at_charge: 0.3,
        is_insurance_covered: true,
        hira_score_at_charge: 153.36,
      },
    ],
    diagnoses: [{ kcd_code: 'L60.0', is_primary: true, sort_order: 0 }],
  };
}

test.describe('요양기관번호 13328581 렌더 감사 (T-20260713 INSTNUM)', () => {
  test('EDI 헤더 institution_code = 13328581 정상 렌더', () => {
    const res = buildEdiExport(validInput(INSTNUM));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.header.institution_code).toBe(INSTNUM);
    }
  });

  test('AC-5 가드: nhis_code 미설정(빈문자/null/공백) → MISSING_INSTITUTION_CODE BLOCK', () => {
    for (const empty of ['', null, undefined, '   ']) {
      const res = buildEdiExport(validInput(empty as string));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.block_code).toBe('MISSING_INSTITUTION_CODE');
    }
  });

  test('AC-5 가드: 13328581 등록 후 해제 — institution 통과, 후속 가드로 진행', () => {
    // 등록값이 있으면 AC-5 통과 → 항목 0건일 때 다음 가드(NO_ITEMS)로 넘어감(AC-5 아님).
    const noItems = validInput(INSTNUM);
    noItems.items = [];
    const res = buildEdiExport(noItems);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.block_code).toBe('NO_ITEMS'); // = AC-5는 이미 해제됨
  });

  test('진료비 세부산정내역(bill_detail) {{clinic_code}} → 13328581', () => {
    const tpl = getHtmlTemplate('bill_detail');
    expect(tpl).not.toBeNull();
    const html = bindHtmlTemplate(tpl as string, { clinic_code: INSTNUM });
    expect(html).toContain(INSTNUM);
    expect(html).toContain(`요양기관기호`);
    expect(html).not.toContain('{{clinic_code}}'); // 미치환 잔존 없음
  });

  test('처방전(rx_standard) {{clinic_code}} → 13328581', () => {
    const tpl = getHtmlTemplate('rx_standard');
    expect(tpl).not.toBeNull();
    const html = bindHtmlTemplate(tpl as string, { clinic_code: INSTNUM });
    expect(html).toContain(INSTNUM);
    expect(html).not.toContain('{{clinic_code}}');
  });

  test('스코프 가드: 렌더는 입력값 그대로 — 타지점 번호 하드코딩 없음', () => {
    // 데이터 구동 증명: 임의 다른 값을 넣으면 그 값이 나오고, 13328581이 새어들지 않음.
    const other = buildEdiExport(validInput('99999999'));
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(other.payload.header.institution_code).toBe('99999999');
      expect(other.payload.header.institution_code).not.toBe(INSTNUM);
    }
  });
});
