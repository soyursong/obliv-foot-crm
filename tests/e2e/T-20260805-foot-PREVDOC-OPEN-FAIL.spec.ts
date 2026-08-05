/**
 * E2E Spec — T-20260805-foot-PREVDOC-OPEN-FAIL
 *
 * 현장 버그 (김주연 총괄 보고, 2026-08-05, P0 hotfix):
 *   서류 재발급 화면 / 발행이력 목록에서 이전 발행 서류가 '알 수 없는 양식 임시' 라벨로 뜨고
 *   클릭해도 열리지 않음(열기·수정·저장 3동작 동반 실패). 재현 케이스: 특정 환자(customer_id 로만 참조,
 *   §4.3 UUID-PK-only)의 2026-07-28 발행 항목.
 *
 * RC (prod 데이터 read-only 검증으로 확정):
 *   해당 항목은 form_submissions row 로 template_id=NULL·status='draft', field_data.form_key=
 *   'blood_reception_daily'. 이는 '발행 서류'가 아니라 혈액/검사 접수·항목상태 레이어
 *   (examItemStatus.ts·BloodDailyListSection.tsx·ExamTargetsSection.tsx)가 form_submissions 를
 *   key-value 영속 저장소로 재사용해 기록한 '내부 상태 레코드'다. 발행 이력 목록이 check_in 의 전체
 *   form_submissions 를 필터 없이 렌더하면서 이 상태 레코드까지 섞여 나왔고, template_id 가 없어
 *   양식이 해석되지 않아 '알 수 없는 양식'(fallback 라벨) + '임시'(draft 뱃지)로 뜨고 클릭이 무동작.
 *   (참고: 같은 화면의 정상 발행분 07/25 '검사결과 보고서'는 template_id 보유 → 정상.)
 *
 * FIX:
 *   발행 이력에는 '실제 발행된 서류'(template_id 보유)만 노출. printable-doc 불변식 — 모든 발행 INSERT
 *   경로는 template_id 를 세팅하고, template_id=NULL writer 는 위 상태 레이어뿐(전 코드 전수 grep 확인).
 *   판별 SSOT = src/lib/issuanceHistory.ts. 구조 불변식 기반이라 향후 신규 상태 레이어(동일 NULL 패턴)도
 *   자동 제외 — form_key 하드코딩 열거 불필요.
 *
 * 실행: npx playwright test T-20260805-foot-PREVDOC-OPEN-FAIL.spec.ts
 */

import { test, expect } from '@playwright/test';
import { isPrintableSubmission, filterIssuanceHistory } from '../../src/lib/issuanceHistory';

// prod 실데이터 형태를 반영한 픽스처(환자 식별자 미포함, 구조만 재현).
const BLOOD_STATE_RECORD = {
  id: '232cfb2d-27ad-46ab-8d6f-28b5efb131a9',
  template_id: null,
  status: 'draft',
  field_data: { form_key: 'blood_reception_daily', received: true, request_date: '2026-07-25' },
  created_at: '2026-07-28T08:29:56.573579+00:00',
};
const EXAM_ITEM_STATE_RECORD = {
  id: 'eb0409c9-0000-0000-0000-000000000000',
  template_id: null,
  status: 'draft',
  field_data: { form_key: 'blood_item_action_status', item_status: 'hold', request_date: '2026-07-28' },
  created_at: '2026-07-28T08:25:00.000000+00:00',
};
const KOH_STATE_RECORD = {
  id: 'koh00000-0000-0000-0000-000000000000',
  template_id: null,
  status: 'draft',
  field_data: { form_key: 'koh_exam_item_status', item_status: 'retest', request_date: '2026-07-28' },
  created_at: '2026-07-28T08:20:00.000000+00:00',
};
const PRINTED_DOC = {
  id: 'd39cfaec-7deb-4be1-a023-8fecae56ead7',
  template_id: '1ffefed2-3160-46d7-ae5e-9545e1ae374e', // 검사결과 보고서
  status: 'published',
  field_data: {},
  created_at: '2026-07-25T05:25:47.732956+00:00',
};
const PRINTED_RECEIPT = {
  id: 'rcpt0000-0000-0000-0000-000000000000',
  template_id: 'aaaa1111-2222-3333-4444-555555555555',
  status: 'printed',
  field_data: {},
  created_at: '2026-07-28T09:00:00.000000+00:00',
};

// ── AC1: 내부 상태 레코드(template_id=NULL)는 발행 서류가 아니다 ─────────────────────
test('AC1: template_id=NULL 상태 레코드(blood/exam/koh)는 발행 서류로 판정되지 않는다', () => {
  expect(isPrintableSubmission(BLOOD_STATE_RECORD)).toBe(false);
  expect(isPrintableSubmission(EXAM_ITEM_STATE_RECORD)).toBe(false);
  expect(isPrintableSubmission(KOH_STATE_RECORD)).toBe(false);
});

// ── AC2: 실제 발행된 서류(template_id 보유)는 발행 서류로 판정된다 ────────────────────
test('AC2: template_id 보유 서류(published/printed)는 발행 서류로 판정된다', () => {
  expect(isPrintableSubmission(PRINTED_DOC)).toBe(true);
  expect(isPrintableSubmission(PRINTED_RECEIPT)).toBe(true);
});

// ── AC3: 발행 이력 필터 — 상태 레코드는 사라지고 발행 서류만 남는다(현장 재현 케이스) ──
test('AC3: filterIssuanceHistory 는 상태 레코드를 제외하고 발행 서류만 남긴다', () => {
  const all = [BLOOD_STATE_RECORD, PRINTED_DOC, EXAM_ITEM_STATE_RECORD, PRINTED_RECEIPT, KOH_STATE_RECORD];
  const shown = filterIssuanceHistory(all);
  expect(shown.map((s) => s.id)).toEqual([PRINTED_DOC.id, PRINTED_RECEIPT.id]);
  // '알 수 없는 양식 임시'(=07/28 blood_reception_daily 상태 레코드)는 더 이상 이력에 없다.
  expect(shown.some((s) => s.id === BLOOD_STATE_RECORD.id)).toBe(false);
});

// ── AC4: 무회귀 — 정상 발행분만 있는 이력은 그대로 유지(전건 통과) ─────────────────────
test('AC4 무회귀: 상태 레코드가 없으면 발행 이력은 원본 그대로', () => {
  const onlyDocs = [PRINTED_DOC, PRINTED_RECEIPT];
  expect(filterIssuanceHistory(onlyDocs)).toEqual(onlyDocs);
  expect(filterIssuanceHistory([])).toEqual([]);
});

// ── AC5: 방어 — template_id 가 빈 문자열/undefined 여도 상태 레코드로 취급(발행 아님) ──
test('AC5 방어: template_id 가 빈 문자열/undefined 인 row 도 발행 서류로 오분류되지 않는다', () => {
  expect(isPrintableSubmission({ template_id: '' })).toBe(false);
  expect(isPrintableSubmission({})).toBe(false);
  expect(isPrintableSubmission({ template_id: undefined })).toBe(false);
});
