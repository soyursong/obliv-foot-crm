/**
 * E2E spec — T-20260715-foot-REFUND-BACKDATE-NAV-ERROR-HOTFIX
 *
 * 현장 보고(김주연 총괄, 풋센터): "전일자 이동해서 환불 처리 하려니깐 에러 뜸" (스샷 F0BH8BP2VH9)
 *
 * ── 진단 결과(RC) ─────────────────────────────────────────────────────────────
 *   스샷 에러 = 「환불 실패: Could not find the function
 *              public.refund_package_payment(p_method, p_payment_id) in the schema cache」
 *   = PostgREST PGRST202 (스키마 캐시가 신규 환불 RPC를 아직 인지 못 한 배포 직후 순간).
 *   • 날짜 컨텍스트 버그 아님 — '전일자'는 우연(패키지 결제 대상이 어제였을 뿐).
 *     환불 핸들러/RPC는 selectedDate 를 payload/RPC 에 전달하지 않음(날짜 무관).
 *   • 마이그 20260714200000(refund_package_payment) 은 prod ledger+함수 실재 확인 → 현재는 자연 복구.
 *   • 진짜 트리거 = 단건이 아닌 '패키지' 환불 + 배포 직후 스키마 캐시 지연.
 *
 * ── 재작성 컨텍스트 (FIX-REQUEST / QA NO-GO) ──────────────────────────────────
 *   최초 fix(0c2248ba)는 구버전 단건-다이얼로그 콜사이트(toast.error(`환불 실패: …`))를 패치했으나,
 *   현재 main 의 ClosingRefundDialog 는 '항목 선택(체크박스) + 일괄 환불' 배치 핸들러로 리팩터됨
 *   (PKG-REFUND-AMOUNT-MISMATCH 선택행 환불 도입분). 오류 경로가 toast → failMsgs.push 배열 누적으로
 *   바뀌어 구 콜사이트는 dead-code. 이 스펙은 리팩터된 배치 핸들러(failMsgs 경로) 기준으로 재검한다.
 *
 * ── 이 스펙이 검증하는 것 ─────────────────────────────────────────────────────
 *   AC1: 전일자(과거 날짜)로 이동해도 환불 진입이 크래시/화면갇힘 없이 렌더된다.
 *   AC3: 금일 환불 동선 회귀 없음.
 *   AC4: 배치 환불 RPC(단건/패키지) 가 PGRST202(schema cache/function-not-found)로 실패해도
 *        raw 영문 스택이 아니라 현장 친화 한국어 안내가 뜨고, 다이얼로그가 갇히지 않는다.
 *        (refundErrorMessage 매핑 — 이번 티켓의 코드 변경분, 배치 핸들러 failMsgs 두 분기에 통합)
 *
 * NOTE: AC2(대상 정합)/실환불 완료는 서버 RPC 실재에 의존 → 라이브 데이터 상태 의존이라
 *       본 스펙은 '무크래시 + 오류 UX' 계약에 집중(REDEFINITION_RISK: 새 경로 미신설).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 어제 날짜(yyyy-MM-dd, KST 기준 근사) — 일마감 상단 날짜 input 에 주입
function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function openClosingPayments(page: import('@playwright/test').Page) {
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
  await expect(paymentsTab).toBeVisible({ timeout: 10000 });
  await paymentsTab.click();
  await page.waitForTimeout(500);
}

// 상단 날짜 input(type=date) 에 값 주입
async function setClosingDate(page: import('@playwright/test').Page, value: string) {
  const dateInput = page.locator('input[type="date"]').first();
  await expect(dateInput).toBeVisible({ timeout: 10000 });
  await dateInput.fill(value);
  await dateInput.dispatchEvent('change');
  await page.waitForTimeout(800);
}

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 전일자 환불 진입: 크래시/화면갇힘 없음 (AC1)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 1 — 전일자 환불 진입 무크래시 (AC1)', () => {
  test('전일자로 이동해도 결제내역이 렌더되고 error-boundary 가 뜨지 않는다', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await openClosingPayments(page);
    await setClosingDate(page, yesterdayStr());

    // 결제내역 테이블(환불 컬럼 헤더)이 여전히 렌더 → 크래시(흰 화면) 아님
    const refundHeader = page.getByRole('columnheader', { name: '환불' });
    await expect(refundHeader).toBeVisible({ timeout: 10000 });

    // React error boundary / 전역 크래시 문구가 없어야 함
    await expect(page.locator('body')).not.toContainText('Something went wrong');
    await expect(page.locator('body')).not.toContainText('Cannot read properties');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 금일 환불 회귀 없음 (AC3)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 2 — 금일 환불 동선 회귀 없음 (AC3)', () => {
  test('금일 복귀 시 결제내역/환불 컬럼 정상 렌더', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await openClosingPayments(page);
    await setClosingDate(page, todayStr());

    const refundHeader = page.getByRole('columnheader', { name: '환불' });
    await expect(refundHeader).toBeVisible({ timeout: 10000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — PGRST202(스키마 캐시) 실패 시 현장 친화 안내 (AC4) — 이번 코드 변경분
//   배치 핸들러(failMsgs) 기준: 항목 체크 → 사유 입력 → 환불 확정 → window.confirm 수락 →
//   RPC 응답을 강제로 PGRST202 로 가로채(mock) → refundErrorMessage 매핑 검증.
// ──────────────────────────────────────────────────────────────────────────────
test.describe('시나리오 3 — 스키마 캐시 오류 UX (AC4)', () => {
  test('배치 환불 RPC 가 PGRST202 로 실패해도 raw 영문 대신 한국어 안내가 뜬다', async ({ page }) => {
    await loginAndWaitForDashboard(page);

    // 배치 핸들러의 window.confirm(합계 확인) → 자동 수락. 클릭 전에 등록.
    page.on('dialog', (d) => d.accept());

    // refund_single_payment / refund_package_payment RPC → 404 PGRST202 강제
    await page.route('**/rest/v1/rpc/refund_*payment*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'PGRST202',
          message:
            'Could not find the function public.refund_package_payment(p_method, p_payment_id) in the schema cache',
          details: null,
          hint: null,
        }),
      }),
    );

    await openClosingPayments(page);

    // 환불 다이얼로그 열기(고객 환불행 묶음) — 환불 가능한 결제행이 없으면 스킵(라이브 데이터 의존)
    const refundBtn = page.getByTestId('refund-open-btn').first();
    if ((await refundBtn.count()) === 0) {
      test.skip(true, '환불 가능한 결제행이 없어 스킵(라이브 데이터 의존)');
    }
    await refundBtn.click();

    const dialog = page.getByTestId('closing-refund-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // 배치 UI: 환불 가능한(비활성 아님) 첫 항목 체크박스 선택 → 확정 활성화
    const checkbox = dialog.getByTestId('refund-item-checkbox').filter({ hasNot: page.locator('[disabled]') }).first();
    const anyCheckbox = dialog.getByTestId('refund-item-checkbox').first();
    const target = (await checkbox.count()) > 0 ? checkbox : anyCheckbox;
    if ((await target.count()) === 0 || (await target.isDisabled())) {
      test.skip(true, '선택 가능한 환불 항목이 없어 스킵(라이브 데이터: 전액 환불됨 등)');
    }
    await target.check();

    // 사유(필수) 입력
    await dialog.getByPlaceholder(/고객 요청|시술 불만족|사유/).fill('벤결제건 (E2E)').catch(async () => {
      await dialog.locator('textarea').first().fill('벤결제건 (E2E)');
    });

    // 환불 확정(배치 제출) — testid 로 안정 타겟
    await dialog.getByTestId('refund-submit').click();

    // 친화 안내 노출 + raw 영문 스택 미노출 (배치 요약 toast 에 friendly 메시지가 실림)
    await expect(page.locator('body')).toContainText('아직 서버에 반영되지 않았습니다', {
      timeout: 8000,
    });
    await expect(page.locator('body')).not.toContainText('schema cache');
    await expect(page.locator('body')).not.toContainText('Could not find the function');

    // 다이얼로그가 갇히지 않음(무한로딩/크래시 아님) — 여전히 조작 가능
    await expect(dialog).toBeVisible();
  });
});
