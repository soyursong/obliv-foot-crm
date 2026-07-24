/**
 * E2E spec — T-20260724-foot-DASH-ISSUEDDOCS-NAMELIST-EXPAND
 * 진료대시보드 '서류작성' 탭 > '서류 완료' 그룹: 발행한 서류를 사후에 확인할 방법 부재 해소.
 *   문지은 대표원장(풋센터) 7/24 현장 피드백 — '발행완료' 표시만 있고 어떤 서류가 발행됐는지 알 수 없음.
 *   요청: (1) '발행완료' 옆에 발행한 서류명 개별 나열, (2) '발행완료' 클릭 시 발행된 서류 상세 표시.
 *
 * 핵심 변경(additive read-only 표시 레이어, db_change=false):
 *   - 발행 이력은 이미 적재됨 — usePublishedOpinionRequests 가 읽어오는 form_submissions(voided,
 *     resolved_reason='published') 의 field_data.doc_type/selected_keys/resolved_at 만 표시(신규 조회·스키마 변경 0).
 *   - AC1: 완료 그룹 '발행' 셀 발행완료 뱃지 옆(하단 근접)에 서류명(진단서/소견서) 개별 표시(docreq-done-docnames).
 *   - AC2: 발행완료 뱃지 클릭 → ColumnExpandPopover(기존 렌더러 재사용)로 발행 서류 상세(서류명+해당항목) 펼침.
 *   - AC5: 열람 전용 — 재발행/취소 등 상태변경 버튼 미추가(뱃지=펼침 토글만).
 *   - authoring/publish 경로(publish_opinion_doc RPC·OpinionEditorDialog)·요청/작성 UI(pending) 일절 미접촉.
 *
 * 표면 겹침 관리(티켓 §84-87): DocRequestQueue.tsx 공유 surface. 발행이력 표시는 done variant 한정 additive
 *   레이어로만 얹음 — T-20260620-DOCDASH-DOCREQ-TABLEVIEW(hold) 의 요청/작성 워크플로(pending)·상태전이 무접점.
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

test.describe('T-20260724-foot-DASH-ISSUEDDOCS-NAMELIST-EXPAND — 발행완료 서류명 나열 + 클릭 펼침', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 발행 서류명 나열(AC1) ────────────────────────────────────
  test('시나리오1(AC1): 발행완료 옆에 발행 서류명(doc_type 라벨) 개별 표시', () => {
    const q = queue();
    // 발행완료 뱃지 옆 서류명 표시 요소.
    expect(q).toContain('data-testid="docreq-done-docnames"');
    // 서류명 = 이미 읽어온 doc_type 라벨(docTypeLabel). 신규 조회 없음.
    expect(q).toContain('const doneDocLabel = docTypeLabel(r.docType)');
    // 잘림 시 말줄임 + 툴팁(AC1 단서).
    expect(q).toContain('truncate');
  });

  test('시나리오1(AC4): 서류명 = 실제 발행 이력 소스(field_data.doc_type)와 일치', () => {
    const q = queue();
    // doneDocLabel 이 done 뱃지 영역에 렌더.
    expect(q).toContain('{doneDocLabel}');
    // doc_type enum → 라벨 매핑(④ enum 라벨 일치). opinionRequest.docTypeLabel 사용.
    expect(q).toContain('docTypeLabel');
    const l = lib();
    // 완료 그룹 소스 훅이 doc_type/selected_keys 를 read (추가 조회 없이 표시 재료 확보).
    expect(l).toContain("fd['doc_type']");
    expect(l).toContain("fd['selected_keys']");
  });

  // ── 시나리오 2: 발행완료 클릭 → 발행 서류 상세 펼침(AC2) ─────────────────
  test('시나리오2(AC2): 발행완료 뱃지 클릭 → 발행 서류 상세 펼침(서류명+해당항목)', () => {
    const q = queue();
    // 뱃지가 클릭 가능한 버튼(펼침 토글) + 앵커 ref.
    expect(q).toContain('doneBadgeRef');
    expect(q).toContain('setExpandDone');
    // 펼침 = 기존 ColumnExpandPopover 재사용(③ 기존 렌더러 재사용, 중복 재구현 금지).
    //   testId prop → 팝오버 내부에서 data-testid 로 렌더.
    expect(q).toContain('testId="docreq-done-expand-pop"');
    expect(q).toContain('data-testid="docreq-done-expand"');
    // 상세에 서류명 + 해당항목(selectedKeys 라벨=itemLabels) 노출.
    expect(q).toContain('data-testid="docreq-done-expand-docname"');
    expect(q).toContain('data-testid="docreq-done-expand-items"');
    expect(q).toContain('발행한 서류');
  });

  test('시나리오2(AC2): 펼침은 완료(done) 그룹에서만 렌더 — 대기(pending) 미노출', () => {
    const q = queue();
    // isDone 가드로 done 그룹에서만 펼침 팝오버 렌더.
    expect(q).toContain('{isDone && (');
    // ColumnExpandPopover 재사용 확인(신규 팝오버 구현 없음).
    expect(q).toContain('ColumnExpandPopover');
  });

  // ── 엣지: 발행 서류 없음/해당항목 없음(AC3) ───────────────────────────────
  test('엣지(AC3): 완료 그룹은 published row = 서류명 항상 존재, 해당항목 0건은 명확 폴백', () => {
    const q = queue();
    // 해당항목(selectedKeys) 없으면 '해당 항목 없음' 명확 표기(펼침 상세) — 오표기 방지.
    expect(q).toContain("itemLabels || '해당 항목 없음'");
  });

  // ── AC5 / 경계: read-only 유지, 상태변경 버튼 미추가 ──────────────────────
  test('AC5: 발행이력 표시는 열람 전용 — 재발행/취소 등 상태변경 버튼 미추가', () => {
    const q = queue();
    // 완료(done) 셀에는 pending 전용 버튼(작성하기/요청취소) 없음.
    //   done 분기 내부에 docreq-write-btn / docreq-cancel-btn 이 없어야 함.
    const doneStart = q.indexOf('{isDone ? (');
    const doneBranch = q.slice(doneStart, q.indexOf(') : (', doneStart));
    expect(doneBranch).not.toContain('docreq-write-btn');
    expect(doneBranch).not.toContain('docreq-cancel-btn');
    // 발행완료 뱃지 버튼은 상태변경이 아니라 펼침 토글만(setExpandDone).
    expect(doneBranch).toContain('setExpandDone');
  });

  test('BLOCKING 경계: publish RPC·발행 경로 미접촉(read-only 표시만)', () => {
    const q = queue();
    expect(q).not.toContain("rpc('publish_opinion_doc'");
  });

  test('NO-DDL(db_change=false): 발행 이력은 기존 적재 field_data read 재사용 — 신규 저장/마이그 0', () => {
    const l = lib();
    // 완료 그룹 소스 = form_submissions read. 신규 write/RPC 없음.
    expect(l).toContain("from('form_submissions')");
    expect(l).toContain("fd['resolved_at']");
  });

  // ── 표면 겹침 회귀 가드(티켓 §84-87) ──────────────────────────────────────
  test('표면 겹침 회귀 가드: 대기(pending) 요청/작성 동선 무회귀 — 작성하기 버튼 보존', () => {
    const q = queue();
    // T-20260620-DOCDASH-DOCREQ-TABLEVIEW(hold) 의 요청/작성 UI(pending) 무접점.
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain("variant=\"pending\"");
    expect(q).toContain("variant=\"done\"");
    // 공용 테이블/헤더 1벌 유지(drift 방지).
    expect(q).toContain('function DocReqTable');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 발행 서류명 나열 + 클릭 펼침 — AC1/AC2/AC4
 *   1. 원장 로그인 → 진료대시보드 → 서류작성 탭 진입
 *   2. 오늘 서류를 발행한 환자(A)를 '서류 완료' 그룹에서 확인
 *   3. 환자 A 행의 '발행 완료 · HH:MM' 뱃지 아래(옆 근접)에 발행 서류명(예: 소견서/진단서)이 표시되는지 확인
 *   4. '발행 완료' 뱃지를 클릭 → 발행한 서류 상세(서류명 + 해당항목)가 펼쳐지는지 확인
 *   5. 표시된 서류명/해당항목이 실제 발행한 서류와 일치하는지 확인
 *   6. 다시 클릭(또는 바깥 클릭/Esc) 시 펼침이 접히는지 확인
 *   Expected: 발행완료 옆 서류명 표시 + 클릭 시 발행 서류 상세 펼침. 실제 발행 이력과 일치.
 *
 * [시나리오2] 엣지 케이스 — 해당항목 없음 / 단건 — AC3
 *   1. 해당항목(옵션) 없이 발행된 완료 건 확인 → 서류명은 표시되고 펼침 상세엔 '해당 항목 없음' 표기
 *   2. 서류 1건만 발행한 환자 → 서류명 1건만 정확히 표시, 클릭 시 그 1건만 상세로 뜸
 *   Expected: 발행 서류명 오표기·누락 없음. 발행 안 한 서류가 뜨지 않음.
 *
 * [시나리오3] read-only 유지 — AC5
 *   1. '서류 완료' 그룹의 발행완료 표시/펼침 상세에 재발행·취소 등 상태변경 버튼이 없는지 확인
 *   2. 뱃지 클릭은 펼침/접힘만 할 뿐 어떤 데이터도 변경하지 않는지 확인
 *   Expected: 순수 열람. 발행된 서류·요청 상태 무변경.
 *
 * 비고(NO-DDL/경계): 발행이력 표시 = form_submissions(voided, resolved_reason='published') 의 이미 적재된
 *   field_data.doc_type/selected_keys/resolved_at read-only 표시. 신규 컬럼/테이블/RPC/마이그 = 0(db_change=false).
 *   가드레일 NOTOUCH: publish_opinion_doc RPC · OpinionEditorDialog 발행 경로 · pending 요청/작성 UI(작성하기/요청취소).
 */
