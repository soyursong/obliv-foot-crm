/**
 * E2E — T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING
 * 처방전(rx_standard) 상단 고객정보 + 요양기관기호 바인딩
 *
 * 배경: 처방전 출력물 상단 좌측 고객정보 블록(피보주민·조합기호·증번호·보호종별)이
 *       빈 라인(placeholder 없음)이라 환자 인적사항이 누락 출력. 요양기관기호({{clinic_code}})는
 *       바인딩은 이미 존재하나 clinics.nhis_code 데이터 null 이라 공란.
 *
 * ⚠ SUPERSEDED (2026-07-19) — T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-①:
 *   김주연 총괄 현장 피드백으로 "좌측 상단 고객정보 과다노출 블록"(본 T-20260612 이 넣은
 *   환자정보/성명/생년월일/주민번호/연락처/주소 6줄 헤더)을 삭제함. 법정 필수 기재(환자 성명·
 *   주민등록번호, 의료법 시행규칙 §12)는 하단 요양급여 서식표에 존치하므로 §12 무위반.
 *   → 본 spec 의 AC-2(상단 헤더 블록 존재) 검증은 supersession 반영으로 재작성됨.
 *   AC-3(요양기관기호)·AC-4(회귀)·요양급여 서식표 필수필드 검증은 그대로 유효.
 *
 * 순수 함수(getHtmlTemplate / bindHtmlTemplate) 단위 검증 패턴
 * (참고: T-20260515-foot-FORM-ONELINE-RX.spec.ts).
 *
 * @see T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING
 * @see T-20260719-foot-RXPRINT-LAYOUT-4FIX (AC-① 상단 헤더 블록 삭제)
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ─── AC-① (RXPRINT-LAYOUT-4FIX) supersession: 상단 좌측 고객정보 헤더 블록 삭제 ───

test.describe('상단 좌측 고객정보 헤더 블록 삭제 (RXPRINT-LAYOUT-4FIX AC-①)', () => {
  test('상단 헤더 과다노출 필드(환자정보/생년월일/연락처/주소)는 rx_standard 에서 제거됨', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    const markup = html!.replace(/<!--[\s\S]*?-->/g, ''); // 주석 제외(이력 단어 잔존 가능)
    // 상단 헤더 블록 고유 라벨/토큰이 렌더 마크업에서 사라졌는지
    expect(markup).not.toContain('환자정보');
    expect(markup).not.toContain('{{record_no}}');
    expect(markup).not.toContain('{{patient_birthdate}}');
    expect(markup).not.toContain('{{patient_phone}}');
    expect(markup).not.toContain('{{patient_address}}');
  });

  test('법정 필수 기재(환자 성명·주민등록번호)는 하단 요양급여 서식표에 존치 (§12 무위반)', () => {
    const html = getHtmlTemplate('rx_standard');
    expect(html).not.toBeNull();
    // 서식표 필수필드 토큰 존치
    expect(html!).toContain('{{patient_name}}');
    expect(html!).toContain('{{patient_rrn}}');
    // 서식표 라벨 존치
    const markup = html!.replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).toContain('성');   // 성 명 라벨
    expect(markup).toContain('주');   // 주 민 번 호 라벨
  });

  test('바인딩 시 환자 성명·주민번호는 서식표에 정상 렌더 (필수필드 회귀 없음)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const bound = bindHtmlTemplate(html, {
      patient_name: '홍길동',
      patient_rrn: '900515-1******',
      rx_items_html: '',
    });
    expect(bound).toContain('홍길동');
    expect(bound).toContain('900515-1******');
    // 삭제된 헤더 과다노출 값은 주입해도 렌더되지 않음(토큰 제거됨)
    const bound2 = bindHtmlTemplate(html, {
      patient_address: '서울 종로구 종로 1',
      patient_phone: '010-1234-5678',
      rx_items_html: '',
    });
    expect(bound2).not.toContain('서울 종로구 종로 1');
    expect(bound2).not.toContain('010-1234-5678');
    // 미해소 플레이스홀더 잔존 없음
    expect(bound).not.toContain('{{patient_name}}');
    expect(bound).not.toContain('{{patient_rrn}}');
  });
});

// ─── AC-3: 요양기관기호 바인딩 + 빈값 fallback (유효 존속) ───

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

// ─── AC-4: 기존 처방전 항목 회귀 방지 ───

test.describe('AC-4 회귀 방지 — 기존 처방전 핵심 항목 유지', () => {
  const PRESERVED = [
    '{{rx_items_html}}',     // 처방 의약품 행
    '{{prescriber_name}}',   // 처방 의료인 성명(RX-DOCTOR-BIND)
    '{{doctor_seal_html}}',  // 도장
    '{{prescriber_license_no}}', // 처방 의료인 면허번호(RX-DOCTOR-BIND)
    '{{usage_days}}',        // 사용기간
    '{{rx_qr_html}}',        // QR
    '{{rx_copy_label}}',     // 약국/환자 보관용 라벨
    '{{diag_code_1}}',       // 질병분류기호(RXPRINT-LAYOUT-4FIX AC-③)
  ];

  test('처방 내용·용법·의사명·도장·QR·질병분류기호 등 기존 플레이스홀더 전부 유지', () => {
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
