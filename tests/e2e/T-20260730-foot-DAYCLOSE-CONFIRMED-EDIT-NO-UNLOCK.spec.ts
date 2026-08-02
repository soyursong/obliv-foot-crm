/**
 * T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK — 일마감 확정 후 '해제 없이 수정' E2E spec
 *
 * 배경 (현장 확정 김다인 MSG-8f6s / DA Q4 [4-d]):
 *   일마감 매출 확정(closed) 후 '재오픈(해제)' 클릭 없이 바로 수정 진입·저장.
 *   저장 = closing_confirmed_edit RPC(원자적 unlock→edit→re-confirm revision+1 + closing_edit_log 감사).
 *   herald confirm_guard 재발화 → outbox 재발행 → Silver 재집계 정합(by-construction).
 *   권한 = payment + admin/manager/director(canEditConfirmedClosing). 이력 화면 즉시노출.
 *
 * 검증지문:
 *   · 확정(마감됨) 상태에서 '확정 상태에서 수정'(confirmed-edit-enter) 버튼 노출 — 재오픈 클릭 불필요.
 *   · 진입 시 배너 + '수정 저장'/'취소' 노출 + 실제정산 입력 활성(해제 없이 편집 가능).
 *   · 확정 후 수정 이력(closing_edit_log) 화면 조회 wiring — clinic_id + close_date 필터 read 요청.
 *   · 신규 테이블/RPC 미배포/컬럼부재로 인한 런타임 크래시 0.
 *
 * READ-ONLY 지향: 실제 재확정 저장(데이터 mutate)은 수행하지 않는다(취소로 종료).
 *   확정 상태 데이터가 없는 환경에서도 회귀검증(render + 이력 read wiring + no-crash)은 항상 성립.
 *   admin storageState 사용(권한 게이트 노출 조건 충족).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const CLOSING_URL = `${BASE_URL}/admin/closing`;

test.use({ storageState: 'playwright/.auth/user.json' });

test.describe('일마감 확정 후 해제없이 수정 — 진입/이력/무회귀', () => {
  test('시나리오0(무회귀): 일마감 화면 렌더 + 신규 테이블/RPC 참조 크래시 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(CLOSING_URL);
    await page.waitForLoadState('networkidle');

    // 총 합계 탭이 정상 렌더(합계 영역 노출)
    await expect(page.getByText(/합계/).first()).toBeVisible();
    // 신규 테이블/RPC/컬럼 부재로 인한 런타임 크래시가 없어야 한다.
    expect(errors.join('\n')).not.toMatch(/closing_edit_log|closing_confirmed_edit|revision|column .* does not exist/i);
  });

  test('시나리오A: 확정 후 수정 이력(closing_edit_log) — clinic+close_date 필터 read 요청 wiring', async ({ page }) => {
    let anyLogQuery = false;
    let scopedLogQuery = false;
    page.on('request', (req) => {
      const u = req.url();
      if (/closing_edit_log/.test(u)) {
        anyLogQuery = true;
        // clinic_id + close_date 스코프가 붙어야 한다(전체 스캔 금지).
        if (/clinic_id=eq\./.test(u) && /close_date=eq\./.test(u)) scopedLogQuery = true;
      }
    });

    await page.goto(CLOSING_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    // 이력 조회가 발생했고(화면 즉시노출 소스), clinic+날짜 스코프가 붙었다.
    expect(anyLogQuery).toBeTruthy();
    expect(scopedLogQuery).toBeTruthy();
  });

  test('시나리오1: 확정(마감됨) 상태면 재오픈 없이 수정 진입 → 배너 + 저장/취소 + 입력 활성', async ({ page }) => {
    await page.goto(CLOSING_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);

    const closedBadge = page.getByText('마감됨');
    const isClosed = (await closedBadge.count()) > 0;

    if (!isClosed) {
      // 오늘(기본 날짜)이 미확정이면 확정 데이터 부재 — 진입 버튼도 없어야 한다(fail-closed 확인).
      await expect(page.getByTestId('confirmed-edit-enter')).toHaveCount(0);
      test.info().annotations.push({ type: 'note', description: '기본 날짜 미확정 — 확정-편집 진입 버튼 부재 확인(조건부 skip)' });
      return;
    }

    // 확정 상태: '확정 상태에서 수정' 버튼이 노출(재오픈과 별개, 해제 클릭 불필요)
    const enterBtn = page.getByTestId('confirmed-edit-enter');
    await expect(enterBtn).toBeVisible();

    // 진입 → 배너 + 저장/취소 노출 + 실제정산 입력 활성
    await enterBtn.click();
    await expect(page.getByTestId('confirmed-edit-banner')).toBeVisible();
    await expect(page.getByTestId('confirmed-edit-save')).toBeVisible();
    await expect(page.getByTestId('confirmed-edit-cancel')).toBeVisible();

    // 실제 정산 카드의 금액 입력이 활성(disabled 아님) — 해제 없이 바로 편집 가능
    const enabledInputs = page.locator('input:not([disabled])');
    expect(await enabledInputs.count()).toBeGreaterThan(0);

    // READ-ONLY: 데이터 mutate 없이 취소로 종료
    await page.getByTestId('confirmed-edit-cancel').click();
    await expect(page.getByTestId('confirmed-edit-banner')).toHaveCount(0);
    await expect(page.getByTestId('confirmed-edit-enter')).toBeVisible();
  });
});
