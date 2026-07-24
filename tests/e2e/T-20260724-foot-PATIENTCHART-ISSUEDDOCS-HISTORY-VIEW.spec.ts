/**
 * E2E Spec — T-20260724-foot-PATIENTCHART-ISSUEDDOCS-HISTORY-VIEW (P1, foot)
 *
 * 개별 환자 진료차트(CustomerChartPage 상담내역 탭)에 소견서·진단서 발행 이력 뷰 3건:
 *   ① 신청 이력 — 누가(신청자)·언제(신청일시) 소견서·진단서를 신청했는지.
 *   ② 발행 여부 — 각 건의 발행완료/미발행 상태 배지.
 *   ③ 발행 서류 열람 — 발행완료 건 서류명 클릭 → 진료차트 내에서 실제 발행본 내용 read-only 열람.
 *
 * 정본 패턴: DASH-ISSUEDDOCS-NAMELIST-EXPAND(deployed a843b4b7, 진료대시보드) + TREATTABLE-DOCS-PARITY(치료테이블).
 * 3 surface 모두 동일 form_submissions 원장 소스 → 발행상태·서류내용 정합. db_change=false(기존 발행이력 READ + FE 렌더).
 *
 * 회귀 임계:
 *   (a) 기존 발행/저장 플로우 무회귀 — form_submissions write(발행 파이프라인·publish RPC) 미접촉.
 *   (b) 진료차트 표시 이력·상태·서류내용이 실제 해당 환자 form_submissions와 일치(타환자 유입 금지) — customer_id 서버필터.
 *   (c) 발행여부 판정이 대시보드·치료테이블과 동일 기준(draft=미발행 / voided+published=발행완료; cancelled 제외).
 *
 * 구성:
 *   A. 순수 로직 — 신규 훅이 소비하는 동일 함수(buildCustomerOpinionRows/computeCustomerOpinionSummary) 직접 import·단언.
 *   B. 정적 소스 가드 — 뷰어 훅/매핑 재사용 + read-only 경계(write/rpc 미접점) + customer_id 격리 + surface(상담내역 탭) 배선.
 *   C. 브라우저 회귀 가드(HTTP 200) + 현장 클릭 시나리오(갤탭 실기기 현장 confirm 대상).
 *
 * 검증 방식(canonical 계승): 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 순수로직/경계 가드.
 *   실브라우저 클릭 시나리오 2종은 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * 실행: npx playwright test T-20260724-foot-PATIENTCHART-ISSUEDDOCS-HISTORY-VIEW.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCustomerOpinionRows,
  computeCustomerOpinionSummary,
  type CustomerOpinionRequestRow,
} from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '../..', rel), 'utf-8');
const SECTION_SRC = () => read('src/components/chart/OpinionDocHistorySection.tsx');
const LIB_SRC = () => read('src/lib/opinionRequest.ts');
const CHART_SRC = () => read('src/pages/CustomerChartPage.tsx');

// 주석 제거 — read-only/게이트 경계 가드는 '실제 코드'에만 적용(설명 주석의 금지어 언급은 무해).
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 라인 주석(URL 의 // 는 앞에 : 가 있어 보존)
const SECTION_CODE = () => stripComments(SECTION_SRC());

// form_submissions raw row 팩토리(supabase 반환 형태).
function sub(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'sub-x',
    customer_id: 'cust-1',
    check_in_id: 'ci-1',
    created_at: '2026-07-24T01:00:00Z',
    status: 'draft',
    field_data: { request_origin: 'staff_consult', doc_type: 'opinion' },
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 순수 로직 — 발행이력 파생/판정 (신규 훅이 소비하는 동일 함수 직접 단언)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 발행이력 순수 로직', () => {
  test('A1: draft=미발행 / voided+published=발행완료 판정 (회귀임계 c)', () => {
    const rows = buildCustomerOpinionRows([
      sub({ id: 'd1', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-24T02:00:00Z' } }),
      sub({ id: 'p1', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'diagnosis', resolved_reason: 'published', requested_at: '2026-07-24T01:00:00Z', resolved_at: '2026-07-24T03:00:00Z' } }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['d1'].publishStatus).toBe('unpublished');
    expect(byId['p1'].publishStatus).toBe('published');
    expect(byId['p1'].resolvedAt).toBe('2026-07-24T03:00:00Z');
  });

  test('A2: cancelled(voided+cancelled) 및 비-staff_consult 는 발행이력에서 제외 (3 surface 정합)', () => {
    const rows = buildCustomerOpinionRows([
      sub({ id: 'c1', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'cancelled' } }),
      sub({ id: 'x1', status: 'draft', field_data: { request_origin: 'penchart', doc_type: 'opinion' } }),
      sub({ id: 'ok', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });

  test('A3: 신청시각(requested_at) 역순 정렬 — 최신 신청 위로', () => {
    const rows = buildCustomerOpinionRows([
      sub({ id: 'old', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-20T01:00:00Z' } }),
      sub({ id: 'new', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', requested_at: '2026-07-24T01:00:00Z' } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  test('A4: 요약 카운트 — 전체/발행완료/미발행', () => {
    const rows: CustomerOpinionRequestRow[] = buildCustomerOpinionRows([
      sub({ id: 'd1', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'opinion' } }),
      sub({ id: 'd2', status: 'draft', field_data: { request_origin: 'staff_consult', doc_type: 'diagnosis' } }),
      sub({ id: 'p1', status: 'voided', field_data: { request_origin: 'staff_consult', doc_type: 'opinion', resolved_reason: 'published' } }),
    ]);
    const s = computeCustomerOpinionSummary(rows);
    expect(s.total).toBe(3);
    expect(s.publishedCount).toBe(1);
    expect(s.unpublishedCount).toBe(2);
  });

  test('A5: 신청자/신청시각/서류종류 필드 매핑 (요구기능 ①)', () => {
    const [r] = buildCustomerOpinionRows([
      sub({ id: 'r1', field_data: { request_origin: 'staff_consult', doc_type: 'diagnosis', requested_by_name: '김실장', requested_at: '2026-07-24T05:30:00Z' } }),
    ]);
    expect(r.requestedByName).toBe('김실장');
    expect(r.requestedAt).toBe('2026-07-24T05:30:00Z');
    expect(r.docType).toBe('diagnosis');
  });

  test('A6: 빈 입력 → 빈 배열(엣지: 발행 이력 없는 환자)', () => {
    expect(buildCustomerOpinionRows([])).toEqual([]);
    expect(computeCustomerOpinionSummary([])).toEqual({ total: 0, publishedCount: 0, unpublishedCount: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 정적 소스 가드 — 단일 소스 재사용 · read-only 경계 · customer 격리 · surface 배선
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. 소스 구조 가드', () => {
  test('B1: 발행본 열람 = 기존 뷰어 훅/매핑 재사용 (단일 소스)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('usePublishedOpinionDocs');
    expect(s).toContain('matchPublishedOpinionDoc');
    expect(s).toContain('composeOpinionDoc'); // 레거시 폴백
    expect(s).toContain('useCustomerOpinionRequests');
  });

  test('B2: read-only 경계 — 발행 파이프라인 write/RPC 미접촉 (회귀임계 a)', () => {
    const s = SECTION_CODE(); // 실제 코드만(설명 주석 제외)
    expect(s).not.toContain('publish_opinion_doc');
    expect(s).not.toContain('.insert(');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.delete(');
    expect(s).not.toContain('useResolveOpinionRequest');
    expect(s).not.toContain('useCreateOpinionRequest');
    expect(s).not.toContain('useUpdateStaffMemo');
  });

  test('B3: 진료대시보드/진료관리(의사공간) 코드 무접촉 (§11 게이트 경계)', () => {
    const s = SECTION_CODE(); // 실제 코드만(설명 주석 제외)
    expect(s).not.toContain('DocRequestQueue');
    expect(s).not.toContain('OpinionEditorDialog');
    expect(s).not.toContain('DoctorDashboard');
    // OpinionDocTab 은 OPINION_SECTIONS(폴백 렌더 상수)만 import — authoring UI 미사용.
    expect(SECTION_SRC()).toContain('OPINION_SECTIONS');
  });

  test('B4: customer_id 격리 — 훅 쿼리가 customer_id 서버필터 (회귀임계 b, 타환자 유입 금지)', () => {
    const lib = LIB_SRC();
    // useCustomerOpinionRequests 블록에 customer_id eq 필터.
    const block = lib.slice(lib.indexOf('useCustomerOpinionRequests'));
    expect(block).toContain(".eq('customer_id', customerId)");
    expect(block).toContain(".in('status', ['draft', 'voided'])");
    // 발행본 열람도 화면상 발행완료 있을 때만 그 환자 id 로 조회.
    expect(SECTION_SRC()).toContain('publishedCustomerIds');
  });

  test('B5: 발행완료만 클릭 열람 / 미발행은 정적 배지 (시나리오2-②)', () => {
    const s = SECTION_SRC();
    expect(s).toContain("r.publishStatus === 'published' ?");
    expect(s).toContain('opinion-history-docname-view');
  });

  test('B6: CustomerChartPage 상담내역 탭에 발행이력 섹션 배선 (surface)', () => {
    const c = CHART_SRC();
    expect(c).toContain("import OpinionDocHistorySection from '@/components/chart/OpinionDocHistorySection'");
    expect(c).toContain('<OpinionDocHistorySection');
    // OpinionRequestBox(실장영역) 바로 아래 배치 — 같은 상담내역 탭.
    const reqIdx = c.indexOf('<OpinionRequestBox');
    const histIdx = c.indexOf('<OpinionDocHistorySection');
    expect(reqIdx).toBeGreaterThan(0);
    expect(histIdx).toBeGreaterThan(reqIdx);
  });

  test('B7: 발행여부 배지 라벨 — 발행완료/미발행 (판정 정합 표기)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('발행완료');
    expect(s).toContain('미발행');
    expect(s).toContain('opinion-history-publish-badge');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. 브라우저 회귀 가드 — 앱 로드(HTTP 200)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. 브라우저 회귀 가드', () => {
  test('C1: 앱 진입 HTTP 200 (번들 무붕괴)', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트 (실계정 PHI → 자동화 대상 아님) ──────────────────
 * 시나리오 1 (정상 동선):
 *   [ ] 로그인 → 환자 검색 → 개별 진료차트 진입 → 상담내역 탭
 *   [ ] '소견서·진단서 발행 이력' 섹션에 그 환자 신청 건 목록 표시
 *   [ ] 각 행에 신청자·신청일시 표시
 *   [ ] 각 행에 발행완료/미발행 배지 표시
 *   [ ] 발행완료 행 서류명 클릭 → 서류 내용이 진료차트 내에서 바로 열림
 *   [ ] 열린 내용이 실제 그 환자 발행 서류와 일치(타환자 아님)
 * 시나리오 2 (엣지):
 *   [ ] 발행 이력 없는 환자 → "발행 이력 없음" 빈 상태, 에러 없음
 *   [ ] 미발행 건 → 클릭 불가(정적 배지), 에러 없음
 *   [ ] 대시보드·치료테이블의 같은 환자 발행상태와 진료차트 발행상태 동일(3 surface 정합)
 */
