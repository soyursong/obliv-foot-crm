/**
 * E2E spec — T-20260625-foot-DOCDASH-DOCSECTION-COMPLETED-SUBHEADER
 * 진료대시보드 '서류작성' 섹션: 발행 완료 환자를 목록에서 제거하지 않고 '서류 완료' 서브헤더 그룹으로 분리해
 *   같은 화면에 계속 표시(현재: 완료 시 사라짐). 문지은 대표원장 6/25 요청(thread 1782358065).
 *
 * 핵심 변경(read-only 표시/그룹핑 레이어):
 *   - usePublishedOpinionRequests(clinicId): status='voided' + field_data.resolved_reason='published' +
 *     resolved_at(KST)==today 인 발행 완료 row 를 read. cancelled(요청취소) 제외. day-scoped.
 *   - DocRequestQueue: (상단) 작업 대상 기존 테이블 + (하단) '서류 완료' 서브헤더 그룹(read-only 행).
 *   - authoring/publish 경로(publish_opinion_doc RPC·OpinionEditorDialog) 일절 미접촉. 스키마 변경 0.
 *
 * 시나리오:
 *   1. 완료 환자 서브헤더로 유지 — 완료 row 를 '서류 완료' 그룹으로 read 해 표시(사라지지 않음), day-scoped.
 *   2. 그룹 구분 가시성 — 상단(작업 대상)/하단('서류 완료') 서브헤더 구분 + 완료 행 표준 컬럼 정상 렌더.
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

test.describe('T-20260625-foot-DOCDASH-DOCSECTION-COMPLETED-SUBHEADER — 발행 완료 서브헤더 유지', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 완료 환자 서브헤더로 유지 ─────────────────────────────────
  test('시나리오1(AC-2): 발행 완료 row 조회 훅 — voided + resolved_reason=published', () => {
    const l = lib();
    expect(l).toContain('export function usePublishedOpinionRequests');
    // 완료 판정 = 영속 저장된 기존 필드 read (신규 컬럼 0).
    expect(l).toContain("status', 'voided'");
    expect(l).toContain("fd['resolved_reason'] === 'published'");
    // 같은 서류작성 큐(staff_consult)에서 발행된 건만.
    expect(l).toContain("fd['request_origin'] === 'staff_consult'");
  });

  test('시나리오1(AC-4): day-scoped — resolved_at(KST)==today 만 완료 그룹에 유지', () => {
    const l = lib();
    expect(l).toContain('todaySeoulISODate');
    expect(l).toContain('seoulISODate(ra) === today');
    // created_at lookback 으로 자정 교차 발행 포섭하되 resolved_at KST 정밀 필터.
    expect(l).toContain("gte('created_at'");
  });

  test('시나리오1(흡수 그라운딩): cancelled(요청취소) row 는 서류 완료 그룹에서 제외', () => {
    const l = lib();
    // '서류 완료' = published 만. cancelled 를 완료로 끌어오는 동등비교 없음.
    expect(l).not.toContain("fd['resolved_reason'] === 'cancelled'");
    // published 필터가 명시적으로 존재(취소는 자동 배제).
    expect(l).toContain("fd['resolved_reason'] === 'published'");
  });

  test('시나리오1(AC-2): 완료 환자가 DocRequestQueue 에 그룹으로 렌더(목록에서 제거 안 함)', () => {
    const q = queue();
    expect(q).toContain('usePublishedOpinionRequests');
    expect(q).toContain('data-testid="docreq-completed-section"');
    expect(q).toContain('data-testid="docreq-completed-table"');
    expect(q).toContain('서류 완료');
  });

  // ── 시나리오 2: 그룹 구분 가시성 ──────────────────────────────────────────
  test('시나리오2(AC-3): "서류 완료" 서브헤더 + 완료 건수 뱃지로 시각 구분', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-completed-count"');
    // 완료 그룹 행 = read-only variant(작성하기/반짝효과/내원확인 제거, 발행 완료 뱃지).
    expect(q).toContain("variant=\"done\"");
    expect(q).toContain('data-testid="docreq-done-badge"');
    expect(q).toContain('발행 완료');
  });

  test('시나리오2(AC-1): 작업 대상(상단) 그룹 무회귀 — 기존 작성하기/큐 동선 보존', () => {
    const q = queue();
    expect(q).toContain("variant=\"pending\"");
    expect(q).toContain('data-testid="docreq-table"');
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('animate-ping'); // 신규 요청 반짝(대기 그룹 한정)
  });

  test('시나리오2(AC-5): 완료 그룹도 표준 컬럼(성함·차트번호 등) 동일 헤더 1벌 재사용', () => {
    const q = queue();
    // 헤더 drift 방지 — DocReqTable 공용 컴포넌트가 두 그룹 모두 렌더.
    expect(q).toContain('function DocReqTable');
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // 완료 그룹 환자 임상 스냅도 조회 대상에 포함(완료행 컬럼 정상 표시).
    expect(q).toContain('[...rows, ...completedRows]');
  });

  // ── BLOCKING 경계: authoring/publish 경로 미접촉(read-only 표시만) ─────────
  test('BLOCKING: 완료 그룹은 read-only 표시만 — publish RPC·신규 마이그 미접촉', () => {
    const q = queue();
    // 큐/완료 그룹은 발행하지 않음(발행은 OpinionEditorDialog 전용).
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    const l = lib();
    // 완료 조회 훅도 form_submissions read 재사용(신규 테이블/RPC 없음).
    expect(l).toContain("from('form_submissions')");
    expect(l).not.toContain("rpc('publish_opinion_doc'");
  });

  test('NO-DDL: 완료 그룹 = 이미 적재되는 field_data(resolved_*) read 재사용(스키마 변경 0)', () => {
    const l = lib();
    // resolve 시 적재되는 resolved_reason/resolved_at 만 read — 신규 컬럼 정의 없음.
    expect(l).toContain("fd['resolved_at']");
    expect(l).toContain("fd['resolved_reason']");
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 완료 환자 서브헤더로 유지 — AC-2/AC-4
 *   1. 원장 로그인 → /admin → 진료대시보드 → 서류작성 섹션 진입
 *   2. 서류 작성 전 환자 A 가 상단 작업 대상 그룹에 표시되는지 확인
 *   3. 환자 A '작성하기' → 발행창에서 내용 확인·발행 완료 처리
 *   4. 환자 A 가 목록에서 사라지지 않고 '서류 완료' 서브헤더 아래 그룹으로 이동해 표시되는지 확인
 *   5. 페이지 새로고침 후에도 환자 A 가 '서류 완료' 그룹에 잔존하는지 확인(당일 기준)
 *   Expected: 완료=published 건만 '서류 완료' 그룹으로 유지. 요청취소(cancelled)는 그룹에 나타나지 않음.
 *
 * [시나리오2] 그룹 구분 가시성 — AC-1/AC-3/AC-5
 *   1. 서류작성 섹션에 미완료 환자 ≥1, 완료 환자 ≥1 존재하도록 준비
 *   2. 상단(작업 대상)과 하단('서류 완료') 그룹이 서브헤더로 시각적으로 구분되는지 확인
 *   3. 완료 그룹 행에는 '작성하기' 버튼/반짝효과 없이 '발행 완료 · HH:MM' 뱃지가 표시되는지 확인
 *   4. 완료 그룹의 환자 행도 표준 컬럼(성함·차트번호·서류종류 등) 정상 렌더 확인
 *   Expected: 상단 작업 동선 무회귀(작성하기 정상), 하단 read-only 완료 그룹 구분 표시.
 *
 * 비고(NO-DDL/경계): 완료 그룹 = form_submissions status='voided' + field_data.resolved_reason='published'
 *   (이미 useResolveOpinionRequest 가 적재하는 필드) read-only 재배치. 신규 컬럼/테이블/RPC/마이그 = 0.
 *   가드레일 NOTOUCH: publish_opinion_doc 비가역 RPC · OpinionEditorDialog 발행 경로 · canPublish 게이트.
 */
