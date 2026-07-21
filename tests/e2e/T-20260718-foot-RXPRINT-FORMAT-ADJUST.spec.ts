/**
 * E2E Spec — T-20260718-foot-RXPRINT-FORMAT-ADJUST
 *
 * 처방전 출력 서식 2종 형식 재조정 (display-only, DB/발번RPC/데이터소스 무변경).
 * 부모 2건(RX-PRINT-ISSUENO-TOTALDAYS-FIX / RXPRINT-DRUGCODE-PREFIX) 모두 deployed —
 * 저장 데이터·발번 로직은 그대로 두고 **표기 형식만** 재정렬한다.
 *
 * 항목1 (교부번호): '제 20260718000025 호' → '2026-07-18 제 000025 호'
 *   - ⚠ SUPERSEDED-BY T-20260721-foot-RXPRINT-ISSUENO-DATE-PHARMACIST-LABEL (총괄 요청):
 *     날짜 표기가 compact '20260718' → dashed 'YYYY-MM-DD'(2026-07-18)로 변경됨. 아래 date 단언은 dashed 기준으로 갱신.
 *   - 저장 issue_no(=date8+seqN 연속, buildIssueNo 산출값)는 불변(AC1·AC4).
 *   - 렌더 직전 splitIssueNoForDisplay 가 표시용으로만 date8/순번 분리
 *     → 처방전 양식 '{{issue_date}} 제 {{issue_no}} 호' 슬롯에서 '20260718 제 000025 호'.
 *   - 두 발행경로(서류발행 탭 buildHtmlPageHtml / 결제창 발행 buildHtmlPageDiv)가 모두 이 헬퍼로 수렴.
 *
 * 항목2 (처방약 코드 구분자): '[코드] 약품명'(대괄호) → '코드 | 약품명'(파이프).
 *   - 렌더 SSOT = buildRxItemsHtml. 코드 NULL/공백 → 파이프 없이 약품명만(AC3 fallback 유지).
 *
 * AC 커버리지:
 *  - AC1 교부번호 = 'YYYYMMDD 제 (순번) 호' 렌더(발번값/로직 무변경 — split 은 표시전용 사본).
 *  - AC2 약품 라인 = '코드 | 약품명'(파이프, 대괄호 제거). 소스 유지.
 *  - AC3 코드 없는 약품 fallback(약품명만) 유지.
 *  - AC4 저장 issue_no 무변경(split 이 원본 미변형) + 다른 칸(총투약일수 등) 무회귀.
 *
 * 실행: npx playwright test T-20260718-foot-RXPRINT-FORMAT-ADJUST.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildIssueNo, splitIssueNoForDisplay } from '../../src/lib/docSerial';
import { buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

// name 셀(첫 <td>)의 텍스트만 순서대로 추출 — 렌더 구조 의존 최소화.
function nameCells(html: string): string[] {
  const cells: string[] = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) cells.push(m[1].trim());
  return cells;
}

// ── 항목1 / AC1: 교부번호 표시 분리 'YYYYMMDD 제 (순번) 호' ─────────────────────────
test('AC1: 저장 issue_no(14자리) → 표시 date(dashed)/순번 분리 (issue_date=2026-07-18, issue_no=000025)', () => {
  const stored = buildIssueNo('20260718', 25, 6)!; // '20260718000025' (부모 저장값)
  const out = splitIssueNoForDisplay({ issue_no: stored });
  // 양식 '{{issue_date}} 제 {{issue_no}} 호' 슬롯 조립 결과 = '2026-07-18 제 000025 호' (T-20260721 dashed)
  expect(out.issue_date).toBe('2026-07-18');
  expect(out.issue_no).toBe('000025');
  expect(`${out.issue_date} 제 ${out.issue_no} 호`).toBe('2026-07-18 제 000025 호');
});

test('AC1: 순번 zero-pad 6자리 유지(현 배포본 연속성)', () => {
  const out = splitIssueNoForDisplay({ issue_no: buildIssueNo('20260718', 25, 6)! });
  expect(out.issue_no).toBe('000025');
  expect(out.issue_no.length).toBe(6);
});

test('AC1 파라미터화: N=5(심평원 13자리) 저장값도 앞8/나머지로 정확 분리', () => {
  const stored = buildIssueNo('20260718', 25, 5)!; // '2026071800025'
  const out = splitIssueNoForDisplay({ issue_no: stored });
  expect(out.issue_date).toBe('2026-07-18');
  expect(out.issue_no).toBe('00025'); // 나머지 = 5자리 순번
  expect(`${out.issue_date} 제 ${out.issue_no} 호`).toBe('2026-07-18 제 00025 호');
});

test('AC1 발번값 무변경: split 은 앞8+나머지 재결합 시 원본 issue_no 와 동일(로직 무변경)', () => {
  const stored = buildIssueNo('20260718', 7, 6)!;
  const out = splitIssueNoForDisplay({ issue_no: stored });
  // 표시 date 는 dashed(T-20260721) → 재결합 검증 시 대시 제거 후 비교 (발번값 자체는 불변)
  expect(`${out.issue_date.replace(/-/g, '')}${out.issue_no}`).toBe(stored);
});

// ── AC4: split 은 원본 미변형(표시전용 사본) + 안전 no-op ─────────────────────────
test('AC4: split 은 원본 values 객체를 변형하지 않음(저장 field_data 불변 보장)', () => {
  const original = { issue_no: '20260718000025', patient_name: '홍길동' };
  const out = splitIssueNoForDisplay(original);
  // 원본 불변 — 저장 issue_no 는 그대로(AC4 DB/데이터 무변경)
  expect(original.issue_no).toBe('20260718000025');
  // 사본만 분리
  expect(out).not.toBe(original);
  expect(out.issue_no).toBe('000025');
  // 다른 필드 무오염
  expect(out.patient_name).toBe('홍길동');
});

test('AC4 no-op: 미채번(빈 issue_no) → 무변경(미리보기 경로 안전)', () => {
  const out = splitIssueNoForDisplay({ issue_no: '' });
  expect(out.issue_no).toBe('');
  expect(out.issue_date ?? '').toBe('');
});

test('AC4 멱등: 이중 적용 안전 — 멱등은 issue_no 포맷으로 판정(issue_date 가드 아님)', () => {
  const once = splitIssueNoForDisplay({ issue_no: '20260718000025' });
  const twice = splitIssueNoForDisplay(once); // 재적용: issue_no='000025'(6자리) → /^\d{9,}$/ 미매치 → no-op
  expect(twice.issue_date).toBe('2026-07-18');
  expect(twice.issue_no).toBe('000025'); // 두 번째 적용에도 변하지 않음
});

// ── 운영 렌더 경로 회귀 가드 (FIX QA — functional_noop 재발 방지) ──────────────────────
// loadAutoBindContext(autoBindContext.ts) 가 issue_date=today('yyyy-MM-dd' dashed) 를 항상 선바인딩한 채
// splitIssueNoForDisplay 로 넘어오는 것이 실제 운영 렌더 경로다. 이전 issue_date 존재 가드는 이 경로에서
// 무조건 no-op 을 유발해 서식 재조정이 배포본에 전혀 적용되지 않았다(항목1 QA FAIL). 아래는 그 실경로 모사.
test('AC1 운영경로: issue_date=today(dashed) 선바인딩 + 14자리 issue_no → compact 8자리로 교정되어 split', () => {
  // autoBindContext 가 넣는 실제 입력 형태 (issue_date 는 dashed today, issue_no 는 저장 발번값 14자리)
  const rendered = splitIssueNoForDisplay({
    issue_date: '2026-07-18', // ← today dashed 선바인딩 (loadAutoBindContext:290 issue_date: today)
    issue_no: '20260718000025',
    patient_name: '홍길동',
  });
  // 가드 제거로 split 이 실제 발동 → 앞날짜가 today 선바인딩과 무관하게 발번날짜 기준 dashed 로 덮어써짐
  expect(rendered.issue_date).toBe('2026-07-18'); // 발번 date8(20260718) → dashed 교정 (T-20260721)
  expect(rendered.issue_no).toBe('000025');
  // 슬롯 조립 결과 = 요구 형식
  expect(`${rendered.issue_date} 제 ${rendered.issue_no} 호`).toBe('2026-07-18 제 000025 호');
  // 타 필드 무오염
  expect(rendered.patient_name).toBe('홍길동');
});

test('AC1 운영경로: dashed today 선바인딩 케이스도 멱등(재적용 시 no-op)', () => {
  const once = splitIssueNoForDisplay({ issue_date: '2026-07-18', issue_no: '20260718000025' });
  const twice = splitIssueNoForDisplay(once);
  expect(twice.issue_date).toBe('2026-07-18');
  expect(twice.issue_no).toBe('000025');
});

test('AC4 no-op: 비-숫자/비정상 issue_no → 무변경(UUID·기타 문자열 오분리 방지)', () => {
  expect(splitIssueNoForDisplay({ issue_no: 'ABC12345' }).issue_no).toBe('ABC12345');
  expect(splitIssueNoForDisplay({ issue_no: '2026' }).issue_no).toBe('2026'); // 9자리 미만
  expect(splitIssueNoForDisplay({}).issue_no ?? '').toBe('');
});

// ── 항목2 / AC2: 처방약 코드 구분자 '코드 | 약품명'(파이프) ─────────────────────────
test('AC2: 약품명 앞 코드 구분자 = "코드 | 약품명"(파이프, 대괄호 제거)', () => {
  const html = buildRxItemsHtml([{ name: '테르비나핀정', code: 'D001' }]);
  expect(html).toContain('D001 | 테르비나핀정');
  // 대괄호 서식 완전 제거
  expect(html).not.toContain('[D001]');
  expect(html).not.toContain('[D001] 테르비나핀정');
  // 코드가 약품명 '앞'
  expect(html.indexOf('D001')).toBeLessThan(html.indexOf('테르비나핀정'));
});

test('AC2: 여러 약 → 각 약마다 자기 코드가 "코드 | 약품명"으로 앞에 붙고 순서 유지', () => {
  const html = buildRxItemsHtml([
    { name: '약A', code: 'AAA' },
    { name: '약B', code: 'BBB' },
  ]);
  expect(html).toContain('AAA | 약A');
  expect(html).toContain('BBB | 약B');
  expect(html.indexOf('AAA | 약A')).toBeLessThan(html.indexOf('BBB | 약B'));
  expect(html).not.toContain('[AAA]');
});

// ── 항목2 / AC3: 코드 없는 약품 → 파이프 없이 약품명만 (fallback 유지) ────────────────
test('AC3 fallback: code=null → 약품명만(파이프 덩그러니·"null" 노출 없음)', () => {
  const html = buildRxItemsHtml([{ name: '무코드약', code: null }]);
  const names = nameCells(html);
  expect(names).toContain('무코드약');
  expect(html).not.toContain('| 무코드약'); // 파이프 덩그러니 금지
  expect(html).not.toContain('null');
  expect(html).not.toContain('undefined');
});

test('AC3 fallback: 공백/빈 code → 파이프 미표기', () => {
  const html = buildRxItemsHtml([
    { name: '공백코드약', code: '   ' },
    { name: '빈문자약', code: '' },
  ]);
  expect(html).toContain('공백코드약');
  expect(html).toContain('빈문자약');
  expect(html).not.toContain('| 공백코드약');
  expect(html).not.toContain('| 빈문자약');
});

test('AC3 혼합: 일부만 코드 → 등록된 약만 "코드 |", 나머지는 약품명만', () => {
  const html = buildRxItemsHtml([
    { name: '코드있음', code: 'X1' },
    { name: '코드없음', code: null },
  ]);
  expect(html).toContain('X1 | 코드있음');
  const names = nameCells(html);
  expect(names).toContain('코드없음');
  expect(html).not.toContain('| 코드없음');
});

// ── AC4 무회귀: 다른 칸 보존 + 빈 filler 행 무오염 ───────────────────────────────
test('AC4 무회귀: 용량/횟수/투약일수 값 보존, 구분자는 약품명 셀에만', () => {
  const html = buildRxItemsHtml([
    { name: '약A', code: 'AAA', unit_dose: '2', daily_freq: '3', total_days: '5' },
  ]);
  expect(html).toContain('AAA | 약A');
  expect(html).toContain('>2<');
  expect(html).toContain('>3<');
  expect(html).toContain('>5<');
  // 코드/파이프가 다른 셀로 새지 않음
  expect(html).not.toContain('>AAA<');
  expect(html).not.toContain('>|<');
});

test('AC4 무회귀: 8행 고정 유지 + 빈 행에 파이프/대괄호 잔재 없음', () => {
  const html = buildRxItemsHtml([{ name: '약A', code: 'AAA' }]);
  expect((html.match(/<tr/g) ?? []).length).toBe(8);
  expect(html).not.toContain('[');
  // 빈 행 name 셀은 완전 공란 → '|' 잔재 없음
  const names = nameCells(html);
  expect(names.filter((n) => n === '').length).toBe(7);
});
