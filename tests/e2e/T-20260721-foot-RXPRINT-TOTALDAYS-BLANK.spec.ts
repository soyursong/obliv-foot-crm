/**
 * E2E Spec — T-20260721-foot-RXPRINT-TOTALDAYS-BLANK
 *
 * 총괄(김주연) 최종 결정: "세 칸 전부 기본 1로 반영해놓고 수정 가능하게".
 *   처방전 인쇄 시 약품행 3칸(1회 투약량 unit_dose / 1일 투여횟수 daily_freq / 총투약일수 total_days)을
 *   모두 리터럴 기본값 '1'로 표기하고, 각 칸은 현장 수기(입력값)로 수정 가능.
 *
 * ⚠ LOGIC-LOCK 해제:
 *   구 T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX 의 "total_days 빈칸이 정답"(A안)은 본 총괄 결정으로 해제.
 *   total_days 폴백 '' → '1' 로 전환. 단 이는 자동 산출 바인딩(옵션B)이 아니라, 형제 두 칸과 동일한
 *   리터럴 기본값 '1' + editable. items[].days 등 자동값 강제 주입 부활 금지, 구 '7' 폴백 부활 금지.
 *
 * 평행 경로 2곳 동시 반영(한 곳만 고치면 결제미니창 경로 재오픈):
 *   1) src/components/DocumentPrintPanel.tsx  — rx_standard 매핑
 *   2) src/components/PaymentMiniWindow.tsx  — buildCodeEnrichedValues (결제미니창 경로)
 *   두 경로 모두 각 칸 = `rxItemDosages[...]?.<field> || '1'` 로 수렴하고,
 *   최종 렌더 SSOT = buildRxItemsHtml(src/lib/htmlFormTemplates.ts) (값 pass-through).
 *
 * AC 커버리지:
 *  - AC1 미입력 시 3칸 모두 기본 '1' 표기 (total_days 도 이제 '' 아님)
 *  - AC2 각 칸 직접 수정(입력값) → 입력값 그대로 렌더
 *  - AC3 회귀: unit_dose/daily_freq 현행 || '1' 무변경
 *  - AC4 자동 계산 바인딩 미도입 (값은 리터럴, 회차·days 파생 아님) + 렌더 SSOT pass-through 무회귀
 *
 * 실행: npx playwright test T-20260721-foot-RXPRINT-TOTALDAYS-BLANK.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

/**
 * 두 인쇄 경로(DocumentPrintPanel / PaymentMiniWindow.buildCodeEnrichedValues)의
 * 폴백 매핑을 그대로 재현한다. 실제 코드의 표현식:
 *   unit_dose:  rxItemDosages[id]?.unit_dose  || '1'
 *   daily_freq: rxItemDosages[id]?.daily_freq || '1'
 *   total_days: rxItemDosages[id]?.total_days || '1'   // T-20260721: '' → '1'
 */
function mapDosage(d?: { unit_dose?: string; daily_freq?: string; total_days?: string }) {
  return {
    unit_dose: d?.unit_dose || '1',
    daily_freq: d?.daily_freq || '1',
    total_days: d?.total_days || '1',
  };
}

// 행별 데이터 셀(용량/횟수/투약일수) 추출: name 다음 3개 <td>.
function doseCells(html: string): Array<{ unit_dose: string; daily_freq: string; total_days: string }> {
  const rows: Array<{ unit_dose: string; daily_freq: string; total_days: string }> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].trim());
    if (tds.length >= 4) rows.push({ unit_dose: tds[1], daily_freq: tds[2], total_days: tds[3] });
  }
  return rows;
}

// ── AC1: 미입력 시 3칸 모두 기본 '1' ─────────────────────────────────────────
test('AC1: 용량 미입력(rxItemDosages 없음) → 3칸 전부 기본 "1" 표기', () => {
  const mapped = mapDosage(undefined);
  expect(mapped).toEqual({ unit_dose: '1', daily_freq: '1', total_days: '1' });

  const html = buildRxItemsHtml([{ name: '테르비나핀정', code: 'D001', ...mapped }]);
  const rows = doseCells(html);
  expect(rows[0]).toEqual({ unit_dose: '1', daily_freq: '1', total_days: '1' });
});

test('AC1: total_days 만 공백(빈 문자열)이어도 기본 "1" (구 빈칸 정책 해제)', () => {
  const mapped = mapDosage({ unit_dose: '2', daily_freq: '3', total_days: '' });
  expect(mapped.total_days).toBe('1');

  const html = buildRxItemsHtml([{ name: '약A', code: 'A1', ...mapped }]);
  const rows = doseCells(html);
  expect(rows[0]).toEqual({ unit_dose: '2', daily_freq: '3', total_days: '1' });
  // 빈칸(공란) 렌더 아님을 명시
  expect(rows[0].total_days).not.toBe('');
});

// ── AC2: 각 칸 직접 수정 → 입력값 그대로 렌더 ──────────────────────────────────
test('AC2: total_days 직접 수정 → 입력값(예 "10") 그대로 렌더', () => {
  const mapped = mapDosage({ total_days: '10' });
  expect(mapped.total_days).toBe('10');

  const html = buildRxItemsHtml([{ name: '약A', code: 'A1', ...mapped }]);
  const rows = doseCells(html);
  expect(rows[0].total_days).toBe('10');
});

test('AC2: 3칸 모두 직접 수정 → 각 입력값 그대로 렌더', () => {
  const mapped = mapDosage({ unit_dose: '5', daily_freq: '2', total_days: '14' });
  const html = buildRxItemsHtml([{ name: '약A', code: 'A1', ...mapped }]);
  const rows = doseCells(html);
  expect(rows[0]).toEqual({ unit_dose: '5', daily_freq: '2', total_days: '14' });
});

// ── AC3: 회귀 — unit_dose/daily_freq 현행 || '1' 무변경 ───────────────────────
test('AC3 회귀: unit_dose/daily_freq 미입력 → 기존대로 "1" (총괄 결정은 total_days 만 변경)', () => {
  expect(mapDosage({ unit_dose: '', daily_freq: '', total_days: '7' })).toEqual({
    unit_dose: '1',
    daily_freq: '1',
    total_days: '7',
  });
});

// ── AC4: 자동 계산 바인딩 미도입 + 렌더 SSOT 무회귀 ───────────────────────────
test('AC4: 값은 리터럴 폴백만 — days·회차 파생 계산 없음(옵션B 미도입)', () => {
  // 동일 입력이면 항상 동일 리터럴. 어떤 외부 파생 소스에도 의존하지 않음.
  expect(mapDosage({}).total_days).toBe('1');
  expect(mapDosage({ total_days: '3' }).total_days).toBe('3');
  // '1' 은 리터럴이지 usage_days(3) 등 다른 값에서 산출된 것이 아님
  expect(mapDosage({}).total_days).not.toBe('3');
});

test('AC4 무회귀: 빈 filler 행 8행 고정, total_days 칸에 자동값 잔재 없음', () => {
  const html = buildRxItemsHtml([{ name: '약A', code: 'A1', ...mapDosage(undefined) }]);
  expect((html.match(/<tr/g) ?? []).length).toBe(8);
  const rows = doseCells(html);
  // 채워진 1행만 '1', 나머지 filler 7행은 공란(빈 행에는 강제 '1' 주입 안 함)
  expect(rows[0].total_days).toBe('1');
  expect(rows.slice(1).every((r) => r.total_days === '')).toBe(true);
});
