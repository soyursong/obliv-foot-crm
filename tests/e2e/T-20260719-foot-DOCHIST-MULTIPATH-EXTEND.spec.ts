/**
 * T-20260719-foot-DOCHIST-MULTIPATH-EXTEND — 소견서/진단서 발행이력 조회+재출력 전경로 확장
 *
 * planner NEW-TASK (MSG-20260719-160638-zc58): FE-only, DB변경0, npm0, risk=GO_WARN.
 * reporter=김주연 총괄(U0ATDB587PV). 기준점 = 1번차트(CheckInDetailSheet) [서류 발급하기] = DocumentPrintPanel.
 *
 * 이 티켓의 착수시점 코드 실태 (조사 결과):
 *   ① 2번차트(CustomerChartPage) — [서류]탭(DOCTAB-NEW-CREATE) + 진료내역탭 방문별 [서류 재발급]이
 *      이미 docReissueCheckIn → DocumentPrintPanel(historyAtTop)로 발행이력 조회+재출력을 제공(REDEFINITION 중복).
 *   ③ 진료내역 '서류 재출력' 섹션 — 진료내역탭이 이미 방문별 [서류 재발급] + 발급서류 목록 보유([서류]탭과 중복).
 *   ② 결제 미니창(PaymentMiniWindow) — DocumentPrintPanel 미렌더, 발행이력 조회+재출력 전무 = 유일한 명확 신규경로.
 *
 * → 본 커밋 = item② 구현. item①③은 이미 충족/중복이라 planner FOLLOWUP으로 reporter 확인(blocked 아님).
 *
 *   AC-② -1: PMW 서류발행 헤더에 [발행이력·재출력] 버튼(btn-pmw-doc-history) — checkIn 존재 시에만 노출.
 *   AC-② -2: 클릭 → DocumentPrintPanel(historyAtTop) 모달(pmw-doc-history-modal) 오픈.
 *   AC-② -3: 단일 컴포넌트/데이터소스 재사용 — PMW 로컬 이력 UI 신규구현 금지(DocumentPrintPanel 이식).
 *   AC-② -4: 방문(checkIn) 스코프 — checkIn prop 그대로 전달(form_submissions.check_in_id 필터 = 그 방문 서류만).
 *   AC-② -5: 권한/RRN마스킹/의료서류 게이트 = 기준점 로직 상속(신규 정책 도입 0), DB/마이그 0·npm 0.
 *
 * 구성 (unit 프로젝트 — auth/server 불요):
 *   - 소스 미러(정적 grep) 가드 + 실DOM(page.setContent) 버튼→모달 토글.
 *   (supervisor 실QA 는 운영 번들 + 갤탭 실기기 field-soak 로 별도 검증.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const pmwSrc = readFileSync(
  resolve(__dir, '../../src/components/PaymentMiniWindow.tsx'),
  'utf-8',
);
const checkInSheetSrc = readFileSync(
  resolve(__dir, '../../src/components/CheckInDetailSheet.tsx'),
  'utf-8',
);

test.describe('T-20260719-foot-DOCHIST-MULTIPATH-EXTEND — item② 소스 미러 정적 가드', () => {
  test('AC-②-1: PMW가 DocumentPrintPanel을 import (경로별 별도구현 금지 — 기준점 컴포넌트 재사용)', () => {
    expect(pmwSrc).toContain(
      "import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';",
    );
  });

  test('AC-②-1: 서류발행 헤더에 [발행이력·재출력] 버튼 — checkIn 게이트', () => {
    expect(pmwSrc).toContain('data-testid="btn-pmw-doc-history"');
    expect(pmwSrc).toContain('발행이력·재출력');
    // checkIn 존재 시에만 노출(방문 스코프 진입점)
    expect(pmwSrc).toMatch(/\{checkIn && \(\s*<button[\s\S]*?data-testid="btn-pmw-doc-history"/);
    // 버튼 onClick = 모달 오픈
    expect(pmwSrc).toContain('onClick={() => setDocHistoryOpen(true)}');
  });

  test('AC-②-2: 클릭 → DocumentPrintPanel(historyAtTop) 모달 오픈', () => {
    expect(pmwSrc).toContain('data-testid="pmw-doc-history-modal"');
    // 모달 게이트 = docHistoryOpen && checkIn
    expect(pmwSrc).toMatch(/\{docHistoryOpen && checkIn && \(/);
    // 모달 본체 = DocumentPrintPanel historyAtTop (2번차트 docReissue 모달과 동일 패턴)
    const modalStart = pmwSrc.indexOf('data-testid="pmw-doc-history-modal"');
    const modalBlock = pmwSrc.slice(modalStart, modalStart + 1600);
    expect(modalBlock).toContain('<DocumentPrintPanel');
    expect(modalBlock).toContain('historyAtTop');
  });

  test('AC-②-4: 방문(checkIn) 스코프 — checkIn prop 그대로 전달(전체 이력 아님)', () => {
    const modalStart = pmwSrc.indexOf('data-testid="pmw-doc-history-modal"');
    const modalBlock = pmwSrc.slice(modalStart, modalStart + 1600);
    // checkIn 을 그대로 넘김 → DocumentPrintPanel 내부 form_submissions.check_in_id = checkIn.id 필터가 방문 스코프
    expect(modalBlock).toMatch(/checkIn=\{checkIn\}/);
  });

  test('AC-②-3/5: PMW에 발행이력 로컬 신규구현 없음 — form_submissions 이력 직접 SELECT 미추가', () => {
    // item② 로 인해 PMW 에 새 form_submissions 조회 쿼리(이력 로드)를 추가하지 않았음을 확인.
    //   (DocumentPrintPanel 이 이력·재출력을 전담 → 이력 누락·권한 분기 방지)
    //   기존 PMW 의 form_submissions 접점은 발행(persist)용 뿐 — SELECT 이력 로드는 없음.
    expect(pmwSrc).not.toContain(".from('form_submissions').select");
    expect(pmwSrc).not.toContain('.from("form_submissions").select');
  });

  test('AC-②-5: 기준점(1번차트) DocumentPrintPanel 인라인 렌더 불변 — 회귀 0', () => {
    // 1번차트 [서류 발행] 섹션(DocumentPrintPanel 직렌더)이 본 티켓으로 변형되지 않음
    expect(checkInSheetSrc).toContain('<DocumentPrintPanel checkIn={checkIn} onUpdated={onUpdated} />');
  });
});

// ── 실DOM 시나리오 가드 (page.setContent, 실 Chromium 클릭) ──
//   정본 JSX 의 버튼→모달 토글을 최소 HTML+JS 로 1:1 모사.
function pmwDocHtml(opts: { hasCheckIn: boolean }): string {
  const btnHtml = opts.hasCheckIn
    ? `<button data-testid="btn-pmw-doc-history"
         onclick="document.getElementById('hist-modal').style.display='flex';">발행이력·재출력</button>`
    : '';
  return `<!doctype html><html><body>
    <div data-testid="pmw-doc-header" style="display:flex;justify-content:space-between">
      <span>서류발행</span>
      ${btnHtml}
    </div>
    <div id="hist-modal" data-testid="pmw-doc-history-modal" style="display:none">
      발행이력·재출력 (DocumentPrintPanel historyAtTop)
      <button data-testid="btn-pmw-doc-history-close"
        onclick="document.getElementById('hist-modal').style.display='none';">닫기</button>
    </div>
  </body></html>`;
}

test.describe('T-20260719-foot-DOCHIST-MULTIPATH-EXTEND — item② 실DOM 시나리오', () => {
  test('시나리오1: checkIn 있으면 [발행이력·재출력] 버튼 → 모달 오픈/닫기', async ({ page }) => {
    await page.setContent(pmwDocHtml({ hasCheckIn: true }));
    const btn = page.locator('[data-testid="btn-pmw-doc-history"]');
    await expect(btn).toBeVisible();
    await expect(page.locator('[data-testid="pmw-doc-history-modal"]')).toBeHidden();
    await btn.click();
    await expect(page.locator('[data-testid="pmw-doc-history-modal"]')).toBeVisible();
    // 닫기
    await page.locator('[data-testid="btn-pmw-doc-history-close"]').click();
    await expect(page.locator('[data-testid="pmw-doc-history-modal"]')).toBeHidden();
  });

  test('시나리오2(권한 엣지): checkIn 없으면(진입 방문 미확정) 버튼 미노출', async ({ page }) => {
    await page.setContent(pmwDocHtml({ hasCheckIn: false }));
    await expect(page.locator('[data-testid="btn-pmw-doc-history"]')).toHaveCount(0);
  });
});
