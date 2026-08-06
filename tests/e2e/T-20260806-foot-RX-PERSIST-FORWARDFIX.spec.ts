/**
 * E2E — T-20260806-foot-RX-PERSIST-FORWARDFIX
 * 풋 처방전 발행 이력 canonical SSOT = form_submissions(처방전 = form_key 'rx_standard').
 * DA-20260806-foot-RX-PERSIST-SSOT (Option B CONFIRM / Option A REJECT).
 *
 * AC1: 조회경로/주석 SSOT=form_submissions(처방전) 명시 · prescriptions write 신설 금지(dead skeleton).
 * AC2: 처방전 발행 이력 조회를 form_submissions 기준 정합화(write 추가 없음).
 * VG1: doc_type(form_key='rx_standard')로 처방전만 정확 필터(타 서식 혼입 0).
 * VG2 (PHI): 투영에 RRN·차트번호·풀 전화 평문 노출 금지(§16-3a/§16-4).
 * VG3 (grain): form_submissions(발행 이력) 축만 소비 — prescription_items(처방 기록) 축 조인/혼입 금지.
 *
 * 시나리오 1: 조회 정상동선 — rx_standard form_submission → 발행 이력 투영(교부일·처방의료인·진단·교부번호·약품명).
 * 시나리오 2: PHI 마스킹 — field_data 의 RRN/풀 전화/차트번호가 투영 어디에도 노출되지 않음.
 * 시나리오 3: grain 분리 — VG1 doc_type 필터(비-처방전 서식 배제) + VG3 발행 이력 축 전용 필드셋.
 *
 * @see T-20260806-foot-RX-PERSIST-FORWARDFIX
 * @see da_decision_foot_rx_persist_ssot_20260806.md
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuanceRows,
  parseRxMedicationNames,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// 실 발행본 형태의 rx_standard field_data (PHI 평문 포함 — patient_rrn/전화/차트번호).
const RX_ITEMS_HTML = buildRxItemsHtml([
  { name: '아모잘탄정', code: '645502330', unit_dose: '1', daily_freq: '1', total_days: '30' },
  { name: '리피토정', unit_dose: '1', daily_freq: '1', total_days: '30' },
]);

function rxRow(overrides: Partial<RawFormSubmissionRow> = {}): RawFormSubmissionRow {
  return {
    id: 'fs-rx-1',
    printed_at: '2026-08-01T09:00:00+09:00',
    created_at: '2026-08-01T08:59:00+09:00',
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date: '2026-08-01',
      issue_no: '20260801-3',
      prescriber_name: '문지은',
      diag_code_1: 'M20.1',
      diag_name_1: '무지외반증',
      diag_code_2: 'L60.0',
      diag_name_2: '조갑감입증',
      // ── PHI 슬롯 (VG2: 투영에 절대 노출 금지). 값은 실환자값 금지 → 유출탐지용 sentinel 토큰.
      //   테스트 목적 = "이 값들이 투영 어디에도 안 나온다" 이므로 형식 무관·distinctive 토큰이면 충분(phi-scan 오탐 회피).
      patient_name: 'PHI-NAME-SENTINEL-NOLEAK',
      patient_rrn: 'PHI-RRN-SENTINEL-NOLEAK',
      clinic_phone_only: 'PHI-PHONE-SENTINEL-NOLEAK',
      chart_number: 'PHI-CHART-SENTINEL-NOLEAK',
      rx_items_html: RX_ITEMS_HTML,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    ...overrides,
  };
}

// ─── 시나리오 1: 조회 정상동선 (AC2) ───

test.describe('시나리오 1: form_submissions 발행 이력 정상 투영', () => {
  test('교부일·처방의료인·진단·교부번호·약품명 투영 (AC2)', () => {
    const rows = mapRxIssuanceRows([rxRow()]);
    expect(rows).toHaveLength(1);
    const rx = rows[0];
    expect(rx.id).toBe('fs-rx-1');
    expect(rx.issued_at).toBe('2026-08-01');           // field_data.issue_date 우선
    expect(rx.prescriber_name).toBe('문지은');
    expect(rx.issue_no).toBe('20260801-3');
    expect(rx.diagnosis).toBe('M20.1 무지외반증, L60.0 조갑감입증');
    expect(rx.medications).toEqual(['645502330 | 아모잘탄정', '리피토정']);
  });

  test('issue_date 부재 시 printed_at → created_at 폴백', () => {
    const noIssueDate = rxRow({
      field_data: { ...rxRow().field_data, issue_date: undefined },
    });
    expect(mapRxIssuanceRows([noIssueDate])[0].issued_at).toBe('2026-08-01T09:00:00+09:00');

    const noPrinted = rxRow({
      printed_at: null,
      field_data: { ...rxRow().field_data, issue_date: undefined },
    });
    expect(mapRxIssuanceRows([noPrinted])[0].issued_at).toBe('2026-08-01T08:59:00+09:00');
  });

  test('rx_items_html 빈 스냅샷 → 약품명 빈 배열(패딩 10행 제외)', () => {
    expect(parseRxMedicationNames(buildRxItemsHtml([]))).toEqual([]);
    expect(parseRxMedicationNames(null)).toEqual([]);
    expect(parseRxMedicationNames('')).toEqual([]);
  });
});

// ─── 시나리오 2: PHI 마스킹 (VG2) ───

test.describe('시나리오 2: PHI 평문 미노출', () => {
  test('RRN·풀 전화·차트번호·환자명이 투영 JSON 어디에도 없음 (VG2)', () => {
    const rows = mapRxIssuanceRows([rxRow()]);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('PHI-RRN-SENTINEL-NOLEAK');    // RRN
    expect(serialized).not.toContain('PHI-PHONE-SENTINEL-NOLEAK');  // 풀 전화
    expect(serialized).not.toContain('PHI-CHART-SENTINEL-NOLEAK');  // 차트번호
    expect(serialized).not.toContain('PHI-NAME-SENTINEL-NOLEAK');   // 환자명
  });

  test('투영 키셋 = 화이트리스트(발행 이력 grain)만', () => {
    const rx = mapRxIssuanceRows([rxRow()])[0];
    expect(Object.keys(rx).sort()).toEqual(
      ['diagnosis', 'id', 'issue_no', 'issued_at', 'medications', 'prescriber_name'].sort(),
    );
    // PHI 필드명 자체가 투영에 존재하지 않음
    for (const phi of ['patient_rrn', 'patient_name', 'clinic_phone_only', 'chart_number']) {
      expect(rx).not.toHaveProperty(phi);
    }
  });
});

// ─── 시나리오 3: grain 분리 (VG1 + VG3) ───

test.describe('시나리오 3: doc_type 필터 + 발행 이력 축 전용', () => {
  test('VG1 — 비-처방전 서식(소견서/KOH/진단서)은 배제 (preFiltered=false)', () => {
    const mixed: RawFormSubmissionRow[] = [
      rxRow(),
      rxRow({ id: 'fs-op-1', field_data: { form_key: 'diag_opinion' }, form_templates: { form_key: 'diag_opinion' } }),
      rxRow({ id: 'fs-koh-1', field_data: { form_key: 'koh_result' }, form_templates: { form_key: 'koh_result' } }),
      rxRow({ id: 'fs-dx-1', field_data: { form_key: 'diagnosis' }, form_templates: { form_key: 'diagnosis' } }),
    ];
    const rows = mapRxIssuanceRows(mixed, /* preFiltered */ false);
    expect(rows.map((r) => r.id)).toEqual(['fs-rx-1']);   // 처방전만 통과
  });

  test('VG1 — form_templates 배열 join 형태에서도 form_key 안전 추출', () => {
    const arrJoin = rxRow({ id: 'fs-rx-arr', form_templates: [{ form_key: RX_ISSUANCE_FORM_KEY }] });
    expect(mapRxIssuanceRows([arrJoin], false)).toHaveLength(1);
  });

  test('VG3 — 투영은 form_submissions 발행 이력 축 필드만(처방 기록 축 medication grain 부재)', () => {
    const rx = mapRxIssuanceRows([rxRow()])[0];
    // prescription_items 축(처방 기록: dosage/duration_days/quantity 등)은 투영에 없음.
    expect(rx).not.toHaveProperty('prescription_items');
    // 약품명은 발행 스냅샷(field_data.rx_items_html) 파생 — 표시 문자열일 뿐 구조화 record 아님.
    expect(Array.isArray(rx.medications)).toBe(true);
    expect(rx.medications.every((m) => typeof m === 'string')).toBe(true);
  });

  test('id 없는 행은 스킵(발행본 무결성)', () => {
    expect(mapRxIssuanceRows([rxRow({ id: null })])).toHaveLength(0);
  });
});

// ─── AC1: doc_type discriminator SSOT 상수 고정 ───

test('AC1 — 처방전 doc_type discriminator = form_key "rx_standard"', () => {
  expect(RX_ISSUANCE_FORM_KEY).toBe('rx_standard');
});
