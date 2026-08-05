/**
 * E2E Spec — T-20260805-foot-DOCISSUE-DATE-EDIT-PRINT-REVERT (+ T-20260805-foot-PREVDOC-OPEN-FAIL)
 *
 * 현장 버그 2건 (박민지 현장 보고, 2026-08-05):
 *
 * [Bug A] 발행일자 출력 고정 — 처방전(rx_standard)에서 교부년월일을 수기 정정(예 2026-08-01)하면
 *   미리보기엔 정정 날짜가 표시되나 [인쇄] 클릭 시 오늘(발번일, 2026-08-05)로 되돌아가 찍힘.
 *   RC: splitIssueNoForDisplay 가 issue_no 앞 8자리(=발번 당일)로 issue_date 를 **무조건** 덮어씀.
 *       발번은 항상 new Date(=오늘)이라 수기 정정 날짜가 소실.
 *   FIX: issue_date_manual='1' 마커가 있고 issue_date 가 유효 dashed 면 그 값을 보존(발번일 덮어쓰기 스킵).
 *
 * [Bug B] 이전 서류 열기 불가 — 발행 이력의 '알 수 없는 양식 임시' 항목 클릭이 무반응.
 *   RC: 이력 항목 template_id 가 활성/카테고리 필터 밖이라 templates.find 미해결 → onClick 이 조용히 무동작.
 *   FIX: 미해결 template_id 를 필터 없이 보충 조회(extraTemplates)해 라벨/클릭 해석. 본 스펙은 해석 규칙만 검증.
 *
 * 실행: npx playwright test T-20260805-foot-DOCISSUE-DATE-EDIT-PRINT-REVERT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildIssueNo, splitIssueNoForDisplay } from '../../src/lib/docSerial';

// ── Bug A / AC1: 수기 정정 발행일 보존 (마커 존재) ──────────────────────────────
test('AC1: issue_date_manual 마커 + 수기 정정 dashed → 인쇄 표시에 정정 날짜 보존 (발번일로 안 돌아감)', () => {
  // 발번은 오늘(20260805) 기준이지만 사용자가 교부년월일을 2026-08-01 로 정정한 상황 모사.
  const stored = buildIssueNo('20260805', 14, 6)!; // '20260805000014'
  const out = splitIssueNoForDisplay({
    issue_date: '2026-08-01',       // 수기 정정값 (미리보기에 보이던 날짜)
    issue_date_manual: '1',         // 명시 편집 마커
    issue_no: stored,
  });
  expect(out.issue_date).toBe('2026-08-01'); // 오늘(2026-08-05)로 덮이지 않음 = 버그 수정
  expect(out.issue_no).toBe('000014');       // 순번 분리는 종전대로
});

test('AC1: 정정값이 발번일과 달라도 정정값 우선 (미리보기 == 인쇄 정합)', () => {
  const out = splitIssueNoForDisplay({
    issue_date: '2026-07-15',
    issue_date_manual: '1',
    issue_no: '20260805000003',
    patient_name: '홍길동',
  });
  expect(out.issue_date).toBe('2026-07-15');
  expect(out.issue_no).toBe('000003');
  expect(out.patient_name).toBe('홍길동'); // 타 필드 무오염
});

// ── Bug A / AC2: 회귀 0 — 마커 없으면 종전(발번일 dashed) 동작 유지 ────────────────
test('AC2 무회귀: 마커 없으면 종전대로 issue_no 앞 8자리(발번일)로 dashed 재조립', () => {
  const out = splitIssueNoForDisplay({
    issue_date: '2026-08-01', // 선바인딩값 (마커 없음)
    issue_no: '20260805000014',
  });
  // 마커 부재 → 발번일(20260805) 기준. 일반 발행·재출력의 '최초 발급일 표시' 로직 보존.
  expect(out.issue_date).toBe('2026-08-05');
  expect(out.issue_no).toBe('000014');
});

test('AC2 무회귀: 마커가 있어도 issue_date 가 유효 dashed 아니면 발번일로 폴백(빈값·형식오류 방어)', () => {
  const bad1 = splitIssueNoForDisplay({ issue_date: '', issue_date_manual: '1', issue_no: '20260805000014' });
  expect(bad1.issue_date).toBe('2026-08-05');
  const bad2 = splitIssueNoForDisplay({ issue_date: '20260801', issue_date_manual: '1', issue_no: '20260805000014' });
  expect(bad2.issue_date).toBe('2026-08-05'); // compact 는 dashed 패턴 미매치 → 폴백
});

test('AC2 무회귀: 마커 truthy 오탐 방지 — issue_date_manual 이 "1" 이 아니면 미적용', () => {
  const out = splitIssueNoForDisplay({ issue_date: '2026-07-15', issue_date_manual: '0', issue_no: '20260805000003' });
  expect(out.issue_date).toBe('2026-08-05'); // '0' → 발번일 기준
});

// ── Bug A / AC3: 멱등 + 원본 미변형 (기존 계약 유지) ──────────────────────────────
test('AC3 무회귀: split 은 원본 values 미변형 + 마커 경로도 멱등', () => {
  const original = { issue_date: '2026-08-01', issue_date_manual: '1', issue_no: '20260805000014' };
  const out = splitIssueNoForDisplay(original);
  expect(original.issue_no).toBe('20260805000014'); // 원본 불변
  const twice = splitIssueNoForDisplay(out);         // issue_no 6자리 → no-op
  expect(twice.issue_date).toBe('2026-08-01');
  expect(twice.issue_no).toBe('000014');
});

test('AC3 무회귀 no-op: 미채번/비정상 issue_no 는 마커 유무와 무관하게 무변경', () => {
  const out = splitIssueNoForDisplay({ issue_date: '2026-08-01', issue_date_manual: '1', issue_no: '' });
  expect(out.issue_no).toBe('');
  expect(out.issue_date).toBe('2026-08-01'); // 미채번 미리보기 — 선바인딩값 그대로(오분리 방지)
});

// ── Bug B / AC4: 발행 이력 양식 해석 규칙 (templates ?? extraTemplates) ──────────────
// 컴포넌트 내부 인라인 해석의 순수 규칙을 재현해 검증(미해결 시 열기불가 → 보충셋 폴백으로 해소).
type Tpl = { id: string; name_ko: string };
function resolveHistoryTemplate(id: string, templates: Tpl[], extra: Tpl[]): Tpl | undefined {
  return templates.find((t) => t.id === id) ?? extra.find((t) => t.id === id);
}

test('AC4: 활성 목록에 없는 template_id 는 extraTemplates 폴백으로 해석(알 수 없는 양식 해소)', () => {
  const templates: Tpl[] = [{ id: 'tpl-active', name_ko: '처방전(표준처방전)' }];
  const extra: Tpl[] = [{ id: 'tpl-legacy', name_ko: '레거시 진료확인서' }];
  // 활성셋만으로는 미해결(=알 수 없는 양식) 이던 항목이 보충셋으로 해석됨.
  expect(resolveHistoryTemplate('tpl-legacy', templates, [])).toBeUndefined();
  expect(resolveHistoryTemplate('tpl-legacy', templates, extra)?.name_ko).toBe('레거시 진료확인서');
});

test('AC4: 활성셋이 우선(중복 id 시 활성 정본 선택) + 완전 미존재는 undefined(안내 토스트 분기)', () => {
  const templates: Tpl[] = [{ id: 'dup', name_ko: '활성본' }];
  const extra: Tpl[] = [{ id: 'dup', name_ko: '보충본' }];
  expect(resolveHistoryTemplate('dup', templates, extra)?.name_ko).toBe('활성본');
  // 삭제되어 양쪽 다 없으면 undefined → onClick 이 안내 토스트로 분기(무반응 아님).
  expect(resolveHistoryTemplate('gone', templates, extra)).toBeUndefined();
});
