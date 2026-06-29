/**
 * E2E Spec — T-20260622-foot-DOC-SERIAL-AUTOGEN
 *
 * 서류 출력 연번호 자동 생성. DocumentPrintPanel 의 연번호 필드(visit_no)를 공란/임시값 대신
 * 규칙 기반으로 자동 채운다.
 *
 * 연번호 형식: {서류종류 prefix}-{발급일 YYYYMMDD}-{차트번호 F-XXXX}-{발급순번 2자리}
 *   예) VC-20260622-F-4302-01
 *
 * 발급순번 = C(무리셋 통산) — 날짜·서류종류·환자 무관 클리닉 전역 단일 통산 카운터. 발번마다 +1, 리셋 없음.
 *   (확정: 김주연 총괄 2026-06-29 MSG-20260629-202802-cyn1 / FIX-REQUEST. 이전 'A.일별 리셋' 기각.)
 *   form_submissions read-only count(clinic 전역) 으로 산출 → DB 스키마 변경 0.
 *   미리보기는 INSERT 안 함 → 반복 호출에도 seq 불변(idempotent, AC-4 '재출력=불변').
 *   실 출력(INSERT) 후 재오픈 시 전역 count+1 → '신규 교부=통산 +1'(전체 연번호 항상 유일).
 *
 * AC 커버리지:
 *  - AC-1 형식 자동 생성: buildDocSerial 가 {prefix}-{YYYYMMDD}-{차트}-{NN} 반환
 *  - AC-2 서류종류코드 매핑: 확정 10종(REC/BILL/KOH/OPN/DIAG/VC/REF/AV/MR/RX) 단일 config
 *  - AC-3 무리셋 통산(C): 날짜·서류종류 무관 단일 통산 — 리셋 없음, 발번마다 +1
 *  - AC-4 발번 멱등/유일: 재출력(seq 불변)=동일값 / 신규 교부(seq+1)=유일값
 *  - AC-5 차트 미발번/미등록 form_key → 발번 보류(slice 임시값 fabrication 금지)
 *
 * 실행: npx playwright test T-20260622-foot-DOCSERIAL-AUTOGEN.spec.ts
 * NOTE: 연번호 생성 규칙(docSerial SSOT) 단위 검증 — 실서버 불필요. seq 산출(클리닉 전역 통산 count)은
 *       DocumentPrintPanel IssueDialog 가 form_submissions read-only count(파티션 없음)로 수행(스키마 변경 0).
 */

import { test, expect } from '@playwright/test';
import {
  DOC_SERIAL_PREFIX,
  docSerialPrefix,
  formatIssueSeq,
  buildDocSerial,
} from '../../src/lib/docSerial';

// ── 시나리오 1: 연번호 자동 표시 (AC-1) ───────────────────────────────────────────

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

// ── 시나리오 2: 발번 멱등(재출력=불변) vs 신규 교부(+1) (AC-4) ──────────────────────

test('시나리오2: 발급순번 2자리 zero-pad — 1→01, 2→02, 12→12, 통산 100→100(자릿수 확장)', () => {
  expect(formatIssueSeq(1)).toBe('01');
  expect(formatIssueSeq(2)).toBe('02');
  expect(formatIssueSeq(12)).toBe('12');
  // 무리셋 통산은 99 초과 가능 — 표기 자릿수는 그대로 확장(2자리 zero-pad 최소만 보장)
  expect(formatIssueSeq(100)).toBe('100');
});

test('시나리오2: 재출력(미리보기 반복, seq 불변) → 동일 연번호 (idempotent, AC-4 재출력=불변)', () => {
  const args = { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 7 } as const;
  // INSERT 전 전역 count 불변 → 반복 호출 동일값
  const a = buildDocSerial(args);
  const b = buildDocSerial(args);
  expect(a).toBe(b);
  expect(a).toBe('VC-20260622-F-4302-07');
});

test('시나리오2: 신규 교부 → 전역 통산 +1 (AC-4 신규=증가)', () => {
  const base = { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622' } as const;
  // 직전 전역 발행 6건 → 다음 seq = 7
  expect(buildDocSerial({ ...base, seq: 7 })).toBe('VC-20260622-F-4302-07');
  // 신규 교부 1건 더 → 전역 count 7 → seq 8
  expect(buildDocSerial({ ...base, seq: 8 })).toBe('VC-20260622-F-4302-08');
});

// ── 시나리오 3: C(무리셋 통산) — 날짜·서류종류 무관 단일 카운터 (AC-3) ──────────────────

test('시나리오3: 다음날 첫 발행도 001 리셋 없이 통산 이어짐 (무리셋)', () => {
  // 06-22 마지막 발번 seq=8 → 06-23 첫 발번은 01 이 아니라 통산 9
  const d0623 = buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260623', seq: 9 });
  expect(d0623).toBe('VC-20260623-F-4302-09');
  // 날짜(YYYYMMDD)는 바뀌었지만 발급순번은 통산 9 — 일별 리셋 아님
  expect(d0623).not.toMatch(/-01$/);
});

test('시나리오3: 다른 서류종류로 발행해도 같은 통산 카운터로 증가 (날짜·서류종류 무관)', () => {
  // 통산 카운터를 모사: 발번 순서대로 seq 가 1씩 증가하며 서류종류/날짜가 달라도 reset 없음
  const sequence = [
    { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 5 }, // VC
    { formKey: 'diagnosis',     chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 6 }, // DIAG (서류종류 변경)
    { formKey: 'koh_result',    chartNo: 'F-1010', dateYYYYMMDD: '20260623', seq: 7 }, // KOH (날짜·환자 변경)
  ];
  const serials = sequence.map(buildDocSerial);
  expect(serials).toEqual([
    'VC-20260622-F-4302-05',
    'DIAG-20260622-F-4302-06',
    'KOH-20260623-F-1010-07',
  ]);
  // 발급순번만 추출 → 5,6,7 단조 증가(서류종류·날짜 무관 단일 통산)
  const seqs = serials.map((s) => Number(s!.slice(s!.lastIndexOf('-') + 1)));
  expect(seqs).toEqual([5, 6, 7]);
});

// ── 시나리오 3b: 같은환자+같은서류+같은날 신규 교부 시 코드 유일성 (AC-4) ─────────────────

test('시나리오3b: 동일 환자·서류·날짜 신규 2건 교부 → 발급순번 달라 전체 코드 유일', () => {
  const base = { formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622' } as const;
  // 별건 2회 교부 → 통산 카운터 7, 8 (같은 환자/서류/날짜라도 순번만 증가)
  const a = buildDocSerial({ ...base, seq: 7 });
  const b = buildDocSerial({ ...base, seq: 8 });
  expect(a).toBe('VC-20260622-F-4302-07');
  expect(b).toBe('VC-20260622-F-4302-08');
  expect(a).not.toBe(b); // 전체 연번호 중복 없음
});

// ── 시나리오 4(회귀 가드): 차트 미발번/미등록 form_key/순번 미산출 → 발번 보류 (AC-5) ────────

test('회귀: 차트번호 미발번(null/빈값) → 발번 보류(null, slice 임시값 미사용)', () => {
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: null, dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: '', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: '   ', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
});

test('회귀: 발급순번 미산출(count 진행 중, seq null) → 발번 보류(null)', () => {
  expect(buildDocSerial({ formKey: 'treat_confirm', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: null })).toBeNull();
});

test('회귀: 미등록 form_key(11번째+) → 안전 fallback(null = 발번 보류, 임의 prefix 금지)', () => {
  expect(docSerialPrefix('payment_cert')).toBeNull();
  expect(docSerialPrefix('treat_confirm_code')).toBeNull();
  expect(docSerialPrefix(undefined)).toBeNull();
  expect(buildDocSerial({ formKey: 'payment_cert', chartNo: 'F-4302', dateYYYYMMDD: '20260622', seq: 1 })).toBeNull();
});

// ── AC-2: 서류종류코드 단일 config (확정 10종) ──────────────────────────────────────

test('AC-2: prefix 단일 config — 확정 10종 정확 매핑(VC=진료확인서, AV=통원확인서 분리)', () => {
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

test('AC-2: 10종 전체 — 각 form_key 가 올바른 prefix 로 연번호 생성', () => {
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
