/**
 * E2E spec — T-20260818-foot-OPINIONCERT-ISSUE-POPUP-FIXEDSIZE-STICKYBTN
 * 진료대시보드 소견서 발급 팝업(OpinionEditorDialog) 크기 고정 + '발행하기' 하단 고정
 * (문지은 대표원장 U0ALGAAAJAV / C0ATE5P6JTH, 2026-08-18):
 *   - AC-1: 팝업 외곽 크기 고정값 (소견서 내용 길이 무관 동일 크기) — dynamic sizing → fixed size.
 *   - AC-2: 팝업 내부 콘텐츠 영역 스크롤 가능 (overflow-y auto 동등).
 *   - AC-3: '발행하기' 버튼 팝업 하단 항상 고정 (sticky footer — 내용 넘어가도·환자/문서 바뀌어도 이동 금지).
 *
 * ★UI-only / NO-DDL: 신규 컬럼/테이블/enum/RLS/RPC = 0. FE 표시·레이아웃 축만(db_change=false).
 * ★게이트: 진료대시보드 소견서 발급 = 원장영역이나 reporter=문원장 본인 → §11 자기요청 예외(planner status_note '게이트 무대상').
 * ★SSOT 단일 컴포넌트: OpinionEditorDialog 는 진료대시보드 허브(DoctorDocsHubDialog)·요청큐(DocRequestQueue)·소견서탭(OpinionDocTab)
 *   3곳이 재사용 → 레이아웃 수정 1회 = 전 호출처 균일 적용, caller별 발산 모달 없음(회귀 범위 안전).
 * ★발행 로직 무회귀: publish_opinion_doc RPC·비가역 트리거·issuer 일치 게이트·disabled 조건 미변경(표시 레이아웃만).
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

test.describe('T-20260818-foot-OPINIONCERT-ISSUE-POPUP-FIXEDSIZE-STICKYBTN — 소견서 발급 팝업 크기 고정 + 발행버튼 하단 고정', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 팝업 외곽 크기 고정 ──────────────────────────────────────────────
  test('AC-1: DialogContent(opinion-dialog) 원장뷰 = 고정 높이 + flex 컬럼 + overflow-hidden', () => {
    const e = editor();
    // 원장(canPublish) 뷰의 DialogContent 클래스 = 고정 높이 h-[90vh] + flex flex-col + overflow-hidden.
    //   내용 길이에 따라 늘어나던 content-driven height 를 고정값으로 잠금(AC-1).
    expect(e).toContain("canPublish ? 'flex h-[90vh] max-w-5xl flex-col overflow-hidden' : 'max-w-2xl'");
    // 헤더(DialogTitle)는 flex-col 안에서 shrink-0(고정) — 본문만 스크롤.
    expect(e).toContain('flex shrink-0 items-center justify-between gap-3 pr-7');
  });

  // ── AC-2: 내부 콘텐츠 스크롤 ───────────────────────────────────────────────
  test('AC-2: 3단 그리드 flex-1 min-h-0 + 소견 본문 전용 스크롤 영역(overflow-y-auto)', () => {
    const e = editor();
    // 그리드가 고정 팝업 안에서 남는 높이를 채우고(min-h-0 flex-1), lg 에서 컬럼 내부 스크롤(overflow-hidden).
    expect(e).toContain('grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto');
    expect(e).toContain('lg:overflow-hidden');
    // col2(소견 본문) 스크롤 래퍼 — 내용이 길어지면 이 영역만 세로 스크롤.
    expect(e).toContain('data-testid="opinion-editor-scroll"');
    expect(e).toContain('flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1');
  });

  // ── AC-3: '발행하기' 하단 고정 footer ──────────────────────────────────────
  test('AC-3: 발행 액션이 스크롤 본문 밖 shrink-0 footer로 분리(하단 고정)', () => {
    const e = editor();
    // 발행 footer = 스크롤 영역 밖 + shrink-0 → 내용/환자/문서 바뀌어도 위치 불변.
    expect(e).toContain('data-testid="opinion-publish-footer"');
    expect(e).toContain('flex shrink-0 items-center justify-between gap-2 border-t pt-2');
    // footer 는 스크롤 래퍼(opinion-editor-scroll) '뒤'(하단)에 렌더되어야 함.
    const scrollIdx = e.indexOf('data-testid="opinion-editor-scroll"');
    const footerIdx = e.indexOf('data-testid="opinion-publish-footer"');
    expect(scrollIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(scrollIdx);
    // '발행하기' 버튼은 footer 내부에 위치(footer 뒤·col2 닫힘 앞).
    const publishBtnIdx = e.indexOf('data-testid="opinion-publish-btn"');
    expect(publishBtnIdx).toBeGreaterThan(footerIdx);
  });

  // ── 회귀 경계: 발행 로직·게이트 무변경(표시 레이아웃만) ─────────────────────
  test('회귀: 발행 RPC/비가역/issuer 일치 게이트·disabled 조건 무변경', () => {
    const e = editor();
    // 발행 버튼 disabled 조건(권한·pending·본문공백·issuer 불일치) 그대로.
    expect(e).toContain('disabled={!canPublish || publishMut.isPending || !text.trim() || (hasSigningInfo && !issuerMatchesSigning)}');
    // 비가역 안내·발행자 일치 게이트 문구 존치.
    expect(e).toContain('※ 발행 후에는 수정·취소할 수 없습니다(의무기록·비가역).');
    expect(e).toContain('data-testid="opinion-doctor-mismatch"');
    // 발행 이력/출력 패널·직원(비의사) 출력전용 뷰 존치(무회귀).
    expect(e).toContain('data-testid="opinion-published"');
    expect(e).toContain('data-testid="opinion-staff-view"');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 짧은 소견서 → 긴 소견서 전환 시 버튼 위치 불변 (AC-1/2/3)
 *   1. 진료대시보드 → 환자 A 서류 → 소견서 작성·발행 팝업 열기(내용 짧은 케이스)
 *   2. 팝업 외곽 크기 + '발행하기' 버튼 화면 위치(좌표) 기록
 *   3. 팝업 닫고 환자 B(소견 내용 긴 케이스) 선택 → 소견서 팝업 열기
 *   4. 팝업 외곽 크기가 2단계와 동일함 확인 (AC-1 — 고정 높이 90vh)
 *   5. 내용이 길어 넘칠 경우 소견 본문(opinion-editor-scroll) 영역만 세로 스크롤됨 확인 (AC-2)
 *   6. '발행하기' 버튼이 2단계 좌표와 동일 위치(팝업 하단)에 고정되어 있음 확인 (AC-3)
 *
 * [시나리오2] 내부 스크롤 중에도 버튼 고정 (AC-3)
 *   1. 긴 소견서 팝업에서 소견 본문 영역을 아래로 스크롤
 *   2. 스크롤 동안 '발행하기' 버튼이 팝업 하단에 계속 고정(가려지지 않음) 확인
 *
 * [시나리오3] 발행 무회귀
 *   1. 소견 내용 입력·발행자 선택 → '발행하기' → 정상 발행(비가역) 확인
 *   2. 발행자 불일치 시 버튼 비활성 + 안내문구 확인(게이트 무회귀)
 *   3. 직원(비의사) 계정 진입 시 발행 UI 숨김·발행이력 저장(PDF)/인쇄만 확인
 *
 * 비고(UI-only/NO-DDL): 신규 컬럼/테이블/enum/RLS/RPC = 0. 순수 레이아웃 안정화(팝업 크기 고정 + footer 하단 고정).
 */
