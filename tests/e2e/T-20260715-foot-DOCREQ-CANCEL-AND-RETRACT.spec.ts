/**
 * E2E spec — T-20260715-foot-DOCREQ-CANCEL-AND-RETRACT
 * 풋센터 현장(U0ATDB587PV, MSG-20260715-183507-q6ck):
 *   "2번차트에서 소견서/진단서 발행 요청은 있는데 요청 취소는 없어. 기능 추가해줘."
 *
 * Part A(본 spec): 2번차트 상담내역 탭(실장영역) '소견서 & 진단서 요청' 박스의 '처리 대기 요청 목록'에
 *   '요청 취소' 액션 신설. 실장(데스크)이 자기가 보낸 draft 발행요청을 원장 발행 전에 직접 회수.
 *   ↔ 기존 원장측 취소(T-20260715-foot-DOCREQ-CANCEL-BTN-CHART2, DocRequestQueue)와 별개 surface —
 *      실장이 '요청을 낸 그 자리'(OpinionRequestBox)에서도 취소 가능하게 대칭 보완.
 *
 * ★계약 정합(db_change=false): 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용 →
 *   status='draft'→'voided' + field_data.resolved_reason='cancelled'(소프트 취소, 감사필드 보존).
 *   신규 상태값/컬럼/테이블/enum/CHECK/RLS/RPC = 0. 'cancelled' 의미론은
 *   T-20260710-DOCREQ-DOCTORCOUNT(deployed) 확정 계약 그대로(신청 아님, 집계·완료표시 제외).
 * ★authoring 경계(§11 게이트 비대상 근거): 원장 발행(published) 경로·서명·직인·OpinionEditorDialog·
 *   진료대시보드 DocRequestQueue 코드 절대 미접촉. 실장영역(OpinionRequestBox) UI만 additive.
 * ★AC-3(회수 반영): 취소 시 진료대시보드 서류작성 큐가 status='draft' 필터로 voided 를 자동 배제 →
 *   해당 행 즉시 회수(DocRequestQueue 코드 무접촉으로 달성).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 *
 * Part B(3건 회수)는 코드 아닌 실데이터 정정 — reporter 확인 게이트 + dry-run + 롤백 준비 별도 처리.
 *   권장경로: 본 기능 배포 후 신설 '요청 취소'로 3건 회수(수동 DB 직접조작 최소화).
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

test.describe('T-20260715-foot-DOCREQ-CANCEL-AND-RETRACT — 실장 발행요청 취소(Part A)', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1(요청 취소 정상 동선): 처리대기 행에 '요청 취소' 액션 ─────────────
  test('S1: 실장 처리대기 요청 목록 행에 요청 취소 버튼 존재', () => {
    const b = box();
    // 처리 대기 목록의 각 행에 취소 버튼(고객별 openForCustomer.map 안).
    expect(b).toContain('data-testid={`opinion-req-cancel-${q.id}`}');
    expect(b).toContain('요청 취소');
    // 대기 목록 컨테이너(기존 산출) 유지.
    expect(b).toContain('data-testid="opinion-req-pending-list"');
  });

  test('S1: 취소 클릭 → 확인 다이얼로그, 확정 시에만 처리(실수 취소 방지)', () => {
    const b = box();
    expect(b).toContain('이 발행 요청을 취소하시겠어요?');
    expect(b).toContain('data-testid="opinion-req-cancel-confirm-btn"');
    expect(b).toContain('data-testid="opinion-req-cancel-dismiss-btn"');
    // 다이얼로그는 cancelTarget state 로 열리고 dismiss 시 초기화(미처리).
    expect(b).toContain('cancelTarget');
    expect(b).toContain('setCancelTarget(null)');
    // 공용 Dialog 컴포넌트 재사용(자체 confirm UI 재구현 금지 — 원장측과 동일 UX).
    expect(b).toContain("from '@/components/ui/dialog'");
  });

  // ── db_change=false 계약: 기존 mutation 재사용, 신규 로직/DDL 금지 ───────────
  test('AC: useResolveOpinionRequest mutate({reason:cancelled}) 재사용(신규 로직/mutation 신설 아님)', () => {
    const b = box();
    expect(b).toContain("reason: 'cancelled'");
    expect(b).toContain('resolveMut.mutateAsync');
    expect(b).toContain('handleCancelConfirm');
    // 박스는 직접 form_submissions update 를 재구현하지 않음(hook 경유 — 단일 계약 경로).
    expect(b).not.toContain("from('form_submissions')");
    expect(b).not.toContain("update({ status: 'voided'");
  });

  test('AC: cancelled 의미론 = 기존 계약(hook 이 soft-cancel: status=voided + resolved_reason, CHECK 무변경)', () => {
    const l = lib();
    // hook 이 'published' | 'cancelled' 두 reason 지원 — 본 티켓이 새 상태값 추가 안 함(db_change=false).
    expect(l).toContain("reason: 'published' | 'cancelled'");
    expect(l).toContain("status: 'voided'");
    expect(l).toContain('resolved_reason: input.reason');
    // 동시성 가드: 이미 발행/처리된 건(draft 아님) 재갱신 방지 → 발행완료 건 취소 불가(AC-4).
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

  // ── 회귀 가드(REDEFINITION_RISK): OpinionRequestBox 기존 산출 무회귀 ──────────
  test('회귀: 발행 요청 생성 흐름(서류종류·옵션·메모·발행 요청 버튼) 보존', () => {
    const b = box();
    expect(b).toContain('data-testid="opinion-req-doctype"');
    expect(b).toContain('data-testid="opinion-req-options"');
    expect(b).toContain('data-testid="opinion-req-memo"');
    expect(b).toContain('data-testid="opinion-req-submit"');
    expect(b).toContain('발행 요청');
    // 처리 대기 배지·서류 날짜·경구약 사유 등 기존 산출 보존.
    expect(b).toContain('data-testid="opinion-req-pending-badge"');
    expect(b).toContain('data-testid="opinion-req-date"');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 요청 취소 정상 동선 (티켓 §4-1)
 *   1. 로그인 → 풋센터 CRM 진료 화면 → 환자 2번차트 열기 → 상담내역 탭 '소견서 & 진단서 요청' 박스
 *   2. 이미 낸 '발행 요청'이 '처리 대기 요청 목록'에 보임(원장 발행 대기)
 *   3. 해당 행 오른쪽 'X(요청 취소)' 버튼 클릭
 *   4. "이 발행 요청을 취소하시겠어요?" 확인 다이얼로그 → '요청 취소' 클릭(확정)
 *   Expected: 요청이 status='voided' + resolved_reason='cancelled'(소프트 취소) 처리 →
 *     이 박스 대기 목록 + 진료 대시보드 서류작성 요청 리스트에서 즉시 제거/회수.
 *
 * [시나리오2] 엣지 케이스 (티켓 §4-2)
 *   a. 발행 '완료'된 건은 대기 목록에 없으므로 취소 노출 안 됨(hook .eq('status','draft') 가드로
 *      동시성상 이미 발행된 건도 재취소 무영향) — 발행 완료 건은 취소 불가(AC-4 잠정 정책).
 *   b. 취소 후 동일 서류를 '발행 요청'으로 재요청하면 정상 신규 요청으로 대기 목록에 다시 뜸.
 *   c. 취소 확인 다이얼로그에서 '아니오' 클릭 시 요청은 그대로 대기 목록에 남음(voided 처리 안 됨).
 *
 * 비고(NO-DDL, db_change=false): 취소 = 기존 useResolveOpinionRequest.mutate({reason:'cancelled'}) 재사용
 *   → form_submissions status='voided' + field_data.resolved_reason='cancelled'.
 *   신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0. 'cancelled' 의미론 = T-20260710-DOCREQ-DOCTORCOUNT(deployed) 계약 그대로.
 *   §11 게이트: 실장영역(OpinionRequestBox)만 수정, 원장 authoring/진료대시보드 코드 미접촉 → 게이트 비대상.
 *
 * === Part B (3건 회수, 실데이터 정정 — 본 코드 배포와 분리) ===
 *   - 스크린샷(F0BH9S7J42X) 빨간박스 3건 = 환자명+서류종류+요청시각 지문 교집합으로 freeze(count=3 단독 UPDATE 금지).
 *   - 실행 직전 reporter(U0ATDB587PV) 3건 목록 확인(responder 경유) + dry-run + 판정근거 스냅샷 + 롤백 준비.
 *   - 권장경로: 본 기능 배포 후 신설 '요청 취소'로 3건 회수(수동 DB 직접조작 최소화).
 */
