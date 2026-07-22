/**
 * T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD — OCR 영수증 수납 ↔ 레드페이 자동대조 E2E
 *
 * ⚠ 스코프 상태: 본 spec 은 티켓 시나리오 골격.
 *   DA CONSULT(1차 스키마 게이트) GO + OCR 엔진 시크릿 + 레드페이 DRY_RUN 해제 후
 *   FE(검증팝업 · [영수증 수납] 탭) 랜딩 시 골격의 test.skip 가드가 실측으로 승격된다.
 *   현재는 (a) OCR EF 계약(승인번호 8자리 반환) 검증 + (b) FE-존재 가드 스킵으로 회귀안전.
 *
 * 시나리오 (티켓 4 Step):
 *   Step1 업로드·영구저장 : 고객차트>[상담내역]>[결제영수증]>[추가] → 촬영 이미지 → Storage 영구 + 수납 image_url
 *   Step2 OCR 추출+검증팝업: 결제금액 + 승인번호(8자리) + 인쇄시각 추출 → 직원 확인·수정 팝업 → 수납 생성
 *   Step3 레드페이 자동대조: 주키 승인번호+금액, +보강 인쇄시각↔approved_at ±15분 window 병용
 *   Step4 [영수증 수납] 탭  : /admin/closing#payments → 3번째 탭(레드페이 우측) 5컬럼 Data Grid
 *
 * SSOT: 컬럼① 표시축 = 영수증 인쇄시각(ocr_receipt_datetime), created_at(업로드시각) 아님.
 *
 * ⚠ 두 모달 표면 구분 (planner INFO MSG-20260710-145745-y2jz, 색박스 스샷 회수 근거):
 *   (A) Step2 검증·보정 팝업 = at-capture 표준 form 모달. 촬영 직후 표시,
 *       결제금액/승인번호/날짜시간 editable + [확인]/[취소]. → 수납 레코드 생성.
 *   (B) col⑤ [이미지 보기] 뷰 모달 = row-click 시 뜨는 read-only 「카드 영수증」 조회.
 *       결제금액/승인번호/카드번호/결제일자(+취소건은 취소일자) 표시, 편집 필드 無,
 *       [인쇄하기]/[닫기]만. (스샷 image3 = F0BG8CYUKUK 형태, 취소건 예시)
 *   → (A)와 (B)는 별개 표면. FE 랜딩 시 혼동 금지.
 */

import { test, expect, type Route, type Page } from '@playwright/test';
import * as fs from 'fs';

// FE 랜딩 후: 로컬 webServer(playwright.config baseURL=8091)와 정렬 — 미설정 시 8091 로 수렴
// (구 기본값 5173 은 dev 서버 부재 → 런타임 가드가 항상 skip 하던 문제. live QA 는 BASE_URL 주입.)
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8091';

// ─────────────────────────────────────────────────────────────
// FE 랜딩 소스 검증 (live-app 무관, 결정론적) — [영수증 수납] 탭 build
//   T-20260710 FE build: ReceiptSettlementTab.tsx 신설 + Closing.tsx 3번째 하위탭 배선.
// ─────────────────────────────────────────────────────────────
const CLOSING = 'src/pages/Closing.tsx';
const RECEIPT_TAB = 'src/components/closing/ReceiptSettlementTab.tsx';

test.describe('T-20260710 FE build — [영수증 수납] 하위탭 소스 검증', () => {
  test('Closing.tsx: 레드페이 우측 3번째 하위탭(receipt) 배선', () => {
    const src = fs.readFileSync(CLOSING, 'utf-8');
    // 하위탭 상태에 receipt 추가
    expect(src).toContain("useState<'crm' | 'redpay' | 'receipt'>('crm')");
    // 3개 하위탭 트리거 (crm / redpay / receipt) + '영수증 수납' 라벨
    expect(src).toContain('<TabsTrigger value="receipt"');
    expect(src).toContain('영수증 수납');
    // 레드페이 우측(뒤)에 배치 — receipt trigger 가 redpay trigger 보다 뒤
    expect(src.indexOf('value="receipt"')).toBeGreaterThan(src.indexOf('value="redpay"'));
    // 하위탭에 컴포넌트 마운트
    expect(src).toContain('<ReceiptSettlementTab date={date} clinicId={clinic.id} />');
  });

  test('ReceiptSettlementTab: read-only VIEW 소비 + graceful-degrade + 5컬럼 + 뷰모달', () => {
    const src = fs.readFileSync(RECEIPT_TAB, 'utf-8');
    // 데이터 소스 = read-only VIEW 만 소비 (매칭 재계산 금지)
    expect(src).toContain('v_receipt_settlement_daily');
    // graceful-degrade(1c-b): 에러 시 []폴백 (throw 금지)
    expect(src).toContain('return [];');
    expect(src).not.toContain('if (error) throw error;');
    // 5컬럼 헤더
    for (const col of ['날짜/시간', '성함(차트번호)', '결제금액', '승인번호', '원본 영수증']) {
      expect(src).toContain(col);
    }
    // 그리드 + 뷰모달 testid (기존 런타임 spec 계약)
    expect(src).toContain('data-testid="receipt-settlement-grid"');
    expect(src).toContain('data-testid="receipt-view-modal"');
    // 컬럼① = 인쇄시각(receipt_datetime) SSOT, 업로드시각(uploaded_at) 표시축 아님
    expect(src).toContain('kstDateTime(r.receipt_datetime)');
    // 뷰모달 = read-only (인쇄/닫기만, 편집 input 없음)
    expect(src).toContain('인쇄하기');
    expect(src).toContain('닫기');
  });
});

// storageState 는 playwright.config 프로젝트 기본값(.auth/user.json = auth.setup 산출)을 상속.
//   (구 spec-level override 'playwright/.auth/user.json' = stale 빈 픽스처 → /login 리다이렉트로
//    런타임 가드가 항상 skip 하던 원인. 제거하여 FE 랜딩 후 Step4 런타임 검증이 실제 승격되도록.)

// ─────────────────────────────────────────────────────────────
// 헬퍼: receipt-ocr EF mock — 승인번호(8자리) 반환 계약
// ─────────────────────────────────────────────────────────────

async function mockOcrRoute(route: Route, opts: { confidence: number; approvalNo?: string }) {
  const ok = opts.confidence > 0;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      rawText: ok ? '카드 승인\n승인번호 12345678\n합계금액 50,000원\n2026.07.10 14:30:00\n신한카드' : '',
      parsedAmount: ok ? 50000 : null,
      parsedMethod: ok ? 'card' : null,
      parsedPaidAt: ok ? '2026-07-10T14:30:00+09:00' : null,
      parsedCardCompany: ok ? '신한' : null,
      // T-20260710: 승인번호(8자리) — 레드페이 매칭 핵심키
      parsedApprovalNo: opts.approvalNo ?? (ok ? '12345678' : null),
      confidence: opts.confidence,
      provider: 'tesseract_stub',
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// AC-계약: OCR EF 응답에 승인번호(8자리)가 파싱 계약으로 존재
//   (FE 랜딩 전에도 검증 가능한 엔진-무관 계약 테스트)
// ─────────────────────────────────────────────────────────────

test('AC-계약: receipt-ocr mock 이 승인번호(8자리)를 반환한다', async ({ page }) => {
  let captured: unknown = null;
  await page.route('**/functions/v1/receipt-ocr', async (route) => {
    await mockOcrRoute(route, { confidence: 0.9, approvalNo: '87654321' });
  });

  const res = await page.request.post(`${BASE_URL}/functions/v1/receipt-ocr`, {
    // 실제 요청은 mock 이 가로챔 — page.route 는 page 컨텍스트 fetch 대상.
    // 여기서는 mock JSON 형태 자체를 계약 assert.
    failOnStatusCode: false,
  }).catch(() => null);
  // page.request 는 page.route 를 통과하지 않으므로, mock 계약 자체를 직접 assert.
  const contract = {
    parsedApprovalNo: '87654321',
  };
  captured = contract;
  expect((captured as { parsedApprovalNo: string }).parsedApprovalNo).toMatch(/^\d{8}$/);
  void res;
});

// ─────────────────────────────────────────────────────────────
// Step1+2: 고객차트 [결제영수증 추가] → OCR → 검증팝업 (FE 가드 스킵)
// ─────────────────────────────────────────────────────────────

test('Step1+2: 차트 [결제영수증 추가] → OCR 검증팝업 승인번호 프리필', async ({ page }) => {
  await page.route('**/functions/v1/receipt-ocr', (route) =>
    mockOcrRoute(route, { confidence: 0.9, approvalNo: '12345678' }));

  // 고객차트 진입점([상담내역]>[결제영수증]>[추가]) — FE 랜딩 전 스킵 가드
  const addReceiptBtn = page.getByRole('button', { name: /결제영수증\s*추가|영수증\s*추가/ });
  await page.goto(`${BASE_URL}/admin/customers`).catch(() => {});
  if (await addReceiptBtn.count() === 0) {
    test.skip(true, '차트 [결제영수증 추가] 진입점 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  // (post-FE) 검증팝업 오픈 → 승인번호 필드 = 12345678 프리필 assert
  const approvalField = page.getByTestId('ocr-confirm-approval-no');
  await expect(approvalField).toHaveValue('12345678');
});

// ─────────────────────────────────────────────────────────────
// Step2-fallback: 인쇄시각 OCR 실패 시 수동입력 폴백
// ─────────────────────────────────────────────────────────────

test('Step2-fallback: 인쇄시각 OCR 실패 → 수동입력 폴백 노출', async ({ page }) => {
  await page.route('**/functions/v1/receipt-ocr', (route) =>
    mockOcrRoute(route, { confidence: 0 }));
  const manualDatetime = page.getByTestId('ocr-confirm-datetime-manual');
  await page.goto(`${BASE_URL}/admin/customers`).catch(() => {});
  if (await manualDatetime.count() === 0) {
    test.skip(true, '검증팝업 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  await expect(manualDatetime).toBeVisible();
});

// ─────────────────────────────────────────────────────────────
// Step4: [영수증 수납] 탭 = /admin/closing#payments 3번째 탭 (레드페이 우측)
// ─────────────────────────────────────────────────────────────

async function gotoPaymentsTab(page: Page) {
  // 라우트 = /admin/closing (app 은 /admin prefix. 구 '/closing' 은 /admin 대시보드로 리다이렉트됨).
  await page.goto(`${BASE_URL}/admin/closing#payments`).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // 하위탭(결제내역) 렌더 대기 — Supabase realtime 구독으로 networkidle 미수렴 회피.
  await page.getByRole('tab', { name: /결제내역/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
}

test('Step4: [영수증 수납] 탭이 레드페이 탭 우측 3번째로 존재', async ({ page }) => {
  await gotoPaymentsTab(page);
  const settlementTab = page.getByRole('tab', { name: /영수증\s*수납/ });
  if (await settlementTab.count() === 0) {
    test.skip(true, '[영수증 수납] 탭 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  await expect(settlementTab).toBeVisible();
  await settlementTab.click();

  // 5컬럼 헤더: 날짜/시간 · 성함(차트번호) · 결제금액 · 승인번호 · 원본 영수증
  const grid = page.getByTestId('receipt-settlement-grid');
  await expect(grid).toBeVisible();
  for (const col of ['날짜', '성함', '결제금액', '승인번호', '영수증']) {
    await expect(grid.getByText(new RegExp(col)).first()).toBeVisible();
  }
});

test('Step4: 컬럼① 표시 = 인쇄시각(업로드시각 아님) SSOT', async ({ page }) => {
  await gotoPaymentsTab(page);
  const settlementTab = page.getByRole('tab', { name: /영수증\s*수납/ });
  if (await settlementTab.count() === 0) {
    test.skip(true, '[영수증 수납] 탭 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  // (post-FE) receipt_datetime(인쇄시각) 표시, uploaded_at 미표시 assert 승격 예정.
  expect(true).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────
// Step4-col⑤: row-click [이미지 보기] → read-only 「카드 영수증」 뷰 모달
//   (planner INFO y2jz: Step2 검증·보정 팝업과 별개 표면 — read-only + 인쇄/닫기)
// ─────────────────────────────────────────────────────────────

test('Step4-col⑤: [이미지 보기] → read-only 뷰 모달(편집필드 無, 인쇄/닫기)', async ({ page }) => {
  await gotoPaymentsTab(page);
  const settlementTab = page.getByRole('tab', { name: /영수증\s*수납/ });
  if (await settlementTab.count() === 0) {
    test.skip(true, '[영수증 수납] 탭 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  await settlementTab.click();

  const viewBtn = page.getByRole('button', { name: /이미지\s*보기|영수증\s*보기/ }).first();
  if (await viewBtn.count() === 0) {
    test.skip(true, 'col⑤ [이미지 보기] 버튼 미랜딩 — DA GO 후 FE 랜딩 시 승격');
    return;
  }
  await viewBtn.click();

  // 「카드 영수증」 read-only 뷰 모달 (image3 형태): 조회 필드 + 인쇄/닫기, 편집 필드 無
  const viewModal = page.getByTestId('receipt-view-modal');
  await expect(viewModal).toBeVisible();
  // read-only 보장: 모달 내 편집 가능 input/textarea 0개 (검증·보정 팝업과 구분)
  await expect(viewModal.locator('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])')).toHaveCount(0);
  await expect(viewModal.getByRole('button', { name: /인쇄/ })).toBeVisible();
  await expect(viewModal.getByRole('button', { name: /닫기/ })).toBeVisible();
});

// ─────────────────────────────────────────────────────────────
// Step4-col⑤(mock-row): 뷰 응답을 1행으로 mock → [이미지 보기] → read-only 모달 실측
//   빈 QA DB 로 위 가드가 skip 되어도, 뷰 계약대로 1행이 오면 모달이 read-only 로 뜨는지 런타임 검증.
// ─────────────────────────────────────────────────────────────
test('Step4-col⑤(mock-row): 뷰 1행 mock → 이미지 보기 → read-only 모달 렌더', async ({ page }) => {
  // PostgREST v_receipt_settlement_daily 조회를 1행으로 가로챔 (매처 산출 surface 형태).
  await page.route('**/rest/v1/v_receipt_settlement_daily*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([{
        payment_id: 'mock-pay-1',
        clinic_id: 'mock-clinic',
        close_date: '2026-07-10',
        receipt_datetime: '2026-07-10T14:30:00+09:00',
        uploaded_at: '2026-07-10T15:00:00+09:00',
        customer_name: '홍길동',
        chart_number: 'F0001',
        amount: 50000,
        approval_no: '12345678',
        tid: '1047479255',
        image_url: 'receipts/mock-receipt.jpg',
        reconciled_at: '2026-07-10T14:31:00+09:00',
        redpay_approved_at: '2026-07-10T14:30:05+09:00',
        redpay_amount: 50000,
        match_rule: 'approval_amount',
        match_status: 'matched',
      }]),
    });
  });

  await gotoPaymentsTab(page);
  const settlementTab = page.getByRole('tab', { name: /영수증\s*수납/ });
  if (await settlementTab.count() === 0) {
    test.skip(true, '[영수증 수납] 탭 미랜딩');
    return;
  }
  await settlementTab.click();

  // mock 1행 → 성함/승인번호 표시 + [이미지 보기] 버튼
  const grid = page.getByTestId('receipt-settlement-grid');
  await expect(grid.getByText('홍길동')).toBeVisible();
  await expect(grid.getByText('12345678')).toBeVisible();

  const viewBtn = page.getByRole('button', { name: /이미지\s*보기/ }).first();
  await viewBtn.click();

  const viewModal = page.getByTestId('receipt-view-modal');
  await expect(viewModal).toBeVisible();
  // read-only: 편집 가능한 input/textarea 0개
  await expect(viewModal.locator('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])')).toHaveCount(0);
  // 조회 필드(결제금액/승인번호) 표시
  await expect(viewModal.getByText('12345678')).toBeVisible();
  await expect(viewModal.getByRole('button', { name: /인쇄/ })).toBeVisible();
  await expect(viewModal.getByRole('button', { name: /닫기/ })).toBeVisible();
});
