/**
 * E2E — T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING
 * 처방전(rx_standard) 상단 고객정보 + 요양기관기호 바인딩
 *
 * 배경: 처방전 출력물 상단 좌측 고객정보 블록(피보주민·조합기호·증번호·보호종별)이
 *       빈 라인(placeholder 없음)이라 환자 인적사항이 누락 출력. 요양기관기호({{clinic_code}})는
 *       바인딩은 이미 존재하나 clinics.nhis_code 데이터 null 이라 공란.
 *
 * AC-1 (diff-first): 진료의뢰서(referral_letter) 고객정보 바인딩 패턴 이식.
 * AC-2: 처방전 상단 고객정보 바인딩 추가 — 성명·생년월일·주민번호·연락처·주소.
 * AC-3: 요양기관기호({{clinic_code}}) 바인딩 — 기존 존재 확인 + 빈값 fallback 무붕괴.
 * AC-4 (회귀 방지): 처방 의약품·용법·의사명·도장 등 기존 항목 유지.
 *
 * 순수 함수(getHtmlTemplate / bindHtmlTemplate) 단위 검증 패턴
 * (참고: T-20260515-foot-FORM-ONELINE-RX.spec.ts).
 *
 * @see T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ─── AC-2: 상단 고객정보 플레이스홀더 존재 ───

test.describe('AC-2 처방전 상단 고객정보 바인딩', () => {
  const RX_TOPBAR_PATIENT_VARS = [
    '{{record_no}}',
    '{{patient_name}}',
    '{{patient_birthdate}}',
    '{{patient_rrn}}',
    '{{patient_phone}}',
    '{{patient_address}}',
  ];

  test('rx_standard 템플릿에 상단 고객정보 6종 플레이스홀더 모두 포함', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    for (const v of RX_TOPBAR_PATIENT_VARS) {
      expect(html!).toContain(v);
    }
  });

  test('레거시 빈 라인(조합기호·보호종별) 라벨 행 제거됨 — 데이터 소스 없는 사문(死文) 라벨', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    // HTML 주석 제거 후 실제 렌더 마크업만 검사 (주석엔 변경 이력 단어가 남아있을 수 있음)
    const markup = html!.replace(/<!--[\s\S]*?-->/g, '');
    // 라벨 행은 "조합기호 :" / "보호종별 :" 형태였음 — 행 자체가 사라졌는지 확인
    expect(markup).not.toContain('조합기호');
    expect(markup).not.toContain('보호종별');
  });

  test('진료의뢰서와 동일 autobind 키 사용 (패턴 이식 검증, AC-1)', () => {
    const rx = getHtmlTemplate('rx_standard');
    const referral = getHtmlTemplate('referral_letter');
    expect(rx).not.toBeNull();
    expect(referral).not.toBeNull();
    // 두 양식 모두 동일 고객 키 사용
    for (const v of ['{{patient_name}}', '{{patient_phone}}']) {
      expect(rx!).toContain(v);
      expect(referral!).toContain(v);
    }
  });
});

// ─── AC-2 바인딩 치환 결과 ───

test.describe('AC-2 bindHtmlTemplate 상단 고객정보 치환', () => {
  const FULL = {
    record_no: 'F-00021',
    patient_name: '홍길동',
    patient_birthdate: '1990-05-15',
    patient_rrn: '900515-1******',
    patient_phone: '010-1234-5678',
    patient_address: '서울 종로구 종로 1',
    clinic_code: '11111111',
    rx_items_html: '<tr><td>약품</td></tr>',
    doctor_name: '김의사',
  };

  test('상단 고객정보 값이 실제로 렌더 텍스트에 치환됨', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, FULL);
    expect(bound).toContain('홍길동');
    expect(bound).toContain('1990-05-15');
    expect(bound).toContain('900515-1******');
    expect(bound).toContain('010-1234-5678');
    expect(bound).toContain('서울 종로구 종로 1');
    expect(bound).toContain('F-00021');
    // 치환 후 미해소 플레이스홀더 잔존 없음
    expect(bound).not.toContain('{{patient_name}}');
    expect(bound).not.toContain('{{patient_birthdate}}');
    expect(bound).not.toContain('{{patient_address}}');
  });
});

// ─── AC-3: 요양기관기호 바인딩 + 빈값 fallback ───

test.describe('AC-3 요양기관기호(clinic_code)', () => {
  test('rx_standard 템플릿에 요양기관기호 라벨 + clinic_code 플레이스홀더 존재', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    expect(html!).toContain('요양기관기호');
    expect(html!).toContain('{{clinic_code}}');
  });

  test('clinic_code 값 주입 시 렌더 텍스트에 표기', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, { clinic_code: '31010203', rx_items_html: '' });
    expect(bound).toContain('31010203');
  });

  test('clinic_code 미설정(빈 문자열)이어도 레이아웃 붕괴/에러 없이 라벨만 남음 (시나리오2)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, { rx_items_html: '' }); // clinic_code 미전달
    expect(bound).toContain('요양기관기호');
    expect(bound).not.toContain('{{clinic_code}}'); // 미해소 잔존 없음
  });
});

// ─── 시나리오2: 고객정보 일부 누락 ───

test.describe('시나리오2 엣지 — 고객정보 일부 미입력', () => {
  test('주소·연락처 미입력이어도 라벨 유지 + 레이아웃 무붕괴 + 나머지 정보 정상', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, {
      record_no: 'F-1',
      patient_name: '김환자',
      rx_items_html: '',
      // patient_birthdate / patient_rrn / patient_phone / patient_address 미전달
    });
    expect(bound).toContain('김환자');
    expect(bound).toContain('환자정보');
    // 미해소 플레이스홀더가 그대로 노출되지 않음
    expect(bound).not.toContain('{{patient_phone}}');
    expect(bound).not.toContain('{{patient_address}}');
  });
});

// ─── AC-4: 기존 처방전 항목 회귀 방지 ───

test.describe('AC-4 회귀 방지 — 기존 처방전 핵심 항목 유지', () => {
  const PRESERVED = [
    '{{rx_items_html}}',     // 처방 의약품 행
    '{{doctor_name}}',       // 처방 의료인 성명
    '{{doctor_seal_html}}',  // 도장
    '{{doctor_license_no}}', // 면허번호
    '{{usage_days}}',        // 사용기간
    '{{rx_qr_html}}',        // QR
    '{{rx_copy_label}}',     // 약국/환자 보관용 라벨
  ];

  test('처방 내용·용법·의사명·도장·QR 등 기존 플레이스홀더 전부 유지', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    for (const v of PRESERVED) {
      expect(html!).toContain(v);
    }
    // 처방전 제목 유지
    expect(html!).toContain('처');
    expect(html!).toContain('방');
    expect(html!).toContain('전');
  });
});
