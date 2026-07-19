/**
 * T-20260719-foot-DOCTAB-NEW-CREATE — 풋센터 2번차트 [서류] 탭 신규 생성 (ADDITIVE)
 *
 * planner NEW-TASK (MSG-20260719-152735-g3ob): FE-only, DB변경0, npm0, risk=GO_WARN/ADDITIVE.
 * reporter=김주연 총괄(U0ATDB587PV) firm 확정 — CTXMENU-DOC-ENTRY 답=B(서류 탭 신규 생성).
 *
 *   AC-1: 차트 탭 목록에 `[서류]`(key='documents') 탭 신규 노출 (additive, 기존 탭 무변경).
 *   AC-2: [서류] 탭 = 해당 고객 예약내역 목록 + 행별 [서류 재출력] 버튼
 *         (재출력 = 예약에 매칭되는 접수 check_ins.reservation_id 기준 기존 재발급 팝업 재사용).
 *   AC-3: [당일 서류 발행] 버튼 → 별도 팝업창(기존 docReissueCheckIn 모달 = DocumentPrintPanel) 오픈.
 *   AC-4: 기존 [예약내역] 탭(reservations)·라우팅 무접점 — 회귀 0.
 *   AC-5: DB/마이그 0, npm 0.
 *
 * 구성 (unit 프로젝트 — auth/server 불요):
 *   - 소스 미러(정적 grep) 가드: 탭 등록·IMPLEMENTED·매칭 로직·양 버튼 배선·예약내역 탭 불변.
 *   - 실DOM(page.setContent) 가드: 시나리오 1~3 분기 동작 — 재출력/당일발행 disabled↔enabled +
 *     enabled 클릭 시 팝업 오픈(setDocReissueCheckIn 동작 모사).
 *   (supervisor 실QA 는 운영 번들 + 갤탭 실기기 field-soak 로 별도 검증.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __srcPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/pages/CustomerChartPage.tsx',
);
const src = readFileSync(__srcPath, 'utf-8');

// [서류] 탭 렌더 블록만 잘라 검증 (chartTab === 'documents' ~ 예약내역 탭 경계)
function documentsTabBlock(): string {
  const start = src.indexOf("chartTab === 'documents' && (");
  const end = src.indexOf("chartTab === 'reservations' &&", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('T-20260719-foot-DOCTAB-NEW-CREATE — 소스 미러 정적 가드', () => {
  test('AC-1: [서류] 탭이 CLINICAL_TABS 에 additive 등록 (key=documents, label=서류)', () => {
    expect(src).toContain("{ key: 'documents',    label: '서류' },");
    // IMPLEMENTED_CLINICAL 에 'documents' 포함 → '준비 중' 폴백이 아닌 실제 렌더 도달
    const implLine = src.match(/const IMPLEMENTED_CLINICAL = \[[^\]]*\]/)?.[0] ?? '';
    expect(implLine).toContain("'documents'");
    // 기존 예약내역 탭 등록 불변 (AC-4 회귀 가드)
    expect(src).toContain("{ key: 'reservations', label: '예약내역' }");
  });

  test('AC-2: [서류] 탭 = 예약내역 목록 + 행별 재출력 (매칭 로직 = check_ins.reservation_id)', () => {
    const block = documentsTabBlock();
    // 예약내역 목록 map
    expect(block).toContain('reservations.map(');
    expect(block).toContain('data-testid="doc-tab-resv-row"');
    // 행별 서류 재출력 버튼
    expect(block).toContain('data-testid="btn-doc-reprint"');
    expect(block).toContain('서류 재출력');
    // 재출력 = 예약↔접수 매칭 (추정 금지 — 매칭 접수건 기준 재발급)
    expect(block).toMatch(/checkInHistory\.find\(\(ci\) => ci\.reservation_id === r\.id\)/);
    // 매칭 접수건으로 기존 재발급 팝업 오픈
    expect(block).toContain('setDocReissueCheckIn(matchedCi)');
  });

  test('AC-3: [당일 서류 발행] 버튼 → 별도 팝업(setDocReissueCheckIn) + latestCheckIn 기준', () => {
    const block = documentsTabBlock();
    expect(block).toContain('data-testid="btn-doc-issue-today"');
    expect(block).toContain('당일 서류 발행');
    expect(block).toContain('setDocReissueCheckIn(latestCheckIn)');
    // 팝업 본체(기존 DOC-REISSUE-BTN 모달)는 재사용 — 삭제되지 않음
    expect(src).toContain('T-20260515-foot-DOC-REISSUE-BTN: 서류 재발급 모달');
    expect(src).toContain('<DocumentPrintPanel');
  });

  test('AC-4: 기존 [예약내역] 탭 렌더 블록 무접점 (회귀 0)', () => {
    // 예약내역 탭 고유 testid·핸들러 보존
    expect(src).toContain('data-testid="reservations-tab-content"');
    expect(src).toContain('data-testid="btn-next-reservation"');
    // [서류] 탭은 별도 블록(documents) — 예약내역 탭을 삭제/대체하지 않음
    const docStart = src.indexOf("chartTab === 'documents' && (");
    const resvStart = src.indexOf("chartTab === 'reservations' &&");
    expect(docStart).toBeGreaterThan(-1);
    expect(resvStart).toBeGreaterThan(-1);
    expect(docStart).not.toBe(resvStart);
  });

  test('AC-5: DB/마이그 0 · npm 0 — 신규 supabase 쓰기·의존성 도입 없음', () => {
    const block = documentsTabBlock();
    // [서류] 탭 블록 내 신규 DB write/RPC 없음 (표시·팝업 트리거만)
    expect(block).not.toMatch(/supabase\.from\(|\.rpc\(/);
  });
});

// ── 실DOM 시나리오 가드 (page.setContent, 실 Chromium 클릭) ──
//   정본 JSX 의 disabled 분기·팝업 트리거를 최소 HTML+JS 로 1:1 모사해 시나리오 1~3 동작 단언.
function docTabHtml(opts: { hasLatestCheckIn: boolean; rows: Array<{ label: string; matched: boolean }> }): string {
  const issueDisabled = opts.hasLatestCheckIn ? '' : 'disabled';
  const rowsHtml = opts.rows
    .map(
      (r, i) => `
      <div data-testid="doc-tab-resv-row" style="display:flex;gap:8px;align-items:center">
        <span>${r.label}</span>
        <button data-testid="btn-doc-reprint" data-i="${i}" ${r.matched ? '' : 'disabled'}
          onclick="if(!this.disabled){document.getElementById('reissue-modal').style.display='flex';}">서류 재출력</button>
      </div>`,
    )
    .join('');
  return `<!doctype html><html><body>
    <div data-testid="documents-tab-content">
      <div data-testid="doc-tab-issue-today">
        <button data-testid="btn-doc-issue-today" ${issueDisabled}
          onclick="if(!this.disabled){document.getElementById('reissue-modal').style.display='flex';}">당일 서류 발행</button>
        ${opts.hasLatestCheckIn ? '' : '<p data-testid="doc-tab-issue-nocheckin">접수 기록이 없어 당일 서류 발행을 사용할 수 없습니다</p>'}
      </div>
      <div data-testid="doc-tab-resv-list">
        ${opts.rows.length === 0 ? '<div data-testid="doc-tab-resv-empty">예약 없음</div>' : rowsHtml}
      </div>
    </div>
    <div id="reissue-modal" data-testid="reissue-modal" style="display:none">서류 재발급 (DocumentPrintPanel)</div>
  </body></html>`;
}

test.describe('T-20260719-foot-DOCTAB-NEW-CREATE — 실DOM 시나리오', () => {
  test('시나리오1: 예약내역 목록 + 매칭 접수 예약행 재출력 → 팝업 오픈', async ({ page }) => {
    await page.setContent(
      docTabHtml({
        hasLatestCheckIn: true,
        rows: [
          { label: '2026.07.01 10:00', matched: true }, // 접수 매칭 → 재출력 가능
          { label: '2026.07.10 14:00', matched: false }, // 접수 없음 → 재출력 비활성
        ],
      }),
    );
    await expect(page.locator('[data-testid="documents-tab-content"]')).toBeVisible();
    const rows = page.locator('[data-testid="doc-tab-resv-row"]');
    await expect(rows).toHaveCount(2);

    const btns = page.locator('[data-testid="btn-doc-reprint"]');
    // 접수 없는 행은 비활성(추정 매칭 금지)
    expect(await btns.nth(1).isDisabled()).toBe(true);
    // 접수 매칭 행 클릭 → 팝업 오픈
    expect(await btns.nth(0).isDisabled()).toBe(false);
    await expect(page.locator('[data-testid="reissue-modal"]')).toBeHidden();
    await btns.nth(0).click();
    await expect(page.locator('[data-testid="reissue-modal"]')).toBeVisible();
  });

  test('시나리오2: [당일 서류 발행] → 별도 팝업 오픈 (접수 있음)', async ({ page }) => {
    await page.setContent(docTabHtml({ hasLatestCheckIn: true, rows: [] }));
    await expect(page.locator('[data-testid="doc-tab-resv-empty"]')).toBeVisible();
    const issue = page.locator('[data-testid="btn-doc-issue-today"]');
    expect(await issue.isDisabled()).toBe(false);
    await issue.click();
    await expect(page.locator('[data-testid="reissue-modal"]')).toBeVisible();
  });

  test('시나리오2-b: 접수 기록 없으면 당일 발행 비활성 + 안내', async ({ page }) => {
    await page.setContent(docTabHtml({ hasLatestCheckIn: false, rows: [] }));
    const issue = page.locator('[data-testid="btn-doc-issue-today"]');
    expect(await issue.isDisabled()).toBe(true);
    await expect(page.locator('[data-testid="doc-tab-issue-nocheckin"]')).toBeVisible();
  });
});
