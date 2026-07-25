/**
 * E2E Spec — T-20260725-foot-DOCVIEW-TREATTABLE-CLICKFAIL-MODAL-BTNCLIP (P1, db_change=false)
 *
 * 어제(07-24) 배포한 서류 열람 2건의 field-soak 부정결과(회귀) 수정. 신규 기능 아님 — parent 배포분 위 회귀 수정.
 *   parent: TREATTABLE-DOCS-PARITY(51ea249a) / ISSUEDDOCS-DOCVIEW-FORMLAYOUT(1a0f03e9) / DOCVIEW-CLICKOPEN.
 *
 * 이슈1(BUG) — 소견서 열람 모달 '행정 정보 저장' 버튼 잘림:
 *   /admin 진료대시보드 > 서류작성 > 발행 소견서 클릭 → 열람 모달(DocRequestQueue viewTarget Dialog).
 *   모달에 높이 제한/내부 스크롤이 없어 iframe(h-68vh) + 잠금안내 + 행정정정 패널(입력 4)이 뷰포트를 넘겨
 *   하단 DialogFooter의 '행정 정보 저장' 버튼이 화면 밖으로 잘림.
 *   → 수정: DialogContent 를 max-h-[90vh] flex-col overflow-hidden 으로 뷰포트에 가두고, 가운데(양식+패널)만
 *     스크롤(min-h-0 flex-1 overflow-y-auto), 헤더/푸터 고정(shrink-0) → 저장 버튼 항상 하단 노출.
 *
 * 이슈2(BUG·회귀) — 치료테이블 발행완료 클릭 → 내용 안 열림:
 *   치료테이블 > 소견서·진단서 탭(DiagDocSection). 목록 렌더는 정상이나 발행완료 항목 클릭 시 열람 모달 미개방.
 *   진단: (1) prod 번들 실재 — version.json commit == origin/main HEAD(=배포 실재, stale 아님, AC4 충족).
 *        (2) 클릭 핸들러는 배선돼 있으나 클릭 타깃이 '요청종류(서류명) 배지'뿐 → 현장은 발행완료 항목/상태배지/행을
 *            눌러 안 열림(클릭 발견성 회귀).
 *   → 수정: 발행완료 '행 전체'를 클릭 타깃으로 확장(onClick=openDocView) + 성함 버튼은 전파차단(stopPropagation)해
 *     성함클릭=2번차트 동선 보존. 미발행 행은 비활성(빈 뷰어/오표기 방지 무회귀).
 *
 * AC:
 *   AC1(이슈1): 열람 모달에서 소견서 본문 + '행정·발급 정보 정정' + '행정 정보 저장' 버튼 전부 접근 가능(잘림 없음).
 *   AC2(이슈2): 치료테이블 발행완료 항목 클릭 시 소견서/진단서 내용 모달 개방(진료대시보드 뷰어 재사용).
 *   AC3(이슈2): 발행일/담당의/서명 등 기발행 정보 표시 + read-only(원장 medical 본문 편집 불가, parent AC③ 계승).
 *   AC4: prod 번들 실재(version.json commit == HEAD) — stale 아님(재배포 불요) 또는 재배포로 반영.
 *   AC5: 현장(김주연 총괄) 실기기 확인 요청(하단 갤탭 체크리스트, responder 경유).
 *
 * 구성:
 *   A. 순수 로직 무회귀 — DiagDocSection 병합/필터 함수 직접 import(회귀 0).
 *   B. 이슈1 정적 가드 — 모달 뷰포트 바운드 + 스크롤 분리 + 푸터 고정 + 저장버튼 존재.
 *   C. 이슈2 정적 가드 — 발행완료 행 클릭 확장 + 성함 전파차단 + read-only 경계 무회귀.
 *   D. 브라우저 회귀 가드(HTTP 200) + 현장 클릭 시나리오(갤탭 실기기 confirm 대상).
 *
 * 검증 방식(canonical 계승): 현장 PHI 계정 인증 우회 불가 → 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 순수로직 가드.
 *   실브라우저 클릭 시나리오 3종은 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * 실행: npx playwright test T-20260725-foot-DOCVIEW-TREATTABLE-CLICKFAIL-MODAL-BTNCLIP.spec.ts
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

test.describe('T-20260725-foot-DOCVIEW-TREATTABLE-CLICKFAIL-MODAL-BTNCLIP — 서류 열람 2건 field-soak 회귀 수정', () => {
  // ── A. 순수 로직 무회귀(이슈2 수정이 병합/필터 로직 불변) ──────────────────────────────
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
    // 발행완료(오늘)는 노출, 미발행(과거일)은 날짜 무관 잔류.
    expect(today.find((r) => r.id === 'p1')).toBeTruthy();
    expect(today.find((r) => r.id === 'd1')).toBeTruthy();
    // 발행완료는 선택 날짜와 다르면 제외(day-scoped).
    expect(filterDiagDocByDate(rows, '2026-07-24').find((r) => r.id === 'p1')).toBeUndefined();
  });

  // ── B. 이슈1: 열람 모달 뷰포트 바운드 + 저장 버튼 접근성(잘림 해소) ──────────────────────
  test('B1(AC1): 열람 모달이 뷰포트에 갇히고(max-h) flex-col 로 구성됨', () => {
    const s = QUEUE_SRC();
    // viewTarget 열람 DialogContent 에 뷰포트 상한 + flex 컬럼 + 넘침 숨김.
    expect(s).toMatch(/docreq-doc-view-dialog[\s\S]{0,120}/);
    expect(s).toContain('max-h-[90vh]');
    expect(s).toMatch(/flex[\s\S]{0,40}flex-col/);
    expect(s).toContain('overflow-hidden');
  });

  test('B2(AC1): 가운데(양식+행정패널)만 스크롤 — min-h-0 flex-1 overflow-y-auto', () => {
    const s = QUEUE_SRC();
    expect(s).toContain('data-testid="docreq-doc-view-scroll"');
    expect(s).toMatch(/docreq-doc-view-scroll[\s\S]{0,80}/);
    // 스크롤 래퍼 클래스(순서 무관 존재).
    expect(s).toContain('min-h-0');
    expect(s).toContain('flex-1');
    expect(s).toContain('overflow-y-auto');
  });

  test('B3(AC1): 헤더/푸터 고정(shrink-0) → 저장 버튼 항상 하단 노출', () => {
    const s = QUEUE_SRC();
    // DialogFooter 고정.
    expect(s).toMatch(/DialogFooter className="shrink-0/);
    // 저장 버튼 여전히 존재(footer 안).
    expect(s).toContain('data-testid="docreq-admin-save-btn"');
    expect(s).toContain('행정 정보 저장');
  });

  // ── C. 이슈2: 발행완료 행 클릭 확장 + 성함 전파차단 + read-only 무회귀 ─────────────────────
  test('C1(AC2): 발행완료 행 전체 클릭 → 열람(openDocView) 배선', () => {
    const s = SECTION_SRC();
    // 행(tr) onClick 이 발행완료일 때 openDocView 호출.
    expect(s).toMatch(/onClick=\{r\.publishStatus === 'published' \? \(\) => openDocView\(r\.id\)/);
    // 발행완료 행 커서 포인터 어포던스.
    expect(s).toMatch(/publishStatus === 'published'[\s\S]{0,80}cursor-pointer/);
  });

  test('C2(AC2): 성함 버튼은 전파차단(stopPropagation) — 성함클릭=2번차트 동선 보존', () => {
    const s = SECTION_SRC();
    // 성함 onClick 에 stopPropagation(행 열람과 분리).
    expect(s).toMatch(/diagdoc-name-clickable[\s\S]{0,220}stopPropagation/);
    expect(s).toContain('nameInteraction.onLeftClick');
  });

  test('C3(AC3/무회귀): 뷰어 read-only 전용 — 발행/취소/수정 side-effect 미접점', () => {
    const s = SECTION_SRC();
    expect(s).toContain('data-testid="diagdoc-doc-view-close"');
    expect(s).not.toContain(".rpc('publish_opinion_doc'");
    expect(s).not.toContain('useResolveOpinionRequest');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.insert(');
  });

  test('C4(AC2 무회귀): 미발행 행은 비활성(클릭 열람 없음) — 빈 뷰어/오표기 방지', () => {
    const s = SECTION_SRC();
    // 미발행 행 onClick=undefined.
    expect(s).toContain("onClick={r.publishStatus === 'published' ? () => openDocView(r.id) : undefined}");
  });

  test('C5(AC3): 뷰어에 발행자/발행시각/차트번호 표시(기발행 정보)', () => {
    const s = SECTION_SRC();
    expect(s).toMatch(/viewDoc\?\.doctorName[\s\S]{0,40}발행자/);
    expect(s).toMatch(/viewTarget\?\.resolvedAt[\s\S]{0,40}발행/);
  });

  // ── D. 브라우저 회귀 가드 — 앱 로드(HTTP 200) ────────────────────────────────────────
  test('D1: 앱 진입 200(빌드/라우팅 무회귀)', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(400);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(김주연 총괄, AC5) ─────────────────────────────
 * [시나리오1·이슈1] 진료대시보드 > 서류작성 > 발행 소견서 클릭 → 열람 모달
 *   [ ] 소견서 양식 본문 렌더 확인
 *   [ ] 하단 '행정·발급 정보 정정 (원내 직원)' 영역이 스크롤로 도달
 *   [ ] '행정 정보 저장' 버튼이 모달 하단에 항상 보이고 클릭 가능(잘림 없음)
 * [시나리오2·이슈2] 치료테이블 > '소견서·진단서' 탭
 *   [ ] 발행완료 항목(예: 신윤아 #F-4604) '행 아무 곳' 클릭 → 소견서/진단서 내용 모달 개방
 *   [ ] 발행일·담당의·서명 표시 + 읽기 전용(입력필드 없음)
 *   [ ] 성함 클릭 시에는 2번차트 열림(열람 모달 아님 — 동선 분리 확인)
 * [시나리오3·엣지] 미발행 항목 클릭 시 열람 모달 안 뜸(비활성) 확인
 */
