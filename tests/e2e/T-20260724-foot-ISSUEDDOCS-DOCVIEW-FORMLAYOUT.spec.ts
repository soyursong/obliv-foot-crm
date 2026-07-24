/**
 * E2E spec — T-20260724-foot-ISSUEDDOCS-DOCVIEW-FORMLAYOUT
 * 진료대시보드 '서류작성' 탭 > '서류 완료' 그룹: 발행완료 서류명 클릭 열람 패널을
 *   텍스트 나열 → 실제 소견서 발행/출력 '양식 그대로'(병원 헤더·환자정보 블록·상병/소견 영역·
 *   발급일·담당의·서명/도장) 레이아웃으로 렌더링(김주연 총괄 풋센터 요청).
 *
 * 핵심 변경(표시 방식만 교체 — 데이터/동선 무회귀, db_change=false):
 *   - AC1: 열람 패널 내부 렌더러 = 텍스트 pre-wrap → 소견서 양식 레이아웃(iframe read-only).
 *   - AC2(렌더러 재사용): 발행/출력에 쓰는 renderOpinionDocHtml(bindHtmlTemplate L-006 단일 경로)를
 *     그대로 재사용 — 새 양식을 그리지 않음(인쇄본과 열람본이 동일 양식 SSOT). printOpinionDoc 도 동일 렌더러 사용.
 *   - AC3(데이터 일치): 발행 저장본(form_submissions.field_data) READ + 인쇄 경로와 동일 바인더 주입.
 *     발행자·면허·차트번호·발행일·본문은 스냅샷 override(법정 의무기록 불변). 교차노출 매핑 무회귀(CLICKOPEN 승계).
 *   - AC4(read-only): 열람 전용 — 재발행/취소/수정 버튼 없음(닫기만). 발행/취소 RPC 무접촉.
 *   - AC5(무회귀): CLICKOPEN 클릭→열람 동선·항목-내용 매핑·발행완료 배지/나열 보존. viewBody(final_text
 *     우선·composeOpinionDoc 폴백) 그대로 승계.
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
const formView = () => read('src/components/doctor/IssuedOpinionDocFormView.tsx');
const printLib = () => read('src/lib/printOpinionDoc.ts');
const reqLib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260724-foot-ISSUEDDOCS-DOCVIEW-FORMLAYOUT — 발행완료 서류 열람을 소견서 양식 그대로', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC1: 열람 패널 내부 렌더러 = 소견서 양식 레이아웃 ─────────────────────────
  test('AC1: CLICKOPEN 열람 패널이 양식 렌더 컴포넌트로 렌더(텍스트 나열 아님)', () => {
    const q = queue();
    // 열람 다이얼로그 안 본문 슬롯이 양식 뷰 컴포넌트를 렌더.
    expect(q).toContain('data-testid="docreq-doc-view-dialog"');
    expect(q).toContain('data-testid="docreq-doc-view-body"');
    expect(q).toContain('<IssuedOpinionDocFormView');
    // 구 pre-wrap 텍스트 나열 렌더는 제거(양식으로 교체).
    expect(q).not.toContain("{viewBody.trim() ? viewBody : '표시할 서류 내용이 없습니다.'}");
    // 양식 뷰는 실제 소견서 양식 레이아웃을 iframe read-only 로 렌더.
    const fv = formView();
    expect(fv).toContain('data-testid="docreq-doc-view-form"');
    expect(fv).toContain('<iframe');
    expect(fv).toContain('srcDoc');
  });

  // ── AC2: 발행/출력 렌더러 재사용(신규 양식 스택 금지) ─────────────────────────
  test('AC2: 발행/출력 렌더러(renderOpinionDocHtml, bindHtmlTemplate) 재사용', () => {
    const fv = formView();
    // 열람 양식 = 인쇄/출력과 동일 렌더러 재사용.
    expect(fv).toContain('renderOpinionDocHtml');
    expect(fv).toContain("from '@/lib/printOpinionDoc'");
    const p = printLib();
    // 렌더러 = bindHtmlTemplate(L-006 단일 경로) 산출. print 와 view 가 같은 함수 공유.
    expect(p).toContain('export function renderOpinionDocHtml');
    expect(p).toContain('bindHtmlTemplate(tpl, fieldValues)');
    // printOpinionDoc 도 동일 렌더러 경유(양식 SSOT 1개 — 인쇄본≡열람본).
    expect(p).toContain('const rendered = renderOpinionDocHtml(data)');
    expect(p).toContain('window.open');
  });

  // ── AC3: 데이터 = 발행 저장본 READ + 인쇄 경로와 동일 바인더 주입 ──────────────
  test('AC3: 발행 저장본 snapshot + 공용 바인더(loadAutoBindContext/applyDiagCodesFromVisit) 주입', () => {
    const fv = formView();
    // 인쇄 경로(OpinionDocTab.handlePrint)와 동일 공용 바인더로 환자정보·상병·직인 주입.
    expect(fv).toContain('loadAutoBindContext');
    expect(fv).toContain('applyDiagCodesFromVisit');
    // 발행본 스냅샷(final_text=body / 발행자 / 면허 / 차트번호 / 발행일) 주입.
    expect(fv).toContain('body,');
    expect(fv).toContain('issuedByName: viewDoc?.doctorName');
    expect(fv).toContain('issuedByLicenseNo: viewDoc?.issuedByLicenseNo');
    // 발행자 직인 결선 = 발행자 clinic_doctors.id(이름↔도장 세트 정합).
    expect(fv).toContain('viewDoc?.issuedByDoctorId');
    // 추가 스냅샷은 이미 적재된 field_data read 만(db_change=false).
    const l = reqLib();
    expect(l).toContain("fd['doctor_license_no']");
    expect(l).toContain("fd['issued_by_doctor_id']");
    expect(l).toContain('issuedByLicenseNo');
    expect(l).toContain('issuedByDoctorId');
  });

  test('AC3(교차노출 무회귀): 원자 매핑·customer 격리 그대로(CLICKOPEN 승계)', () => {
    const q = queue();
    // 매핑 소스(matchPublishedOpinionDoc)·본문 계산(viewBody) 그대로 승계 — 렌더 방식만 교체.
    expect(q).toContain('matchPublishedOpinionDoc(viewTarget, publishedDocs)');
    expect(q).toContain('viewDoc?.finalText');
    expect(q).toContain('composeOpinionDoc');
    const l = reqLib();
    expect(l).toContain(".in('customer_id', ids)");
  });

  // ── AC4: read-only — 상태변경 버튼 미추가 ────────────────────────────────────
  test('AC4: 열람 뷰어는 read-only — 재발행/취소/수정 버튼 없음(닫기만)', () => {
    const q = queue();
    const start = q.indexOf('data-testid="docreq-doc-view-dialog"');
    const end = q.indexOf('</Dialog>', start);
    const viewer = q.slice(start, end);
    expect(viewer).not.toContain('docreq-write-btn');
    expect(viewer).not.toContain('docreq-cancel-btn');
    expect(viewer).not.toContain('resolveMut');
    expect(viewer).not.toContain('mutate');
    expect(viewer).toContain('data-testid="docreq-doc-view-close"');
    expect(viewer).toContain('닫기');
    // 양식 뷰 자체도 발행/write 트리거 없음(순수 렌더).
    const fv = formView();
    expect(fv).not.toContain('.insert(');
    expect(fv).not.toContain('.update(');
    expect(fv).not.toContain('.delete(');
    expect(fv).not.toContain("rpc('publish_opinion_doc'");
  });

  test('BLOCKING 경계: publish RPC·발행 경로 미접촉(표시 방식만 교체)', () => {
    const q = queue();
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    const fv = formView();
    expect(fv).not.toContain("rpc('publish_opinion_doc'");
  });

  // ── AC5: CLICKOPEN 동선/hub 무회귀 ───────────────────────────────────────────
  test('AC5(무회귀): 클릭→열람 동선·서류명 나열·배지 펼침 보존', () => {
    const q = queue();
    // 클릭 열람 결선 그대로.
    expect(q).toContain('data-testid="docreq-done-docnames"');
    expect(q).toContain('onClick={() => onViewDoc?.(r)}');
    expect(q).toContain('onViewDoc={openDocView}');
    // hub 나열/배지 펼침 보존.
    expect(q).toContain('const doneDocLabel = docTypeLabel(r.docType)');
    expect(q).toContain('data-testid="docreq-done-badge"');
    expect(q).toContain('testId="docreq-done-expand-pop"');
    // 대기(pending) 요청/작성 동선 무회귀.
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('variant="pending"');
    expect(q).toContain('variant="done"');
  });

  test('AC5(그레이스풀): 본문 저장본 없으면 안내문(레이아웃 붕괴 없이 fallback)', () => {
    const fv = formView();
    expect(fv).toContain("표시할 서류 내용이 없습니다.");
    // 자동바인딩 불가(check_in/customer 결측)여도 렌더는 진행(autoValues 옵션 주입).
    expect(fv).toContain('enabled: !!clinicId && !!viewTarget?.checkInId && !!viewTarget?.customerId');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 동선 — 서류 클릭 → 양식 그대로 열람 (AC1~AC3, AC5)
 *   1. 원장 로그인 → 진료대시보드 → 서류작성 탭 → '서류 완료' 그룹
 *   2. 소견서를 발행한 환자 행의 발행 서류명(밑줄 점선) 클릭 → 열람 패널 열림
 *   3. 패널이 텍스트 나열이 아니라 '소견서 양식 레이아웃'(병원 헤더·환자정보 블록·상병/소견 영역·
 *      발급일·담당의·서명/도장)으로 표시되는지 확인
 *   4. 양식에 채워진 값(환자명·소견 내용·발급일·발행자 등)이 실제 발행한 서류와 일치하는지 확인
 *   5. 발행 미리보기/출력 화면 양식과 동일 레이아웃인지 대조(재사용 확인)
 *   6. 패널을 닫아도 발행완료 배지·서류명 나열이 그대로인지 확인(무회귀)
 *   Expected: 실제 발행 소견서 양식 그대로 열람. 인쇄 양식과 동일 레이아웃.
 *
 * [시나리오2] 엣지 — 다건 / read-only / 데이터 완전성 (AC3, AC4, AC5)
 *   1. 소견서·진단서를 모두 발행한 환자 → 각 서류명 클릭 시 해당 종류의 양식이 정확히 뜨는지(항목-양식 매핑)
 *   2. 열람 패널에 재발행·취소·수정 버튼이 없는지(닫기만) 확인
 *   3. 일부 필드(도장/서명, 특정 소견)가 빈 발행본 → 양식 레이아웃 유지되고 빈 칸으로 정상 표시(붕괴/오류 없음)
 *   Expected: 항목→서류 매핑 정확, 순수 열람(무변경), 빈 칸도 레이아웃 유지.
 *
 * 비고(NO-DDL/경계): 양식 렌더 = 발행/출력 렌더러(renderOpinionDocHtml, bindHtmlTemplate L-006) 재사용 +
 *   form_submissions(status='published') field_data(final_text/doc_type/chart_no/doctor_name/doctor_license_no/
 *   issued_by_doctor_id/check_in_id) read-only. 신규 컬럼/테이블/RPC/마이그 = 0(db_change=false).
 *   가드레일 NOTOUCH: publish_opinion_doc RPC · OpinionEditorDialog 발행 경로 · pending 요청/작성 UI.
 *   MEDSPACE-CONFIRM-GATE: 부모 CLICKOPEN 원장컨펌 승계(satisfied_reported), read-only 표시 방식만 개선.
 */
