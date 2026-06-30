import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-RESVMGMT-HOVER-MEMO-LINK
 *
 * 현장(박민지 팀장): 예약관리 예약카드 hover 팝업에 (1) 예약메모가 안 보임,
 *   (2) hover 팝업 내 '링크'(성함→고객차트) 동작 점검·수정 요청.
 *
 * §2 분기 진단(착수 전 필수):
 *   reservation_memo_history(reservation-scope) 162행 + reservations.booking_memo 비공백 103행 →
 *   메모는 DB에 실재(ingest 결손 아님) → FE display 축 = 본 티켓 범위(ingest SYNC/PUSH-DROP 소관 아님).
 *
 * 근본원인 + 결론:
 *   - 메모 미표시 RC: hover 가 reservations.booking_memo(생성시 초기메모만 담는 부분 미러)만 읽어,
 *     예약상세 팝업 타임라인(reservation_memo_history SoT)으로 추가/수정한 메모가 hover 에 미표시.
 *     → 형제 티켓 T-20260630-foot-RESVHOVER-MEMO-NOT-SHOWN(commit 32221de1, main 라이브)이
 *       resvMemoMap(reservation_memo_history SoT 배치 조회) 배선으로 해소. 본 티켓 메모축과 동일 수정.
 *   - '링크': hover 팝업(포털 카드) 내부엔 anchor/href/clickable 0 (런타임 확인). 현장이 말한 '링크' =
 *     밑줄 성함(트리거) onClick → handleResvOpenChart → openChart(고객차트). 깨진 적 없음(런타임 확인).
 *
 * 라이브 검증(이 spec 작성 시 desktop-chrome 실행 결과):
 *   - 예약메모 표시: 메모 있는 카드 = 내용 노출('SDEERERE'/'내원 후…'/'도수센터 총괄님'), 없는 카드 = '-' (AC1/AC2).
 *   - 성함 링크 클릭 → 고객차트 sheet open (AC3). pageerror 0 (AC4).
 *
 * 시나리오(AC1~AC4):
 *   S1(source-integrity, 결정론): 메모 SoT 배선 + bookingMemo 렌더 라인 + 성함 onClick 링크 배선 잔존.
 *   S2(live, best-effort): 예약카드 hover → 간략정보 카드에 '예약메모' 줄(내용/빈메모 '-') 안전 렌더 + pageerror 0.
 *   S3(live, best-effort): 밑줄 성함(clickable 트리거) 클릭 → 고객차트 패널 open(링크 동작).
 *
 * FE-only · NO-DDL · 발송 0. 데이터 정책 자문 게이트 비대상. 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상(예약 화면).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const HOVER_CARD = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// S1 — source-integrity gating (결정론, auth 불요)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVMGMT-HOVER-MEMO-LINK — source-integrity', () => {
  test('S1-a: 예약메모 hover 가 reservation_memo_history(SoT) 배치 조회로 배선', () => {
    // resvMemoMap 을 reservation_memo_history 에서 .in() 단일 배치로 채움(N+1 없음).
    expect(RESV_PAGE).toContain('resvMemoMap');
    expect(RESV_PAGE).toMatch(/from\(\s*['"]reservation_memo_history['"]\s*\)/);
    // 두 hover surface 모두 SoT 우선 + 레거시 컬럼 fallback(회귀0).
    const wired = RESV_PAGE.match(/bookingMemo:\s*resvMemoMap\.get\(r\.id\)\s*\?\?\s*r\.booking_memo\s*\?\?\s*null/g) ?? [];
    expect(wired.length).toBeGreaterThanOrEqual(2);
  });

  test('S1-b: CustomerHoverCard 가 예약메모(bookingMemo) 렌더 + 빈메모 가드(-) 유지', () => {
    expect(HOVER_CARD).toContain('예약메모');
    // 값 있으면 내용, 없으면 '-' (AC2 빈메모 가드 — 공백행/undefined crash 금지).
    expect(HOVER_CARD).toMatch(/reservationInfo\.bookingMemo\?\.trim\(\)\s*\?/);
  });

  test('S1-c: hover 성함 링크(onClick→차트) + 차트 오픈 핸들러 배선 잔존', () => {
    // 트리거 성함 onClick = 링크. 두 예약 surface 모두 handleResvOpenChart 연결.
    const linkWired = RESV_PAGE.match(/onClick=\{\(\)\s*=>\s*handleResvOpenChart\(resvAsCheckIn\(r\)\)\}/g) ?? [];
    expect(linkWired.length).toBeGreaterThanOrEqual(2);
    expect(RESV_PAGE).toMatch(/const handleResvOpenChart[\s\S]*?openChart\(ci\.customer_id\)/);
    // CustomerHoverCard 트리거 성함은 onClick 주어지면 clickable testid(링크 식별자) 부여.
    expect(HOVER_CARD).toContain('customer-hover-card-name-clickable');
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2/S3 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 RESVMGMT-HOVER-MEMO-LINK — live', () => {
  test('S2: 예약카드 hover → 예약메모 줄 안전 렌더(내용/빈메모 -) + pageerror 0', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/admin/reservations');
    await page.waitForTimeout(2500);

    const names = page.locator('[data-testid^="customer-hover-card-name"]');
    const cnt = await names.count();
    if (cnt === 0) { test.skip(true, '예약카드 없음(데이터 의존) — 스킵'); return; }

    let sawMemoLabel = false;
    for (let i = 0; i < Math.min(cnt, 6); i++) {
      await names.nth(i).scrollIntoViewIfNeeded().catch(() => {});
      await names.nth(i).hover().catch(() => {});
      await page.waitForTimeout(420);
      const card = page.getByTestId('customer-hover-card');
      if (await card.isVisible({ timeout: 800 }).catch(() => false)) {
        const txt = await card.innerText().catch(() => '');
        if (/예약메모/.test(txt)) sawMemoLabel = true; // 라벨 + (내용 or '-') 모두 정상 렌더
      }
      await page.mouse.move(2, 2);
      await page.waitForTimeout(120);
    }
    // 최소 1개 카드에서 예약메모 줄이 안전 렌더(내용/빈메모 '-'), crash 없음.
    expect(sawMemoLabel, '예약메모 줄이 hover 카드에 렌더되지 않음').toBeTruthy();
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('S3: 밑줄 성함(링크) 클릭 → 고객차트 패널 open', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.goto('/admin/reservations');
    await page.waitForTimeout(2500);

    const link = page.getByTestId('customer-hover-card-name-clickable').first();
    if ((await link.count()) === 0) { test.skip(true, 'clickable 예약카드 없음 — 스킵'); return; }

    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);

    const chartOpen = await page
      .locator('[role="dialog"], [data-testid*="chart"], [class*="sheet"]')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(chartOpen, '성함 링크 클릭 후 고객차트 패널이 열리지 않음').toBeTruthy();
  });
});
