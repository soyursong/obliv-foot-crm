/**
 * E2E Spec — T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT (P1, medical_confirm_gate confirmed_by_relay)
 *
 * 발행된 소견서/진단서 상세에서 필드 단위 수정권한 분리.
 *   A부류(원장 medical 본문 = 진단소견/의사소견): 회색·잠금 read-only(편집 불가, 우회 불가).
 *   B부류(발급요청일자 = 서류 날짜): 원내 직원 편집·저장(요청 레코드에 persist, 발행 원문 불오염).
 *
 * ★depends_on=T-20260721-foot-DOCREPRINT-OPINION-EDIT-NOSYNC 정합(AC-5): 발행본 전체 '수정 팝업' 부활 아님 —
 *   원장 소견 잠금 유지 + 행정필드만 인라인 편집 affordance.
 *
 * AC:
 *   AC-1: (필드분류표 확정) LOCKED={진단소견,의사소견} / EDITABLE={발급요청일자} — 본 구현 scope.
 *   AC-2: A부류 = 읽기전용 + 잠금 아이콘/회색. div 렌더 → 키보드/붙여넣기/프로그램적 우회로도 값 변경 불가.
 *   AC-3: B부류(발급요청일자) 편집·저장 persist + 성공/실패 토스트(묵음 제외 채널).
 *   AC-4: 의료법 §22 — 저장은 원장 medical content(발행본 status='published' 스냅샷) 불오염.
 *          행정필드 write 는 요청 레코드(field_data.request_date)에만 + status<>'published' 가드.
 *   AC-5: NOSYNC 정합 — 발행본 전체 수정 팝업 부활 아님(원장 소견 잠금 + 행정필드만 인라인 편집).
 *
 * 구성:
 *   A. 순수 로직 — matchRequestForPublished(발행본↔요청 매핑) 직접 import·단언.
 *   B. 저장계층 소스 가드 — useUpdateOpinionRequestDate 가 요청 레코드 request_date 만 write + published 차단 + 감사로그.
 *   C. 뷰어 소스 가드 — 잠금 아이콘/회색 read-only div + 발급요청일자 편집 input + 저장 토스트(묵음 제외).
 *
 * 실행: npx playwright test T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchRequestForPublished,
  type CustomerOpinionRequest,
} from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REQ_SRC = () => readFileSync(join(HERE, '../../src/lib/opinionRequest.ts'), 'utf-8');
const TAB_SRC = () => readFileSync(join(HERE, '../../src/components/doctor/OpinionDocTab.tsx'), 'utf-8');

function creq(over: Partial<CustomerOpinionRequest>): CustomerOpinionRequest {
  return { id: 'req-x', checkInId: 'ci-1', docType: 'opinion', requestDate: '2026-07-20', status: 'voided', ...over };
}

// ── A. 순수 로직: 발행본 ↔ 요청 레코드 매핑 (AC-3 편집 대상 결정) ──────────────────────
test.describe('A. matchRequestForPublished — 발행본↔요청 매핑', () => {
  test('check_in_id 우선 매핑(같은 doc_type)', () => {
    const reqs = [creq({ id: 'a', checkInId: 'ci-1' }), creq({ id: 'b', checkInId: 'ci-2' })];
    expect(matchRequestForPublished('ci-2', 'opinion', reqs)?.id).toBe('b');
  });

  test('check_in_id 미일치 → 같은 doc_type 최초 폴백', () => {
    const reqs = [creq({ id: 'a', checkInId: 'ci-9', docType: 'diagnosis' }), creq({ id: 'b', checkInId: 'ci-8', docType: 'opinion' })];
    expect(matchRequestForPublished('ci-1', 'opinion', reqs)?.id).toBe('b');
  });

  test('doc_type 불일치 시 매핑 없음(교차 배제)', () => {
    const reqs = [creq({ id: 'a', docType: 'diagnosis' })];
    expect(matchRequestForPublished('ci-1', 'opinion', reqs)).toBeNull();
  });

  test('요청 0건 → null(무편집 안전)', () => {
    expect(matchRequestForPublished('ci-1', 'opinion', [])).toBeNull();
  });

  test('checkInId null → 같은 doc_type 최초', () => {
    const reqs = [creq({ id: 'a', docType: 'opinion' }), creq({ id: 'b', docType: 'opinion' })];
    expect(matchRequestForPublished(null, 'opinion', reqs)?.id).toBe('a');
  });
});

// ── B. 저장계층 소스 가드 (AC-4 발행 원문 불오염) ────────────────────────────────────
test.describe('B. useUpdateOpinionRequestDate — 요청 레코드에만 write', () => {
  test('request_date 만 merge-write + published 차단 가드', () => {
    const src = REQ_SRC();
    const fn = src.slice(src.indexOf('export function useUpdateOpinionRequestDate'));
    // 요청 식별키(staff_consult) 아니면 거부 — 타 draft/발행본 오염 방지.
    expect(fn).toContain("prev['request_origin'] !== 'staff_consult'");
    // published(발행 원문)는 write 대상 아님 — 조기 차단 + update 쿼리 .neq('status','published') 이중 가드(AC-4).
    expect(fn).toContain("row?.status === 'published'");
    expect(fn).toContain(".neq('status', 'published')");
    // request_date 키만 갱신(발행본 final_text/doctor_name 등 medical 스냅샷 미접촉).
    expect(fn).toContain('request_date: input.requestDate');
    expect(fn).not.toContain('final_text');
  });

  test('편집 감사로그(누가·언제·이전값→새값) append — 의료법 §22 추적성', () => {
    const src = REQ_SRC();
    const fn = src.slice(src.indexOf('export function useUpdateOpinionRequestDate'));
    expect(fn).toContain('admin_edit_log');
    expect(fn).toContain('prev: prevDate');
    expect(fn).toContain('next: input.requestDate');
    expect(fn).toContain('by:');
    expect(fn).toContain('at:');
  });

  test('rows-affected 검증(silent write-failure 금지) — 0행이면 실패 처리', () => {
    const src = REQ_SRC();
    const fn = src.slice(src.indexOf('export function useUpdateOpinionRequestDate'));
    expect(fn).toContain('.select(\'id\')');
    expect(fn).toMatch(/upd\.length === 0.*throw|!upd \|\| upd\.length === 0/s);
  });

  test('customer_id 스코프 조회(타 환자 배제)', () => {
    const src = REQ_SRC();
    const fn = src.slice(src.indexOf('export function useCustomerOpinionRequests'));
    expect(fn).toContain(".eq('customer_id', customerId)");
    expect(fn).toContain("fd['request_origin'] === 'staff_consult'");
  });
});

// ── C. 뷰어 소스 가드 (AC-2 잠금 / AC-3 편집·토스트 / AC-5 NOSYNC 정합) ───────────────
test.describe('C. OpinionDocTab 발행본 상세 뷰어', () => {
  test('A부류 원장 소견 = 잠금 아이콘 + 회색 read-only div(편집요소 없음, AC-2)', () => {
    const src = TAB_SRC();
    // 잠금 표시 아이콘 import + 발행본 상세 read-only body.
    expect(src).toContain('opinion-detail-locked-body');
    expect(src).toContain('발행 후 수정 불가 · 의료법 제22조');
    // read-only body 는 div(textarea/input 아님) — 우회 편집 불가.
    const bodyBlock = src.slice(src.indexOf('opinion-detail-locked-body') - 400, src.indexOf('opinion-detail-locked-body') + 200);
    expect(bodyBlock).toContain('whitespace-pre-wrap');
    expect(bodyBlock).not.toContain('<Textarea');
  });

  test('B부류 발급요청일자 = 편집 input + 저장 버튼(AC-3)', () => {
    const src = TAB_SRC();
    expect(src).toContain('opinion-detail-reqdate-input');
    expect(src).toContain('opinion-detail-reqdate-save');
    expect(src).toContain('handleSaveReqDate');
  });

  test('저장 성공 토스트 = 묵음 제외 채널(toast.confirm) — success/info 묵음 회피(AC-3)', () => {
    const src = TAB_SRC();
    const fn = src.slice(src.indexOf('const handleSaveReqDate'), src.indexOf('const handleSaveReqDate') + 900);
    expect(fn).toContain('toast.confirm(');   // 저장 성공은 반드시 노출
    expect(fn).toContain('toast.error(');     // 실패도 노출
    expect(fn).not.toContain('toast.success(');
  });

  test('발행 이력 내용 클릭 → 상세 뷰어 진입(잠금 아이콘 표시)', () => {
    const src = TAB_SRC();
    expect(src).toContain('opinion-published-view');
    expect(src).toContain('setViewRow(row)');
  });

  test('AC-5 NOSYNC 정합 — 저장은 요청 레코드 훅만 사용(발행 RPC/발행본 write 미접촉)', () => {
    const src = TAB_SRC();
    // 발행본 편집(publish RPC 재호출)로 저장하지 않음 — 행정필드는 요청 레코드 update 훅 경유.
    expect(src).toContain('useUpdateOpinionRequestDate');
    const saveFn = src.slice(src.indexOf('const handleSaveReqDate'), src.indexOf('const handleSaveReqDate') + 900);
    expect(saveFn).not.toContain('publish_opinion_doc');
    expect(saveFn).not.toContain('publishMut');
  });
});
