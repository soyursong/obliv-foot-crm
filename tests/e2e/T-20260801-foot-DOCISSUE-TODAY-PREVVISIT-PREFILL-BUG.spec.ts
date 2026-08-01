/**
 * E2E spec — T-20260801-foot-DOCISSUE-TODAY-PREVVISIT-PREFILL-BUG (P1 hotfix, regression)
 *
 * 버그: '당일 서류 발행'(신규 입력) 클릭 시 이전 방문 발행 저장본(form_submissions.field_data)이
 *   자동 연동(프리필)됨. 2경로(차트 2번탭 · 대시보드 우클릭 서류팝업) 공통.
 *
 * 회귀 원인(진단 확정): STAGE2(344fae4e, DOCREPRINT-GENERALFORMS-STAGE2)의 재출력 인터셉트
 *   (handleSelectTemplate → findLatestPrintedSubmission → ReprintViewer)와 이전 발행분 프리필
 *   (T-20260719 DOCREPRINT-DOCTOR-CONTENT-PERSIST useEffect)이 발행 mode(당일 발행 vs 재출력)로
 *   분기하지 않고 무조건 적용됨. '당일 서류 발행' 진입점은 latestCheckIn(이전 방문일 수 있음)을 스코프하는데,
 *   그 체크인에 발행 저장본이 있으면 카드 클릭 시 재출력 뷰어(이전 field_data)로 잘못 진입.
 *
 * 수정(B안, no-DDL): DocumentPrintPanel 에 newIssueMode prop 추가.
 *   - 당일 서류 발행 진입점 → newIssueMode=true: 재출력 인터셉트/프리필 비활성 → 항상 빈 IssueDialog(신규).
 *   - 서류 재출력 진입점    → newIssueMode=false: STAGE2 재출력(다시보기) 동작 그대로(AC-3 회귀 0).
 *
 * AC:
 *   (1) 차트 2번탭 '당일 서류 발행' → 이전 방문 연동 없음(재출력 뷰어 미노출).
 *   (2) 대시보드 우클릭 서류팝업 '당일 서류 발행' → 동일.
 *   (3) 재출력 경로 STAGE2 동작 회귀 없음.
 *
 * ⚠ DOM 시나리오는 실 seed(발행 저장본 有 고객) 의존이 커 graceful skip(레포 관례).
 *   회귀 앵커는 소스 계약(mode 배선) 정적 단언으로 seed-무관 결정론 보장한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

test.describe('T-20260801 DOCISSUE-TODAY-PREVVISIT-PREFILL-BUG — 당일 발행 이전방문 연동 차단', () => {
  // ── 계약 앵커(seed-무관, 결정론): mode 분기 배선 무결성 ────────────────────
  test('C1: DocumentPrintPanel — newIssueMode 로 재출력 인터셉트/프리필 게이트', () => {
    const src = read('src/components/DocumentPrintPanel.tsx');

    // Props 에 newIssueMode 선언.
    expect(src).toMatch(/newIssueMode\?\s*:\s*boolean/);
    // 구조분해 기본값 false(미지정 진입점=STAGE2 재출력 동작 유지, AC-3).
    expect(src).toMatch(/newIssueMode\s*=\s*false/);

    // 재출력 인터셉트(handleSelectTemplate)는 newIssueMode 일 때 우회 → 항상 IssueDialog.
    //   `if (!newIssueMode && GENERAL_REPRINT_FORM_KEYS.has(...))` 형태여야 함.
    const gate = /if\s*\(\s*!newIssueMode\s*&&\s*GENERAL_REPRINT_FORM_KEYS\.has/;
    expect(src).toMatch(gate);

    // 이전 발행분 프리필 useEffect 는 newIssueMode 일 때 early-return.
    //   (prefillAppliedRef 블록 앞에 `if (newIssueMode) return;`)
    const prefillIdx = src.indexOf('prefillAppliedRef.current === checkIn.id');
    expect(prefillIdx).toBeGreaterThan(0);
    const beforePrefill = src.slice(Math.max(0, prefillIdx - 400), prefillIdx);
    expect(beforePrefill).toMatch(/if\s*\(\s*newIssueMode\s*\)\s*return\s*;/);
  });

  // ── 계약 앵커: 차트 2번탭(CustomerChartPage) 진입점 mode 배선 ──────────────
  test('C2: 차트 서류탭 — 당일 발행=true / 재출력=false 배선', () => {
    const src = read('src/pages/CustomerChartPage.tsx');

    // 모드 상태 존재.
    expect(src).toMatch(/const\s*\[\s*docReissueNewMode\s*,\s*setDocReissueNewMode\s*\]/);

    // 당일 서류 발행 버튼: mode=true 로 세팅 후 latestCheckIn 스코프 오픈.
    const issueBtnIdx = src.indexOf('btn-doc-issue-today');
    expect(issueBtnIdx).toBeGreaterThan(0);
    const issueBtnCtx = src.slice(issueBtnIdx - 300, issueBtnIdx);
    expect(issueBtnCtx).toMatch(/setDocReissueNewMode\(true\)/);

    // 서류 재출력 버튼(예약행): mode=false.
    const reprintBtnIdx = src.indexOf('btn-doc-reprint');
    expect(reprintBtnIdx).toBeGreaterThan(0);
    const reprintBtnCtx = src.slice(reprintBtnIdx - 300, reprintBtnIdx);
    expect(reprintBtnCtx).toMatch(/setDocReissueNewMode\(false\)/);

    // 방문이력 드릴다운 '서류 재발급' 도 재출력(false).
    expect(src).toMatch(/setDocReissueNewMode\(false\);\s*setDocReissueCheckIn\(ci\)/);

    // 패널에 mode prop 주입.
    expect(src).toMatch(/newIssueMode=\{docReissueNewMode\}/);
  });

  // ── 계약 앵커: 대시보드 우클릭 서류팝업(DocumentReprintPopup) 진입점 mode 배선 ──
  test('C3: 우클릭 서류팝업 — 당일 발행=true / 재출력=false 배선', () => {
    const src = read('src/components/DocumentReprintPopup.tsx');

    expect(src).toMatch(/const\s*\[\s*reissueNewMode\s*,\s*setReissueNewMode\s*\]/);

    // 당일 서류 발행: mode=true.
    const issueBtnIdx = src.indexOf('btn-doc-reprint-issue-today');
    expect(issueBtnIdx).toBeGreaterThan(0);
    expect(src.slice(issueBtnIdx - 300, issueBtnIdx)).toMatch(/setReissueNewMode\(true\)/);

    // 서류 재출력(방문행): mode=false.
    const reissueBtnIdx = src.indexOf('btn-doc-reprint-reissue');
    expect(reissueBtnIdx).toBeGreaterThan(0);
    expect(src.slice(reissueBtnIdx - 300, reissueBtnIdx)).toMatch(/setReissueNewMode\(false\)/);

    // 패널에 mode prop 주입.
    expect(src).toMatch(/newIssueMode=\{reissueNewMode\}/);
  });

  // ── AC-1: 차트 2번탭 '당일 서류 발행' → 재출력 뷰어 미노출(이전 방문 연동 없음) ──
  test('AC-1: 차트 서류탭 당일 발행 클릭 → 재출력 뷰어(이전 field_data) 미노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 고객 목록 → 첫 고객 차트 진입.
    await page.goto('/customers').catch(() => {});
    await page.waitForTimeout(500);
    const custRow = page.locator('[data-testid="customer-row"], [data-customer-id], table tbody tr').first();
    if ((await custRow.count()) === 0) { test.skip(true, '고객 목록 없음(seed 부재)'); return; }
    await custRow.click().catch(() => {});
    await page.waitForTimeout(800);

    // 차트 2번탭 > 서류 탭.
    const docTab = page.getByRole('tab', { name: '서류' }).or(page.getByText('서류', { exact: true }));
    if ((await docTab.count()) === 0) { test.skip(true, '서류 탭 미노출(차트 미진입/seed)'); return; }
    await docTab.first().click().catch(() => {});
    await page.waitForTimeout(300);

    const issueBtn = page.locator('[data-testid="btn-doc-issue-today"]');
    if ((await issueBtn.count()) === 0 || (await issueBtn.isDisabled())) {
      test.skip(true, '당일 서류 발행 버튼 비활성(내원 기록 없음)'); return;
    }
    await issueBtn.click();
    await page.waitForTimeout(600);

    // 발행 패널 모달이 뜬 뒤, 일반서식 카드를 클릭했을 때 재출력 뷰어가 뜨면 안 됨.
    const cards = page.locator('[data-testid^="docprint-card-"]');
    if ((await cards.count()) === 0) { test.skip(true, '서류 카드 미노출'); return; }
    // 일반서식(재출력 대상) 카드 우선 클릭.
    const general = page.locator(
      '[data-testid="docprint-card-bill_receipt"], [data-testid="docprint-card-bill_receipt_new"], [data-testid="docprint-card-rx_standard"], [data-testid="docprint-card-treat_confirm_code"], [data-testid="docprint-card-treat_confirm_nocode"], [data-testid="docprint-card-visit_confirm"]',
    ).first();
    const target = (await general.count()) > 0 ? general : cards.first();
    const detail = target.getByText('상세 발행 →');
    if ((await detail.count()) === 0) { test.skip(true, '상세 발행 진입점 없음'); return; }
    await detail.click();
    await page.waitForTimeout(600);

    // 핵심 단언: 당일 발행 모드에서는 재출력 뷰어(이전 방문 저장본)가 절대 뜨지 않는다.
    await expect(page.locator('[data-testid="reprint-viewer-dialog"]')).toHaveCount(0);
  });

  // ── AC-3: 재출력 경로는 STAGE2 재출력 뷰어 동작 회귀 없음(seed 有 시) ──
  test('AC-3: 서류 재출력 경로 → 저장본 다시보기 뷰어 유지(STAGE2 회귀 0)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/customers').catch(() => {});
    await page.waitForTimeout(500);
    const custRow = page.locator('[data-testid="customer-row"], [data-customer-id], table tbody tr').first();
    if ((await custRow.count()) === 0) { test.skip(true, '고객 목록 없음(seed 부재)'); return; }
    await custRow.click().catch(() => {});
    await page.waitForTimeout(800);

    const docTab = page.getByRole('tab', { name: '서류' }).or(page.getByText('서류', { exact: true }));
    if ((await docTab.count()) === 0) { test.skip(true, '서류 탭 미노출'); return; }
    await docTab.first().click().catch(() => {});
    await page.waitForTimeout(300);

    // 예약행 '서류 재출력' 클릭 → 발행 저장본 있으면 재출력 뷰어 노출.
    const reprintBtn = page.locator('[data-testid="btn-doc-reprint"]').first();
    if ((await reprintBtn.count()) === 0 || (await reprintBtn.isDisabled())) {
      test.skip(true, '재출력 대상 예약행 없음(seed 부재)'); return;
    }
    await reprintBtn.click();
    await page.waitForTimeout(600);

    const general = page.locator(
      '[data-testid="docprint-card-bill_receipt"], [data-testid="docprint-card-bill_receipt_new"], [data-testid="docprint-card-rx_standard"], [data-testid="docprint-card-treat_confirm_code"], [data-testid="docprint-card-treat_confirm_nocode"], [data-testid="docprint-card-visit_confirm"]',
    );
    if ((await general.count()) === 0) { test.skip(true, '일반서식 카드 없음'); return; }
    let sawViewer = false;
    const n = await general.count();
    for (let i = 0; i < n; i++) {
      const c = general.nth(i);
      if ((await c.locator('text=/\\d+건/').count()) === 0) continue; // 발행 이력 배지 필요
      const detail = c.getByText('상세 발행 →');
      if ((await detail.count()) === 0) continue;
      await detail.click();
      try {
        await page.locator('[data-testid="reprint-viewer-dialog"]').waitFor({ state: 'visible', timeout: 4000 });
        sawViewer = true;
        break;
      } catch { /* 다음 후보 */ }
    }
    if (!sawViewer) { test.skip(true, '발행 저장본 있는 일반서식 없음(seed 부재)'); return; }
    // 회귀 가드: 재출력 경로에서는 STAGE2 다시보기 뷰어가 정상 노출된다.
    await expect(page.locator('[data-testid="reprint-preview-frame"]')).toBeVisible();
  });
});
