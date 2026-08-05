/**
 * E2E spec — T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW
 * 진료대시보드 '소견서'→'서류작성' 리네임 + 환자별 서류요청 9칼럼 테이블뷰 + 서류요청→작성 워크플로.
 *   (문지은 대표원장 6/20, Q1 확정=김주연 총괄 6/22 — 해당항목=OPINION_SECTIONS 재사용.)
 *
 * 본 티켓 = CHART2-OPINION-SELECT-BOX-LINK(aabb0a4f)가 깐 서류작성 큐 surface 위에서:
 *   (A) 메뉴 리네임/(B) 9칼럼/(C) 작성하기→OpinionEditorDialog 재사용 = 이미 충족(회귀 가드).
 *   ★본 티켓 net-new = 처방내역·임상경과 칼럼이 RXCLIN-PREVIEW-DROPDOWN 표현(미리보기+컬럼앵커 드롭다운)을
 *     '상속'하도록 ColumnExpandPopover 를 공유 모듈로 추출(중복 재구현 금지) + DocRequestQueue 적용.
 *
 * 시나리오:
 *   1. 메뉴 리네임 확인('소견서'→'서류작성', value/testid 보존).
 *   2. 서류요청→작성하기 흐름(9칼럼 + 작성하기 반짝 + OpinionEditorDialog prefill)
 *      + (B안 델타, hold 해제 2026-08-05) 원장 작성창 2단 메모칸 양방향 편집 → staff_memo write-back → 요청기록 반영.
 *   3. 권한 게이트(데스크/일반직원 본문 입력 read-only — canPublish staff-view).
 *
 * B안 델타 코드 = T-20260715-foot-DOCREQ-STAFFMEMO-VIEWER-EDITABLE 로 라이브(A단방향→양방향 전환 이미 배포).
 *   본 스펙은 그 델타를 본 티켓 surface(진료대시보드 서류작성) E2E lock 으로 고정 + NOTOUCH 회귀 가드.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const docTools = () => read('src/pages/DoctorTools.tsx');
const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const popover = () => read('src/components/doctor/ColumnExpandPopover.tsx');
const callDash = () => read('src/components/doctor/DoctorCallDashboard.tsx');
const opinionTab = () => read('src/components/doctor/OpinionDocTab.tsx');
const lib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW — 서류작성 테이블뷰 + RXCLIN 표현 상속', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 메뉴 리네임 ────────────────────────────────────────────────
  test('시나리오1: 균검사지 옆 탭 라벨 서류작성, value/testid 보존', () => {
    const d = docTools();
    expect(d).toContain('서류작성');
    // 구 라벨 '소견서'는 탭 트리거 텍스트로 더 이상 노출되지 않음(서브 OpinionDocTab 내부 헤더는 별개).
    expect(d).toContain('value="opinion_doc"');
    expect(d).toContain('data-testid="tab-opinion-doc"');
    // 큐 + 기존 OpinionDocTab 둘 다 렌더(회귀0).
    expect(d).toContain('<DocRequestQueue');
    expect(d).toContain('<OpinionDocTab');
  });

  // ── 시나리오 2: 서류요청 → 작성하기 흐름 ──────────────────────────────────
  test('시나리오2: 서류작성 큐 9칼럼 헤더 전부 존재', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-table"');
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
  });

  test('시나리오2: 작성하기 버튼 + OpinionEditorDialog prefill 재사용 (반짝 제거됨)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('작성하기');
    // animate-ping ripple 은 T-20260716-foot-DOCREQ-PING-SHIMMER-REMOVE(deployed)로 제거됨 → 부재 단언.
    expect(q).not.toContain('animate-ping');
    // 작성창 = 기존 OpinionEditorDialog 재사용(별도 진단서창 신설 금지).
    expect(q).toContain('OpinionEditorDialog');
    expect(q).toContain('initialSelectedKeys');
    expect(q).toContain('initialDocType');
    expect(q).toContain('staffRequestMemo');
    // 새 진단서 전용 다이얼로그를 만들지 않음(재사용 보장).
    expect(q).not.toContain('DiagnosisEditorDialog');
  });

  test('시나리오2(Q1): 해당항목 = OPINION_SECTIONS 재사용(라벨맵)', () => {
    const q = queue();
    expect(q).toContain('buildOptionLabelMap');
    const l = lib();
    expect(l).toContain('OPINION_SECTIONS');
    expect(l).toContain("from '@/components/doctor/OpinionDocTab'");
  });

  // ── ★net-new: 처방내역·임상경과 RXCLIN-PREVIEW-DROPDOWN 표현 상속(중복 재구현 금지) ──
  test('RXCLIN 상속: ColumnExpandPopover 공유 모듈 추출 + 양쪽 재사용(중복 재구현 금지)', () => {
    // 공유 컴포넌트가 독립 모듈로 존재하고 export.
    const p = popover();
    expect(p).toContain('export function ColumnExpandPopover');
    expect(p).toContain('createPortal');
    // DoctorCallDashboard 는 더 이상 로컬 정의하지 않고 공유 모듈을 import(중복 제거).
    const cd = callDash();
    expect(cd).toContain("from '@/components/doctor/ColumnExpandPopover'");
    expect(cd).not.toContain('function ColumnExpandPopover(');
    // DocRequestQueue 도 동일 공유 컴포넌트를 import(자체 popover 재구현 금지).
    const q = queue();
    expect(q).toContain("from '@/components/doctor/ColumnExpandPopover'");
    expect(q).not.toContain('function ColumnExpandPopover(');
    expect(q).not.toContain("from 'react-dom'"); // 자체 createPortal 팝오버 재구현 안 함
  });

  test('RXCLIN 상속: 임상경과 셀 클릭 → 컬럼앵커 드롭다운 전문 (처방내역=상시 전건표기)', () => {
    const q = queue();
    // ★스펙 갱신(T-20260729-foot-ALIMPAN-RX-MULTILIST-ALWAYSVISIBLE, deployed): 처방내역 셀은
    //   클릭 드롭다운(docreq-rx-expand-pop/rxCellRef/setExpandRx/widthScale=2) 제거 → 당일 처방약 전건 상시 표기.
    //   임상경과는 RXCLIN 컬럼앵커 드롭다운(ColumnExpandPopover) 유지.
    expect(q).not.toContain('testId="docreq-rx-expand-pop"');   // 처방내역 드롭다운 제거됨(상시표기 전환)
    expect(q).toContain('testId="docreq-clinical-expand-pop"'); // 임상경과 드롭다운 유지
    // 임상경과 셀 ref + 클릭 토글(미리보기→펼침).
    expect(q).toContain('clinicalCellRef');
    expect(q).toContain('setExpandClinical');
  });

  // ── 시나리오 3: 권한 게이트(데스크 본문 입력 불가) ────────────────────────
  test('시나리오3: 본문 작성=원장/작성권한자(canPublish), 데스크 read-only staff-view', () => {
    const tab = opinionTab();
    // 발행/작성 게이트 = director|doctor(MEDDOC-DESK-PRINTONLY 정합, 가드레일 NOTOUCH).
    expect(tab).toContain("['director', 'doctor'].includes");
    // 비권한자(데스크/일반직원) = 본문 editor 숨김 + 출력전용 안내(staff-view).
    expect(tab).toContain('data-testid="opinion-staff-view"');
    expect(tab).toContain('직원은 발행된 서류의 저장(PDF)·인쇄만');
    // 발행 버튼은 canPublish 일 때만 — disabled 가드.
    expect(tab).toContain('disabled={!canPublish');
  });

  test('시나리오3(BLOCKING): 발행 = publish_opinion_doc RPC(원장 전용)로만, 큐는 비발행', () => {
    const q = queue();
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    const tab = opinionTab();
    expect(tab).toContain('publish_opinion_doc');
  });

  // ── 큐 셀 표시: 직원 서류요청 메모 read-display(편집 surface 아님) ──────────
  //   양방향 편집 surface = 원장 작성창(OpinionDocTab) 2단 메모칸. 큐 테이블 셀은 표시 전용 유지.
  test('큐 셀: 직원 서류요청 메모 = read-display(테이블 셀 편집 없음)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-memo"');
    expect(q).toContain('메모:');
    // 큐 테이블 셀은 메모를 표시만 — 셀 내 편집 input/textarea 없음(편집은 작성창에서).
    expect(q).not.toContain('docreq-memo-edit');
  });

  // ── Q2 B안 델타: 원장 작성창 2단 메모칸 양방향 편집 + staff_memo write-back ──
  //   (hold 해제 2026-08-05 JONGNO D-7 directive 종결. 코드=T-20260715-DOCREQ-STAFFMEMO-VIEWER-EDITABLE 라이브,
  //    본 티켓 스코프 = A단방향→양방향 전환의 E2E lock.)
  test('시나리오2(B안 델타): 원장 작성창 2단 메모칸 = 편집 textarea(readOnly 제거)', () => {
    const tab = opinionTab();
    // 2단 메모칸 = 편집 가능 textarea(입력 활성). read-only 뷰어(단순 span) 아님.
    expect(tab).toContain('data-testid="opinion-staff-memo-input"');
    expect(tab).toContain('value={memoDraft}');
    expect(tab).toContain('onChange={(e) => setMemoDraft(e.target.value)}');
    // readOnly/disabled 속성으로 잠기지 않음(원장 편집 허용).
    expect(tab).not.toMatch(/opinion-staff-memo-input"[\s\S]{0,400}readOnly/);
  });

  test('시나리오2(B안 델타): 원장 수정 → 저장(blur) → 원 요청메모(staff_memo) write-back(양방향)', () => {
    const tab = opinionTab();
    // blur 시 저장 → useUpdateStaffMemo(requestId, staffMemo=memoDraft).
    expect(tab).toContain('onBlur={handleMemoSave}');
    expect(tab).toContain('useUpdateStaffMemo');
    expect(tab).toContain('updateMemoMut.mutateAsync({ requestId, staffMemo: memoDraft })');
    // write-back = 원 요청 form_submissions.field_data.staff_memo 단일 키 merge(양방향, 요청기록 반영).
    const l = lib();
    expect(l).toContain('const merged = { ...prev, staff_memo: input.staffMemo ?? \'\' }');
    // 요청기록(처리대기 큐) 즉시 반영 — 편집한 메모가 큐 표시에도 동기화.
    expect(l).toContain("queryKey: ['opinion_request_queue', clinicId]");
  });

  test('시나리오2(B안 델타, NOTOUCH): write-back = staff_memo 전용 — 발행/서명/직인/RPC 미접촉', () => {
    const l = lib();
    // draft + staff_consult 요청에만 write(발행/취소 소급 미변경) — 가드레일 NOTOUCH.
    expect(l).toContain("prev['request_origin'] !== 'staff_consult'");
    expect(l).toContain(".eq('status', 'draft')");
    // 편집 훅은 publish_opinion_doc 비가역 RPC 미호출(발행 산출물 불오염).
    expect(l).not.toContain("rpc('publish_opinion_doc'");
  });

  // ── NO-DDL 가드: 서류요청 영속화 = form_submissions draft 재사용 ───────────
  test('NO-DDL: 서류요청 = form_submissions status=draft + field_data JSON 재사용', () => {
    const l = lib();
    expect(l).toContain("status: 'draft'");
    expect(l).toContain("request_origin: 'staff_consult'");
    expect(l).toContain("from('form_submissions')");
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 메뉴 리네임 — A
 *   1. 원장 로그인 → 진료대시보드 진입
 *   2. 균검사지 '옆' 탭 라벨이 "서류작성"으로 표시(구 "소견서" 탭명 미표시) 확인
 *   Expected: 탭 라벨만 변경, 탭 내용·동선 보존.
 *
 * [시나리오2] 서류요청 → 작성하기 — B/C + RXCLIN 표현 상속
 *   1. "서류작성" 진입 → 환자 테이블 9칼럼 렌더 확인
 *   2. 처방내역/임상경과 셀 클릭 → 셀 바로 아래 컬럼 폭 드롭다운으로 전문 펼침(다른 칼럼 비가림), 재클릭/바깥클릭 접힘
 *      (진료 알림판의 처방/임상경과 펼침과 '동일한' 표현인지 비교 확인 — 중복 재구현 아님)
 *   3. 한 행에서 서류종류=진단서, 해당항목 선택(=상담내역 선택박스와 동일 항목) → 처리요청
 *   4. 발행 칸에 '작성하기' 버튼 + 반짝 효과 표시 확인
 *   5. (작성권한자로) '작성하기' 클릭 → 진단서 쓰기창(기존 소견서 창과 동일, 서류종류=mode) 오픈, 좌측 해당항목 미리선택 확인
 *   6. 2단(소견 내용 위)에 직원 서류요청 메모가 '실장 요청(메모)'로 표시 + 편집 가능(textarea) 확인
 *   7. (B안 델타) 원장이 2단 메모칸 내용 수정 → 입력칸 밖 클릭(blur) → '저장됨' 표기 확인
 *   8. (B안 델타) 처리대기 큐로 돌아가면 해당 요청 메모가 수정된 내용으로 반영(양방향, 요청기록 write-back) 확인
 *   Expected: 별도 진단서창 신설 없이 기존 발행창 재사용, prefill 정상 + 메모 양방향 편집·요청기록 동기.
 *
 * [시나리오3] 권한 게이트(MEDDOC reconcile) — BLOCKING
 *   1. 데스크/일반직원 계정으로 '작성하기' 클릭
 *   2. 발행창이 '출력전용 뷰'(opinion-staff-view)로 열림 — 본문 editor·발행자 선택·발행하기 모두 미노출
 *   3. 안내문 "소견서 발행은 원장(의료진) 권한입니다. 직원은 발행된 서류의 저장(PDF)·인쇄만 가능합니다." 확인
 *   Expected: 데스크는 본문 입력 불가(read-only), 발행 RPC(is_doctor_role) 서버 게이트로도 이중 차단.
 *
 * 비고(NO-DDL): 서류요청 영속화 = form_submissions status='draft' + field_data.request_origin='staff_consult'
 *   (CHART2-OPINION-SELECT-BOX-LINK 패턴 그대로 재사용). 신규 컬럼/테이블/enum/RLS = 0.
 *   가드레일 NOTOUCH: publish_opinion_doc 비가역 RPC · printOpinionDoc(PDF/인쇄) · canPublish(director|doctor) · DoctorDocsHubDialog 허브.
 */
