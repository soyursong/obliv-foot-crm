/**
 * E2E Spec — T-20260728-foot-CHART2-DOCREQ-HISTORY-COORDPERM (P1, foot)
 *
 * 풋 2번차트 상담내역 현장요청 2건:
 *   ① 서류(소견서/진단서) 요청 이력 요약 줄 → **상세 테이블** 확장.
 *      칼럼: 신청일시 · 서류종류 · 신청직원 · 발급상태(신청됨/발급완료/취소 3-state).
 *      발급상태 = DIAGDOC(closed) 상태매핑 재사용(신청됨=draft / 발급완료=voided+published / 취소=voided+cancelled).
 *      신청직원 = field_data.requested_by_name **단독**(DA MSG-8dqz: issued_by 조인 금지 = '발급직원' 오표시, requested_by_id 부재).
 *   ② 코디네이터(coordinator) 서류 '신청(요청)' 권한 = **신청만**. 출력(발급)·취소·발행은 미부여(원장 유지).
 *      DA CONSULT-REPLY(9fka/8dqz): ADDITIVE·FE-only·무DDL(form_submissions_insert RLS = active member 전원 허용).
 *
 * 회귀 임계:
 *   (a) buildCustomerOpinionRows(발행이력 2-state, T-20260724) 판정 무회귀 — 본 티켓은 별 파생(buildCustomerDocRequestRows) 추가.
 *   (b) 신청직원 = requested_by_name 단독(issued_by→staff 조인 금지 = 발급직원 오표시). 결측 → '—'.
 *   (c) coordinator 취소 버튼 비노출(신청만) · 다른 역할 취소 동선 무회귀 · 신청은 전 직군(RLS 패리티) 허용.
 *
 * 구성:
 *   A. 순수 로직 — buildCustomerDocRequestRows/computeDocRequestSummary 직접 import·단언(3-state 판정·매핑·정렬).
 *   B. 권한 SSOT — canRequestOpinionDoc/canCancelOpinionRequest 술어(coordinator 신청 O / 취소 X).
 *   C. 정적 소스 가드 — 상세 테이블 배선(4칼럼) · issued_by 조인 부재 · 취소 게이트 배선 · read-only 경계.
 *   D. 브라우저 회귀(HTTP 200).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 순수로직/술어 단언 + 정적 구조 가드 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오(coordinator 로그인)는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * 실행: npx playwright test T-20260728-foot-CHART2-DOCREQ-HISTORY-COORDPERM.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCustomerDocRequestRows,
  computeDocRequestSummary,
  DOC_REQUEST_STATUS_LABEL,
  type CustomerDocRequestRow,
} from '../../src/lib/opinionRequest';
import {
  canRequestOpinionDoc,
  canCancelOpinionRequest,
  OPINION_REQUEST_ROLES,
  OPINION_CANCEL_ROLES,
} from '../../src/lib/permissions';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '../..', rel), 'utf-8');
const SECTION_SRC = () => read('src/components/chart/OpinionDocHistorySection.tsx');
const LIB_SRC = () => read('src/lib/opinionRequest.ts');
const BOX_SRC = () => read('src/components/consult/OpinionRequestBox.tsx');
const CHART_SRC = () => read('src/pages/CustomerChartPage.tsx');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// form_submissions raw row 팩토리(supabase 반환 형태).
function sub(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'sub-x',
    customer_id: 'cust-1',
    check_in_id: 'ci-1',
    created_at: '2026-07-28T01:00:00Z',
    status: 'draft',
    field_data: { request_origin: 'staff_consult', doc_type: 'opinion' },
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 순수 로직 — 상세 테이블 3-state 파생 (신청됨/발급완료/취소)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 상세 테이블 3-state 순수 로직', () => {
  test('A1: 신청됨=draft / 발급완료=voided+published / 취소=voided+cancelled (DIAGDOC 매핑, AC①-2)', () => {
    const rows = buildCustomerDocRequestRows([
      sub({ id: 'req', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-28T03:00:00Z' } }),
      sub({ id: 'iss', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'diagnosis', resolved_reason: 'published', requested_at: '2026-07-28T02:00:00Z', resolved_at: '2026-07-28T04:00:00Z' } }),
      sub({ id: 'cxl', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'cancelled', requested_at: '2026-07-28T01:00:00Z' } }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['req'].issueStatus).toBe('requested');
    expect(byId['iss'].issueStatus).toBe('issued');
    expect(byId['cxl'].issueStatus).toBe('cancelled');
    // 발급완료만 publishStatus='published'(doc-view 게이트 정합), 나머지 unpublished.
    expect(byId['iss'].publishStatus).toBe('published');
    expect(byId['req'].publishStatus).toBe('unpublished');
    expect(byId['cxl'].publishStatus).toBe('unpublished');
  });

  test('A2: 취소 건이 이력에서 누락되지 않고 행으로 노출 (AC①-3, buildCustomerOpinionRows 와의 차이)', () => {
    const rows = buildCustomerDocRequestRows([
      sub({ id: 'cxl', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'cancelled' } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['cxl']); // 취소 포함(발행이력 빌더는 제외했던 건)
    expect(rows[0].issueStatus).toBe('cancelled');
  });

  test('A3: 비-staff_consult / published 원본은 요청 이력 아님(제외)', () => {
    const rows = buildCustomerDocRequestRows([
      sub({ id: 'pen', status: 'draft', field_data: { request_origin: 'penchart', doc_type: 'opinion' } }),
      sub({ id: 'pub', status: 'published', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
      sub({ id: 'ok', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });

  test('A4: 신청직원 = requested_by_name 단독 — issued_by 무시(회귀임계 b, 발급직원 오표시 방지)', () => {
    const [r] = buildCustomerDocRequestRows([
      sub({
        id: 'r1',
        issued_by: 'staff-PRINTER-999',           // 발급/출력 직원 — '신청직원'으로 새면 안 됨
        field_data: { request_origin: 'staff_consult', doc_type: 'diagnosis', requested_by_name: '김코디', requested_at: '2026-07-28T05:30:00Z' },
      }),
    ]);
    expect(r.requestedByName).toBe('김코디');    // requested_by_name 그대로
    expect(r.requestedByName).not.toContain('999');
    expect(r.requestedAt).toBe('2026-07-28T05:30:00Z');
    expect(r.docType).toBe('diagnosis');
  });

  test('A5: 신청직원 결측 → 빈 문자열(컴포넌트에서 "—" placeholder)', () => {
    const [r] = buildCustomerDocRequestRows([
      sub({ id: 'r2', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
    ]);
    expect(r.requestedByName).toBe('');
  });

  test('A6: 신청시각(requested_at) 역순 정렬 — 최신 신청 위로', () => {
    const rows = buildCustomerDocRequestRows([
      sub({ id: 'old', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-20T01:00:00Z' } }),
      sub({ id: 'new', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-28T01:00:00Z' } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  test('A7: 요약 카운트 — 전체/발급완료/미발행/취소', () => {
    const rows: CustomerDocRequestRow[] = buildCustomerDocRequestRows([
      sub({ id: 'd1', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
      sub({ id: 'i1', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'published' } }),
      sub({ id: 'c1', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'cancelled' } }),
    ]);
    const s = computeDocRequestSummary(rows);
    expect(s).toEqual({ total: 3, requestedCount: 1, issuedCount: 1, cancelledCount: 1 });
  });

  test('A8: 상태 라벨 SSOT — 신청됨(미발행)/발급완료(발행완료)/취소', () => {
    expect(DOC_REQUEST_STATUS_LABEL.requested).toBe('미발행');
    expect(DOC_REQUEST_STATUS_LABEL.issued).toBe('발행완료');
    expect(DOC_REQUEST_STATUS_LABEL.cancelled).toBe('취소');
  });

  test('A9: 빈 입력 → 빈 배열 / 빈 요약', () => {
    expect(buildCustomerDocRequestRows([])).toEqual([]);
    expect(computeDocRequestSummary([])).toEqual({ total: 0, requestedCount: 0, issuedCount: 0, cancelledCount: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 권한 SSOT — coordinator 신청 O / 취소 X (item②)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. 코디 서류신청 권한 술어', () => {
  test('B1: coordinator = 신청(요청) 권한 O (AC②-1)', () => {
    expect(canRequestOpinionDoc('coordinator')).toBe(true);
  });

  test('B2: coordinator = 취소(철회) 권한 X — 신청만 (AC②-2/시나리오3)', () => {
    expect(canCancelOpinionRequest('coordinator')).toBe(false);
  });

  test('B3: 다른 역할(실장 consultant/원장 director/관리자)은 신청·취소 모두 유지 (무회귀)', () => {
    for (const role of ['admin', 'manager', 'director', 'consultant'] as const) {
      expect(canRequestOpinionDoc(role)).toBe(true);
      expect(canCancelOpinionRequest(role)).toBe(true);
    }
  });

  test('B4: 신청 role-set = 전 직군(RLS 패리티, lock-out 0) / 취소 = 신청 − coordinator', () => {
    expect(OPINION_REQUEST_ROLES).toContain('coordinator');
    // 취소 set 은 coordinator 만 빠지고 나머지 동일.
    expect(OPINION_CANCEL_ROLES).not.toContain('coordinator');
    expect(new Set(OPINION_CANCEL_ROLES)).toEqual(
      new Set(OPINION_REQUEST_ROLES.filter((r) => r !== 'coordinator')),
    );
  });

  test('B5: null/unknown role → fail-closed(false) (INV-4)', () => {
    expect(canRequestOpinionDoc(null)).toBe(false);
    expect(canRequestOpinionDoc(undefined)).toBe(false);
    expect(canCancelOpinionRequest(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. 정적 소스 가드 — 상세 테이블 배선 · issued_by 조인 부재 · 취소 게이트 · read-only
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. 소스 구조 가드', () => {
  test('C1: 상세 테이블 4칼럼 헤더 (신청일시·서류종류·신청직원·발급상태)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('신청일시');
    expect(s).toContain('서류종류');
    expect(s).toContain('신청직원');
    expect(s).toContain('발급상태');
    expect(s).toContain('opinion-history-table');
    // 발급상태 3-state 배지 배선.
    expect(s).toContain('IssueStatusBadge');
    expect(s).toContain('r.issueStatus');
  });

  test('C2: 신청직원 = requested_by_name 단독 — 빌더가 issued_by 를 신청직원으로 쓰지 않음(회귀임계 b)', () => {
    const lib = stripComments(LIB_SRC());
    // buildCustomerDocRequestRows 블록에서 requestedByName 소스가 field_data.requested_by_name 여야 함.
    const start = lib.indexOf('export function buildCustomerDocRequestRows');
    const block = lib.slice(start, start + 2000);
    expect(block).toContain("requestedByName: String(fd['requested_by_name']");
    // issued_by 를 requestedByName 에 매핑하지 않음(발급직원 오표시 방지).
    expect(block).not.toContain("requestedByName: String(r['issued_by']");
    expect(block).not.toContain("requestedByName: String(fd['issued_by']");
  });

  test('C3: customer_id 격리 — useCustomerDocRequestHistory 가 customer_id 서버필터', () => {
    const lib = LIB_SRC();
    const block = lib.slice(lib.indexOf('useCustomerDocRequestHistory'));
    expect(block).toContain(".eq('customer_id', customerId)");
    expect(block).toContain(".in('status', ['draft', 'voided'])");
  });

  test('C4: read-only 경계 — 섹션이 발행 파이프라인 write/RPC 미접촉 (회귀임계 a)', () => {
    const s = stripComments(SECTION_SRC());
    expect(s).not.toContain('publish_opinion_doc');
    expect(s).not.toContain('.insert(');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.delete(');
    expect(s).not.toContain('useResolveOpinionRequest');
    expect(s).not.toContain('useCreateOpinionRequest');
  });

  test('C5: 코디 취소 버튼 게이트 배선 — OpinionRequestBox canCancel 조건부 렌더', () => {
    const box = BOX_SRC();
    expect(box).toContain('canCancel');
    expect(box).toContain('{canCancel && (');
    // 취소 X 버튼 testid 가 canCancel 게이트 안에 있어야 함.
    const gateIdx = box.indexOf('{canCancel && (');
    const cancelBtnIdx = box.indexOf('opinion-req-cancel-');
    expect(gateIdx).toBeGreaterThan(0);
    expect(cancelBtnIdx).toBeGreaterThan(gateIdx);
  });

  test('C6: CustomerChartPage 가 role 기반 canRequest/canCancel 주입', () => {
    const c = CHART_SRC();
    expect(c).toContain('canRequestOpinionDoc(profile?.role)');
    expect(c).toContain('canCancelOpinionRequest(profile?.role)');
    expect(c).toContain('canRequest={canRequestOpinionDoc');
    expect(c).toContain('canCancel={canCancelOpinionRequest');
  });

  test('C7: 진료대시보드/진료관리(의사공간) 코드 무접촉 (§11 게이트)', () => {
    const s = stripComments(SECTION_SRC());
    expect(s).not.toContain('DocRequestQueue');
    expect(s).not.toContain('OpinionEditorDialog');
    expect(s).not.toContain('DoctorDashboard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. 브라우저 회귀 가드 — 앱 로드(HTTP 200)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D. 브라우저 회귀 가드', () => {
  test('D1: 앱 진입 HTTP 200 (번들 무붕괴)', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (실계정 PHI → 자동화 대상 아님) ──────────────────
 * 시나리오 1 (요청①: 상세 테이블):
 *   [ ] 서류요청 2건+ 환자 → 2번차트 → 상담내역 탭
 *   [ ] '소견서·진단서 서류요청 이력'이 행 단위 테이블(신청일시/서류종류/신청직원/발급상태)로 표시(요약 N개 아님)
 *   [ ] 발급완료 건 = "발행완료", 취소 건 = "취소", 미발행 건 = "미발행" 정확 표기(오분류 0)
 *   [ ] 신청직원 칼럼 = '신청한 사람' 이름(발급/출력한 직원 아님) · 결측 행은 '—'
 *   [ ] 발급완료 서류종류 클릭 → 실제 발행본 내용 열람(미발행/취소는 클릭 불가 정적 배지)
 * 시나리오 2 (요청②: 코디 신청 동선 + 권한 경계):
 *   [ ] coordinator 계정 로그인 → 2번차트 상담내역 탭 → '발행 요청' 버튼 노출·동작(신청 제출 성공)
 *   [ ] 신청 후 이력 테이블에 새 행: 신청직원=로그인 코디 이름, 발급상태="미발행"
 *   [ ] coordinator 계정: 신청내역 목록 행에 '취소(X)' 버튼 **비노출** · 서류 출력/발행 액션 없음
 *   [ ] director(원장) 계정: 코디가 요청한 건 최종 발행(출력) 가능(발행 체인 무회귀)
 *   [ ] consultant(실장) 계정: 기존 '취소(X)' 버튼 그대로 노출(무회귀)
 */
