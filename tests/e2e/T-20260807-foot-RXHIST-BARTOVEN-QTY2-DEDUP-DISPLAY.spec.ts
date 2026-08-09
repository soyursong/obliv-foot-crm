/**
 * E2E — T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY (P1, 회귀 수정)
 * 처방이력 탭 — 바르토벤 수량2/건수 표시 결함(256228c5 RXHISTORY-TAB-4IMPROVE 배포 회귀) 재현·수정.
 *
 * ── RC(실데이터 확정, 김병완 F-4741 12발행 실조회):
 *    dedupeRxIssuanceRows 종전 키 (환자·교부일·약품집합)가 "같은 날 같은 약을 서로 다른 교부번호로
 *    발행한 별개 처방"까지 1건으로 과수렴 → 2건 발행이 1건으로 표시("2건인데 1건") + 병합건수 미표기.
 *    후보 (a)dedup 과수렴 = 실경로 / (b)병합건수 미표기 = 동반 / (c)splitRepresentativeMedications = 무관
 *    (4mL[57001771]·8mL[57001772]는 약명 자체가 달라 애초에 dedup 안 됨 — 정상).
 *
 * ── 수정: 실처방 식별자 = 교부번호(issue_no). 교부번호 다르면 별개 발행(병합 금지), 같으면 재출력(1건 병합).
 *    초안(issue_no=NULL)만 (교부일+약품집합) 폴백. dup_count>1 = 재출력 N회 배지 노출.
 *
 * canonical SSOT = form_submissions(form_key='rx_standard'). read-side only(집계/표시). DB 스키마 변경 0.
 * 로직은 라이브 비의존 결정적 스펙으로 검증(브라우저 무의존).
 */

import { test, expect } from '@playwright/test';
import {
  mapRxIssuancePatientRows,
  dedupeRxIssuanceRows,
  splitRepresentativeMedications,
  RX_ISSUANCE_FORM_KEY,
  type RawFormSubmissionWithCustomerRow,
} from '../../src/lib/rxIssuanceHistory';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// 실사례 약명(서비스관리 등록형: '코드 | 약품명'). 4mL·8mL 는 서로 다른 약명(코드 다름).
const BARTOVEN_4 = '57001771 | (비급여) 바르토벤외용액 4mL(에피나코나졸)';
const BARTOVEN_8 = '57001772 | (비급여) 바르토벤외용액 8mL(에피나코나졸)';
const TERBI = '057000061 | 터미졸크림(테르비나핀염산염)15g';

const HTML_B4 = buildRxItemsHtml([{ name: BARTOVEN_4, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
const HTML_B8 = buildRxItemsHtml([{ name: BARTOVEN_8, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
const HTML_B4_TERBI = buildRxItemsHtml([
  { name: TERBI, unit_dose: '1', daily_freq: '1', total_days: '1' },
  { name: BARTOVEN_4, unit_dose: '1', daily_freq: '1', total_days: '1' },
]);

const KBW = { id: '259abd32', name: '김병완', chart_number: 'F-4741' };

function rxRow(
  id: string,
  medHtml: string,
  issue_date: string,
  issue_no: string | null,
  printed_at?: string | null,
): RawFormSubmissionWithCustomerRow {
  return {
    id,
    customer_id: KBW.id,
    printed_at: printed_at === undefined ? `${issue_date}T09:00:00+09:00` : printed_at,
    created_at: `${issue_date}T08:59:00+09:00`,
    field_data: {
      form_key: RX_ISSUANCE_FORM_KEY,
      issue_date,
      issue_no,
      prescriber_name: '김윤기',
      rx_items_html: medHtml,
    },
    form_templates: { form_key: RX_ISSUANCE_FORM_KEY },
    customers: { name: KBW.name, chart_number: KBW.chart_number },
  };
}

// ── RC 재현: 실데이터 그대로(같은 날 바르토벤 4mL 을 교부번호 013/015 로 2건 발행) ──
test.describe('RC 재현 — 같은 날 동일 약 별개 교부번호 2건 발행', () => {
  test('과수렴 금지: 서로 다른 교부번호 → 2건 유지(각 dup_count=1)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('a', HTML_B4_TERBI, '2026-07-25', '20260805000013', '2026-08-05T10:40:58+09:00'),
      rxRow('b', HTML_B4_TERBI, '2026-07-25', '20260805000015', '2026-08-05T10:47:12+09:00'),
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(2); // 종전 키에서는 1건으로 과수렴하던 케이스
    deduped.forEach((r) => expect(r.dup_count).toBe(1));
  });

  test('동일 교부번호 재출력만 1건 병합(dup_count=2)', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('c', HTML_B4, '2026-08-05', '20260805000008', '2026-08-05T10:30:00+09:00'),
      rxRow('d', HTML_B4, '2026-08-05', '20260805000008', '2026-08-05T10:31:00+09:00'),
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].dup_count).toBe(2);
  });
});

// ── (c) 배제 검증: 4mL vs 8mL 은 약명이 달라 애초에 병합 대상 아님 ──
test.describe('4mL·8mL 구분 유지', () => {
  test('바르토벤 4mL·8mL 동일 교부일이라도 별개 약(별개 교부번호) → 2건', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('e', HTML_B4, '2026-08-07', '20260807000101'),
      rxRow('f', HTML_B8, '2026-08-07', '20260807000102'),
    ]);
    expect(dedupeRxIssuanceRows(rows)).toHaveLength(2);
  });

  test('splitRepresentativeMedications: 4mL 선택 시 8mL 은 기타로(숨김 아님)', () => {
    const { representative, others } = splitRepresentativeMedications(
      [BARTOVEN_4, BARTOVEN_8],
      [BARTOVEN_4],
    );
    expect(representative).toEqual([BARTOVEN_4]);
    expect(others).toEqual([BARTOVEN_8]); // 숨겨지지 않고 '기타' 컬럼에 노출
  });
});

// ── 초안(교부번호 NULL) 폴백: 확정 발행과 섞지 않음 ──
test.describe('초안 교부번호 미부여 폴백', () => {
  test('draft(issue_no=NULL) 는 (교부일+약품집합) 폴백 dedup, 확정발행과 별개 키', () => {
    const rows = mapRxIssuancePatientRows([
      rxRow('g1', HTML_B4, '2026-08-05', null, null), // 초안1
      rxRow('g2', HTML_B4, '2026-08-05', null, null), // 초안2(동일 약/날짜) → 폴백 병합
      rxRow('g3', HTML_B4, '2026-08-05', '20260805000020'), // 확정 발행(교부번호 있음) → 별개
    ]);
    const deduped = dedupeRxIssuanceRows(rows);
    expect(deduped).toHaveLength(2); // 초안 1건(g1==g2) + 확정 1건(g3)
  });
});
