/**
 * E2E — T-20260822-foot-RX-NOTATION-FORMAT-CANONICAL-SPEC (문지은 대표원장, U0ALGAAAJAV)
 *
 * 풋센터CRM 처방약/주사제 표기형식 canonical 통일:
 *   [구분]약품명(성분명)_(함량/단위)
 *   예) [내복]엔테론정150밀리그람(비티스비니페라엑스)
 *       [외용]니조랄2%액(케토코나졸)_(20mg/1mL)
 *
 * B안 스코프(IN-SCOPE): AC-1(검색결과 canonical 표시) · AC-4(축약·순서변형 입력 validation) ·
 *   AC-5(조회화면 동일형식). AC-2/3(HIRA/MFDS 외부 API 자동연동)은 OUT-OF-SCOPE(후속 트랙).
 *
 * ★ 표기형식 SSOT = src/lib/rxCanonical.ts (외부 호출 0 · 신규 DB 0 · 신규 npm 0, 순수 함수).
 *   본 spec 은 그 순수 로직을 결정적(deterministic)으로 검증한다.
 */

import { test, expect } from '@playwright/test';
import {
  formatRxCanonical,
  parseRxCanonical,
  validateRxNotation,
  firstRxNotationError,
  displayRxName,
  toRxRoute,
  RX_ROUTE_LABEL,
  RX_ROUTE_LABELS,
} from '../../src/lib/rxCanonical';

test.describe('RX-NOTATION canonical 표기형식', () => {
  // ── AC-1: canonical 조립 = [구분]약품명(성분명)_(함량/단위) ──────────────────
  test('AC-1: formatRxCanonical — 대표원장 예시 2건 정확 조립', () => {
    // 예1: _(함량/단위) 없는 형태
    expect(
      formatRxCanonical({ route: 'oral', name: '엔테론정150밀리그람', ingredient: '비티스비니페라엑스' }),
    ).toBe('[내복]엔테론정150밀리그람(비티스비니페라엑스)');

    // 예2: _(함량/단위) 있는 형태
    expect(
      formatRxCanonical({
        route: 'topical',
        name: '니조랄2%액',
        ingredient: '케토코나졸',
        amountUnit: '20mg/1mL',
      }),
    ).toBe('[외용]니조랄2%액(케토코나졸)_(20mg/1mL)');
  });

  test('AC-1: 라벨 입력(내복/외용/주사)도 동일 조립', () => {
    expect(formatRxCanonical({ route: '주사', name: '세파졸린주' })).toBe('[주사]세파졸린주');
    expect(RX_ROUTE_LABELS).toEqual(['내복', '외용', '주사']);
    expect(RX_ROUTE_LABEL.injection).toBe('주사');
  });

  test('AC-1: 부분 데이터 tolerant — 없는 파트는 순서 유지한 채 생략', () => {
    // route 없음 → [구분] 생략
    expect(formatRxCanonical({ name: '엔테론정', ingredient: '비티스비니페라엑스' })).toBe(
      '엔테론정(비티스비니페라엑스)',
    );
    // ingredient 없음 → (성분명) 생략
    expect(formatRxCanonical({ route: 'oral', name: '엔테론정' })).toBe('[내복]엔테론정');
    // name 없음 → 빈 문자열
    expect(formatRxCanonical({ name: '' })).toBe('');
  });

  test('toRxRoute — 라벨·동의어 흡수', () => {
    expect(toRxRoute('내복')).toBe('oral');
    expect(toRxRoute('먹는약')).toBe('oral');
    expect(toRxRoute('외용')).toBe('topical');
    expect(toRxRoute('바르는약')).toBe('topical');
    expect(toRxRoute('주사제')).toBe('injection');
    expect(toRxRoute('')).toBeNull();
  });

  // ── round-trip: build → parse 원본 손실 0 ────────────────────────────────
  test('parseRxCanonical — canonical 문자열 무손실 분해(round-trip)', () => {
    const p = parseRxCanonical('[외용]니조랄2%액(케토코나졸)_(20mg/1mL)');
    expect(p.hasRoute).toBe(true);
    expect(p.route).toBe('topical');
    expect(p.name).toBe('니조랄2%액');
    expect(p.ingredient).toBe('케토코나졸');
    expect(p.amountUnit).toBe('20mg/1mL');

    const p2 = parseRxCanonical('[내복]엔테론정150밀리그람(비티스비니페라엑스)');
    expect(p2.route).toBe('oral');
    expect(p2.name).toBe('엔테론정150밀리그람');
    expect(p2.ingredient).toBe('비티스비니페라엑스');
    expect(p2.amountUnit).toBeNull();
  });

  // ── AC-4: 순서변형(사고원인) validation ──────────────────────────────────
  test('AC-4: 순서변형 "니조랄액2%" 차단(사고원인) — 농도(%)는 제형어 앞', () => {
    const bad = validateRxNotation('니조랄액2%');
    expect(bad.ok).toBe(false);
    expect(bad.violations[0].code).toBe('pct_after_form');
    expect(firstRxNotationError('니조랄액2%')).toContain('순서');
  });

  test('AC-4: canonical "니조랄2%액"은 통과(오탐 0)', () => {
    expect(validateRxNotation('니조랄2%액').ok).toBe(true);
    // 정제 함량표기(정+150밀리그람)는 % 가 아니므로 무해 — 오탐 없음
    expect(validateRxNotation('엔테론정150밀리그람').ok).toBe(true);
    // 크림/연고류 정상 순서
    expect(validateRxNotation('데카덤2%크림').ok).toBe(true);
    expect(validateRxNotation('크림2%데카덤').ok).toBe(false); // 크림 뒤 % = 위반
  });

  test('AC-4: 빈 입력 차단', () => {
    const r = validateRxNotation('   ');
    expect(r.ok).toBe(false);
    expect(r.violations[0].code).toBe('empty');
  });

  // ── AC-1/AC-5: displayRxName = 원본 verbatim(축약·순서변형 0) ─────────────
  test('AC-1/AC-5: displayRxName — 원본 풀네임 그대로(축약·재정렬 0)', () => {
    const full = '[외용]니조랄2%액(케토코나졸)_(20mg/1mL)';
    expect(displayRxName(full)).toBe(full);
    // HIRA 급여약 원본 풀네임도 축약 없이 그대로
    expect(displayRxName('  엔테론정150밀리그람(비티스비니페라엑스)  ')).toBe(
      '엔테론정150밀리그람(비티스비니페라엑스)',
    );
    expect(displayRxName(null)).toBe('');
  });
});
