/**
 * E2E Spec — T-20260718-foot-RXPRINT-DRUGCODE-PREFIX
 *
 * 처방전 출력 시 처방약 목록의 각 약품명 **앞에** 서비스관리 등록 약 코드(services.service_code)를
 *   '[코드] 약품명' 형태로 표기 (송도 처방전 IMG_9001.jpg 서식 참고 — 구두 미상 시 '[코드] 약품명' 기본).
 *
 * 렌더 SSOT = buildRxItemsHtml(src/lib/htmlFormTemplates.ts). 세 인쇄 경로
 *   (DocumentPrintPanel 단건/배치 · PaymentMiniWindow)가 모두 이 함수로 수렴 → 여기서 코드 prefix.
 *   각 호출부는 items[].code = service_code 를 전달. 본 spec = 순수 렌더 헬퍼 단위 검증(실서버 불필요).
 *
 * AC 커버리지:
 *  - AC1 각 약품명 앞에 service_code 표기 ('[코드] 약품명')
 *  - AC2 형식 = '[코드] 약품명' (대괄호 + 공백 구분자, 송도 서식 기준·총괄 재확인 대상)
 *  - AC3 코드 NULL/미매핑/공백 → 코드 없이 약품명만 (빈 '[]'·'null' 문자열 노출 금지 = graceful fallback)
 *  - AC4 다른 칸(용량/횟수/투약일수) 무회귀 + 코드 prefix 는 name 셀에만 적용(다른 셀 무오염)
 *
 * 실행: npx playwright test T-20260718-foot-RXPRINT-DRUGCODE-PREFIX.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// name 셀(첫 <td>)의 텍스트만 순서대로 추출 — 렌더 구조 의존 최소화.
function nameCells(html: string): string[] {
  // 각 행 첫 <td>...</td> 의 내용(약품명 셀). 빈 행 포함 전부.
  const cells: string[] = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) cells.push(m[1].trim());
  return cells;
}

// ── AC1 / AC2: 코드 있는 약 → '[코드] 약품명' ────────────────────────────────
test('AC1/AC2: 약품명 앞에 service_code 를 "[코드] 약품명" 형태로 표기', () => {
  const html = buildRxItemsHtml([{ name: '테르비나핀정', code: 'D001' }]);
  expect(html).toContain('[D001] 테르비나핀정');
  // 코드가 약품명 '앞'에 위치
  expect(html.indexOf('[D001]')).toBeLessThan(html.indexOf('테르비나핀정'));
});

test('AC1: 여러 약 → 각 약마다 각자의 코드가 앞에 붙음', () => {
  const html = buildRxItemsHtml([
    { name: '약A', code: 'AAA' },
    { name: '약B', code: 'BBB' },
    { name: '약C', code: 'CCC' },
  ]);
  expect(html).toContain('[AAA] 약A');
  expect(html).toContain('[BBB] 약B');
  expect(html).toContain('[CCC] 약C');
  // 순서 유지
  expect(html.indexOf('[AAA] 약A')).toBeLessThan(html.indexOf('[BBB] 약B'));
  expect(html.indexOf('[BBB] 약B')).toBeLessThan(html.indexOf('[CCC] 약C'));
});

// ── AC3: 코드 미등록/미매핑 → 코드 없이 약품명만 (빈 '[]'·'null' 금지) ──────────
test('AC3 fallback: service_code = null → 코드 없이 약품명만, "[]"·"null" 노출 없음', () => {
  const html = buildRxItemsHtml([{ name: '무코드약', code: null }]);
  const names = nameCells(html);
  expect(names).toContain('무코드약');
  // graceful: 빈 대괄호·null 문자열 절대 없음
  expect(html).not.toContain('[]');
  expect(html).not.toContain('[null]');
  expect(html).not.toContain('null 무코드약');
  expect(html).not.toContain('undefined');
});

test('AC3 fallback: code 미전달(undefined) → 약품명만', () => {
  const html = buildRxItemsHtml([{ name: '코드없음약' }]);
  expect(html).toContain('코드없음약');
  expect(html).not.toContain('[] 코드없음약');
  expect(html).not.toContain('[undefined]');
});

test('AC3 fallback: 공백/whitespace code → prefix 미표기(빈 대괄호 방지)', () => {
  const html = buildRxItemsHtml([
    { name: '공백코드약', code: '   ' },
    { name: '빈문자약', code: '' },
  ]);
  expect(html).toContain('공백코드약');
  expect(html).toContain('빈문자약');
  expect(html).not.toContain('[ ]');
  expect(html).not.toContain('[   ]');
  expect(html).not.toContain('[]');
});

test('AC3 혼합: 일부만 코드 등록 → 등록된 약만 prefix, 나머지는 약품명만', () => {
  const html = buildRxItemsHtml([
    { name: '코드있음', code: 'X1' },
    { name: '코드없음', code: null },
  ]);
  expect(html).toContain('[X1] 코드있음');
  const names = nameCells(html);
  expect(names).toContain('코드없음');
  expect(html).not.toContain('[] 코드없음');
});

// ── AC4: 다른 칸 무회귀 + 빈 행 무오염 ────────────────────────────────────────
test('AC4 무회귀: 용량/횟수/투약일수 값은 그대로 표기(코드 prefix 는 약품명 셀에만)', () => {
  const html = buildRxItemsHtml([
    { name: '약A', code: 'AAA', unit_dose: '2', daily_freq: '3', total_days: '5' },
  ]);
  expect(html).toContain('[AAA] 약A');
  // 다른 셀 값 보존
  expect(html).toContain('>2<');
  expect(html).toContain('>3<');
  expect(html).toContain('>5<');
  // 코드가 다른 셀로 새어나가지 않음
  expect(html).not.toContain('>[AAA]<');
});

test('AC4 무회귀: 빈 filler 행(8행 고정)에 빈 대괄호 없음', () => {
  const html = buildRxItemsHtml([{ name: '약A', code: 'AAA' }]);
  // TOTAL_ROWS=8 유지: 8개 행
  expect((html.match(/<tr/g) ?? []).length).toBe(8);
  // 빈 행에 '[]' 등 잔재 없음
  expect(html).not.toContain('[]');
  expect(html).not.toContain('[undefined]');
  expect(html).not.toContain('[null]');
});

test('AC4 무회귀: 처방약 0건 → 빈 8행, 코드 아티팩트 없음', () => {
  const html = buildRxItemsHtml([]);
  expect((html.match(/<tr/g) ?? []).length).toBe(8);
  expect(html).not.toContain('[');
});
