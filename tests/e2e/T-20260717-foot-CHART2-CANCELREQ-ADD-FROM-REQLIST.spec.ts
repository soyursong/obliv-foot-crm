/**
 * E2E spec — T-20260717-foot-CHART2-CANCELREQ-ADD-FROM-REQLIST
 * 풋센터 총괄(김주연, U0ATDB587PV / MSG-20260717-132056-qgst):
 *   "2번차트 - 상담내역 - 신청내역 목록에서도 취소 요청 가능하도록 추가해줘"
 *
 * 요지: 진료대시보드(DocRequestQueue, 원장영역)에서 이미 되는 '요청 취소' 동선을
 *   2번차트 상담내역 탭(실장영역) '신청내역 목록'(= OpinionRequestBox '처리 대기 요청 목록')으로 확장.
 *   실장이 자기가 낸 발행요청을 '요청을 낸 그 자리'에서도 취소할 수 있게 대칭 보완.
 *
 * ★재사용 SSOT(신규 로직/경로 발명 금지): 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용 →
 *   status='draft'→'voided' + field_data.resolved_reason='cancelled'(소프트 취소, 감사필드 보존).
 *   진료대시보드 '요청 취소'와 동일 mutation·동일 결과. 신규 상태값/컬럼/테이블/enum/CHECK/RLS/RPC = 0
 *   (db_change=false). 'cancelled' 의미론 = T-20260710-DOCREQ-DOCTORCOUNT(deployed) 확정 계약 그대로.
 * ★authoring 경계(§11 게이트 비대상 근거): 원장 발행(published) 경로·서명·직인·OpinionEditorDialog·
 *   진료대시보드 DocRequestQueue 코드 절대 미접촉. 실장영역(OpinionRequestBox) UI만 additive.
 * ★AC-2/3(결과 정합·회수 반영): 취소 시 진료대시보드 서류작성 큐가 status='draft' 필터로 voided 를
 *   자동 배제 → 해당 행 즉시 회수(DocRequestQueue 코드 무접촉으로 달성 = 동일 결과).
 * ★AC-5(중복/불가상태 방어): hook 의 .eq('status','draft') 동시성 가드로 이미 발행/처리된 건 재취소 무영향.
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

const box = () => read('src/components/consult/OpinionRequestBox.tsx');
const lib = () => read('src/lib/opinionRequest.ts');
const dashQueue = () => read('src/components/doctor/DocRequestQueue.tsx');

test.describe('T-20260717-foot-CHART2-CANCELREQ-ADD-FROM-REQLIST — 신청내역 목록 취소 요청', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1(정상 동선): 신청내역 목록 각 행에 '취소 요청' 액션 노출 ─────────
  test('S1: 신청내역 목록(처리 대기 요청 목록) 각 행에 취소 요청 버튼 존재', () => {
    const b = box();
    // 신청내역 목록 컨테이너(기존 산출) 유지 + 행 식별자.
    expect(b).toContain('data-testid="opinion-req-pending-list"');
    expect(b).toContain('data-testid={`opinion-req-pending-row-${q.id}`}');
    // 각 신청 행에 취소 요청 액션(고객별 openForCustomer.map 안).
    expect(b).toContain('data-testid={`opinion-req-cancel-${q.id}`}');
    expect(b).toContain('취소 요청');
  });

  test('S1: 취소 요청 클릭 → 확인 다이얼로그, 확정 시에만 처리(실수 취소 방지)', () => {
    const b = box();
    expect(b).toContain('이 발행 요청을 취소하시겠어요?');
    expect(b).toContain('data-testid="opinion-req-cancel-confirm-btn"');
    expect(b).toContain('data-testid="opinion-req-cancel-dismiss-btn"');
    // 다이얼로그는 cancelTarget state 로 열리고 dismiss('아니오') 시 초기화(미처리).
    expect(b).toContain('cancelTarget');
    expect(b).toContain('setCancelTarget(null)');
    // 공용 Dialog 컴포넌트 재사용(자체 confirm UI 재구현 금지 — 진료대시보드와 동일 UX).
    expect(b).toContain("from '@/components/ui/dialog'");
  });

  // ── AC-2(동일 처리): 기존 mutation 재사용, 신규 로직/DDL 금지 ────────────────
  test('AC-2: useResolveOpinionRequest mutate({reason:cancelled}) 재사용(진료대시보드와 동일 처리)', () => {
    const b = box();
    expect(b).toContain("reason: 'cancelled'");
    expect(b).toContain('resolveMut.mutateAsync');
    expect(b).toContain('handleCancelConfirm');
    // 박스는 직접 form_submissions update 를 재구현하지 않음(hook 경유 — 단일 계약 경로, 신규 경로 발명 금지).
    expect(b).not.toContain("from('form_submissions')");
    expect(b).not.toContain("update({ status: 'voided'");
  });

  test('AC-2: 진료대시보드(DocRequestQueue)와 동일 SSOT hook·동일 reason 사용', () => {
    const b = box();
    const q = dashQueue();
    // 진료대시보드 원장영역도 동일 hook·동일 reason(cancelled) → 두 surface 결과 정합의 근거.
    expect(q).toContain('useResolveOpinionRequest');
    expect(q).toContain("reason: 'cancelled'");
    expect(b).toContain('useResolveOpinionRequest');
    expect(b).toContain("reason: 'cancelled'");
  });

  test('AC-3: cancelled 의미론 = 기존 계약(hook 이 soft-cancel: status=voided + resolved_reason, CHECK 무변경)', () => {
    const l = lib();
    // hook 이 'published' | 'cancelled' 두 reason 지원 — 본 티켓이 새 상태값 추가 안 함(db_change=false).
    expect(l).toContain("reason: 'published' | 'cancelled'");
    expect(l).toContain("status: 'voided'");
    expect(l).toContain('resolved_reason: input.reason');
    // 동시성 가드: 이미 발행/처리된 건(draft 아님) 재갱신 방지 → 발행 완료 건 취소 불가(AC-5).
    expect(l).toContain(".eq('status', 'draft')");
  });

  // ── AC-3(회수 반영): 취소 → 진료대시보드 큐 자동 제거(DocRequestQueue 무접촉) ──
  test('AC-3: 취소 성공 시 큐 invalidate(draft 필터가 voided 배제 → 진료대시보드 행 자동 회수)', () => {
    const l = lib();
    expect(l).toContain("queryKey: ['opinion_request_queue', clinicId]");
    // 진료대시보드 open 큐는 status='draft' 만 조회 → voided(취소) 자동 배제.
    expect(l).toContain(".eq('status', 'draft')");
    // 완료 표시(usePublishedOpinionRequests)는 resolved_reason='published' 만 — cancelled 배제(혼동 방지).
    expect(l).toContain("fd['resolved_reason'] === 'published'");
  });

  // ── §11 게이트 비대상 근거(authoring/진료대시보드 코드 미접촉) ────────────────
  test('경계: 실장영역(OpinionRequestBox)만 수정 — 원장 authoring/발행 경로 미접촉', () => {
    const b = box();
    // 발행 RPC·발행 다이얼로그를 실장 박스가 호출하지 않음.
    expect(b).not.toContain("rpc('publish_opinion_doc'");
    expect(b).not.toContain('OpinionEditorDialog');
    // 실장영역 정체성(상담내역 탭) 헤더 문구 유지.
    expect(b).toContain('상담내역 탭(실장영역)');
  });

  // ── AC-4 회귀 가드(REDEFINITION_RISK): OpinionRequestBox 기존 산출 무회귀 ─────
  test('AC-4 회귀: 발행 요청 생성 흐름(서류종류·옵션·메모·발행 요청 버튼) 보존', () => {
    const b = box();
    expect(b).toContain('data-testid="opinion-req-doctype"');
    expect(b).toContain('data-testid="opinion-req-options"');
    expect(b).toContain('data-testid="opinion-req-memo"');
    expect(b).toContain('data-testid="opinion-req-submit"');
    expect(b).toContain('발행 요청');
    // 처리 대기 배지·서류 날짜 등 기존 산출 보존.
    expect(b).toContain('data-testid="opinion-req-pending-badge"');
    expect(b).toContain('data-testid="opinion-req-date"');
  });

  test('AC-4 회귀: 진료대시보드 기존 요청 취소(요청 취소 버튼) 무회귀', () => {
    const q = dashQueue();
    // 진료대시보드 원장영역 '요청 취소' 동선(SSOT 원본) 코드 무접촉·보존.
    expect(q).toContain('요청 취소');
    expect(q).toContain('useResolveOpinionRequest');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 신청내역 목록에서 취소 요청 — 정상 동선 (티켓 §시나리오1)
 *   1. 로그인 → 풋센터 CRM 진입 → 고객 선택 → 2번차트 열기
 *   2. 상담내역 탭 → '소견서 & 진단서 요청' 박스 → '처리 대기 요청 목록'(= 신청내역 목록)에 이미 낸 요청 표시
 *   3. 취소요청 대상 신청 행 오른쪽 'X(취소 요청)' 버튼 클릭
 *   4. "이 발행 요청을 취소하시겠어요?" 확인 다이얼로그 → '취소 요청' 클릭(확정)
 *   Expected: 요청이 status='voided' + resolved_reason='cancelled'(소프트 취소) 처리 →
 *     이 신청내역 목록 + 진료 대시보드 서류작성 요청 리스트에서 즉시 제거/회수(동일 결과).
 *
 * [시나리오2] 엣지 케이스 (티켓 §시나리오2)
 *   a. 이미 취소요청된 신청 행 — voided 로 대기 목록에서 사라져 재취소 노출 안 됨(중복요청 방지).
 *   b. 취소 불가 상태(이미 발행 완료된 건) — 대기 목록에 없어 취소 노출 안 됨. 동시성상 이미 발행된 건도
 *      hook .eq('status','draft') 가드로 재취소 무영향(발행 완료 건 취소 불가).
 *   c. 취소 확인 다이얼로그에서 '아니오' 클릭 시 요청은 그대로 신청내역 목록에 남음(voided 처리 안 됨).
 *
 * 비고(NO-DDL, db_change=false): 취소 = 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용
 *   → form_submissions status='voided' + field_data.resolved_reason='cancelled'.
 *   신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0. 진료대시보드 '요청 취소'(DocRequestQueue)와 동일 SSOT·동일 결과.
 *   §11 게이트: 실장영역(OpinionRequestBox)만 수정, 원장 authoring/진료대시보드 코드 미접촉 → 게이트 비대상.
 *
 * [정합 참고] 본 기능은 T-20260715-foot-DOCREQ-CANCEL-AND-RETRACT Part A(commit 93de0067, deploy-ready)와
 *   동일 surface·동일 구현이다. 93de0067 이 main 에 미머지 상태여서 현장이 재요청 → 본 티켓으로 main 랜딩.
 *   두 브랜치 동시 머지 시 OpinionRequestBox 변경 내용이 동일하므로 충돌 없이 수렴(divergence 없음).
 */
