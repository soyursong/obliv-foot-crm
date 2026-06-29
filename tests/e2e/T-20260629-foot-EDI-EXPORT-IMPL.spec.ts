/**
 * E2E spec — T-20260629-foot-EDI-EXPORT-IMPL
 * 심평원 표준 청구명세서(요양급여비용 명세서) 표준 범용 logical export — 가드 SSOT 검증.
 *
 * SSOT: edi_export_data_contract_20260629.md (DA-20260629-EDI-EXPORT-CONTRACT)
 *
 * 현장 클릭 시나리오 3종(티켓 본문) → 가드 SSOT(buildEdiExport) 변환:
 *   시나리오1(정상 export 동선) → export OK + 표준 명세서 3계층(일반내역/상병/진료내역) +
 *                                  AA154/AA254 진찰료 + 본인부담구분코드 + 공단부담액 + ★전송(transmitted) 불생성.
 *   시나리오2(환수 가드)        → data_incomplete 차지 포함 청구 → export BLOCK(DATA_INCOMPLETE).
 *   시나리오3(요양기관기호 미설정) → export BLOCK(MISSING_INSTITUTION_CODE).
 * + 계약 가드 회귀: 본인부담구분코드 미접지 등급(AC-3) BLOCK / 적용률 미기록(AC-3) BLOCK /
 *                   D2 전송보류(AC-6) export_status enum 에 transmitted 부재 / D1 logical 포맷(AC-7).
 *
 * 실제 브라우저 로그인+청구 시드는 헤드리스 비용 과대 → 가드 로직(export 정합의 진실 원천)을
 * 순수 함수로 직접 검증(기존 spec 컨벤션: lib 직접 import).
 */
import { test, expect } from '@playwright/test';
import {
  buildEdiExport,
  copayClassCode,
  EDI_EXPORT_FORMAT_VERSION,
  exportPayloadRef,
  payloadFingerprint,
  type EdiExportInput,
  type EdiItemInput,
} from '../../src/lib/ediExport';

// ── 공통 픽스처 ─────────────────────────────────────────────
function generalLine(over: Partial<EdiItemInput> = {}): EdiItemInput {
  return {
    service_id: 'svc-aa154',
    service_name: '초진 진찰료',
    hira_code: 'AA154',
    hira_category: 'consultation',
    base_amount: 17610,
    copayment_amount: 5300,
    insurance_covered_amount: 12310,
    grade_at_charge: 'general',
    copayment_rate_at_charge: 0.3,
    is_insurance_covered: true,
    hira_score_at_charge: 197.0,
    ...over,
  };
}

function baseInput(over: Partial<EdiExportInput> = {}): EdiExportInput {
  return {
    claim: {
      claim_id: 'claim-1',
      clinic_nhis_code: '12345678',
      clinic_name: '오블리브 풋센터 종로',
      visit_date: '2026-06-29',
      patient_name: '홍길동',
      patient_chart_no: 'C-2026-00123',
      total_base: 17610,
      total_copayment: 5300,
      total_covered: 12310,
    },
    items: [generalLine()],
    diagnoses: [{ kcd_code: 'B35.1', is_primary: true, sort_order: 0 }],
    ...over,
  };
}

// ── 시나리오 1: 정상 export 동선 ─────────────────────────────
test('시나리오1: 정상 청구(일반·완전) → export OK + 표준 3계층 + AA154/공단부담/구분코드', () => {
  const res = buildEdiExport(baseInput());
  expect(res.ok).toBe(true);
  if (!res.ok) return;

  // ① 일반내역(헤더): 요양기관기호·총액·공단부담
  expect(res.payload.header.institution_code).toBe('12345678');
  expect(res.payload.header.total_covered).toBe(12310);

  // ② 상병내역: KCD 주상병
  expect(res.payload.diagnoses[0].kcd_code).toBe('B35.1');
  expect(res.payload.diagnoses[0].is_primary).toBe(true);

  // ③ 진료내역: AA154 진찰료 줄번호 + 공단부담 + 본인부담구분코드(일반='')
  const line = res.payload.items[0];
  expect(line.hira_code).toBe('AA154');
  expect(line.insurance_covered_amount).toBe(12310);
  expect(line.copayment_amount).toBe(5300);
  expect(line.copay_class_code).toBe(''); // 일반 = 별도 구분코드 없음(접지된 사실)

  // ★ D2: export payload 어디에도 전송(transmitted) 개념이 생성되지 않음
  expect(JSON.stringify(res.payload)).not.toContain('transmit');
});

test('시나리오1-b: 재진 진찰료 AA254 정상 export', () => {
  const res = buildEdiExport(
    baseInput({ items: [generalLine({ hira_code: 'AA254', service_name: '재진 진찰료' })] }),
  );
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.payload.items[0].hira_code).toBe('AA254');
});

// ── 시나리오 2: 환수 가드 (data_incomplete) ──────────────────
test('시나리오2: 공단부담 미산출(data_incomplete) 항목 포함 → export BLOCK(DATA_INCOMPLETE)', () => {
  // 급여 + hira_score NULL + 등급≠general = calc_copayment v1.2 data_incomplete=true 차지
  const res = buildEdiExport(
    baseInput({
      items: [
        generalLine(),
        generalLine({
          service_id: 'svc-x',
          service_name: '미완전 급여항목',
          hira_code: null,
          grade_at_charge: 'medical_aid_2',
          hira_score_at_charge: null,
          copayment_rate_at_charge: 0.15,
        }),
      ],
    }),
  );
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.block_code).toBe('DATA_INCOMPLETE');
});

// ── 시나리오 3: 요양기관기호 미설정 ──────────────────────────
test('시나리오3: 요양기관기호 미설정 → export BLOCK(MISSING_INSTITUTION_CODE)', () => {
  for (const code of [null, undefined, '', '   ']) {
    const res = buildEdiExport(baseInput({ claim: { ...baseInput().claim, clinic_nhis_code: code } }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.block_code).toBe('MISSING_INSTITUTION_CODE');
  }
});

// ── 계약 가드 회귀 ───────────────────────────────────────────
test('AC-3: 본인부담구분코드 미접지 등급(의료급여/차상위 등) → BLOCK(COPAY_CLASS_UNGROUNDED), 날조 금지', () => {
  for (const grade of ['medical_aid_1', 'medical_aid_2', 'low_income_1', 'infant', 'elderly_flat', 'unverified']) {
    // 완전 데이터(hira_score 보유)라도 구분코드 미접지면 BLOCK
    const res = buildEdiExport(
      baseInput({ items: [generalLine({ grade_at_charge: grade, hira_score_at_charge: 197, copayment_rate_at_charge: 0.15 })] }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.block_code).toBe('COPAY_CLASS_UNGROUNDED');
  }
  // 일반만 접지(grounded) — code 는 빈문자(없음)이며 추정 코드값을 만들지 않음
  expect(copayClassCode('general')).toEqual({ code: '', grounded: true });
  expect(copayClassCode('medical_aid_1').grounded).toBe(false);
  expect(copayClassCode('medical_aid_1').code).toBeNull();
});

test('AC-3: 급여 항목 적용률 미기록 → BLOCK(RATE_MISSING)', () => {
  const res = buildEdiExport(
    baseInput({ items: [generalLine({ copayment_rate_at_charge: null })] }),
  );
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.block_code).toBe('RATE_MISSING');
});

test('주상병 누락(상병 있으나 주상병 미지정) → BLOCK(NO_PRIMARY_DIAGNOSIS)', () => {
  const res = buildEdiExport(
    baseInput({ diagnoses: [{ kcd_code: 'B35.1', is_primary: false, sort_order: 0 }] }),
  );
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.block_code).toBe('NO_PRIMARY_DIAGNOSIS');
});

test('항목 0건 → BLOCK(NO_ITEMS)', () => {
  const res = buildEdiExport(baseInput({ items: [] }));
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.block_code).toBe('NO_ITEMS');
});

// ── AC-7(D1 범용 logical) / 산출물 참조(§5 PHI) ──────────────
test('AC-7: format_version 은 범용 logical(벤더 물리 레이아웃 종속 아님)', () => {
  expect(EDI_EXPORT_FORMAT_VERSION).toBe('hira-edi-logical-v1');
  expect(EDI_EXPORT_FORMAT_VERSION).toContain('logical');
});

test('§5 PHI: export 산출물 참조키에 환자 식별정보(이름·차트번호) 미포함', () => {
  const res = buildEdiExport(baseInput());
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const ref = exportPayloadRef('claim-1', payloadFingerprint(res.payload));
  expect(ref).not.toContain('홍길동');
  expect(ref).not.toContain('C-2026-00123');
  expect(ref).toContain('claim-1');
  expect(ref).toContain(EDI_EXPORT_FORMAT_VERSION);
});

test('AC-6(D2): 동일 청구 재산출 시 지문 일관(전송 상태 변이 없이 export 보관만 반복 가능)', () => {
  const a = buildEdiExport(baseInput());
  const b = buildEdiExport(baseInput());
  expect(a.ok && b.ok).toBe(true);
  if (a.ok && b.ok) expect(payloadFingerprint(a.payload)).toBe(payloadFingerprint(b.payload));
});
