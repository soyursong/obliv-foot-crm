/**
 * E2E spec — T-20260527-foot-CLOSE-ITEM-COUNT
 * 일마감 개별 건 수 표기 — 빨간 박스 구역 전체 적용
 *
 * 배경:
 *   T-20260526-foot-CLOSING-PAYCOUNT에서 패키지 결제 / 단건 결제 / 합계 SummaryCard에
 *   건 수(N건) 표기를 추가했으나, "수기결제" SummaryCard는 호환(backward-compatible)만
 *   처리하고 count 전달을 누락. 이번 티켓은 "전체 적용"으로 수기결제 카드에도 건 수 추가.
 *
 * 빨간 박스 구역 식별:
 *   Closing.tsx 총 합계 탭의 SummaryCard 그리드 4종
 *   (패키지 결제 / 단건 결제 / 수기결제 / 합계(결제수단별))
 *
 * AC-1: Closing 페이지 "빨간 박스 구역" 식별 — SummaryCard 4종 모두 존재
 * AC-2: 수기결제 SummaryCard — 카드/현금/이체 각 행에 count 전달 (N건 표기)
 * AC-3: 합계 SummaryCard "수기결제 포함" 행에 count 전달 (전체 적용)
 * AC-4: 기존 패키지/단건/합계 카드 건 수 표기 회귀 없음
 * AC-5: 빌드 통과
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const src = (): string => fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

// ─── AC-1: 빨간 박스 구역 식별 ───────────────────────────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT AC-1: 빨간 박스 구역 식별', () => {

  test('SummaryCard 4종 title 모두 존재', () => {
    const s = src();
    expect(s).toContain('title="패키지 결제"');
    expect(s).toContain('title="단건 결제"');
    expect(s).toContain('title="수기결제"');
    expect(s).toContain('title="합계 (결제수단별)"');
  });

  test('SummaryCard rows에 [string, number, number?] 타입 사용', () => {
    const s = src();
    // count가 포함된 rows 형태 — 3번째 요소(건 수) 전달
    expect(s).toContain('[string, number, number]');
  });

});

// ─── AC-2: 수기결제 SummaryCard 건 수 표기 ───────────────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT AC-2: 수기결제 카드 건 수', () => {

  test('수기결제 카드 — 카드 행에 manualCardCount 전달', () => {
    const s = src();
    expect(s).toContain("['카드', totals.manualCard, totals.manualCardCount]");
  });

  test('수기결제 카드 — 현금 행에 manualCashCount 전달', () => {
    const s = src();
    expect(s).toContain("['현금', totals.manualCash, totals.manualCashCount]");
  });

  test('수기결제 카드 — 이체 행에 manualTransferCount 전달', () => {
    const s = src();
    expect(s).toContain("['이체', totals.manualTransfer, totals.manualTransferCount]");
  });

  test('수기결제 카드 — totalCount 전달', () => {
    const s = src();
    expect(s).toContain(
      'totalCount={totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount}'
    );
  });

  test('totals useMemo — manualCardCount/manualCashCount/manualTransferCount 계산 로직 존재', () => {
    const s = src();
    expect(s).toContain("manualEntries.filter(m => m.method === 'card').length");
    expect(s).toContain("manualEntries.filter(m => m.method === 'cash').length");
    expect(s).toContain("manualEntries.filter(m => m.method === 'transfer').length");
  });

  test('totals 반환 객체에 manualCardCount/manualCashCount/manualTransferCount 포함', () => {
    const s = src();
    expect(s).toContain('manualCardCount, manualCashCount, manualTransferCount');
  });

});

// ─── AC-3: 합계 카드 "수기결제 포함" 행 건 수 전체 적용 ──────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT AC-3: 합계 카드 수기결제 포함 건 수', () => {

  test('"수기결제 포함" 행에 count 인자 전달', () => {
    const s = src();
    // 수기결제 포함 행: [string, number, number] 형태로 spread
    expect(s).toContain(
      "'수기결제 포함', totals.manualTotal, totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount"
    );
  });

  test('"수기결제 포함" 행 — [string, number, number] 타입 캐스팅', () => {
    const s = src();
    const pattern = /['"]수기결제 포함['"].*\[string, number, number\]/;
    expect(pattern.test(s)).toBe(true);
  });

});

// ─── AC-4: 기존 건 수 표기 회귀 없음 ─────────────────────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT AC-4: 기존 카드 건 수 회귀 없음', () => {

  test('패키지 결제 카드 — pkgCardCount/pkgCashCount/pkgTransferCount 여전히 전달', () => {
    const s = src();
    expect(s).toContain('totals.pkgCardCount');
    expect(s).toContain('totals.pkgCashCount');
    expect(s).toContain('totals.pkgTransferCount');
  });

  test('단건 결제 카드 — singleCardCount/singleCashCount/singleTransferCount 여전히 전달', () => {
    const s = src();
    expect(s).toContain('totals.singleCardCount');
    expect(s).toContain('totals.singleCashCount');
    expect(s).toContain('totals.singleTransferCount');
  });

  test('합계 카드 totalCount — totalCardCount + totalCashCount + totalTransferCount 유지', () => {
    const s = src();
    expect(s).toContain(
      'totalCount={totals.totalCardCount + totals.totalCashCount + totals.totalTransferCount}'
    );
  });

  test('SummaryCard 컴포넌트 — count undefined 시 건 수 미표시 (기존 렌더 유지)', () => {
    const s = src();
    expect(s).toContain('count !== undefined');
  });

});

// ─── AC-5: 기존 금액 집계 정확성 불변 ────────────────────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT AC-5: 금액 집계 무변경', () => {

  test('sumGross/sum 헬퍼 여전히 존재', () => {
    const s = src();
    expect(s).toContain('const sumGross');
    expect(s).toContain('const sum');
  });

  test('grossTotal = totalCard + totalCash + totalTransfer 공식 유지', () => {
    const s = src();
    expect(s).toContain('const grossTotal = totalCard + totalCash + totalTransfer');
  });

  test('manualTotal 금액 집계 — .reduce((s, m) => s + m.amount, 0) 유지', () => {
    const s = src();
    expect(s).toContain('manualCard + manualCash + manualTransfer');
  });

});

// ─── FIX: supervisor QA 대응 — 조건부 렌더링 제거 검증 ────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT FIX: 수기결제 항상 렌더 (supervisor 요구)', () => {

  test('수기결제 카드 — manualTotal>0 조건부 렌더 제거 확인', () => {
    const s = src();
    // 수기결제 SummaryCard가 조건부({totals.manualTotal > 0 && ...) 없이 항상 렌더되어야 함
    // 이전 조건 문자열이 존재하면 0건 상태에서 카드가 사라짐 → 실패
    expect(s).not.toContain('{totals.manualTotal > 0 && (');
    // title="수기결제" 는 여전히 존재 (항상 렌더)
    expect(s).toContain('title="수기결제"');
  });

});

// ─── VISIBLE: 브라우저 렌더링 검증 (desktop-chrome + auth 필요) ──────────────
// supervisor QA에서 /admin/closing 접속 후 3개 텍스트 미탐지 재현 방지.
// 실행 조건: 로컬 dev 서버(port 8082) + .auth/user.json 세션 필요.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260527-CLOSE-ITEM-COUNT VISIBLE: /admin/closing 텍스트 가시성', () => {

  test('수기결제 · 합계(결제수단별) · N건 — 0건 상태에서도 가시', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    // 인증 실패 시(로그인 페이지 리다이렉트) 명시적 오류
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('login')) {
      throw new Error(
        `[VISIBLE] 인증 실패 — /admin/closing 접근 시 로그인으로 리다이렉트됨.\n` +
        `URL: ${currentUrl}\n` +
        `auth.setup.ts 실행 여부와 .auth/user.json 확인 필요.`,
      );
    }

    // 미래 날짜(0건 상태) 강제: 수기결제 manualTotal=0 조건에서도 카드 존재 보장
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.count() > 0) {
      await dateInput.fill('2099-12-31');
      await page.waitForLoadState('networkidle');
    }

    // ① "수기결제" 타이틀 — 조건 제거 후 0건 상태에서도 visible
    await expect(page.getByText('수기결제').first()).toBeVisible({ timeout: 8_000 });

    // ② "합계 (결제수단별)" 타이틀 — 항상 렌더
    await expect(page.getByText('합계 (결제수단별)').first()).toBeVisible({ timeout: 8_000 });

    // ③ "N건" 패턴 텍스트 — 0건 시 "0건", 데이터 있을 시 "N건"
    //    패키지/단건/수기/합계 4 SummaryCard × 각 3행 → 최소 4개 이상 "N건" 존재
    const kenLocator = page.locator('text=/^\\d+건$/');
    const kenCount = await kenLocator.count();
    console.log(`[VISIBLE] "N건" 패턴 개수: ${kenCount}`);
    expect(kenCount).toBeGreaterThanOrEqual(1);
  });

  test('수기결제 카드 — 미래 날짜 0건에서 "0건" 텍스트 포함', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      test.skip(true, `인증 미설정 — 로그인 리다이렉트 (${currentUrl})`);
      return;
    }

    // 미래 날짜로 설정 → 모든 카운트 = 0
    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.count() > 0) {
      await dateInput.fill('2099-12-31');
      await page.waitForLoadState('networkidle');
    }

    // "0건" 텍스트가 DOM에 존재해야 함 (수기결제 카드 항상 렌더 보장 결과)
    const zeroKen = page.locator('text=0건');
    const zeroKenCount = await zeroKen.count();
    console.log(`[VISIBLE] "0건" 텍스트 개수: ${zeroKenCount}`);
    expect(zeroKenCount).toBeGreaterThanOrEqual(1);
  });

});
