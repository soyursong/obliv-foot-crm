/**
 * E2E spec — T-20260724-foot-ISSUEDDOCS-DOCVIEW-CLICKOPEN
 * 진료대시보드 '서류작성' 탭 > '서류 완료' 그룹: 발행완료 서류명(항목) 클릭 → 실제 발행본 내용 read-only 열람.
 *   문지은 대표원장(풋센터) 7/24 현장 피드백 후속 — hub(NAMELIST-EXPAND, deployed)는 서류명 나열 + 해당항목
 *   미리보기까지 납품. 콘텐츠 열람은 옵션으로만 남겨 미완결 → 본 티켓이 그 '내용 열람' 증분을 완결한다.
 *
 * 핵심 변경(additive read-only 열람 레이어, db_change=false):
 *   - AC1: '서류 완료' 그룹 서류명(docreq-done-docnames) 클릭 → 발행본 내용 뷰어(docreq-doc-view-dialog) 열림.
 *   - AC2: 뷰어 본문 = 실제 발행본(form_submissions status='published', field_data.final_text) 우선 표시
 *          (실발행본 일치). 발행본 미발견 시 요청 저장본(selected_keys) 재구성 폴백(composeOpinionDoc 재사용).
 *   - AC3: 요청 1건 ↔ 발행본 1건 원자 매핑(matchPublishedOpinionDoc: check_in_id+doc_type → customer 폴백).
 *          customer_id 필터로 다른 환자 발행본 구조적 배제(교차 노출 금지).
 *   - AC4: 열람 전용 — 뷰어에 재발행/취소/수정 버튼 없음(닫기만).
 *   - AC5: hub 나열/배지 렌더 무회귀 — 서류명 표시 텍스트·testid 동일, 클릭 열람만 결선. 배지 펼침 팝오버 보존.
 *   - authoring/publish 경로(publish_opinion_doc RPC·OpinionEditorDialog)·요청/작성 UI(pending) 일절 미접촉.
 *
 * 파일 시퀀싱(공유 surface): DocRequestQueue.tsx — DOCDASH-DOCREQ-TABLEVIEW(hold) 위에 done variant 한정
 *   additive read-only 열람 레이어로만 얹음. 요청/작성 워크플로(pending)·상태전이 무접점.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀/경계 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260724-foot-ISSUEDDOCS-DOCVIEW-CLICKOPEN — 발행완료 서류명 클릭 → 발행본 내용 열람', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 서류명 클릭 → 발행본 내용 열람(AC1) ───────────────────────
  test('시나리오1(AC1): 발행완료 서류명 클릭 → 발행본 내용 뷰어 열림', () => {
    const q = queue();
    // 서류명 요소(hub testid 보존) 가 클릭 핸들러(onViewDoc)로 뷰어를 연다.
    expect(q).toContain('data-testid="docreq-done-docnames"');
    expect(q).toContain('onClick={() => onViewDoc?.(r)}');
    // 열람 뷰어(모달) + 본문 요소.
    expect(q).toContain('data-testid="docreq-doc-view-dialog"');
    expect(q).toContain('data-testid="docreq-doc-view-body"');
    // done 그룹에만 onViewDoc 전달(pending 서류명 없음/미노출).
    expect(q).toContain('onViewDoc={openDocView}');
  });

  // ── 시나리오 2: 실제 발행본 일치 + 원자 매핑(AC2/AC3) ─────────────────────
  test('시나리오2(AC2): 뷰어 본문 = 실제 발행본 final_text 우선(재구성 폴백)', () => {
    const q = queue();
    // final_text 우선 → 없으면 저장본(selected_keys)으로 작성창 합성기 재사용 폴백.
    expect(q).toContain('viewDoc?.finalText');
    expect(q).toContain('composeOpinionDoc');
    const l = lib();
    // 발행본 read = form_submissions status='published' + final_text(신규 write/RPC 없음).
    expect(l).toContain("fd['final_text']");
    expect(l).toContain(".eq('status', 'published')");
  });

  test('시나리오2(AC3): 요청↔발행본 원자 매핑 — check_in_id/customer 격리(교차노출 금지)', () => {
    const l = lib();
    // 매핑 함수 존재 + doc_type/check_in_id 원자키, customer_id 폴백(다른 환자 배제).
    expect(l).toContain('export function matchPublishedOpinionDoc');
    expect(l).toContain('d.docType === row.docType');
    expect(l).toContain('d.checkInId === row.checkInId');
    expect(l).toContain('d.customerId === row.customerId');
    // 조회 자체가 customer_id 필터로 대상 환자만(다른 환자 발행본 구조적 배제).
    expect(l).toContain(".in('customer_id', ids)");
  });

  // ── AC4: read-only — 상태변경 버튼 미추가 ────────────────────────────────
  test('AC4: 열람 뷰어는 read-only — 재발행/취소/수정 버튼 없음(닫기만)', () => {
    const q = queue();
    const start = q.indexOf('data-testid="docreq-doc-view-dialog"');
    const end = q.indexOf('</Dialog>', start);
    const viewer = q.slice(start, end);
    // 뷰어 내부에 상태변경/작성 트리거 없음.
    expect(viewer).not.toContain('docreq-write-btn');
    expect(viewer).not.toContain('docreq-cancel-btn');
    expect(viewer).not.toContain('resolveMut');
    expect(viewer).not.toContain('mutate');
    // 유일 액션 = 닫기.
    expect(viewer).toContain('data-testid="docreq-doc-view-close"');
    expect(viewer).toContain('닫기');
  });

  test('BLOCKING 경계: publish RPC·발행 경로 미접촉(read-only 열람만)', () => {
    const q = queue();
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    const l = lib();
    // 열람 훅은 조회 전용 — publish RPC 호출 없음.
    expect(l).not.toContain("rpc('publish_opinion_doc'");
  });

  test('NO-DDL(db_change=false): 발행본은 기존 적재 field_data read 재사용 — 신규 저장/마이그 0', () => {
    const l = lib();
    expect(l).toContain('export function usePublishedOpinionDocs');
    expect(l).toContain("from('form_submissions')");
    // 열람 훅에 write/insert/update/delete 없음.
    const start = l.indexOf('export function usePublishedOpinionDocs');
    const end = l.indexOf('export function matchPublishedOpinionDoc', start);
    const hook = l.slice(start, end);
    expect(hook).not.toContain('.insert(');
    expect(hook).not.toContain('.update(');
    expect(hook).not.toContain('.delete(');
  });

  // ── AC5: hub 무회귀 — 나열/배지 렌더 보존 ─────────────────────────────────
  test('AC5(hub 무회귀): 서류명 나열 + 배지 펼침 팝오버 렌더 보존', () => {
    const q = queue();
    // hub 서류명 나열 소스·라벨 보존.
    expect(q).toContain('const doneDocLabel = docTypeLabel(r.docType)');
    expect(q).toContain('{doneDocLabel}');
    expect(q).toContain('truncate');
    // hub 배지 펼침 팝오버(해당항목 미리보기) 보존.
    expect(q).toContain('data-testid="docreq-done-badge"');
    expect(q).toContain('testId="docreq-done-expand-pop"');
    expect(q).toContain("itemLabels || '해당 항목 없음'");
    expect(q).toContain('setExpandDone');
  });

  test('표면 겹침 회귀 가드: 대기(pending) 요청/작성 동선 무회귀 — 작성하기 버튼 보존', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain("variant=\"pending\"");
    expect(q).toContain("variant=\"done\"");
    expect(q).toContain('function DocReqTable');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 서류명 클릭 → 발행본 내용 열람 — AC1/AC2
 *   1. 원장 로그인 → 진료대시보드 → 서류작성 탭 진입
 *   2. 오늘 서류를 발행한 환자(A)를 '서류 완료' 그룹에서 확인
 *   3. 환자 A 행의 발행 서류명(예: 소견서/진단서, 밑줄 점선 표시)을 클릭
 *   4. 발행본 내용 뷰어(모달)가 열리고, 발행한 서류의 실제 본문이 그대로 보이는지 확인
 *   5. 상단에 서류종류·환자명·차트번호·발행시각(있으면 발행자)이 표시되는지 확인
 *   6. '닫기'로 뷰어가 닫히는지 확인
 *   Expected: 클릭한 서류의 실제 발행 내용이 열람됨. 표시 내용이 실제 발행한 서류와 일치.
 *
 * [시나리오2] 원자 매핑 — 교차 노출 금지 — AC3
 *   1. 같은 날 여러 환자가 서류를 발행한 상태에서, 특정 환자 서류명 클릭
 *   2. 그 환자·그 서류의 내용만 뜨고, 다른 환자/다른 서류 내용이 섞여 뜨지 않는지 확인
 *   3. 한 환자가 소견서·진단서를 모두 발행한 경우, 각 서류명 클릭 시 해당 종류의 내용만 뜨는지 확인
 *   Expected: 항목→서류 매핑 정확. 다른 환자/다른 서류 내용 노출 없음.
 *
 * [시나리오3] read-only 유지 — AC4/AC5
 *   1. 발행본 뷰어에 재발행·취소·수정 등 상태변경 버튼이 없는지 확인(닫기만)
 *   2. 뷰어 열람/닫기는 어떤 데이터도 변경하지 않는지 확인
 *   3. hub 기능 무회귀: 서류명 나열 표시 + '발행 완료' 배지 클릭 시 해당항목 미리보기 펼침 정상 동작 확인
 *   Expected: 순수 열람. 발행된 서류·요청 상태 무변경. hub 나열/배지 펼침 정상.
 *
 * 비고(NO-DDL/경계): 발행본 열람 = form_submissions(status='published', opinion_doc) 의 이미 적재된
 *   field_data.final_text/doc_type/check_in_id read-only. 신규 컬럼/테이블/RPC/마이그 = 0(db_change=false).
 *   가드레일 NOTOUCH: publish_opinion_doc RPC · OpinionEditorDialog 발행 경로 · pending 요청/작성 UI(작성하기/요청취소).
 */
