/**
 * E2E — T-20260719-foot-RXPRINT-LAYOUT-4FIX
 * 처방전(rx_standard) 서식 4건 레이아웃·바인딩 수정 (김주연 총괄 현장 피드백)
 *
 * AC-①: 좌측 상단 고객정보(빨간박스) 과다노출 블록 삭제.
 *        - (구) RX-TOPBAR-PATIENT-HIRA-MISSING 헤더 6줄(환자정보/성명/생년월일/주민번호/연락처/주소) 제거.
 *        - ★법정 필수 기재(환자 성명·주민등록번호, 의료법 시행규칙 §12)는 하단 요양급여 서식표에 존치.
 *        - ★RX-DOCTOR-BIND 처방의료인 빨간박스(성명·면허)와는 다른 블록 — 무접촉·무회귀.
 * AC-②: 환자 성명/주민번호 기입칸 아래 빈 여백(구 4행 좌측 빈 td 2개) 제거.
 *        - 주민번호 라벨·값 셀을 rowspan=2 로 확장해 빈 박스 흡수. E-mail 행 정렬 존치.
 * AC-③: 질병분류기호 칸에 결제미니창 선택 상병코드 바인딩(diag_code_N).
 *        - 템플릿 토큰 존치 + 렌더 검증. (컴포넌트 폴백=check_in_services 는 현장/실DB 검증 축.)
 * AC-④: 조제시 참고사항 블록 좌측 확장(비율 정합) — 주사제 처방내역 폭 310→200px, 라벨 70→90px.
 *
 * 순수 함수(getHtmlTemplate / bindHtmlTemplate) 단위 검증 패턴.
 *
 * @see T-20260719-foot-RXPRINT-LAYOUT-4FIX
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

// ─── AC-①: 좌측 상단 고객정보 과다노출 블록 삭제 ───

test.describe('AC-① 좌측 상단 고객정보 블록 삭제', () => {
  test('상단 헤더 과다노출 필드(환자정보/생년월일/연락처/주소/등록번호) 토큰 제거됨', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    const markup = stripComments(html!);
    expect(markup).not.toContain('환자정보');
    expect(markup).not.toContain('{{record_no}}');
    expect(markup).not.toContain('{{patient_birthdate}}');
    expect(markup).not.toContain('{{patient_phone}}');
    expect(markup).not.toContain('{{patient_address}}');
  });

  test('법정 필수 기재(환자 성명·주민등록번호)는 하단 서식표에 존치 (§12 무위반)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('{{patient_name}}');
    expect(html).toContain('{{patient_rrn}}');
    const bound = bindHtmlTemplate(html, {
      patient_name: '김환자', patient_rrn: '790415-2******', rx_items_html: '',
    });
    expect(bound).toContain('김환자');
    expect(bound).toContain('790415-2******');
  });

  test('처방의료인 빨간박스(RX-DOCTOR-BIND 성명·면허) 무회귀 — 별개 블록 존치', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('{{prescriber_name}}');
    expect(html).toContain('{{prescriber_license_no}}');
    expect(html).toContain('{{doctor_seal_html}}');
    const markup = stripComments(html);
    expect(markup).toContain('처'); // 처방의료인의 성명 라벨
    expect(markup).toContain('면'); // 면허종별/면허번호 라벨
  });

  test('제목 "처방전"은 중앙정렬 유지 + QR 존치', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('rx-title');
    expect(html).toContain('{{rx_qr_html}}');
    expect(html).toContain('{{rx_copy_label}}');
  });
});

// ─── AC-②: 성명/주민번호 아래 빈 여백 제거 ───

test.describe('AC-② 성명/주민번호 하단 빈 여백 제거', () => {
  test('주민번호 라벨·값 셀이 rowspan=2 로 확장되어 빈 td 흡수', () => {
    const html = getHtmlTemplate('rx_standard')!;
    // 주민번호 라벨 셀 rowspan=2 (빈 여백 흡수)
    expect(html).toMatch(/rowspan="2"[^>]*>주&nbsp;민&nbsp;번&nbsp;호/);
    // 주민번호 값 셀도 rowspan=2 + patient_rrn 토큰
    expect(html).toMatch(/rowspan="2"[^>]*>\{\{patient_rrn\}\}/);
  });

  test('E-mail 주소 행 + clinic_email 바인딩 정렬 존치 (의료기관 4행 유지)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('E-mail');
    expect(html).toContain('{{clinic_email}}');
    const bound = bindHtmlTemplate(html, { clinic_email: 'official@obliv.kr', rx_items_html: '' });
    expect(bound).toContain('official@obliv.kr');
  });

  test('주민번호 아래 좌측 빈 셀(구 <td></td><td></td>) 잔존 없음', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const markup = stripComments(html);
    // rx_standard 서식표에서 연속 빈 셀 2개 → E-mail 행 패턴이 사라졌는지 (rowspan 흡수)
    expect(markup).not.toMatch(/<td>\s*<\/td>\s*<td>\s*<\/td>\s*<td[^>]*>E-mail/);
    // rx_standard 내 바(bare) 빈 셀 자체가 없음(⑥ 조제시 참고사항은 rowspan/colspan 셀)
    expect(markup).not.toMatch(/<td>\s*<\/td>/);
  });
});

// ─── AC-③: 질병분류기호 상병코드 바인딩 ───

test.describe('AC-③ 질병분류기호(diag_code) 바인딩', () => {
  test('질병분류기호 라벨 + diag_code_1~4 토큰 존치', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('질병분류기호');
    for (const n of [1, 2, 3, 4]) {
      expect(html).toContain(`{{diag_code_${n}}}`);
    }
    // 3·4행 가시성 플래그 토큰
    expect(html).toContain('{{diag_row_3_style}}');
    expect(html).toContain('{{diag_row_4_style}}');
  });

  test('상병코드 주입 시 질병분류기호 칸에 렌더', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, {
      diag_code_1: 'L600', diag_code_2: 'B351',
      diag_row_3_style: 'display:none', diag_row_4_style: 'display:none',
      rx_items_html: '',
    });
    expect(bound).toContain('L600');
    expect(bound).toContain('B351');
  });

  test('상병코드 미선택(폴백) 시 질병분류기호 빈칸 렌더 — 오류/잔존 토큰 없음', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, { rx_items_html: '' }); // diag_code 미전달
    // 라벨은 남고 미해소 토큰은 없음
    expect(bound).toContain('질병분류기호');
    expect(bound).not.toContain('{{diag_code_1}}');
    expect(bound).not.toContain('{{diag_code_2}}');
  });
});

// ─── AC-④: 조제시 참고사항 좌측 확장 ───

test.describe('AC-④ 조제시 참고사항 좌측 확장(비율 정합)', () => {
  test('주사제 처방내역 셀 폭 200px 로 축소 (구 310px)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('width:200px;');
    // 구 310px 폭은 주사제 처방내역 셀에서 제거됨
    const markup = stripComments(html);
    expect(markup).not.toMatch(/width:310px;[^]*주사제/);
  });

  test('조제시 참고사항 라벨 폭 90px 로 확장 (구 70px) + 라벨 존치', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('조제시');
    expect(html).toContain('참고사항');
    expect(html).toMatch(/width:90px;[^>]*>조제시/);
  });
});

// ─── 회귀: 처방전 핵심 필드 총점검 ───

test.describe('회귀 — 처방전 핵심 플레이스홀더 유지', () => {
  test('약품·용법·처방의료인·도장·QR·요양기관기호·사용기간 전부 유지', () => {
    const html = getHtmlTemplate('rx_standard')!;
    for (const v of [
      '{{rx_items_html}}', '{{prescriber_name}}', '{{doctor_seal_html}}',
      '{{prescriber_license_no}}', '{{usage_days}}', '{{rx_qr_html}}',
      '{{clinic_code}}', '{{issue_date}}', '{{issue_no}}', '{{hira_institution_name}}',
    ]) {
      expect(html).toContain(v);
    }
  });
});
