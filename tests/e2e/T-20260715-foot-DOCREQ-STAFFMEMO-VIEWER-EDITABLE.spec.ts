/**
 * E2E spec — T-20260715-foot-DOCREQ-STAFFMEMO-VIEWER-EDITABLE
 * 서류 발행요청 '실장 상세내용(직원 요청 메모)' 칸 — (AC-1)원장 작성창 + 서류작성 처리대기 큐 표시 보장,
 *   (AC-2)뷰어(read-only)→편집 가능 전환 + 저장 유지.
 *   (김주연 총괄 U0ATDB587PV / C0ATE5P6JTH 답변형 요청. 원 스펙 T-20260620-CHART2-DOC-REQUEST-INTEGRATION 후속)
 *
 * ★NO-DDL: 저장 = 기존 form_submissions.field_data.staff_memo(JSONB) 재사용 → 신규 컬럼/테이블/enum/RLS = 0.
 *   편집 write-path(useUpdateStaffMemo)만 활성화. form_submissions_update RLS = clinic member + status<>'published'.
 * ★authoring 경계(AC-4, BLOCKING): 편집 대상 = '직원 요청 메모'(staff_memo) 단일 키만. 진단/소견 본문·서명·직인·
 *   발행(published) 산출물·publish_opinion_doc RPC 절대 미접촉. staff_memo merge-update 한정.
 * ★핸드오프 무결(AC-3): merge-update(field_data 전체 스프레드 + staff_memo 덮어쓰기) → selected_keys/doc_type/
 *   request_date 등 다른 요청 메타 무변경. 요청 1건=작성창 1회 매핑 불변.
 * ★REDEFINITION_RISK(AC-5): 같은 surface(DocRequestQueue.tsx/작성창) 기존 산출 회귀 금지 —
 *   TABLEVIEW 9칼럼·RXCLIN 미리보기·항목 미리선택(prefill)·CANCEL 취소버튼.
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

const editor = () => read('src/components/doctor/OpinionDocTab.tsx');
const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260715-foot-DOCREQ-STAFFMEMO-VIEWER-EDITABLE — 실장 요청 메모 표시 보장 + 편집', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1 (표시 보장): 작성창 + 큐 양쪽에 실장 메모 노출 ─────────────────────
  test('AC-1: 원장 작성창에 실장 요청 메모칸 노출(요청으로 열림=requestId 있을 때)', () => {
    const e = editor();
    expect(e).toContain('data-testid="opinion-staff-request-memo"');
    // 큐('작성하기')로 열린 요청(requestId)에만 노출 — 허브 직접 오픈(requestId 없음)은 미노출(무회귀).
    expect(e).toContain('{requestId && (');
    // seed 는 요청 원본(staffRequestMemo).
    expect(e).toContain('staffRequestMemo');
  });

  test('AC-1: 처리대기 큐에 실장 메모 표시(내용 있으면 노출)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-memo"');
    expect(q).toContain('메모:');
    // 큐 → 작성창으로 staffMemo 전달(표시 소스 일치).
    expect(q).toContain('staffRequestMemo={active?.staffMemo ?? null}');
  });

  // ── AC-2 (뷰어→편집 + 저장 유지) ──────────────────────────────────────────
  test('AC-2: 메모칸이 편집 가능한 textarea(read-only 뷰어 아님)', () => {
    const e = editor();
    expect(e).toContain('data-testid="opinion-staff-memo-input"');
    // controlled 편집 state + onChange(입력 가능).
    expect(e).toContain('value={memoDraft}');
    expect(e).toContain('onChange={(e) => setMemoDraft(e.target.value)}');
    // 편집칸 = <textarea>(입력/커서 활성). 기존 read-only 문구('실장 요청(참고)' 단순 span)에서 전환.
    expect(e).toContain('onBlur={handleMemoSave}');
    expect(e).not.toContain('실장 요청(참고)');
  });

  test('AC-2: blur 시 저장(useUpdateStaffMemo) → 재진입 유지(persist)', () => {
    const e = editor();
    // 저장 훅 import + 사용.
    expect(e).toContain('useUpdateStaffMemo');
    expect(e).toContain('updateMemoMut.mutateAsync');
    // 저장 핸들러 — requestId 로 저장, 변경 없으면 no-op(불필요 write 방지).
    expect(e).toContain('handleMemoSave');
    expect(e).toContain('if (memoDraft === memoSaved) return');
    // 새 요청 바인딩 시 memoDraft/memoSaved 를 요청 원본으로 seed(재진입 시 저장값 유지 반영).
    expect(e).toContain('setMemoDraft(staffRequestMemo ?? \'\')');
    expect(e).toContain('setMemoSaved(staffRequestMemo ?? \'\')');
  });

  test('AC-2: 저장 상태 표기(저장 중/수정됨/저장됨)', () => {
    const e = editor();
    expect(e).toContain('data-testid="opinion-staff-memo-status"');
    expect(e).toContain('저장 중…');
    expect(e).toContain('저장됨');
  });

  // ── AC-2/3: 데이터 계층 — staff_memo 단일 키 merge + NO-DDL ────────────────
  test('AC-3: useUpdateStaffMemo = field_data.staff_memo merge-update(다른 메타 무변경)', () => {
    const l = lib();
    expect(l).toContain('export function useUpdateStaffMemo');
    // 기존 field_data 전체 스프레드 후 staff_memo 만 덮어쓰기(selected_keys/doc_type/request_date 보존).
    expect(l).toContain('const merged = { ...prev, staff_memo: input.staffMemo ?? \'\' }');
    // 저장 성공 시 큐 invalidate(표시 동기화).
    expect(l).toContain("queryKey: ['opinion_request_queue', clinicId]");
  });

  test('AC-3/4: 경계 가드 — staff_consult 요청 + draft 만 write(발행/취소 소급 미변경)', () => {
    const l = lib();
    // request_origin 검증(큐 요청만 — 타 draft 제출 오염 방지).
    expect(l).toContain("prev['request_origin'] !== 'staff_consult'");
    // draft 만 갱신(발행 published/취소 voided 건은 소급 미변경 = 발행완료 산출물 보호).
    expect(l).toContain(".eq('status', 'draft')");
  });

  // ── AC-4 (의료 authoring 경계 — 절대) ─────────────────────────────────────
  test('AC-4: 편집은 staff_memo 전용 — 발행/서명/직인/RPC 미접촉', () => {
    const l = lib();
    // 메모 저장은 field_data update 만 — publish RPC 미호출.
    expect(l).not.toContain("rpc('publish_opinion_doc'");
    // update 대상은 field_data 만(status 변경 없음 — draft→published/voided 전이 아님).
    expect(l).toContain('.update({ field_data: merged })');
    // 편집칸(staff_memo)과 의료판단 본문 editor(Textarea)는 물리 분리 — 작성창엔 별도 editor 가 그대로 존재.
    const e = editor();
    expect(e).toContain('publish_opinion_doc'); // 발행 RPC 경로는 그대로 보존(회귀 없음)
  });

  // ── AC-5 (REDEFINITION_RISK, 같은 surface 회귀 금지) ───────────────────────
  test('AC-5: 큐 TABLEVIEW 9칼럼 + 항목 미리선택(prefill) 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-table"');
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // prefill(항목 미리선택) 전달 보존.
    expect(q).toContain('initialSelectedKeys={active?.selectedKeys ?? []}');
    // 처방내역 데이터소스(prescription_items) 상속 보존.
    expect(lib()).toContain('prescription_items');
  });

  test('AC-5: 큐 작성하기 버튼·RXCLIN 미리보기·취소버튼(CANCEL) 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('작성하기');
    expect(q).toContain('testId="docreq-rx-expand-pop"');
    // CANCEL 취소버튼(T-20260715-DOCREQ-CANCEL-BTN-CHART2) 회귀 없음.
    expect(q).toContain('data-testid="docreq-cancel-btn"');
    expect(q).toContain('data-testid="docreq-cancel-confirm-btn"');
  });

  test('AC-5: 작성창 prefill 배타 가드·경구약 사유·날짜 치환 회귀 없음', () => {
    const e = editor();
    // prefill 배타(진단서 단일 ⊕ 금기증 복수) 가드 보존.
    expect(e).toContain('applyPrefillExclusivity');
    // 경구약 사유/날짜 등 기존 플레이스홀더 컨트롤 보존.
    expect(e).toContain('data-testid="opinion-placeholder-controls"');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 동선 — 표시 + 편집 + 저장 유지
 *   1. 데스크(실장) 로그인 → 2번차트 상담내역 → 서류 종류+항목 선택 + 상세내용(메모) 입력 → 발행요청 전송
 *   2. 원장 로그인 → 진료 대시보드 → "서류작성" 탭
 *   3. 처리대기 큐에서 방금 온 요청 행에 실장 메모("메모: …")가 표시됨 확인 (AC-1)
 *   4. "작성하기" 클릭 → 작성창 상단 '실장 요청(메모)' 칸에도 메모가 표시됨 확인 (AC-1)
 *   5. 메모칸 클릭 → 입력 커서 활성(편집 가능) → 내용 수정 → 입력칸 밖 클릭(blur)
 *      Expected: '저장 중…' → '저장됨' 표기. field_data.staff_memo 갱신.
 *   6. 다이얼로그 닫고 재진입(또는 큐 새로고침)
 *      Expected: 수정한 메모 내용이 유지됨(작성창·큐 셀 모두 최신값).
 *
 * [시나리오2] 엣지/가드
 *   1. 메모칸 편집·저장 후 진단서/소견서 본문·서명·직인·발행완료(published) 산출물 변화 없음 확인 (AC-4)
 *   2. 같은 화면 테이블뷰 9칼럼/취소버튼/항목 미리선택 정상 동작(회귀 없음) 확인 (AC-5)
 *   3. 허브(DoctorDocsHubDialog)에서 소견서 직접 오픈(요청 아님=requestId 없음) → 메모칸 미노출 확인(무회귀)
 *
 * 비고(NO-DDL): 저장 = 기존 form_submissions.field_data.staff_memo(JSONB) 재사용.
 *   신규 컬럼/테이블/enum/RLS/RPC = 0. RLS(form_submissions_update)=clinic member + status<>'published'.
 *   편집 대상 = '직원 요청 메모' 단일 키 — 의료판단 본문/서명/직인/published 절대 미접촉(AC-4).
 */
