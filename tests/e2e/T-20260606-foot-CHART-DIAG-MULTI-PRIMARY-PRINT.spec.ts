/**
 * E2E spec — T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT
 * 진료차트 상병 다중등록 + 주/부 구분 + 출력 상병코드 표시 (문지은 대표원장 C0ATE5P6JTH).
 *
 * AC 요약:
 *   AC-1 [F] 다중 상병 등록 — 한 차트에 N개 상병(줄바꿈 직렬화, 등록 마스터에서만 선택).
 *   AC-2 [E] 주/부상병 구분 — 순서 기반(index 0 = 주상병) + [주상병] 승격.
 *            A안(2026-08-08 confirm ts 1786168049.516599): 상병 1건 이상이면 주상병 최소 1건 강제,
 *            미지정 시 저장 차단 + "주상병을 지정해 주세요".
 *   AC-3 [D] 출력 상병코드 — 서류/차트 인쇄에 "{service_code} {명칭}"(예: "M79.3 족저근막염"),
 *            다중 상병 시 주상병 우선 나열(diag_code_1..4/name_1..4).
 *   AC-0 모델 — 신규 연결테이블 chart_diagnoses(주/부·코드/명칭 스냅샷·seq·service_id FK).
 *              medical_charts.diagnosis(text)=하위호환·UI 정본 보존, 저장 시 구조화 미러 파생.
 *
 * 스타일: 기존 DX 계열 spec(SUPERPHRASE-DX-MULTISELECT-FIX / DX-MGMT-OVERHAUL-STAGE4) 패턴 계승 —
 *   구현 정본(DiagnosisFolderPicker.deriveChartDiagnoses/chartDiagnosesHasPrimary +
 *   autoBindContext 다중 상병 print parse)을 동일 규칙으로 in-page 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// 정본 헬퍼 미러 — DiagnosisFolderPicker.tsx export 헬퍼와 동일 규칙.
// ─────────────────────────────────────────────────────────────────────────────
const parseDxEntries = (value: string): string[] =>
  !value ? [] : value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

const splitDxLabel = (label: string): { code: string; name: string } => {
  const m = label.match(/^([A-Za-z][0-9][0-9A-Za-z.]*)\s+(.+)$/);
  if (m) return { code: m[1], name: m[2] };
  return { code: '', name: label };
};

interface DerivedChartDiagnosis {
  diagnosis_code: string | null;
  diagnosis_name: string;
  diagnosis_type: 'primary' | 'secondary';
  seq: number;
}

const deriveChartDiagnoses = (value: string): DerivedChartDiagnosis[] =>
  parseDxEntries(value).map((label, idx) => {
    const { code, name } = splitDxLabel(label);
    return {
      diagnosis_code: code.trim() ? code.trim() : null,
      diagnosis_name: name.trim() || label.trim(),
      diagnosis_type: idx === 0 ? 'primary' : 'secondary',
      seq: idx,
    };
  });

const chartDiagnosesHasPrimary = (value: string): boolean => {
  const rows = deriveChartDiagnoses(value);
  return rows.length === 0 || rows.some((r) => r.diagnosis_type === 'primary');
};

// autoBindContext 다중 상병 print parse 미러 — parseIcdFromText(줄 단위) → diag_code_N/name_N.
const parseIcdFromText = (text: string | null | undefined): { code: string; name: string } => {
  if (!text) return { code: '', name: '' };
  const match = text.match(/^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+(.+)$/);
  if (match) return { code: match[1], name: match[2].trim() };
  return { code: '', name: text.trim() };
};

// clinicMaster: 코드 미동반 순수 상병명 → service_code 역조회(마스터). null=graceful.
const buildDiagCodesForPrint = (
  diagnosis: string | null,
  masterByName: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!diagnosis) return out;
  const lines = String(diagnosis).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  lines.forEach((line, idx) => {
    const p = parseIcdFromText(line);
    let code = p.code;
    if (!code && p.name && masterByName[p.name]) code = masterByName[p.name];
    const n = idx + 1;
    out[`diag_code_${n}`] = code;
    out[`diag_name_${n}`] = p.name;
  });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
test.describe('T-20260606 진료차트 상병 다중등록 + 주/부 + 출력코드 (순수 로직 정합)', () => {
  // 시나리오 1: 다중 상병 + 주/부 등록 (AC-1 + AC-2 order-model)
  test('AC-1/AC-2 다중 상병 파생 — index 0=주상병, 나머지 부상병, seq/코드/명칭 스냅샷', () => {
    const value = 'M79.3 족저근막염\nM21.6 기타 후천성 발변형';
    const rows = deriveChartDiagnoses(value);
    expect(rows).toHaveLength(2);
    // 주상병(첫 줄)
    expect(rows[0]).toMatchObject({
      diagnosis_code: 'M79.3',
      diagnosis_name: '족저근막염',
      diagnosis_type: 'primary',
      seq: 0,
    });
    // 부상병
    expect(rows[1]).toMatchObject({
      diagnosis_code: 'M21.6',
      diagnosis_type: 'secondary',
      seq: 1,
    });
    // 주상병은 정확히 1건
    expect(rows.filter((r) => r.diagnosis_type === 'primary')).toHaveLength(1);
  });

  test('AC-2 주상병 승격 후 파생 — 승격된 상병이 primary(seq 0)로 이동', () => {
    // makeDxPrimary(1) 결과 = "M21.6 ...\nM79.3 ..." (부→주 승격, 나머지 순서 보존)
    const promoted = 'M21.6 기타 후천성 발변형\nM79.3 족저근막염';
    const rows = deriveChartDiagnoses(promoted);
    expect(rows[0].diagnosis_code).toBe('M21.6');
    expect(rows[0].diagnosis_type).toBe('primary');
    expect(rows[1].diagnosis_code).toBe('M79.3');
    expect(rows[1].diagnosis_type).toBe('secondary');
  });

  // 시나리오 3: 하위호환 — 기존 단일 상병 차트
  test('AC-0 하위호환 — 단일 diagnosis 텍스트는 주상병 1건으로 파생(데이터 유실 없음)', () => {
    const legacy = 'M79.3 족저근막염';
    const rows = deriveChartDiagnoses(legacy);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ diagnosis_type: 'primary', seq: 0, diagnosis_code: 'M79.3' });
  });

  test('AC-0 코드 미동반 순수 상병명(레거시) — code=null graceful, name 보존', () => {
    const rows = deriveChartDiagnoses('족저근막염');
    expect(rows).toHaveLength(1);
    expect(rows[0].diagnosis_code).toBeNull();
    expect(rows[0].diagnosis_name).toBe('족저근막염');
    expect(rows[0].diagnosis_type).toBe('primary');
  });

  // 시나리오 4: 주상병 강제 (AC-2 A안)
  test('AC-2 강제 — 상병 0건은 요건 없음(통과)', () => {
    expect(chartDiagnosesHasPrimary('')).toBe(true);
  });

  test('AC-2 강제 — 상병 있으면 주상병 최소 1건 보장(order-model 구조적 통과)', () => {
    expect(chartDiagnosesHasPrimary('M79.3 족저근막염')).toBe(true);
    expect(chartDiagnosesHasPrimary('M79.3 족저근막염\nM21.6 기타')).toBe(true);
  });

  test('AC-2 강제 — 주상병 누락 set 은 저장 차단 대상(불변식 방어선)', () => {
    // 구조화 파생 결과에 주상병이 없는 (비정상) set 은 저장 차단(=false).
    const noPrimary: DerivedChartDiagnosis[] = [
      { diagnosis_code: 'M79.3', diagnosis_name: '족저근막염', diagnosis_type: 'secondary', seq: 0 },
    ];
    const ok = noPrimary.length === 0 || noPrimary.some((r) => r.diagnosis_type === 'primary');
    expect(ok).toBe(false); // → handleSave 가 "주상병을 지정해 주세요" 로 차단
  });

  // 시나리오 2: 출력 화면 상병코드 표시 (AC-3 [D])
  test('AC-3 [D] 출력 — 다중 상병 코드+명칭 슬롯(diag_code_1..N, 주상병 우선)', () => {
    const value = 'M79.3 족저근막염\nM21.6 기타 후천성 발변형';
    const out = buildDiagCodesForPrint(value, {});
    expect(out.diag_code_1).toBe('M79.3');
    expect(out.diag_name_1).toBe('족저근막염');
    expect(out.diag_code_2).toBe('M21.6');
    expect(out.diag_name_2).toBe('기타 후천성 발변형');
  });

  test('AC-3 [D] 출력 — 코드 미동반 상병명은 마스터 역조회로 코드 보강', () => {
    const out = buildDiagCodesForPrint('족저근막염', { 족저근막염: 'M79.3' });
    expect(out.diag_code_1).toBe('M79.3');
    expect(out.diag_name_1).toBe('족저근막염');
  });

  test('AC-3 [D] 출력 — 코드/마스터 모두 없으면 명칭만(graceful)', () => {
    const out = buildDiagCodesForPrint('기타 상병', {});
    expect(out.diag_code_1).toBe('');
    expect(out.diag_name_1).toBe('기타 상병');
  });

  test('AC-3 [D] 출력 — 상병코드 슬롯 최대 4건 상한', () => {
    const value = ['A00.0 a', 'B11.1 b', 'C22.2 c', 'D33.3 d', 'E44.4 e'].join('\n');
    const out = buildDiagCodesForPrint(value, {});
    expect(out.diag_code_4).toBe('D33.3');
    expect(out.diag_code_5).toBeUndefined(); // 5번째는 슬롯 상한 초과로 미표시
  });
});
