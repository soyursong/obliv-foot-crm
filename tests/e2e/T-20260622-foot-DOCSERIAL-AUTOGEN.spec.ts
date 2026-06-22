/**
 * E2E Spec — T-20260622-foot-DOCSERIAL-AUTOGEN
 *
 * 서류 출력 연번호 자동 생성. DocumentPrintPanel 의 연번호 필드(visit_no)를 공란/임시값 대신
 * 규칙 기반으로 자동 채운다.
 *
 * 연번호 형식: {서류종류 prefix}-{발급일 YYYYMMDD}-{차트번호 F-XXXX}-{발급순번 2자리}
 *   예) VC-20260622-F-4302-01
 *
 * 발급순번 = 동일 환자 + 동일 서류종류(template) + 동일 발급일 form_submissions count + 1 (read-only).
 *   미리보기는 INSERT 안 함 → 반복 호출에도 seq 불변(idempotent). 출력 후 재오픈 시 count+1.
 *
 * AC 커버리지:
 *  - AC-1 형식 자동 생성: buildDocSerial 가 {prefix}-{YYYYMMDD}-{차트}-{NN} 반환
 *  - AC-2 발급순번 정합: seq → 2자리 zero-pad(01/02…), seq 변화 = 출력 이력 count 기반
 *  - AC-3 차트번호 교정: 미발번(null/빈값)이면 발번 보류(slice 임시값 fabrication 금지)
 *  - AC-4 prefix 중앙화: 확정 10종(REC/BILL/KOH/OPN/DIAG/VC/REF/AV/MR/RX) 단일 config,
 *                        표에 없는 form_key 는 안전 fallback(null = 발번 보류)
 *
 * 실행: npx playwright test T-20260622-foot-DOCSERIAL-AUTOGEN.spec.ts
 * NOTE: 연번호 생성 규칙(docSerial SSOT) 단위 검증 — 실서버 불필요. UI 바인딩(count 쿼리)은
 *       DocumentPrintPanel IssueDialog 가 이 헬퍼를 호출하며, seq 는 form_submissions read-only
 *       count 로 산출(스키마 변경 0).
 */

import { test, expect } from '@playwright/test';
import {
  DOC_SERIAL_PREFIX,
  docSerialPrefix,
  formatIssueSeq,
  buildDocSerial,
} from '../../src/lib/docSerial';

// ── 시나리오 1: 진료확인서 연번호 자동 표시 (AC-1) ───────────────────────────────

test('시나리오1: 진료확인서(treat_confirm) 연번호 = VC-{날짜}-{차트}-01', () => {
  const serial = buildDocSerial({
    formKey: 'treat_confirm',
    chartNo: 'F-4302',
    dateYYYYMMDD: '20260622',
    seq: 1,
  });
  expect(serial).toBe('VC-20260622-F-4302-01');
});

test('시나리오1: 형식 = {prefix}-{YYYYMMDD}-{차트}-{2자리순번} 정규식 일치', () => {
  const serial = buildDocSerial({
    formKey: 'diagnosis',
    chartNo: 'F-1234',
    dateYYYYMMDD: '20260622',
    seq: 3,
  });
  expect(serial).toBe('DIAG-20260622-F-1234-03');
  expect(serial).toMatch(/^[A-Z]+-\d{8}-F-\d+-\d{2}$/);
});

// ── 시나리오 2: 발급순번 증가 (AC-2) ──────────────────────────────────────────

test('시나리오2: 발급순번 2자리 zero-pad — 1→01, 2→02, 12→12', () => {
  expect(formatIssueSeq(1)).toBe('01');
  expect(formatIssueSeq(2)).toBe('02');
  expect(formatIssueSeq(12)).toBe('12');
});

test('시나리오2: 같은 환자·서류·날짜 두 번째 발급 → 끝 순번 -02', () => {
  const base = { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622' } as const;
  // 1회차: 기존 발급 0건 → count+1 = 1
  expect(buildDocSerial({ ...base, seq: 1 })).toBe('VC-20260622-F-4302-01');
  // 2회차: 기존 발급 1건 → count+1 = 2
  expect(buildDocSerial({ ...base, seq: 2 })).toBe('VC-20260622-F-4302-02');
});

test('시나리오2: 미리보기 반복(seq 불변) → 동일 연번호 (idempotent)', () => {
  const args = { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 1 } as const;
  // INSERT 전 count 불변 → 반복 호출 동일값
  const a = buildDocSerial(args);
  const b = buildDocSerial(args);
  expect(a).toBe(b);
  expect(a).toBe('VC-20260622-F-4302-01');
});

// ── 시나리오 3: 회귀 가드 — 차트 미발번/미등록 form_key/날짜·prefix 매핑 (AC-3/AC-4) ──

test('시나리오3: 차트번호 미발번(null/빈값) → 발번 보류(null, slice 임시값 미사용)', () => {
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: null, dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: '', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: '   ', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
});

test('시나리오3: 발급순번 미산출(count 진행 중, seq null) → 발번 보류(null)', () => {
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: null })).toBeNull();
});

test('시나리오3: 미등록 form_key(11번째+) → 안전 fallback(null = 발번 보류, 임의 prefix 금지)', () => {
  // 표에 없는 form_key — payment_cert/diag_opinion_v2/treat_confirm_code 등
  expect(docSerialPrefix('payment_cert')).toBeNull();
  expect(docSerialPrefix('treat_confirm_code')).toBeNull();
  expect(docSerialPrefix(undefined)).toBeNull();
  expect(buildDocSerial({ formKey: 'payment_cert', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
});

test('AC-4: prefix 단일 config — 확정 10종 정확 매핑(VC=진료확인서, AV=통원확인서 분리)', () => {
  expect(DOC_SERIAL_PREFIX).toEqual({
    bill_receipt: 'REC',
    bill_detail: 'BILL',
    koh_result: 'KOH',
    diag_opinion: 'OPN',
    diagnosis: 'DIAG',
    treat_confirm: 'VC',
    referral_letter: 'REF',
    visit_confirm: 'AV',
    medical_record_request: 'MR',
    rx_standard: 'RX',
  });
  expect(Object.keys(DOC_SERIAL_PREFIX)).toHaveLength(10);
  // VC/AV 분리 확정 — 진료확인서≠통원확인서
  expect(DOC_SERIAL_PREFIX.treat_confirm).toBe('VC');
  expect(DOC_SERIAL_PREFIX.visit_confirm).toBe('AV');
  expect(DOC_SERIAL_PREFIX.treat_confirm).not.toBe(DOC_SERIAL_PREFIX.visit_confirm);
});

test('AC-4: 10종 전체 — 각 form_key 가 올바른 prefix 로 연번호 생성', () => {
  const cases: Array<[string, string]> = [
    ['bill_receipt', 'REC'],
    ['bill_detail', 'BILL'],
    ['koh_result', 'KOH'],
    ['diag_opinion', 'OPN'],
    ['diagnosis', 'DIAG'],
    ['treat_confirm', 'VC'],
    ['referral_letter', 'REF'],
    ['visit_confirm', 'AV'],
    ['medical_record_request', 'MR'],
    ['rx_standard', 'RX'],
  ];
  for (const [formKey, prefix] of cases) {
    expect(buildDocSerial({ formKey, chartNo: 'F-0001', dateYYYYMMDD: '20260622', seq: 1 }))
      .toBe(`${prefix}-20260622-F-0001-01`);
  }
});
