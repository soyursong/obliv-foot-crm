import { test, expect } from '@playwright/test';
import {
  buildAutoRxDxRecords,
  projectAutoRxDxRecord,
  formatAutoRxMedication,
  formatAutoDxCode,
  autoRxDxDateKey,
  type AutoRxDxRecord,
} from '../../src/lib/autoRxDxRecord';
import type { RawFormSubmissionRow } from '../../src/lib/rxIssuanceHistory';

/**
 * T-20260818-foot-PENCHART-AUTORECORD-CRMDATA-DOCFORM-AUTOFILL
 *
 * 고객상세 2번차트 [펜차트 자동기록용] 위치에 CRM 데이터(처방약 rx_items·상병코드 dx_items)를
 * 화면 진입 시 자동 생성/표시(펜차트 자동기록 동일 방식). 데이터소스 정본 = PaymentMiniWindow 저장
 * form_submissions(form_key='rx_standard').
 *
 * 검증 = 순수 투영 로직(buildAutoRxDxRecords/projectAutoRxDxRecord/formatters) 단언 —
 *   현장 클릭 시나리오(고객상세 진입 시 자동 생성)의 데이터 산출 축 고정.
 *
 * 실행:
 *   npx playwright test tests/e2e/T-20260818-foot-PENCHART-AUTORECORD-CRMDATA-DOCFORM-AUTOFILL.spec.ts \
 *     --project=desktop-chrome
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
/** rx_standard form_submissions 행(구조화 rx_items + 상병코드) 픽스처. */
function rxRow(
  id: string,
  fd: Record<string, unknown>,
  meta?: { printed_at?: string | null; created_at?: string | null },
): RawFormSubmissionRow {
  return {
    id,
    printed_at: meta?.printed_at ?? null,
    created_at: meta?.created_at ?? null,
    field_data: fd,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1: 정상 동선 — 구조화 rx_items(수량) + 상병코드 자동 투영 (AC-1/AC-2/AC-4)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 구조화 rx_items + 상병코드 자동 생성', () => {
  test('구조화 rx_items(total_qty) + diag_code → 처방약·상병코드 자동기록', () => {
    const recs = buildAutoRxDxRecords([
      rxRow('sub-1', {
        issue_date: '2026-08-18',
        issue_no: '20260818-001',
        prescriber_name: '문지은',
        diag_code_1: 'L600', diag_name_1: '내향성 발톱',
        diag_code_2: 'B351', diag_name_2: '발톱백선',
        rx_items: [
          { code: 'A11500', name: '이트라코나졸', total_qty: '2', unit_dose: '1', daily_freq: '2', total_days: '30' },
          { code: null, name: '테르비나핀', total_qty: '1', unit_dose: '1', daily_freq: '1', total_days: '14' },
        ],
      }),
    ]);
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.issuedAt).toBe('2026-08-18');
    expect(r.issueNo).toBe('20260818-001');
    expect(r.prescriberName).toBe('문지은');
    // 상병코드 — 코드+명 2건
    expect(r.diagnoses).toEqual([
      { code: 'L600', name: '내향성 발톱' },
      { code: 'B351', name: '발톱백선' },
    ]);
    // 처방약 — 구조화 수량 유지(AC-4), html 폴백 아님
    expect(r.medicationsFromHtml).toBe(false);
    expect(r.medications).toHaveLength(2);
    expect(r.medications[0]).toMatchObject({ code: 'A11500', name: '이트라코나졸', totalQty: '2', totalDays: '30' });
    // 표시 포맷 — 수량 ×2 + 용법
    expect(formatAutoRxMedication(r.medications[0])).toBe('이트라코나졸 ×2 (1회 1 · 1일 2회 · 30일분)');
    expect(formatAutoDxCode(r.diagnoses[0])).toBe('L600 내향성 발톱');
  });

  test('수량 1(total_qty=1)은 ×N 미표기 — 단수 처방 노이즈 억제', () => {
    const rec = projectAutoRxDxRecord(
      rxRow('sub-2', {
        diag_code_1: 'L600', diag_name_1: '내향성 발톱',
        rx_items: [{ name: '아세트아미노펜', total_qty: '1', unit_dose: '1', daily_freq: '3', total_days: '3' }],
      }),
    );
    expect(rec).not.toBeNull();
    expect(formatAutoRxMedication(rec!.medications[0])).toBe('아세트아미노펜 (1회 1 · 1일 3회 · 3일분)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2: 엣지 케이스 — 데이터 없음/부분 (AC-3 에러 없이 빈칸/미표시)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 데이터 없음/부분 방어', () => {
  test('빈 입력 → 빈 배열(크래시 없음)', () => {
    expect(buildAutoRxDxRecords(null)).toEqual([]);
    expect(buildAutoRxDxRecords(undefined)).toEqual([]);
    expect(buildAutoRxDxRecords([])).toEqual([]);
  });

  test('처방약·상병코드 둘 다 없는 행 → 레코드 제외(빈 레코드 미표시)', () => {
    const recs = buildAutoRxDxRecords([
      rxRow('empty-1', { issue_no: 'x', prescriber_name: '문지은' }), // 진단·약 없음
    ]);
    expect(recs).toEqual([]);
  });

  test('상병코드만 있고 처방약 없음 → 레코드 포함, 처방약 빈 배열', () => {
    const recs = buildAutoRxDxRecords([
      rxRow('dx-only', { diag_code_1: 'L600', diag_name_1: '내향성 발톱' }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].diagnoses).toHaveLength(1);
    expect(recs[0].medications).toEqual([]);
  });

  test('처방약만 있고 상병코드 없음 → 레코드 포함, 상병 빈 배열', () => {
    const recs = buildAutoRxDxRecords([
      rxRow('rx-only', { rx_items: [{ name: '테르비나핀', total_qty: '1' }] }),
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].medications).toHaveLength(1);
    expect(recs[0].diagnoses).toEqual([]);
  });

  test('id 없는 행 → null(제외)', () => {
    expect(projectAutoRxDxRecord({ field_data: { diag_code_1: 'L600' } })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3: AC-4 구조화 미완 폴백 — rx_items_html 파싱(약품명만, 수량 없음)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 구조화 rx_items 부재 시 html 폴백', () => {
  test('rx_items 부재 + rx_items_html 존재 → 약품명 파싱 + fromHtml 플래그', () => {
    const rec = projectAutoRxDxRecord(
      rxRow('legacy-1', {
        diag_code_1: 'L600', diag_name_1: '내향성 발톱',
        rx_items_html:
          '<table><tr><td>A11500 | 이트라코나졸</td><td>1</td></tr><tr><td>테르비나핀 ×2</td><td>2</td></tr></table>',
      }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.medicationsFromHtml).toBe(true);
    expect(rec!.medications.map((m) => m.name)).toEqual(['A11500 | 이트라코나졸', '테르비나핀 ×2']);
    // 폴백은 수량 정보 없음(null)
    expect(rec!.medications[0].totalQty).toBeNull();
  });

  test('구조화 rx_items 있으면 html 폴백 사용 안 함(구조화 우선)', () => {
    const rec = projectAutoRxDxRecord(
      rxRow('both', {
        rx_items: [{ name: '이트라코나졸', total_qty: '2' }],
        rx_items_html: '<table><tr><td>딴약</td></tr></table>',
      }),
    );
    expect(rec!.medicationsFromHtml).toBe(false);
    expect(rec!.medications.map((m) => m.name)).toEqual(['이트라코나졸']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4: 정렬(교부일 최신순) + 교부일 폴백 + form_key 방어 필터
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 정렬·폴백·필터', () => {
  test('교부일 내림차순(최신 먼저), issue_date 없으면 printed_at 폴백', () => {
    const recs = buildAutoRxDxRecords([
      rxRow('old', { diag_code_1: 'L600' }, { printed_at: '2026-08-01T10:00:00Z' }),
      rxRow('new', { issue_date: '2026-08-18', diag_code_1: 'B351' }),
      rxRow('mid', { diag_code_1: 'S900' }, { created_at: '2026-08-10T09:00:00Z' }),
    ]);
    expect(recs.map((r) => r.key)).toEqual(['new', 'mid', 'old']);
    expect(recs.map((r) => r.issuedAt)).toEqual(['2026-08-18', '2026-08-10', '2026-08-01']);
  });

  test('preFiltered=false → rx_standard 아닌 행 제외', () => {
    const recs = buildAutoRxDxRecords(
      [
        { id: 'diag-doc', field_data: { form_key: 'diagnosis', diag_code_1: 'L600' } },
        { id: 'rx-doc', field_data: { form_key: 'rx_standard', diag_code_1: 'B351' } },
      ],
      false,
    );
    expect(recs.map((r) => r.key)).toEqual(['rx-doc']);
  });

  test('autoRxDxDateKey — ISO/도트/폴백', () => {
    expect(autoRxDxDateKey('2026-08-18T12:00:00Z')).toBe('2026-08-18');
    expect(autoRxDxDateKey('2026.8.3')).toBe('2026-08-03');
    expect(autoRxDxDateKey('')).toBeNull();
    expect(autoRxDxDateKey(null)).toBeNull();
  });
});

// 타입 export 사용 확인(미사용 lint 방지)
const _typecheck: AutoRxDxRecord | null = null;
void _typecheck;
