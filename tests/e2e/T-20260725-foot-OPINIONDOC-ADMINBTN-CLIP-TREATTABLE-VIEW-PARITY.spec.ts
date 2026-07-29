/**
 * E2E Spec — T-20260725-foot-OPINIONDOC-ADMINBTN-CLIP-TREATTABLE-VIEW-PARITY (P2, db_change=false, FE-only)
 *
 * 소견서/진단서 UX 2건 (김주연 총괄 풋센터 07-25 신고, screenshot_gate 충족).
 *
 * AC1 — 진료대시보드 > 서류작성 열람 모달 '행정 정보 저장' 버튼 클리핑 수정:
 *   DocRequestQueue viewTarget Dialog 를 뷰포트에 가두고(max-h-[90vh] flex-col overflow-hidden) 가운데만
 *   스크롤(min-h-0 flex-1 overflow-y-auto), 헤더/푸터 고정(shrink-0) → '행정 정보 저장' 버튼 항상 하단 노출.
 *   (parent 9c70f3f1 에서 도입한 sticky-footer 구조의 무회귀 가드.)
 *
 * AC2 — 치료테이블 > 소견서·진단서 탭(DiagDocSection): '발행 소견서 내용보기' parity(이식):
 *   진료대시보드 열람 뷰어(DocRequestQueue → IssuedOpinionDocFormView)를 치료테이블 뷰어에 '동일 컴포넌트'로
 *   재사용 → 발행본을 텍스트 나열이 아닌 '소견서 양식 그대로'(병원헤더·환자정보·상병/소견·발급일·서명/도장) 렌더.
 *   이식 원본 = T-20260724-foot-DOCPUB-LINKAGE-EDITSCOPE ①(진료대시보드 배포본).
 *   ★발행본 read-only 열람만 — 편집/재출력 트리거 신규 도입 금지(의료법§22 발행본 불변, DOCREPRINT NOSYNC A안).
 *   치료테이블 뷰어에도 동일 sticky-footer 구조 적용 → 양식(iframe)이 길어도 '닫기' 버튼 항상 노출(BTNCLIP 재발 방지).
 *
 * 게이트: OpinionDocTab authoring 무접촉 · publish/취소 RPC 무접촉 · db_change=false → medical_confirm_gate 무영향.
 *   (§11.1 치료사 surface 는 게이트 비대상 · 발행본 편집/재출력 경계 미접촉.)
 *
 * 구성:
 *   A. 순수 로직 무회귀 — DiagDocSection 병합/필터 함수 직접 import(회귀 0).
 *   B. AC1 정적 가드 — 진료대시보드 열람 모달 뷰포트 바운드 + 스크롤 분리 + 푸터 고정 + 저장버튼 존재.
 *   C. AC2 정적 가드 — 치료테이블 뷰어가 IssuedOpinionDocFormView(동일 컴포넌트) 재사용 + parity props + 뷰포트 바운드.
 *   E. read-only 경계 — 치료테이블 뷰어에 편집/재출력/발행 side-effect 미도입.
 *   D. 브라우저 회귀 가드(HTTP 200).
 *
 * 검증 방식(canonical 계승): 현장 PHI 계정 인증 우회 불가 → 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 순수로직 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * 실행: npx playwright test T-20260725-foot-OPINIONDOC-ADMINBTN-CLIP-TREATTABLE-VIEW-PARITY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDiagDocRows,
  filterDiagDocByDate,
} from '../../src/components/treatment/DiagDocSection';
import type { OpinionRequestRow } from '../../src/lib/opinionRequest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '../..', rel), 'utf-8');
const SECTION_SRC = () => read('src/components/treatment/DiagDocSection.tsx');
const QUEUE_SRC = () => read('src/components/doctor/DocRequestQueue.tsx');

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
    requestedAt: '2026-07-25T01:00:00Z',
    createdAt: '2026-07-25T01:00:00Z',
    requestDate: '',
    ...over,
  };
}

test.describe('T-20260725-foot-OPINIONDOC-ADMINBTN-CLIP-TREATTABLE-VIEW-PARITY — 소견서 UX 2건', () => {
  // ── A. 순수 로직 무회귀(뷰어 parity 이식이 병합/필터 로직 불변) ────────────────────────────
  test('A1: buildDiagDocRows — 발행완료/미발행 상태 정확(무회귀)', () => {
    const published = [req({ id: 'p1', docType: 'diagnosis', resolvedAt: '2026-07-25T02:00:00Z' })];
    const drafts = [req({ id: 'd1', docType: 'opinion' })];
    const rows = buildDiagDocRows(drafts, published);
    expect(rows.find((r) => r.id === 'p1')!.publishStatus).toBe('published');
    expect(rows.find((r) => r.id === 'd1')!.publishStatus).toBe('unpublished');
  });

  test('A2: filterDiagDocByDate — 발행완료 day-scoped / 미발행 잔류(무회귀)', () => {
    const rows = buildDiagDocRows(
      [req({ id: 'd1', requestedAt: '2026-07-20T01:00:00Z' })],
      [req({ id: 'p1', requestedAt: '2026-07-25T01:00:00Z', resolvedAt: '2026-07-25T02:00:00Z' })],
    );
    const today = filterDiagDocByDate(rows, '2026-07-25');
    expect(today.find((r) => r.id === 'p1')).toBeTruthy();
    expect(today.find((r) => r.id === 'd1')).toBeTruthy();
    expect(filterDiagDocByDate(rows, '2026-07-24').find((r) => r.id === 'p1')).toBeUndefined();
  });

  // ── B. AC1: 진료대시보드 열람 모달 뷰포트 바운드 + 저장 버튼 접근성(잘림 해소, 무회귀) ──────────
  test('B1(AC1): 열람 모달이 뷰포트에 갇히고(max-h) flex-col 로 구성됨', () => {
    const s = QUEUE_SRC();
    expect(s).toContain('data-testid="docreq-doc-view-dialog"');
    expect(s).toContain('max-h-[90vh]');
    expect(s).toMatch(/flex[\s\S]{0,40}flex-col/);
    expect(s).toContain('overflow-hidden');
  });

  test('B2(AC1): 가운데(양식+행정패널)만 스크롤 — min-h-0 flex-1 overflow-y-auto', () => {
    const s = QUEUE_SRC();
    expect(s).toContain('data-testid="docreq-doc-view-scroll"');
    expect(s).toContain('min-h-0');
    expect(s).toContain('flex-1');
    expect(s).toContain('overflow-y-auto');
  });

  test('B3(AC1): 헤더/푸터 고정(shrink-0) → 저장 버튼 항상 하단 노출', () => {
    const s = QUEUE_SRC();
    expect(s).toMatch(/DialogFooter className="shrink-0/);
    expect(s).toContain('data-testid="docreq-admin-save-btn"');
    expect(s).toContain('행정 정보 저장');
  });

  // ── C. AC2: 치료테이블 뷰어가 진료대시보드와 '동일 컴포넌트' 재사용(parity) ───────────────────
  test('C1(AC2): 치료테이블 뷰어가 IssuedOpinionDocFormView(진료대시보드와 동일 컴포넌트) 재사용', () => {
    const s = SECTION_SRC();
    // 동일 컴포넌트 import.
    expect(s).toMatch(/import IssuedOpinionDocFormView from '@\/components\/doctor\/IssuedOpinionDocFormView'/);
    // 뷰어 본문에 렌더(양식 그대로).
    expect(s).toMatch(/<IssuedOpinionDocFormView[\s\S]{0,400}\/>/);
  });

  test('C2(AC2): 진료대시보드 뷰어도 동일 컴포넌트 사용(parity 원본 일치)', () => {
    const q = QUEUE_SRC();
    expect(q).toContain('<IssuedOpinionDocFormView');
  });

  test('C3(AC2): 치료테이블 뷰어에 parity props 전달(발행본 스냅샷 + 병원헤더 + 행정 오버레이)', () => {
    const s = SECTION_SRC();
    const block = s.slice(s.indexOf('<IssuedOpinionDocFormView'));
    expect(block).toMatch(/clinicId=\{clinicId\}/);
    expect(block).toMatch(/viewTarget=\{viewTarget\}/);
    expect(block).toMatch(/viewDoc=\{viewDoc\}/);
    expect(block).toMatch(/body=\{viewBody\}/);
    expect(block).toMatch(/clinicHeader=\{clinicHeader\}/);
    expect(block).toMatch(/adminOverrides=\{viewTarget\?\.adminOverrides\}/);
    // 병원헤더는 진료대시보드와 동일 훅(useClinicHeader)으로 조회.
    expect(s).toMatch(/useClinicHeader\(clinicId\)/);
  });

  test('C4(AC2): 치료테이블 뷰어 모달도 뷰포트 바운드 + sticky footer(닫기 버튼 재클리핑 방지)', () => {
    const s = SECTION_SRC();
    expect(s).toContain('data-testid="diagdoc-doc-view-dialog"');
    expect(s).toContain('max-h-[90vh]');
    expect(s).toContain('data-testid="diagdoc-doc-view-scroll"');
    expect(s).toContain('min-h-0');
    expect(s).toMatch(/DialogFooter className="shrink-0/);
    expect(s).toContain('data-testid="diagdoc-doc-view-close"');
  });

  // ── E. read-only 경계 — 편집/재출력/발행 side-effect 신규 도입 금지 ────────────────────────
  test('E1(AC2): 치료테이블 뷰어 read-only 전용 — 발행/취소/수정 RPC·write 미도입', () => {
    const s = SECTION_SRC();
    expect(s).not.toContain(".rpc('publish_opinion_doc'");
    expect(s).not.toContain('useResolveOpinionRequest');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.insert(');
  });

  test('E2(AC2): 치료테이블 발행본 뷰어 — 발행본 재출력/재발행 트리거 미도입 (§22 불변 유지)', () => {
    const s = SECTION_SRC();
    // ── SUPERSEDED by T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN (planner GO 2026-07-29) ──
    //   본 spec 최초 premise("뷰어는 닫기만 · 저장 트리거 없음")는 승인·배포된 T-20260728로 정당 대체됨:
    //   치료테이블 뷰어 footer에 [행정정보 수정] 진입점(diagdoc-doc-view-edit-admin-btn) + 전용 편집기
    //   ('행정 정보 저장' 버튼)가 legit surface로 도입. 편집 대상 = 발행완료 요청행 field_data.admin_overrides
    //   오버레이(비의료 행정필드) — 발행 '의료본'(published snapshot)·발행 파이프라인 무접촉(§22 스냅샷 불변).
    //   진료의(발급 의료인) 편집은 문지은 대표원장 Option A 컨펌 후 활성(DOCTOR_FIELD_EDITABLE=true, fast-follow 2026-07-29).
    //   → 따라서 '행정 정보 저장' 부재 단언은 폐기(현실=legit 존재). E1가 publish RPC/insert/update 부재를 가드.
    //
    // 여기서 지키는 §22 불변 = 발행 '의료본' 자체의 재출력/재발행(인쇄) 트리거 미도입 (변함없이 유효):
    expect(s).not.toMatch(/printOpinionDoc\s*\(/);
    expect(s).not.toContain('window.print(');
  });

  test('E3(AC2 무회귀): 성함 클릭=2번차트 동선 보존(전파차단) · 미발행 행 비활성', () => {
    const s = SECTION_SRC();
    expect(s).toMatch(/diagdoc-name-clickable[\s\S]{0,260}stopPropagation/);
    expect(s).toContain("onClick={r.publishStatus === 'published' ? () => openDocView(r.id) : undefined}");
  });

  // ── D. 브라우저 회귀 가드 — 앱 로드(HTTP 200) ────────────────────────────────────────
  test('D1: 앱 진입 200(빌드/라우팅 무회귀)', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(김주연 총괄) ─────────────────────────────────────
 * [AC1] 진료대시보드 > 서류작성 > 발행 소견서 클릭 → 열람 모달
 *   [ ] 소견서 양식 본문 렌더 확인
 *   [ ] 하단 '행정·발급 정보 정정 (원내 직원)' 영역이 스크롤로 도달
 *   [ ] '행정 정보 저장' 버튼이 모달 하단에 항상 보이고 클릭 가능(잘림 없음)
 * [AC2] 치료테이블 > '소견서·진단서' 탭 > 발행완료 항목 클릭 → 열람 모달
 *   [ ] 진료대시보드와 '똑같은 소견서 양식'으로 열림(병원헤더·환자정보·상병/소견·발급일·서명/도장)
 *   [ ] 발행일·담당의·서명 표시 + 읽기 전용(입력필드·저장·재출력 버튼 없음, '닫기'만)
 *   [ ] 양식이 길어도 '닫기' 버튼이 항상 하단에 보임(잘림 없음)
 *   [ ] 성함 클릭 시에는 2번차트 열림(열람 모달 아님 — 동선 분리)
 *   [ ] 미발행 항목 클릭 시 열람 모달 안 뜸(비활성)
 */
