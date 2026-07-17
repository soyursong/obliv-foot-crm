/**
 * E2E spec — T-20260717-foot-OPINION-WRITE-UI-3FIX
 * 소견서 작성 화면 UI 개선 3건 (문지은 대표원장 U0ALGAAAJAV / C0ATE5P6JTH, 2026-07-17):
 *   [1] QR 안내문구를 좌측 하단(옵션 그리드 단)으로 이동 (첨부 F0BHXT5AB0V).
 *   [2] 실장 요청 메모(staff_memo) textarea 를 내용 분량만큼 세로 자동확장(autosize) — 스크롤 제거.
 *   [3] 발급(작성하기) 완료 시 화면 정체 제거 → 대기 목록의 다음 환자로 자동 전환(없으면 목록 복귀).
 *
 * ★UI-only / NO-DDL: 신규 컬럼/테이블/enum/RLS/RPC = 0. FE 표시·동작 축만.
 * ★게이트: medical_confirm_gate=required, confirm_status=confirmed(자기요청 예외 — reporter=문원장 본인).
 * ★트랜잭션-then-navigate(AC-4): onPublished 는 발행(publish_opinion_doc) 성공 직후에만 호출 →
 *   발행 실패 시 미호출(이동 없음, 현재 화면 유지)이 구조적으로 보장됨.
 * ★회귀 경계: 실장메모 편집/저장(T-20260715-DOCREQ-STAFFMEMO-VIEWER-EDITABLE, deployed) 동작 무회귀.
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

test.describe('T-20260717-foot-OPINION-WRITE-UI-3FIX — 소견서 작성 화면 UI 3건', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── [1] QR 안내문구 좌측 하단 이동 ─────────────────────────────────────────
  test('AC-1: QR 안내문구(autocheck-hint)가 좌측 옵션 그리드 단 하단으로 이동', () => {
    const e = editor();
    // 안내문구 자체는 존치.
    expect(e).toContain('data-testid="opinion-autocheck-hint"');
    expect(e).toContain('QR입력');
    // 좌측 단(옵션 그리드)이 flex-col 로 재구성 — 옵션 스크롤 영역 + 하단 고정 안내문구.
    expect(e).toContain('data-testid="opinion-options"');
    // 안내문구는 옵션 그리드(data-testid="opinion-options") '뒤'(하단)에 위치해야 함(좌측 하단).
    const optIdx = e.indexOf('data-testid="opinion-options"');
    const hintIdx = e.indexOf('data-testid="opinion-autocheck-hint"');
    expect(optIdx).toBeGreaterThan(-1);
    expect(hintIdx).toBeGreaterThan(optIdx); // 옵션 그리드 뒤에 렌더 = 좌측 단 하단
    // 안내문구 인스턴스는 1개만(2단 중복 제거 확인).
    expect(e.split('data-testid="opinion-autocheck-hint"').length - 1).toBe(1);
  });

  // ── [2] 실장 메모 autosize ────────────────────────────────────────────────
  test('AC-2: 실장 메모 textarea autosize — ref + scrollHeight 바인딩', () => {
    const e = editor();
    // useRef import + memoRef 선언.
    expect(e).toContain('useRef');
    expect(e).toContain('const memoRef = useRef<HTMLTextAreaElement>(null)');
    // 메모 textarea 에 ref 부착.
    expect(e).toContain('ref={memoRef}');
    // autosize effect — height auto 리셋 후 scrollHeight 로 확장(축소도 반영).
    expect(e).toContain("ta.style.height = 'auto'");
    expect(e).toContain('ta.style.height = `${ta.scrollHeight}px`');
    // memoDraft 변화마다 재계산(입력·삭제 반영).
    expect(e).toContain('[open, requestId, memoDraft]');
    // 스크롤 제거 — overflow-hidden(자동확장이 스크롤 대체).
    expect(e).toContain('overflow-hidden');
  });

  test('AC-2: 실장 메모 편집/저장 동작 무회귀(deployed 계약 보존)', () => {
    const e = editor();
    expect(e).toContain('data-testid="opinion-staff-memo-input"');
    expect(e).toContain('value={memoDraft}');
    expect(e).toContain('onBlur={handleMemoSave}');
    expect(e).toContain('useUpdateStaffMemo');
  });

  // ── [3] 발급 후 자동 다음 환자 이동 ────────────────────────────────────────
  test('AC-3: 발행 성공 시 다음 대기 환자로 자동 전환(없으면 목록 복귀)', () => {
    const q = queue();
    // handlePublished 에서 다음 대기 행 계산 + setActive(재바인딩) / 없으면 dialog 닫기.
    expect(q).toContain('const handlePublished = async () =>');
    expect(q).toContain('const nextRow =');
    expect(q).toContain('setActive(nextRow)');
    expect(q).toContain('setDialogOpen(false)');
    // resolve invalidate 레이스 방지 — rows 스냅샷으로 대상 확정(mutateAsync 전에 nextRow 계산).
    const nextIdx = q.indexOf('const nextRow =');
    const resolveIdx = q.indexOf('resolveMut.mutateAsync', nextIdx);
    expect(nextIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(nextIdx); // nextRow 계산이 resolve 호출보다 먼저
  });

  test('AC-4: 트랜잭션-then-navigate — 발행 성공 직후에만 onPublished 호출', () => {
    const e = editor();
    // OpinionEditorDialog.handlePublish: publishMut.mutateAsync 성공(try 내부) 후에만 onPublished 호출.
    expect(e).toContain('if (onPublished && result?.id) onPublished(String(result.id))');
    // 발행 실패는 catch 로 분기(onPublished 미호출 → 이동 없음).
    expect(e).toContain('발행 실패:');
  });

  // ── 회귀 경계: 다른 진입점(허브/금일내방객)은 auto-advance 무영향 ──────────
  test('AC-5: 큐(대기 목록) 외 진입점은 onPublished 미전달(auto-advance 미적용)', () => {
    const q = queue();
    // 큐는 onPublished 전달(auto-advance 대상).
    expect(q).toContain('onPublished={handlePublished}');
    // 허브 오픈은 onPublished 미전달 유지(무회귀) — DoctorDocsHubDialog.
    const hub = read('src/components/doctor/DoctorDocsHubDialog.tsx');
    expect(hub).not.toContain('onPublished');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] QR 안내문구 위치 (정상)
 *   1. 원장 로그인 → 진료 대시보드 → "서류작성" 탭 → 발건강 질문지 자동체크(QR입력)가 있는 환자 "작성하기"
 *   2. 소견서 작성 화면에서 'QR입력 …' 안내문구가 좌측(옵션 그리드) 단 하단에 렌더되는지 확인
 *      (첨부 F0BHXT5AB0V 목표 위치와 일치. 방향/여백이 다르면 responder 경유 색박스 스크린샷 재확인 후 미세조정)
 *
 * [시나리오2] 실장 메모 autosize (정상)
 *   1. '실장 요청(메모)' 칸에 1줄 입력 → 필드 높이 1줄
 *   2. 여러 줄(10줄) 입력 → 스크롤 없이 세로 자동 확장되어 전체 표시
 *   3. 내용 삭제 → 높이 축소 반영
 *   4. blur → '저장됨' 표기 + 재진입 시 유지(편집/저장 무회귀)
 *
 * [시나리오3] 발급 후 자동 이동 (정상)
 *   1. 대기 목록에 환자 A·B 2명 → A "작성하기" → 발행 → 자동으로 B 작성 화면 전환
 *   2. 마지막 환자 발행 → 다음 없음 → 작성창 닫히고 목록 복귀
 *
 * [시나리오4] 엣지/가드
 *   1. 필수값 누락 등 저장 실패 → 화면 이동 없이 현재 화면 유지 + 에러 토스트(트랜잭션-then-navigate)
 *
 * 비고(UI-only/NO-DDL): 신규 컬럼/테이블/enum/RLS/RPC = 0. 실장메모 편집/저장(deployed) 동작 무회귀.
 */
