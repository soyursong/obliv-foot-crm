/**
 * E2E — T-20260809-foot-RXHIST-DRUGLIST-PRESCRIBED-ONLY-FILTER
 * 치료테이블 '처방 이력' 탭 — 약 드롭다운 옵션을 처방약 마스터(services category_label='처방약')와
 *   교차검증하여 비처방약 라인(진찰료·검사·상병코드 등)을 제외.
 *
 * canonical SSOT = form_submissions(form_key='rx_standard') 발행 이력 축(rxIssuanceHistory.ts).
 *   교차검증 축 = services(category_label='처방약') 약 마스터(prescribableDrugs.fetchRxDrugMaster).
 *   두 축은 직교(VG3) — prescriptions/prescription_items(dead skeleton) 무접촉(AC-3). db_change=false.
 *
 * ★ AC-2 조사 재정의: 드롭다운 옵션 소스 = 발행이력 파싱이므로 옵션은 전부 발행이력 ≥1건
 *   → 원 '0건 제외'는 no-op. 실제 오염 = 비처방약 라인(진찰료 'AA154 | 초진진찰료-의원'·
 *     검사 'D620300HZ | 일반진균검사-KOH도말') 혼입(스크린샷 F0BP36UHB7E). Option A(마스터 교차검증)로 해소.
 *
 * AC-1: 코드(prefix) 또는 약품명이 처방약 마스터에 있는 옵션만 노출.
 * AC-6 (a): 코드/약품명 양축 매칭 — 코드 없는 자유텍스트 정상약도 약품명 매칭 시 노출.
 * AC-6 (b): 제외된 토큰 목록 수집(evidence).
 * AC-4: 결과목록/dedup/필터 무회귀 — 드롭다운 옵션 필터만 변경.
 *
 * ★ 필터는 라이브 비의존 순수 로직으로 결정적 검증. 탭 렌더는 브라우저 스모크(로그인 실패 시 skip).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedications,
  buildRxDrugMasterIndex,
  filterMedicationsByRxMaster,
  parseMedicationToken,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
  type RxDrugMasterEntry,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// 정상 처방약(services category_label='처방약' 등록) — 코드 있음/없음 혼합.
const RX_HAITRE = buildRxItemsHtml([
  { name: '하이트리크림(0.2g/20g)', code: 'H0001', unit_dose: '1', daily_freq: '1', total_days: '14' },
]);
const RX_BARTOVEN = buildRxItemsHtml([
  { name: '바르토벤외용액4mL(에피나코나졸)', unit_dose: '1', daily_freq: '1', total_days: '30' }, // 코드 없음(자유텍스트)
]);
// 비처방약 오염 라인 — 진찰료·검사(스크린샷 F0BP36UHB7E 지목 2건).
const CONTAM = buildRxItemsHtml([
  { name: '초진진찰료-의원', code: 'AA154', unit_dose: '1', daily_freq: '1', total_days: '1' },
  { name: '일반진균검사-KOH도말-조갑조직', code: 'D620300HZ', unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

function rxRow(
  id: string,
  medHtml: string,
  customer: { name: string; chart_number: string },
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    printed_at: '2026-08-01T09:00:00+09:00',
    created_at: '2026-08-01T08:59:00+09:00',
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date: '2026-08-01',
      issue_no: `20260801-${id}`,
      prescriber_name: '문지은',
      diag_code_1: 'B35.1',
      diag_name_1: '조갑백선',
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: customer.name, chart_number: customer.chart_number },
  };
}

// 발행이력 — 정상약 + 비처방약 라인이 스냅샷에 섞인 상태(현장 오염 재현).
const SAMPLE: RawFormSubmissionWithCustomerRow[] = [
  rxRow('fs-1', RX_HAITRE, { name: '김환자', chart_number: '10001' }),
  rxRow('fs-2', RX_BARTOVEN, { name: '이환자', chart_number: '10002' }),
  rxRow('fs-3', CONTAM, { name: '박환자', chart_number: '10003' }),
];

// 처방약 마스터(services category_label='처방약'). 진찰료(AA154)·검사(D620300HZ)는 여기 없음(=비처방약).
const RX_MASTER: RxDrugMasterEntry[] = [
  { service_code: 'H0001', name: '하이트리크림(0.2g/20g)' },
  { service_code: 'B0004', name: '바르토벤외용액4mL(에피나코나졸)' }, // 코드 다름 → 약품명 축으로 매칭돼야 함
  { service_code: 'L0060', name: '록소드펜정60mg' },
];

// 발행이력 파싱 시 실제 드롭다운 토큰(코드 prefix 포함).
const TOK_HAITRE = 'H0001 | 하이트리크림(0.2g/20g)';
const TOK_BARTOVEN = '바르토벤외용액4mL(에피나코나졸)'; // 코드 없이 발행 → 약품명만
const TOK_AA154 = 'AA154 | 초진진찰료-의원';
const TOK_KOH = 'D620300HZ | 일반진균검사-KOH도말-조갑조직';

// ─── 토큰 파서 ───
test.describe('토큰 파서(parseMedicationToken)', () => {
  test('코드 prefix 분리 + 수량 접미 제거', () => {
    expect(parseMedicationToken(TOK_HAITRE)).toEqual({
      code: 'H0001',
      name: '하이트리크림(0.2g/20g)',
    });
    expect(parseMedicationToken(TOK_BARTOVEN)).toEqual({
      code: null,
      name: '바르토벤외용액4mL(에피나코나졸)',
    });
    // ' ×N' 수량 접미 제거
    expect(parseMedicationToken('H0001 | 하이트리크림 ×2')).toEqual({
      code: 'H0001',
      name: '하이트리크림',
    });
  });
});

// ─── 시나리오 1: 정상 — 처방약만 드롭다운 노출 ───
test.describe('시나리오 1: 처방약만 드롭다운 노출', () => {
  test('AC-1 — 코드/약품명 마스터 매칭 옵션만 kept, 비처방약은 excluded', () => {
    const meds = collectDistinctMedications(mapRxIssuancePatientRows(SAMPLE));
    // 오염 상태 사전확인: 원본 옵션에는 비처방약 라인이 섞여 있음.
    expect(meds).toContain(TOK_AA154);
    expect(meds).toContain(TOK_KOH);

    const index = buildRxDrugMasterIndex(RX_MASTER);
    const { kept, excluded } = filterMedicationsByRxMaster(meds, index);

    // 정상약(코드 매칭 하이트리 + 약품명 매칭 바르토벤)은 노출.
    expect(kept).toContain(TOK_HAITRE);
    expect(kept).toContain(TOK_BARTOVEN);
    // 비처방약(진찰료·검사)은 제외.
    expect(kept).not.toContain(TOK_AA154);
    expect(kept).not.toContain(TOK_KOH);
    expect(excluded).toEqual(expect.arrayContaining([TOK_AA154, TOK_KOH]));
  });
});

// ─── 시나리오 2: 엣지 — 비처방약 라인 미노출 ───
test.describe('시나리오 2: 비처방약 라인 제외', () => {
  test('AC-1 — 진찰료(AA154)·검사(D620300HZ) 코드/약품명 모두 마스터 부재 → 제외', () => {
    const index = buildRxDrugMasterIndex(RX_MASTER);
    const { kept } = filterMedicationsByRxMaster([TOK_AA154, TOK_KOH], index);
    expect(kept).toEqual([]);
  });

  test('AC-6 (a) — 코드 매칭(하이트리) 또는 약품명 매칭(바르토벤, 코드 상이) 양축 노출', () => {
    const index = buildRxDrugMasterIndex(RX_MASTER);
    // 하이트리: 코드(H0001) 일치 → 노출.
    expect(filterMedicationsByRxMaster([TOK_HAITRE], index).kept).toEqual([TOK_HAITRE]);
    // 바르토벤: 발행 토큰엔 코드 없음, 마스터엔 코드 B0004 → 약품명 축으로 매칭돼 노출.
    expect(filterMedicationsByRxMaster([TOK_BARTOVEN], index).kept).toEqual([TOK_BARTOVEN]);
  });
});

// ─── 시나리오 3: 가드 — fail-open / 무회귀 ───
test.describe('시나리오 3: 가드·무회귀', () => {
  test('AC-6 가드 — 마스터 0건이면 전체 노출(대량 오제외 방지, 컴포넌트 fail-open과 동일 의미)', () => {
    const emptyIndex = buildRxDrugMasterIndex([]);
    const meds = collectDistinctMedications(mapRxIssuancePatientRows(SAMPLE));
    const { kept, excluded } = filterMedicationsByRxMaster(meds, emptyIndex);
    // 빈 인덱스면 아무것도 매칭 안 됨 → excluded 전량. (컴포넌트는 이 경우 필터를 아예 적용하지 않고 원본 노출)
    expect(kept).toEqual([]);
    expect(excluded.length).toBe(meds.length);
  });

  test('AC-4 무회귀 — 결과행 필터(filterRxRowsByMedications)는 kept 약으로 정상 동작', () => {
    const rows = mapRxIssuancePatientRows(SAMPLE);
    // 드롭다운에서 kept 된 정상약을 선택하면 해당 발행 환자 정상 조회.
    expect(filterRxRowsByMedications(rows, [TOK_HAITRE]).map((r) => r.patient_name)).toEqual([
      '김환자',
    ]);
    expect(filterRxRowsByMedications(rows, [TOK_BARTOVEN]).map((r) => r.patient_name)).toEqual([
      '이환자',
    ]);
  });

  test('빈/공백 코드·약품명은 매칭 안 함(인덱스에 빈 문자열 미포함)', () => {
    const idx = buildRxDrugMasterIndex([{ service_code: '', name: '  ' }, { name: '록소드펜정60mg' }]);
    expect(idx.codes.size).toBe(0);
    expect(idx.names.has('록소드펜정60mg')).toBe(true);
  });
});

// ★ 브라우저 렌더(탭 진입 + 드롭다운 옵션 실노출 + 제외토큰 육안검증)는 supervisor field-soak 관측 —
//   본 spec 은 read-side 교차검증 순수 로직의 결정론 가드(auth/DB/server 불요·unit 전용).
