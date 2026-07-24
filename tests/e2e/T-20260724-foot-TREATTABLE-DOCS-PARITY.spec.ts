/**
 * E2E Spec — T-20260724-foot-TREATTABLE-DOCS-PARITY (P1, medical_confirm_gate RESOLVED/RELEASED)
 *
 * 치료테이블 '소견서·진단서' 메뉴에 진료대시보드 서류 스펙 동일 적용 + 신규 2건.
 * canonical = T-20260724-foot-DASH-ISSUEDDOCS-DOCVIEW-CLICKOPEN(deployed 9ec7e5b6, DocRequestQueue 뷰어).
 *
 * 3개 기능(all additive read/FE, db_change=false):
 *   ① 발행 목록 + 클릭 열람: 치료테이블 [소견서·진단서](DiagDocSection) 발행완료 서류명 클릭 → 실제 발행본
 *      내용 read-only 열람. 소스=기존 usePublishedOpinionDocs(final_text)+matchPublishedOpinionDoc 원자매핑,
 *      미발견 시 composeOpinionDoc 폴백. 순수 view(취소/재발행 side-effect 없음).
 *   ② 자동연동(수리): 소견서·진단서 작성 폼(OpinionEditorDialog) 진입 시 생년월일·당일 시술·처방내역 자동 표시.
 *      기존 authoring surface prefill 결선(useQueueClinicalSnaps 재사용, customer_id 필터 → 타 환자 유입 배제).
 *   ③ 필드별 수정권한: 원장 작성 medical 본문(진단소견/의사소견)=치료테이블 뷰어에서 read-only(편집 노출 0, AC3).
 *      행정필드(발급요청일자 등)=기존 실장 요청박스(OpinionRequestBox '서류 날짜')에서 편집 유지(AC4) — 치료테이블 미신설(scope-guard).
 *
 * AC:
 *   AC1: 발행완료 서류가 서류명으로 개별 나열되고 클릭 시 서류 내용 전체를 바로 열람.
 *   AC2: 작성 폼에서 생년월일·당일 시술·처방내역 자동 표시(미작동 해소), 값=해당 환자 실데이터(타 환자 유입 없음).
 *   AC3: 원장 직접 작성 영역은 원내 스태프에게 read-only(어떤 경로로도 편집 노출 없음).
 *   AC4: 발급 요청일자 등 원장 작성영역 외 항목은 원내 스태프가 수정 가능(기존 요청박스 유지).
 *   AC5: 기존 발행/저장/열람 read-only 성격 무회귀(발행 취소·재발행 side-effect 미유발).
 *
 * 구성:
 *   A. 순수 로직 — DiagDocSection 이 소비하는 동일 함수(buildDiagDocRows/filterDiagDocByDate) 직접 import.
 *   B. 정적 소스 가드 — 뷰어 훅/매핑 재사용 + read-only 경계 + write/rpc 미접점.
 *   C. 자동연동 배선 가드(②) + 필드권한 경계 가드(③).
 *   D. 브라우저 회귀 가드(HTTP 200) + 현장 클릭 시나리오(갤탭 실기기 confirm 대상).
 *
 * 검증 방식(canonical 계승): 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 순수로직/경계 가드.
 *   실브라우저 클릭 시나리오 3종은 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * 실행: npx playwright test T-20260724-foot-TREATTABLE-DOCS-PARITY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDiagDocRows,
  filterDiagDocByDate,
  type DiagDocRow,
} from '../../src/components/treatment/DiagDocSection';
import type { OpinionRequestRow } from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '../..', rel), 'utf-8');
const SECTION_SRC = () => read('src/components/treatment/DiagDocSection.tsx');
const EDITOR_SRC = () => read('src/components/doctor/OpinionDocTab.tsx');
const REQBOX_SRC = () => read('src/components/consult/OpinionRequestBox.tsx');
const LIB_SRC = () => read('src/lib/opinionRequest.ts');

// 테스트용 OpinionRequestRow 팩토리(훅 반환 형태).
function req(over: Partial<OpinionRequestRow>): OpinionRequestRow {
  return {
    id: 'req-x',
    customerId: 'cust-1',
    checkInId: 'ci-1',
    docType: 'opinion',
    selectedKeys: [],
    staffMemo: '',
    oralMedReason: '',
    patientName: '홍길동',
    chartNo: null,
    birthDate: null,
    requestedByName: '',
    requestedAt: '2026-07-24T01:00:00Z',
    createdAt: '2026-07-24T01:00:00Z',
    requestDate: '',
    ...over,
  };
}

test.describe('T-20260724-foot-TREATTABLE-DOCS-PARITY — 치료테이블 소견서·진단서 서류 스펙 미러 + 자동연동 + 필드권한', () => {
  // ── A. 순수 로직: 발행완료/미발행 병합 + 날짜 스코프(canonical 로직 무회귀, AC5) ────────────
  test('A1: buildDiagDocRows — 발행완료(published) 우선 편입 + 미발행(draft) 뒤 + 발행상태 정확', () => {
    const published = [req({ id: 'p1', docType: 'diagnosis', resolvedAt: '2026-07-24T02:00:00Z' })];
    const drafts = [req({ id: 'd1', docType: 'opinion' })];
    const rows = buildDiagDocRows(drafts, published);
    const p = rows.find((r) => r.id === 'p1')!;
    const d = rows.find((r) => r.id === 'd1')!;
    expect(p.publishStatus).toBe('published');
    expect(d.publishStatus).toBe('unpublished');
  });

  test('A2: filterDiagDocByDate — 신청시각 KST 날짜 스코프 유지(회귀 0)', () => {
    const rows = buildDiagDocRows([], [req({ id: 'p1', requestedAt: '2026-07-24T01:00:00Z', resolvedAt: '2026-07-24T02:00:00Z' })]);
    expect(filterDiagDocByDate(rows, '2026-07-24').length).toBe(1);
    expect(filterDiagDocByDate(rows, '2026-07-23').length).toBe(0);
  });

  // ── B. 기능①: 발행본 read-only 열람 뷰어(DASH-ISSUEDDOCS-DOCVIEW-CLICKOPEN 이식) ────────────
  test('B1(AC1): 발행완료 서류명 클릭 요소 + 실발행본 뷰어 결선', () => {
    const s = SECTION_SRC();
    expect(s).toContain('data-testid="diagdoc-docname-view"');      // 발행완료 서류명 클릭 요소
    expect(s).toContain('data-testid="diagdoc-doc-view-dialog"');   // 열람 다이얼로그
    expect(s).toContain('data-testid="diagdoc-doc-view-body"');     // 발행본 본문
    expect(s).toContain('openDocView');                              // 클릭 → 열람 핸들러
  });

  test('B2(AC1): 뷰어 소스 = 기존 발행본 훅/매핑 재사용(단일 소스, 신규 조회 0)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('usePublishedOpinionDocs');
    expect(s).toContain('matchPublishedOpinionDoc');
    expect(s).toContain('composeOpinionDoc');   // 미발견 폴백(기존 합성기 재사용)
  });

  test('B3(AC2/AC3): 교차노출 방지 — 발행완료 행 customer_id 로만 발행본 조회', () => {
    const s = SECTION_SRC();
    expect(s).toContain('publishedCustomerIds');
    // matchPublishedOpinionDoc 자체가 docType+check_in_id→customer 원자매핑(라이브러리 계약).
    const lib = LIB_SRC();
    expect(lib).toContain('export function matchPublishedOpinionDoc');
  });

  test('B4(AC3/AC5): 뷰어 read-only 전용 — 재발행/취소/수정 side-effect 요소 없음', () => {
    const s = SECTION_SRC();
    // 열람 다이얼로그 내부에 닫기만 존재. 발행/취소/수정 mutation '호출' 미접점(주석 언급은 무관, 실 호출만 가드).
    expect(s).toContain('data-testid="diagdoc-doc-view-close"');
    expect(s).not.toContain(".rpc('publish_opinion_doc'");    // 발행 RPC 호출 없음
    expect(s).not.toContain('useResolveOpinionRequest');      // 취소/재발행 mutation 미사용(import·호출 0)
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.insert(');
  });

  test('B5(AC1): 미발행 행은 클릭 불가(정적 배지) — 빈 뷰어/오표기 방지', () => {
    const s = SECTION_SRC();
    // published 일 때만 클릭 버튼, 아니면 Badge.
    expect(s).toMatch(/publishStatus === 'published'[\s\S]*diagdoc-docname-view[\s\S]*<Badge/);
  });

  // ── C. 기능②: 자동연동(생년월일/당일시술/처방내역) 배선 가드 ─────────────────────────────
  test('C1(AC2): 작성 폼에 생년월일·당일시술·처방내역 자동연동 표시 요소', () => {
    const e = EDITOR_SRC();
    expect(e).toContain('data-testid="opinion-autofill-ref"');
    expect(e).toContain('data-testid="opinion-autofill-birth"');
    expect(e).toContain('data-testid="opinion-autofill-treatment"');
    expect(e).toContain('data-testid="opinion-autofill-rx"');
  });

  // T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK [RC fix]: 자동연동 소스를 실 데이터가 존재하는 SSOT 로 재결선.
  //   구 배선(useQueueClinicalSnaps medical_charts + visitor.birth_date)은 공란 RC 원인 → loadOpinionAutofillRef 로 교체.
  //   AC2 불변식(customer_id/check_in_id 스코프 조회 = 타 환자 유입 배제)은 유지 — 소스 identity 만 갱신.
  test('C2(AC2): 자동연동 소스 = loadOpinionAutofillRef 재결선 + customer_id/check_in_id 로만 조회(타 환자 유입 배제)', () => {
    const e = EDITOR_SRC();
    expect(e).toContain('loadOpinionAutofillRef');
    // visitor.customer_id + visitor.id(check_in) 스코프로만 조회(전역/타 환자 소스 미참조).
    expect(e).toMatch(/loadOpinionAutofillRef\(clinicId, visitor\?\.customer_id \?\? null, visitor\?\.id \?\? null\)/);
    expect(e).toContain("queryKey: ['opinion_autofill_ref'");
  });

  test('C3(AC2): 시술/처방 없는 환자 → 빈 표기(오표기 방지, 시나리오2-4)', () => {
    const e = EDITOR_SRC();
    // 값 없으면 "없음" 폴백(재결선 후에도 유지).
    expect(e).toContain("autofillRef?.treatment || '없음'");
    expect(e).toContain("autofillRef?.prescription || '없음'");
    expect(e).toContain("autofillRef?.birthDisplay || '없음'");
  });

  // ── D. 기능③: 필드권한 경계 가드 ──────────────────────────────────────────────────────
  test('D1(AC3): 원장 medical 본문 read-only 경계 — 치료테이블 뷰어에 편집 폼/textarea 신설 없음', () => {
    const s = SECTION_SRC();
    // 발행본 표시는 read-only div(pre-wrap). 편집 입력요소·발행/저장 버튼 미신설.
    expect(s).not.toContain('<Textarea');
    expect(s).not.toContain('<textarea');
    expect(s).not.toContain('opinion-publish-btn');
  });

  test('D2(AC4): 행정필드(발급요청일자) 편집은 기존 실장 요청박스에서 유지 — 회귀 0', () => {
    const r = REQBOX_SRC();
    // '서류 날짜'(발급요청일자) staff 편집 input 유지(치료테이블 미이관, scope-guard).
    expect(r).toContain('data-testid="opinion-req-date"');
    expect(r).toContain('setRequestDate');
  });

  test('D3(scope-guard): 치료테이블에 staff 신규 authoring/편집 폼 미신설(07-20 선례 유지)', () => {
    const s = SECTION_SRC();
    // 작성/발행 진입 컴포넌트(OpinionEditorDialog) 미마운트 — 치료테이블은 열람 read-only 만.
    expect(s).not.toContain('OpinionEditorDialog');
    expect(s).not.toContain('useCreateOpinionRequest');
  });

  // ── E. 브라우저 회귀 가드 ────────────────────────────────────────────────────────────
  test('E1(AC5): 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(PHI 인증 우회 불가 → 정적/순수로직으로 대체 검증한 시나리오) ──
 *
 * 시나리오1(AC1) 발행 서류 목록 + 클릭 열람:
 *   [ ] 치료테이블 진입 → [소견서·진단서] 메뉴 → 발행완료 행의 서류명(진단서/소견서)이 개별 나열되어 보인다.
 *   [ ] 서류명(밑줄 점선) 클릭 → 발행본 내용이 다이얼로그로 바로 뜬다(실제 발행 본문 표시).
 *   [ ] 2종 이상 발행 시 각각 열람 가능 + 닫은 뒤 목록 상태 무변경(취소/재발행 안 됨).
 *
 * 시나리오2(AC2) 자동연동:
 *   [ ] 소견서(또는 진단서) 작성 폼 진입 → '환자 자동연동'에 생년월일·당일 시술·처방내역이 자동으로 채워진다.
 *   [ ] 채워진 값이 그 환자의 실제 데이터와 일치한다.
 *   [ ] 시술/처방 없는 환자는 '없음'으로 정확히 표기(타 환자 데이터가 새어들지 않음).
 *
 * 시나리오3(AC3/AC4) 필드별 수정권한:
 *   [ ] 원장 작성영역(소견 본문 등)은 치료테이블 열람 다이얼로그에서 read-only(클릭·포커스로도 편집 불가).
 *   [ ] 발급 요청일자 등은 실장 요청박스(2번차트 상담내역)에서 원내 스태프가 수정 가능.
 *   [ ] read-only 필드가 저장/재발행 등 어떤 경로로도 원장 작성 콘텐츠를 변조하지 않는다.
 */
