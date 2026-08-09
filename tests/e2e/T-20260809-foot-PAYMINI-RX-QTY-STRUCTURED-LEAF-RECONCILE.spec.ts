/**
 * E2E Spec — T-20260809-foot-PAYMINI-RX-QTY-STRUCTURED-LEAF-RECONCILE (P2)
 *
 * 부모 T-20260807-foot-PAYMINI-RX-QTY-INPUT-FIELD 의 DA HARD REJECT 정합.
 *   [문제] 처방약 수량(×N)이 rx_items_html 문자열에만 착지(단독착지) — 구조화 leaf 부재.
 *   [수정] canonical 수량 키 = total_qty 로 통일(AC3) + form_submissions.field_data.rx_items[]
 *          구조화 leaf 로 ADDITIVE persist(AC1) + buildRxItemsHtml 이 total_qty 를 읽어 ×N 렌더(AC2).
 *          출력물 시각결과 불변(output-equivalent) — 부모 배포(176dbc97)의 ×N 라이브 렌더와 동일.
 *
 * 렌더/persist 공통 SSOT = buildRxItemsHtml(src/lib/htmlFormTemplates.ts).
 *   PaymentMiniWindow.buildCodeEnrichedValues 가 구조화 rxItemsLeaf(=field_data.rx_items) 를 단일
 *   in-memory 객체로 조립 → (a) buildRxItemsHtml 입력(표시)과 (b) field_data.rx_items(persist) 양쪽에
 *   동일 객체 사용 → display=persist 동일 SSOT(AC2).
 *
 * db_change = false (field_data JSONB 에 rx_items 중첩배열 leaf ADDITIVE, DDL 0).
 *
 * ★ 구조화 leaf persist 자체(supabase .update({field_data}) + rows-affected 검증)는 컴포넌트+DB 경로 →
 *   본 결정적 헬퍼 spec 범위 밖. 실기기 field-soak(갤탭) confirm 항목:
 *     - 처방약 수량 입력 후 결제→처방전 발행 → form_submissions.field_data.rx_items[].total_qty 실착지 확인
 *     - 0-row 저장 실패 시 토스트 경보 노출(rows-affected 검증) 확인
 *
 * AC 커버리지(결정적 헬퍼 단위):
 *  - AC2 total_qty(구조화 leaf 키) → name 셀 '약품명 ×N'
 *  - AC2 output-equivalent — total_qty=N 과 (구) qty=N 의 렌더 결과 동일
 *  - AC3 canonical 키 = total_qty (total_qty 가 qty 보다 우선)
 *  - AC4 하위호환 폴백 — total_qty 미전달 시 legacy qty 로 폴백, 둘 다 없으면 접미 없음
 *  - 처방이력 정합 — parseRxMedicationNames 왕복(총량 접미 온전 복원)
 *
 * 실행: npx playwright test T-20260809-foot-PAYMINI-RX-QTY-STRUCTURED-LEAF-RECONCILE.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { parseRxMedicationNames } from '../../src/lib/rxIssuanceHistory';

const BARTOVEN = '바르토벤';
const CODE = '57001771';

// name 셀(각 <tr> 첫 <td>)의 비어있지 않은 텍스트만 순서대로 추출.
function nameCells(html: string): string[] {
  const cells: string[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/i;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const c = cellRe.exec(m[1]);
    if (!c) continue;
    const t = c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (t) cells.push(t);
  }
  return cells;
}

test.describe('AC2/AC3 — canonical total_qty(구조화 leaf 키) 렌더', () => {
  test('total_qty=2 → "바르토벤 ×2"', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, total_qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([`${BARTOVEN} ×2`]);
  });

  test('total_qty=3 → 코드 prefix + ×N 공존 "코드 | 약품명 ×3"', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, code: CODE, total_qty: 3, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([`${CODE} | ${BARTOVEN} ×3`]);
  });

  test('total_qty 접미는 name 셀에만 — 용량/횟수/투약일수 무오염', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, total_qty: 5, unit_dose: '2', daily_freq: '3', total_days: '7' }]);
    const rowMatch = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(html);
    expect(rowMatch).not.toBeNull();
    const tds = (rowMatch![1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? []).map((td) =>
      td.replace(/<[^>]+>/g, '').trim(),
    );
    expect(tds[0]).toBe(`${BARTOVEN} ×5`);
    expect(tds[1]).toBe('2');
    expect(tds[2]).toBe('3');
    expect(tds[3]).toBe('7');
    expect(tds.slice(1).some((c) => c.includes('×'))).toBe(false);
  });
});

test.describe('AC2 — output-equivalent (부모 ×N 라이브 렌더와 시각결과 불변)', () => {
  test('total_qty=N 과 (구) qty=N 렌더 결과 동일', () => {
    for (const n of [2, 3, 4, 10]) {
      const withTotalQty = buildRxItemsHtml([{ name: BARTOVEN, code: CODE, total_qty: n, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
      const withLegacyQty = buildRxItemsHtml([{ name: BARTOVEN, code: CODE, qty: n, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
      expect(withTotalQty).toBe(withLegacyQty);
    }
  });
});

test.describe('AC3 — total_qty 가 legacy qty 보다 우선(canonical precedence)', () => {
  test('total_qty=3, qty=2 동시 전달 → total_qty 채택("×3")', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, total_qty: 3, qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([`${BARTOVEN} ×3`]);
  });

  test('total_qty=1(명시) 은 qty=5 를 무시하고 ×N 미표기', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, total_qty: 1, qty: 5, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });
});

test.describe('AC4 — 하위호환 폴백(구 저장본·구 호출부 무회귀)', () => {
  test('total_qty 미전달 + qty=2 → legacy qty 폴백("×2")', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([`${BARTOVEN} ×2`]);
  });

  test('total_qty·qty 둘 다 미전달 → ×N 미표기 (DocumentPrintPanel 등 무영향)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });

  test('total_qty=0 등 비정상값도 접미 없음(>1 조건 방어)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, total_qty: 0, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });
});

test.describe('처방이력 정합 — parseRxMedicationNames 왕복(총량 접미 온전 복원)', () => {
  test('total_qty 다품목 혼재 — 각 항목 독립 표기', () => {
    const html = buildRxItemsHtml([
      { name: '터미졸', total_qty: 1, unit_dose: '1', daily_freq: '1', total_days: '1' },
      { name: BARTOVEN, code: CODE, total_qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' },
    ]);
    expect(parseRxMedicationNames(html)).toEqual(['터미졸', `${CODE} | ${BARTOVEN} ×2`]);
  });
});
