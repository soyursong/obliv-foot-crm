/**
 * E2E Spec — T-20260721-foot-RXPRINT-ISSUENO-DATE-PHARMACIST-LABEL
 *
 * 풋센터 처방전 출력물 텍스트 2건 수정 (김주연 총괄 요청, display-only / DB·발번RPC·데이터소스 무변경).
 *
 * 요구 1 (교부번호 날짜): 교부년월일번호 슬롯의 날짜를 YYYY-MM-DD(dashed)로 표시 (예 '2026-07-21').
 *   - 렌더 SSOT = splitIssueNoForDisplay(docSerial.ts). 저장 issue_no(=date8+seqN 연속) 불변.
 *   - 구 T-20260718-foot-RXPRINT-FORMAT-ADJUST 는 compact '20260721' 로 표시했으나 총괄 요청으로 dashed 로 변경.
 *   - 미리보기(today dashed 선바인딩)와 발행본(발번 date8 → dashed 재조립) 표시형식 통일.
 *
 * 요구 2 (조제내역 라벨): 조제내역 섹션 항목명 '조제약 성명' → '조제약사 성명' (한 글자 '사' 추가, 순수 라벨 텍스트).
 *   - 렌더 SSOT = RX_STANDARD_HTML (getHtmlTemplate('rx_standard')).
 *
 * AC 커버리지:
 *  - AC1 교부번호 = 'YYYY-MM-DD 제 (순번) 호' 렌더 (발번값/로직 무변경 — split 은 표시전용 사본).
 *  - AC2 조제내역 항목명 = '조제약사 성명'.
 *  - AC3 회귀 0 — 다른 필드/라벨(총투약일수·약품행·조제년월·조제량·조제기관의명·교부년월일번호 등) 불변 +
 *        저장 issue_no 무변경 + split 원본 미변형 + 멱등 유지.
 *
 * 실행: npx playwright test T-20260721-foot-RXPRINT-ISSUENO-DATE-PHARMACIST-LABEL.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildIssueNo, splitIssueNoForDisplay } from '../../src/lib/docSerial';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 라벨 텍스트를 nbsp/공백 무시하고 비교하기 위한 정규화 (양식은 자간 표현에 &nbsp; 사용).
function stripSpacing(html: string): string {
  return html.replace(/&nbsp;/g, '').replace(/\s+/g, '');
}

const RX_HTML = getHtmlTemplate('rx_standard')!;

// ── AC1: 교부번호 날짜 = YYYY-MM-DD(dashed) ──────────────────────────────────────
test('AC1: 저장 issue_no(14자리) → 교부 날짜가 dashed YYYY-MM-DD 로 표시 (2026-07-21 제 000025 호)', () => {
  const stored = buildIssueNo('20260721', 25, 6)!; // '20260721000025' (발번 저장값)
  const out = splitIssueNoForDisplay({ issue_no: stored });
  expect(out.issue_date).toBe('2026-07-21'); // compact '20260721' 아님 (dashed 확인)
  expect(out.issue_no).toBe('000025');
  expect(`${out.issue_date} 제 ${out.issue_no} 호`).toBe('2026-07-21 제 000025 호');
});

test('AC1: dashed 형식 = 정확히 YYYY-MM-DD 패턴(하이픈 2개, 10자)', () => {
  const out = splitIssueNoForDisplay({ issue_no: buildIssueNo('20260721', 3, 6)! });
  expect(out.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(out.issue_date.length).toBe(10);
});

test('AC1 운영경로: today(dashed) 선바인딩 + 14자리 issue_no → 발번 date 기준 dashed 로 교정', () => {
  // loadAutoBindContext 가 issue_date=today(dashed) 를 선바인딩한 실제 렌더 입력 모사.
  const rendered = splitIssueNoForDisplay({
    issue_date: '2026-07-01', // today 선바인딩 (발번날짜와 다를 수 있음)
    issue_no: '20260721000025', // 발번 date8=20260721
    patient_name: '홍길동',
  });
  expect(rendered.issue_date).toBe('2026-07-21'); // 발번 date 기준 dashed (선바인딩 today 아님)
  expect(rendered.issue_no).toBe('000025');
  expect(rendered.patient_name).toBe('홍길동'); // 타 필드 무오염
});

test('AC1 파라미터화: N=5(심평원 13자리) 저장값도 dashed 로 정확 분리', () => {
  const out = splitIssueNoForDisplay({ issue_no: buildIssueNo('20260721', 25, 5)! }); // '2026072100025'
  expect(out.issue_date).toBe('2026-07-21');
  expect(out.issue_no).toBe('00025');
});

// ── AC2: 조제내역 라벨 '조제약사 성명' ──────────────────────────────────────────
test('AC2: 처방전 조제내역 항목명 = "조제약사 성명" (사 추가)', () => {
  const norm = stripSpacing(RX_HTML);
  expect(norm).toContain('조제약사성명');
});

test('AC2: 구 라벨 "조제약 성명"(사 없는 형태) 은 잔존하지 않음', () => {
  // 자간 표현(&nbsp;) 제거 후, '조제약성명'(사 없이 바로 성명) 시퀀스가 없어야 함.
  const norm = stripSpacing(RX_HTML);
  expect(norm).not.toContain('조제약성명');
});

// ── AC3: 회귀 0 — 다른 라벨/필드 불변 ───────────────────────────────────────────
test('AC3 무회귀: 조제내역 인접 라벨(조제기관의명·조제량(조제일수)·조제년월) 불변', () => {
  const norm = stripSpacing(RX_HTML);
  expect(norm).toContain('조제기관의명');
  expect(norm).toContain('조제량(조제일수)');
  expect(norm).toContain('조제년월');
  expect(norm).toContain('조제내역'); // rowspan 세로 라벨(조/제/내/역)
});

test('AC3 무회귀: 교부년월일번호 라벨 + 슬롯 토큰({{issue_date}}/{{issue_no}}) 불변', () => {
  const norm = stripSpacing(RX_HTML);
  expect(norm).toContain('교부년월일번호');
  // 슬롯 구조 '{{issue_date}} 제 {{issue_no}} 호' 보존
  expect(RX_HTML).toContain('{{issue_date}}');
  expect(RX_HTML).toContain('{{issue_no}}');
  expect(norm).toContain('{{issue_date}}제{{issue_no}}호');
});

test('AC3 무회귀: 총투약일수/사용기간 슬롯({{usage_days}}) 불변', () => {
  expect(RX_HTML).toContain('{{usage_days}}');
});

test('AC3 무회귀: split 은 원본 values 미변형 (저장 field_data 불변) + 멱등', () => {
  const original = { issue_no: '20260721000025', patient_name: '김풋' };
  const out = splitIssueNoForDisplay(original);
  expect(original.issue_no).toBe('20260721000025'); // 원본 불변
  expect(out).not.toBe(original);
  // 멱등: 재적용 시 no-op (issue_no 6자리 → /^\d{9,}$/ 미매치)
  const twice = splitIssueNoForDisplay(out);
  expect(twice.issue_date).toBe('2026-07-21');
  expect(twice.issue_no).toBe('000025');
});

test('AC3 무회귀 no-op: 미채번/비정상 issue_no → 무변경(미리보기·UUID 오분리 방지)', () => {
  expect(splitIssueNoForDisplay({ issue_no: '' }).issue_no).toBe('');
  expect(splitIssueNoForDisplay({ issue_no: 'ABC12345' }).issue_no).toBe('ABC12345');
  expect(splitIssueNoForDisplay({ issue_no: '2026' }).issue_no).toBe('2026'); // 9자리 미만
});
