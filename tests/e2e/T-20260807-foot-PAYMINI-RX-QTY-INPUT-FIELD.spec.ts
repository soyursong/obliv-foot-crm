/**
 * E2E Spec — T-20260807-foot-PAYMINI-RX-QTY-INPUT-FIELD (P2)
 *
 * 결제미니창(PaymentMiniWindow) 처방약 항목에 수량 스테퍼 [− N +] 노출 + qty 전파.
 *   - 약 선택 시 기본값 default_qty = 1 로 시작(handleSelectService: { service, qty: 1 }).
 *   - 스테퍼 하한 1(0/미입력 방지, handleSetItemQty clamp = Math.max(1, ...)).
 *   - qty>1 시 처방전 인쇄·처방이력 공통 '약품명 ×N' 표기(buildRxItemsHtml).
 *
 * 렌더 SSOT = buildRxItemsHtml(src/lib/htmlFormTemplates.ts). 세 인쇄 경로가 모두 이 함수로 수렴.
 *   qty 접미는 name 셀에만 적용, 다른 칸(용량/횟수/투약일수) 무오염.
 * 처방이력 표시축 = parseRxMedicationNames(src/lib/rxIssuanceHistory.ts) — name 셀 파싱.
 * 본 spec = 순수 렌더/파싱 헬퍼 단위 검증(실서버·브라우저 불필요, 결정적).
 *
 * db_change = false (rx_items_html JSON leaf additive, DDL 0).
 *
 * AC 커버리지:
 *  - AC2 입력 캡처: qty 전파 → name 셀 '약품명 ×N' (스테퍼 값이 rx_items_html 로 흐름)
 *  - AC3 처방이력 정합: parseRxMedicationNames 가 '바르토벤 ×2' 온전 복원 + BARTOVEN-QTY2 회귀0
 *  - AC4 하위호환: qty 미전달(undefined)/1 → 접미 없음(기존 DocumentPrintPanel 등 무영향)
 *  - 엣지(시나리오2): '미입력→기본값1' = qty 1 이면 ×N 미표기(default_qty=1 명시 스펙)
 *
 * 실행: npx playwright test T-20260807-foot-PAYMINI-RX-QTY-INPUT-FIELD.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';
import { parseRxMedicationNames } from '../../src/lib/rxIssuanceHistory';

const BARTOVEN = '바르토벤';
const BARTOVEN_CODED = '57001771 | (비급여) 바르토벤외용액 4mL(에피나코나졸)';

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

test.describe('AC2 — 수량 전파: qty>1 → name 셀 약품명 ×N', () => {
  test('qty=2 → "바르토벤 ×2" (코드 없는 약)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    const names = nameCells(html);
    expect(names).toEqual([`${BARTOVEN} ×2`]);
  });

  test('qty=3 → 코드 prefix + ×N 공존 "코드 | 약품명 ×3"', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, code: '57001771', qty: 3, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    const names = nameCells(html);
    expect(names).toEqual([`57001771 | ${BARTOVEN} ×3`]);
  });

  test('qty 접미는 name 셀에만 — 다른 칸(용량/횟수/투약일수) 무오염', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 5, unit_dose: '2', daily_freq: '3', total_days: '7' }]);
    // 용량/횟수/투약일수 셀에 '×' 미출현
    const rowMatch = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(html);
    expect(rowMatch).not.toBeNull();
    const tds = (rowMatch![1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? []).map((td) =>
      td.replace(/<[^>]+>/g, '').trim(),
    );
    // [name, unit_dose, daily_freq, total_days, method]
    expect(tds[0]).toBe(`${BARTOVEN} ×5`);
    expect(tds[1]).toBe('2');
    expect(tds[2]).toBe('3');
    expect(tds[3]).toBe('7');
    expect(tds.slice(1).some((c) => c.includes('×'))).toBe(false);
  });
});

test.describe('AC4 / 시나리오2 엣지 — 하위호환 + 기본값1(미입력→1)', () => {
  test('qty=1 → ×N 미표기 (default_qty=1, 미입력 방지 하한)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 1, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });

  test('qty 미전달(undefined) → ×N 미표기 (기존 호출부 DocumentPrintPanel 등 무영향)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });

  test('qty=0 등 비정상값도 접미 없음 (>1 조건 — 방어)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 0, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN]);
  });

  test('BARTOVEN-QTY2 회귀0 — 코드형 약명 qty 미전달 시 종전 출력 불변', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN_CODED, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(nameCells(html)).toEqual([BARTOVEN_CODED]);
  });
});

test.describe('AC3 — 처방이력 정합: parseRxMedicationNames 왕복', () => {
  test('"바르토벤 ×2" 온전 복원 (처방이력 표시)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(parseRxMedicationNames(html)).toEqual([`${BARTOVEN} ×2`]);
  });

  test('코드형 + ×N 복원 "코드 | 약품명 ×2"', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, code: '57001771', qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(parseRxMedicationNames(html)).toEqual([`57001771 | ${BARTOVEN} ×2`]);
  });

  test('qty=1 은 ×N 없이 복원 (건수/표시 정합)', () => {
    const html = buildRxItemsHtml([{ name: BARTOVEN, qty: 1, unit_dose: '1', daily_freq: '1', total_days: '1' }]);
    expect(parseRxMedicationNames(html)).toEqual([BARTOVEN]);
  });

  test('다품목 혼재 — 각 항목 qty 독립 표기', () => {
    const html = buildRxItemsHtml([
      { name: '터미졸', qty: 1, unit_dose: '1', daily_freq: '1', total_days: '1' },
      { name: BARTOVEN, qty: 2, unit_dose: '1', daily_freq: '1', total_days: '1' },
    ]);
    expect(parseRxMedicationNames(html)).toEqual(['터미졸', `${BARTOVEN} ×2`]);
  });
});
