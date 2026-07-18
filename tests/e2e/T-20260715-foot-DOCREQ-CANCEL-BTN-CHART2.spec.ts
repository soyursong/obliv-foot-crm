/**
 * E2E spec — T-20260715-foot-DOCREQ-CANCEL-BTN-CHART2
 * 2번차트(진료부 통합 대시보드) → 서류작성 탭 → 소견서·진단서 처리대기 큐에
 *   '요청 취소(회수)' 버튼 추가. 실장(데스크)이 잘못 보낸 draft 발행요청을 원장 발행 전에 직접 회수.
 *   (김주연 총괄 MSG-20260715-183717-r322 / 문원장 confirm MSG-20260715-205503-dwuo)
 *
 * ★계약 정합(AC-3): 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용 →
 *   status='voided' + resolved_reason='cancelled'. BE/DDL 신규 작업 0. 'cancelled' 의미론(=신청 아님,
 *   집계·완료표시 제외)은 T-20260710-DOCREQ-DOCTORCOUNT(deployed)가 확정한 계약 — 신규 상태·의미 도입 없음.
 * ★authoring 경계(AC-7): 원장 발행(published) 경로·서명·직인 로직 절대 미접촉. draft void 한정.
 * ★REDEFINITION_RISK(AC-6): 같은 DocRequestQueue.tsx surface의 기존 산출(TABLEVIEW 9칼럼·RXCLIN 미리보기·
 *   ColumnExpandPopover·처방내역 컬럼) 회귀 금지. 취소버튼만 additive.
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

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260715-foot-DOCREQ-CANCEL-BTN-CHART2 — 서류요청 취소(회수) 버튼', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 처리대기(draft) 행에 '요청 취소' 버튼 ────────────────────────────
  test('AC-1: 처리대기 행 요청 취소 버튼 존재(작성하기 룩앤필 조화, outline 톤)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cancel-btn"');
    expect(q).toContain('요청 취소');
    // outline 톤(secondary/cancel 룩앤필 — 작성하기(teal solid)와 시각 구분).
    expect(q).toContain('variant="outline"');
  });

  test('AC-1: 취소 버튼은 pending 그룹에만(done=완료행 미표시 — AC-7 authoring 경계)', () => {
    const q = queue();
    // onCancel prop 은 optional — pending 테이블에만 전달, 완료 그룹엔 미전달.
    expect(q).toContain('onCancel?: (r: OpinionRequestRow) => void');
    // pending DocReqTable 호출에만 onCancel 전달(정확히 1회 — 완료 테이블엔 없음).
    const onCancelPropCount = (q.match(/onCancel=\{openCancel\}/g) ?? []).length;
    expect(onCancelPropCount).toBe(1);
    // 버튼 렌더는 onCancel 가드 하에서만(done 그룹 undefined → 미렌더).
    expect(q).toContain('{onCancel && (');
  });

  // ── AC-2: 확인 다이얼로그(실수 취소 방지) ─────────────────────────────────
  test('AC-2: 취소 클릭 → 확인 다이얼로그, 확정 시에만 처리', () => {
    const q = queue();
    expect(q).toContain('이 요청을 취소하시겠어요?');
    expect(q).toContain('data-testid="docreq-cancel-confirm-btn"');
    expect(q).toContain('data-testid="docreq-cancel-dismiss-btn"');
    // 다이얼로그는 cancelTarget state 로 열리고, dismiss/닫기 시 target 초기화(처리 안 함).
    expect(q).toContain('cancelTarget');
    expect(q).toContain('setCancelTarget(null)');
    // Dialog 컴포넌트 재사용(자체 confirm UI 재구현 금지).
    expect(q).toContain("from '@/components/ui/dialog'");
  });

  // ── AC-3: 기존 mutation 재사용, 신규 로직/DDL 금지 ────────────────────────
  test('AC-3: useResolveOpinionRequest mutate({reason:cancelled}) 재사용(신규 로직 아님)', () => {
    const q = queue();
    expect(q).toContain("reason: 'cancelled'");
    expect(q).toContain('resolveMut.mutateAsync');
    // 취소 확정 핸들러가 기존 mutation 경유(별도 취소 mutation 신설 금지).
    expect(q).toContain('handleCancelConfirm');
    // 큐 자체는 직접 form_submissions update 를 재구현하지 않음(hook 경유).
    expect(q).not.toContain("from('form_submissions')");
    expect(q).not.toContain("update({ status: 'voided'");
  });

  test('AC-3: cancelled 의미론 = 기존 계약(hook 이 status=voided + resolved_reason 세팅)', () => {
    const l = lib();
    // hook 이 'published' | 'cancelled' 두 reason 을 지원(계약 유지 — 본 티켓이 새 상태값 추가 안 함).
    expect(l).toContain("reason: 'published' | 'cancelled'");
    expect(l).toContain("status: 'voided'");
    expect(l).toContain('resolved_reason: input.reason');
    // 동시성 가드: 이미 처리된 건(draft 아님) 재갱신 방지.
    expect(l).toContain(".eq('status', 'draft')");
  });

  // ── AC-4: 취소 완료 시 큐 제거 + 완료 그룹 미표시 ─────────────────────────
  test('AC-4: 취소 성공 시 큐 invalidate(draft 필터 voided 배제 → 행 자동 제거)', () => {
    const l = lib();
    // onSuccess 가 큐 쿼리 invalidate.
    expect(l).toContain("queryKey: ['opinion_request_queue', clinicId]");
    // 완료 표시(usePublishedOpinionRequests)는 resolved_reason='published' 만 — cancelled 배제(기존 정책 유지).
    expect(l).toContain("fd['resolved_reason'] === 'published'");
  });

  // ── AC-6(guard, REDEFINITION_RISK): 기존 surface 산출 회귀 없음 ───────────
  test('AC-6: TABLEVIEW 9칼럼 헤더 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-table"');
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
  });

  test('AC-6: 작성하기 버튼·반짝효과·RXCLIN 미리보기 드롭다운 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('작성하기');
    expect(q).toContain('animate-ping');
    // RXCLIN 표현 상속(ColumnExpandPopover 재사용) 보존.
    expect(q).toContain("from '@/components/doctor/ColumnExpandPopover'");
    expect(q).toContain('testId="docreq-rx-expand-pop"');
    expect(q).toContain('testId="docreq-clinical-expand-pop"');
    expect(q).toContain('widthScale={2}');
    // 처방내역 데이터소스(prescription_items) 상속 보존.
    expect(lib()).toContain('prescription_items');
  });

  test('AC-6: 완료 그룹(서류 완료 서브헤더) 회귀 없음', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-completed-section"');
    expect(q).toContain('서류 완료');
    expect(q).toContain('data-testid="docreq-done-badge"');
  });

  // ── AC-7(guard): authoring 경계 미접촉 ────────────────────────────────────
  test('AC-7: 발행(published) 경로·서명·직인 authoring 미접촉(큐는 비발행 유지)', () => {
    const q = queue();
    // 발행 resolve 경로(published)는 그대로 — 취소가 별도 경로.
    expect(q).toContain("reason: 'published'");
    // 큐는 발행 RPC 를 직접 호출하지 않음(OpinionEditorDialog 경유 — 회귀 없음).
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    // 취소는 draft void 한정 — published 건을 void 로 만드는 경로 없음(hook 의 .eq('status','draft') 가드).
    expect(lib()).toContain(".eq('status', 'draft')");
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 취소(회수) 동선
 *   1. 로그인 → 2번차트(진료부 통합 대시보드) → "서류작성" 탭
 *   2. 소견서·진단서 처리대기 큐에 대기 요청(draft) 행이 보임
 *   3. 잘못 요청한 행의 "요청 취소" 버튼('작성하기' 아래, outline 톤) 클릭
 *   4. "이 요청을 취소하시겠어요?" 확인 다이얼로그 → "요청 취소" 클릭(확정)
 *   Expected: 해당 요청이 status='voided' + resolved_reason='cancelled' 처리 →
 *     처리대기 큐에서 행 즉시 제거 + '서류 완료' 그룹에도 미표시(published 만 완료).
 *
 * [시나리오2] 취소 확인 취소(실수 방지)
 *   1. 처리대기 행 "요청 취소" 버튼 클릭 → 확인 다이얼로그 표시
 *   2. "아니오" 클릭
 *   Expected: 요청은 그대로 처리대기 큐에 남음(voided 처리 안 됨).
 *
 * [시나리오3] (guard) 완료 표시 회귀 없음
 *   1. resolved_reason='published'(원장 발행완료) 건은 '서류 완료' 그룹에 정상 표시(취소 버튼 없음)
 *   2. resolved_reason='cancelled'(취소) 건은 완료 그룹 미표시
 *   Expected: 발행완료 건 authoring/서명/직인 무영향, 취소 건만 큐에서 소거.
 *
 * 비고(NO-DDL): 취소 = 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용
 *   → form_submissions status='voided' + field_data.resolved_reason='cancelled'.
 *   신규 컬럼/테이블/enum/RLS/RPC = 0. 'cancelled' 의미론 = T-20260710-DOCREQ-DOCTORCOUNT(deployed) 계약 그대로.
 *   권한(AC-5): 취소 대상 = clinic member 전원(잠정). 요청자 본인 한정 좁힘은 원장 확인 후 후속.
 */
